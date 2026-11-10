// A Chat node per successful html_render call, placed where the call happened
// and kept outside the folded process, so the page reads inline with the turn.
export const NODE_KIND = 'html-render';
const TOOL = 'html_render';

function parseArgs(raw) {
  try {
    const value = JSON.parse(raw ?? '');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** html_render's result meta: `{ tool: 'html_render', title, height, html? }`; older results lack `tool`. */
export function isRenderMeta(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.tool !== undefined) return meta.tool === TOOL;
  return typeof meta.title === 'string' && Number.isFinite(meta.height);
}

/** The page a successful result shows: inlined html from meta, else the call's own. */
function pageOf(context, meta) {
  const args = context.state.args;
  const recorded = meta && typeof meta === 'object' ? meta : {};
  const html = typeof recorded.html === 'string' ? recorded.html : args.html;
  if (typeof html !== 'string' || html === '') return null;
  const title = typeof recorded.title === 'string' ? recorded.title : args.title;
  const height = Number.isFinite(recorded.height) ? recorded.height : args.height;
  return { callId: context.id, html, title: typeof title === 'string' && title ? title : 'HTML', height };
}

export const htmlRenderDefinition = {
  kind: NODE_KIND,
  target: 'chat',
  match: {
    'tool/call': event => event.data?.name === TOOL ? { id: String(event.data.callId), role: 'start' } : null,
    // tool/result carries no tool name, and an update without a start stays pending,
    // so only results whose meta html_render wrote are claimed.
    'tool/result': event => {
      const callId = event.data?.message?.toolCallId;
      return callId !== undefined && isRenderMeta(event.data.meta) ? { id: String(callId), role: 'update' } : null;
    },
  },
  start: (_context, match) => {
    const args = parseArgs(match.event.data.arguments);
    return { args, seq: undefined, page: undefined };
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state;
    const data = match.event.data;
    return { ...context.state, seq: match.event.seq, page: data.message?.isError === true ? null : pageOf(context, data.meta) };
  },
  buildViewNode: context => {
    const state = context.state;
    if (!state?.page) return null;
    return {
      key: context.key,
      kind: NODE_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      groupTree: 'turn',
      data: state.page,
    };
  },
};
