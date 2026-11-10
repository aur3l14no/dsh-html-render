// The document a page runs in, shared by html_preview (headless Chrome on the
// Host) and the chat frame (a sandboxed srcdoc iframe in the Web client), so
// the PNG the model checks is the page the user sees.
import snapshot from './theme-snapshot.json' with { type: 'json' };

export const MESSAGE_SOURCE = 'dsh-html-render';
export const MIN_HEIGHT = 80;
export const MAX_HEIGHT = 2000;
export const MAX_FIT_HEIGHT = 20000;
export const MIN_WIDTH = 240;
export const MAX_WIDTH = 1600;
export const DEFAULT_WIDTH = 728;
export const MAX_HTML_LENGTH = 512_000;

/**
 * Model-facing theme variables and the DSH tokens they follow. The names match
 * T3 Code's html_render vocabulary, so pages written for either look the same.
 */
export const TOKENS = {
  '--background': '--dsw-alias-bg-base',
  '--foreground': '--dsw-alias-label-primary',
  '--muted': '--dsw-alias-markdown-tag',
  '--muted-foreground': '--dsw-alias-label-secondary',
  '--card': '--dsw-alias-markdown-code-block',
  '--card-foreground': '--dsw-alias-label-primary',
  '--popover': '--dsw-alias-bg-layer-2',
  '--popover-foreground': '--dsw-alias-label-primary',
  '--secondary': '--dsw-alias-interactive-bg-hover',
  '--secondary-foreground': '--dsw-alias-label-primary',
  '--border': '--dsw-alias-border-l2',
  '--ring': '--dsw-alias-state-business-primary',
  '--primary': '--dsw-alias-state-business-primary',
  '--primary-foreground': '--dsw-alias-label-primary-foreground',
  '--accent': '--dsw-alias-state-business-primary',
  '--accent-foreground': '--dsw-alias-label-primary-foreground',
  '--accent-surface': '--dsw-alias-state-business-tertiary',
  '--destructive': '--dsw-alias-state-error-primary',
  '--destructive-foreground': '--dsw-alias-label-primary-foreground',
  '--destructive-surface': '--dsw-alias-interactive-bg-hover-danger',
  '--warning': '--dsw-alias-state-warn-primary',
  '--warning-foreground': '--dsw-static-neutral-1000',
  '--warning-surface': '--dsw-alias-state-warn-tertiary',
  '--success': '--dsw-alias-state-success-primary',
  '--success-foreground': '--dsw-alias-label-primary-foreground',
  '--info': '--dsw-alias-state-business-primary',
  '--info-foreground': '--dsw-alias-label-primary-foreground',
  '--code-background': '--dsw-alias-markdown-code-block',
  '--code-foreground': '--dsw-alias-label-primary',
  '--chart-1': '--dsw-static-blue-500',
  '--chart-2': '--dsw-static-green-500',
  '--chart-3': '--dsw-static-amber-500',
  '--chart-4': '--dsw-static-violet-600',
  '--chart-5': '--dsw-static-red-500',
  '--chart-6': '--dsw-static-deepseek-450',
  '--radius': '--dsw-radius-md',
  '--font-sans': '--dsw-font-family',
  '--font-mono': '--ds-font-family-code',
};

/** Theme values recorded from the installed DSH stylesheets; see scripts/snapshot-theme.mjs. */
export const SNAPSHOT = snapshot;

/** `:root{...}` declaring every theme variable from a `{ '--name': value }` map. */
export function themeCss(values) {
  const lines = Object.keys(TOKENS)
    .filter(name => typeof values[name] === 'string' && values[name] !== '')
    .map(name => `${name}:${values[name].replace(/[<>{};]/g, '')}`);
  return `:root{${lines.join(';')}}`;
}

// The page owns everything after this sheet, so author rules win. The 8px html
// padding leaves room for focus rings and shadows; pages may override it.
const BASE_CSS = `html{padding:8px;margin:0;background:transparent;-webkit-text-size-adjust:100%}
body{margin:0;background:transparent;color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5}
*,*::before,*::after{box-sizing:border-box}`;

