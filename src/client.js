import React from 'react';
import { MAX_FIT_HEIGHT, MESSAGE_SOURCE, TOKENS, buildDocument, clampHeight, themeCss } from './shared/document.js';
import { NODE_KIND, htmlRenderDefinition } from './shared/definition.js';
import { PreviewRow, RenderRow } from './rows.js';
import css from './style.css';
import en from '../locale/en.json';
import zh from '../locale/zh.json';

const h = React.createElement;
const NS = '@local/dsh-html-render';
// A page whose height keeps growing as its frame grows is following the frame; stop fitting it.
const MAX_GROWTH_STEPS = 24;

// The live DSH theme as the frame's variables, recomputed when the body's theme attributes change.
const theme = (() => {
  let current;
  const listeners = new Set();
  const read = () => {
    const style = getComputedStyle(document.body);
    const values = {};
    for (const [name, source] of Object.entries(TOKENS)) values[name] = style.getPropertyValue(source).trim();
    const appearance = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
    return { css: themeCss(values), appearance };
  };
  let observer;
  return {
    get() {
      current ??= read();
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (!observer) {
        observer = new MutationObserver(() => {
          const next = read();
          if (next.css === current?.css && next.appearance === current?.appearance) return;
          current = next;
          for (const notify of listeners) notify();
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) { observer?.disconnect(); observer = undefined; current = undefined; }
      };
    },
  };
})();

function useTheme() {
  return React.useSyncExternalStore(theme.subscribe, theme.get, theme.get);
}

function openLink(url) {
  try {
    const target = new URL(url);
    if (target.protocol === 'http:' || target.protocol === 'https:') window.open(target.href, '_blank', 'noopener,noreferrer');
  } catch {}
}

function Frame({ render, t }) {
  const current = useTheme();
  const frame = React.useRef(null);
  const box = React.useRef(null);
  const [height, setHeight] = React.useState(() => clampHeight(render.height));
  const [fullscreen, setFullscreen] = React.useState(false);
  // Theme changes go to the running page by message, so the document is built once.
  const initial = React.useRef(current);
  const srcDoc = React.useMemo(
    () => buildDocument(render.html, { css: initial.current.css, appearance: initial.current.appearance }),
    [render.html],
  );

  React.useEffect(() => {
    let growth = 0;
    let last = 0;
    const onMessage = event => {
      const data = event.data;
      if (event.source !== frame.current?.contentWindow || data?.source !== MESSAGE_SOURCE) return;
      if (data.type === 'height' && Number.isFinite(data.height)) {
        growth = data.height > last ? growth + 1 : 0;
        last = data.height;
        if (growth <= MAX_GROWTH_STEPS) setHeight(clampHeight(data.height, MAX_FIT_HEIGHT));
      } else if (data.type === 'link' && typeof data.url === 'string') {
        openLink(data.url);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const postTheme = React.useCallback(() => {
    frame.current?.contentWindow?.postMessage({ source: MESSAGE_SOURCE, type: 'theme', ...current }, '*');
  }, [current]);
  React.useEffect(postTheme, [postTheme]);

  React.useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement === box.current) document.exitFullscreen?.().catch(() => {});
    else box.current?.requestFullscreen?.().catch(() => {});
  };

  return h('figure', { className: 'dsh-html-render', ref: box, 'data-appearance': current.appearance },
    h('iframe', {
      ref: frame,
      title: render.title,
      srcDoc,
      // No allow-same-origin: the page gets an opaque origin and cannot reach DSH's DOM, storage or cookies.
      sandbox: 'allow-scripts allow-forms',
      referrerPolicy: 'no-referrer',
      loading: 'lazy',
      onLoad: postTheme,
      style: { height: fullscreen ? '100%' : height, colorScheme: current.appearance },
    }),
    h('div', { className: 'dsh-html-render-actions' },
      h('button', {
        type: 'button',
        className: 'dsh-html-render-button',
        onClick: toggleFullscreen,
        'aria-label': fullscreen ? t('exitFullscreen') : t('fullscreen'),
        title: fullscreen ? t('exitFullscreen') : t('fullscreen'),
      }, fullscreen ? '⤡' : '⤢')));
}

/** One html_render page, as a Chat node where its call happened. */
const HtmlRenderNode = React.memo(function HtmlRenderNode({ node, t }) {
  return h('div', { className: 'dsh-html-render-node' }, h(Frame, { render: node.data, t }));
});

export const inject = ['slots', 'locale', 'uiConversation'];

// One stylesheet serves the tool rows and the page frames.
function installStyle() {
  const style = document.createElement('style');
  style.dataset.plugin = NS;
  style.textContent = css;
  document.head.append(style);
  return () => style.remove();
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, 'en', en.ui));
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh.ui));
  ctx.effect(installStyle);
  for (const [key, Row] of [['html_preview', PreviewRow], ['html_render', RenderRow]]) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS }, Row));
  }
  ctx.uiConversation.events.register(htmlRenderDefinition);
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: NODE_KIND,
    locale: NS,
  }, HtmlRenderNode));
}
