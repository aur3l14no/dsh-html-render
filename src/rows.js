// Tool-call rows for html_preview and html_render, in place of the generic
// row, which prints the whole page as input and the screenshot as JSON.
import React from 'react';
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives';

const h = React.createElement;

function parseArgs(raw) {
  try {
    const value = JSON.parse(raw ?? '');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** What a row shows, from whichever stage the call has reached. */
export function rowModel(props) {
  const { phase, block } = props;
  if (phase === 'preparing') return { state: 'preparing', args: {}, text: '', image: undefined };
  const raw = phase === 'start' ? block.argsRaw : block.call?.argsRaw;
  const args = parseArgs(raw);
  if (phase === 'start') return { state: 'running', args, text: '', image: undefined };
  const content = Array.isArray(block.content) ? block.content : [];
  const text = content.filter(item => item?.type === 'text').map(item => item.text).join('\n').trim();
  const image = content.find(item => item?.type === 'image' && item.attachment)?.attachment;
  const state = block.isError ? (block.error?.code === 'ABORTED' ? 'stopped' : 'error') : 'done';
  return { state, args, text: text || block.error?.reason || '', image };
}

function Icon({ name, ...rest }) {
  const Component = Primitives[name];
  return Component ? h(Component, { size: 14, ...rest }) : null;
}

function Shimmer({ active, children }) {
  const Component = Primitives.TextShimmer;
  return Component ? h(Component, { active }, children) : h('span', null, children);
}

function Screenshot({ attachment, loadImage, alt }) {
  const [url, setUrl] = React.useState(() => loadImage?.peek?.(attachment));
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    if (!url && loadImage) loadImage(attachment).then(value => { if (live) setUrl(value); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [attachment, loadImage, url]);
  if (failed) return null;
  return h('div', { className: 'dsh-html-row-shot', style: { aspectRatio: attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : undefined, maxWidth: attachment.width } },
    url ? h('img', { src: url, alt, width: attachment.width, height: attachment.height }) : null);
}

function Section({ label, children }) {
  return h('section', { className: 'dsh-html-row-section', 'aria-label': label },
    h('div', { className: 'dsh-html-row-header' }, label),
    children);
}

function HtmlToolRow(props, kind) {
  const { t, inspect, loadImage } = props;
  const model = rowModel(props);
  const [open, setOpen] = React.useState(false);
  const running = model.state === 'preparing' || model.state === 'running';
  // A page passed by path is shown by its path: the file may have changed since.
  const source = typeof model.args.path === 'string' ? model.args.path : model.args.html;
  const expandable = !running && (typeof source === 'string' || model.text !== '');
  const expanded = open && expandable;

  let summary;
  if (model.state === 'error') summary = model.text.split('\n')[0];
  else if (model.state === 'stopped') summary = t('row.stopped');
  else if (kind === 'render') summary = typeof model.args.title === 'string' ? model.args.title : '';
  else {
    const width = Number.isInteger(model.args.width) ? model.args.width : 728;
    const appearance = model.args.appearance === 'dark' ? t('row.dark') : t('row.light');
    const height = /^contentHeight: (\d+)px/.exec(model.text)?.[1];
    summary = [height ? `${width} × ${height}px` : `${width}px`, appearance].join(' · ');
  }

  const toggle = () => setOpen(value => !value);
  const disclosure = expandable ? {
    role: 'button',
    tabIndex: 0,
    'aria-expanded': expanded,
    onClick: toggle,
    onKeyDown: event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    },
  } : {};
  const leading = expanded
    ? h(Icon, { name: 'IconChevronDownOutlineRegular' })
    : expandable
      ? [h('span', { key: 'icon', className: 'dsh-html-row-idle' }, h(Icon, { name: 'IconCodeOutlineRegular' })),
        h('span', { key: 'chevron', className: 'dsh-html-row-hover' }, h(Icon, { name: 'IconChevronDownOutlineRegular' }))]
      : h(Icon, { name: 'IconCodeOutlineRegular' });

  // The text result repeats the measured height already in the summary; keep problems and console.
  const details = kind === 'preview' ? model.text.replace(/^contentHeight:[^\n]*\n?/, '') : model.text;

  return h('div', { className: 'dsh-html-row', 'data-state': model.state, 'data-tool': `html_${kind}` },
    h('div', { className: 'dsh-html-row-line', 'data-expandable': expandable || undefined, ...disclosure },
      h('span', { className: 'dsh-html-row-leading' }, leading),
      h(Shimmer, { active: running },
        h('span', { className: 'dsh-html-row-title' }, t(kind === 'preview' ? 'row.previewTitle' : 'row.renderTitle')),
        summary ? h('span', { className: 'dsh-html-row-dot', 'aria-hidden': true }) : null,
        summary ? h('span', { className: 'dsh-html-row-summary', 'data-state': model.state }, summary) : null)),
    expanded ? h('div', { className: 'dsh-html-row-body' },
      model.image ? h(Screenshot, { attachment: model.image, loadImage, alt: t('row.screenshot') }) : null,
      details && (kind === 'preview' || model.state !== 'done') ? h(Section, { label: t('row.result') }, h('pre', { 'data-state': model.state }, details)) : null,
      typeof source === 'string' ? h(Section, { label: t('row.source') }, h('pre', null, source)) : null,
      inspect ? h('button', { type: 'button', className: 'dsh-html-row-inspect', onClick: inspect },
        h(Icon, { name: 'IconInspectOutlineRegular', size: 12 }), t('row.inspect')) : null) : null);
}

export const PreviewRow = props => HtmlToolRow(props, 'preview');
export const RenderRow = props => HtmlToolRow(props, 'render');