const PREVIEW_CSS = 'html{background:var(--background)}';

// Inside the frame: report the content height, follow theme changes, and hand
// link clicks to the parent, which opens http(s) links in a new tab. The frame
// has an opaque origin, so this is all it can say to DSH.
const BRIDGE = `(()=>{const S=${JSON.stringify(MESSAGE_SOURCE)},R=document.documentElement;
if(window.parent===window)return;
const post=m=>parent.postMessage(Object.assign({source:S},m),'*');
let last=-1;const measure=()=>{if(document.readyState==='loading')return;const h=Math.ceil(R.getBoundingClientRect().height);if(h>0&&h!==last){last=h;post({type:'height',height:h})}};
new ResizeObserver(measure).observe(R);document.addEventListener('DOMContentLoaded',measure);addEventListener('load',measure);
addEventListener('message',e=>{const d=e.data;if(e.source!==parent||!d||d.source!==S||d.type!=='theme')return;
const s=document.getElementById('dsh-html-theme');if(s)s.textContent=d.css;R.dataset.theme=d.appearance;R.style.colorScheme=d.appearance});
document.addEventListener('click',e=>{const a=e.target instanceof Element&&e.target.closest('a[href]');if(!a)return;
const href=a.getAttribute('href')||'';if(href.startsWith('#'))return;e.preventDefault();post({type:'link',url:a.href})},true);})();`;

/**
 * Wrap a page with the theme, base sheet and frame bridge.
 * @param html - the page as the model wrote it; a fragment is accepted.
 * @param options.css - theme variables, from {@link themeCss}.
 * @param options.appearance - `light` or `dark`.
 * @param options.preview - paint the theme background, as the chat behind the frame would.
 * @returns a complete HTML document.
 */
export function buildDocument(html, { css, appearance, preview = false }) {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<style id="dsh-html-theme">${css}</style>`
    + `<style>${BASE_CSS}${preview ? PREVIEW_CSS : ''}</style>`
    + `<script>${BRIDGE}</script>`;
  const scheme = `data-theme="${appearance}" style="color-scheme:${appearance}"`;
  const source = String(html);
  const headOpen = /<head(\s[^>]*)?>/i.exec(source);
  let body;
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    body = source.slice(0, at) + head + source.slice(at);
  } else {
    const htmlOpen = /<html(\s[^>]*)?>/i.exec(source);
    if (htmlOpen) {
      const at = htmlOpen.index + htmlOpen[0].length;
      body = `${source.slice(0, at)}<head>${head}</head>${source.slice(at)}`;
    } else {
      body = `<html><head>${head}</head><body>${source.replace(/^\s*<!doctype[^>]*>/i, '')}</body></html>`;
    }
  }
  // The root carries the appearance; an author attribute on <html> comes later and wins.
  body = body.replace(/<html(\s[^>]*)?>/i, match => match.replace(/^<html/i, `<html ${scheme}`));
  return /^\s*<!doctype/i.test(body) ? body : `<!doctype html>${body}`;
}

/** Problems T3 Code also refuses: viewport-relative heights make the fitted frame grow forever. */
export function layoutProblems(html) {
  const problems = [];
  const styles = [];
  for (const match of String(html).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) styles.push(match[1]);
  for (const match of String(html).matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) styles.push(match[2] ?? match[3]);
  const css = styles.join('\n');
  if (/(?<![\w-])\d*\.?\d+(?:[dsl]?vh|vmin|vmax)\b/i.test(css)) {
    problems.push('Uses viewport height units (vh/vmin/vmax); the frame fits the content, so give fixed pixel heights instead.');
  }
  if (/(?:^|[},\s])(?:html|body)(?:\s*,\s*(?:html|body))*\s*\{[^}]*(?<![\w-])(?:min-)?height\s*:\s*100%/i.test(css)) {
    problems.push('Sets height:100% on html or body; let the content set the height.');
  }
  return problems;
}

export function clampHeight(value, max = MAX_HEIGHT) {
  const number = Number.isFinite(value) ? Math.round(value) : MIN_HEIGHT;
  return Math.min(max, Math.max(MIN_HEIGHT, number));
}
