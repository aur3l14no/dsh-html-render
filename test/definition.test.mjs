import test from 'node:test';
import assert from 'node:assert/strict';
import { NODE_KIND, htmlRenderDefinition as definition, isRenderMeta } from '../src/shared/definition.js';

const call = (seq, callId, name, args) => ({ type: 'tool/call', seq, data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) } });
const META = { tool: 'html_render', title: 'T', height: 90 };
const result = (seq, callId, extra = {}) => ({ type: 'tool/result', seq, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, isError: extra.isError ?? false, content: [] }, ...(extra.isError ? {} : { meta: extra.meta ?? META }) } });

/** Drive the Definition the way the Conversation engine does for one Context. */
function run(events) {
  const location = { kind: 'step', turn: 1, step: 1 };
  let context;
  for (const event of events) {
    const matched = definition.match[event.type]?.(event);
    if (!matched) continue;
    const match = { event, role: matched.role, location };
    if (!context) {
      if (matched.role !== 'start') continue;
      context = { key: `${NODE_KIND}:${matched.id}`, kind: NODE_KIND, id: matched.id, start: match, state: undefined };
      context = { ...context, state: definition.start(context, match, { previous: () => undefined }) };
    } else if (matched.id === context.id) {
      context = { ...context, state: definition.update(context, match) };
    }
  }
  return context && definition.buildViewNode(context);
}

test('a successful html_render becomes a turn-level Chat node anchored at its result', () => {
  const node = run([call(10, 'c1', 'html_render', { html: '<p>x</p>', title: 'Chart', height: 160 }), result(12, 'c1')]);
  assert.deepEqual(node, {
    key: 'html-render:c1', kind: 'html-render', id: 'c1', target: 'chat', anchorSeq: 12,
    location: { kind: 'step', turn: 1, step: 1 }, visibility: 'visible', groupTree: 'turn',
    data: { callId: 'c1', html: '<p>x</p>', title: 'T', height: 90 },
  });
});

test('inlined html from meta wins; running, failed and other calls show nothing', () => {
  const inlined = run([call(1, 'c', 'html_render', { html: '<img src="/a.png">', title: 'T', height: 90 }), result(2, 'c', { meta: { ...META, html: '<img src="data:x">' } })]);
  assert.equal(inlined.data.html, '<img src="data:x">');
  assert.equal(run([call(1, 'c', 'html_render', { html: '<p>x</p>', title: 'T', height: 90 })]), null);
  assert.equal(run([call(1, 'c', 'html_render', { html: '<p>x</p>', title: 'T', height: 90 }), result(2, 'c', { isError: true })]), null);
  assert.equal(definition.match['tool/call'](call(1, 'c', 'bash', {})), null);
  assert.equal(run([call(1, 'c', 'html_render', '{not json'), result(2, 'c')]), null);
});

test('only html_render results are claimed, so other tools leave no pending Context', () => {
  const other = { type: 'tool/result', seq: 5, data: { message: { role: 'tool', toolCallId: 'x', content: [] }, meta: { path: '/a' } } };
  assert.equal(definition.match['tool/result'](other), null);
  assert.equal(definition.match['tool/result']({ ...other, data: { message: other.data.message } }), null);
  assert.deepEqual(definition.match['tool/result'](result(6, 'r')), { id: 'r', role: 'update' });
  assert.equal(isRenderMeta({ title: 'Old', height: 120 }), true, 'results logged before the marker');
  assert.equal(isRenderMeta({ tool: 'other', title: 'x', height: 1 }), false);
});

test('a result whose call is outside the loaded window builds nothing until the call loads', () => {
  assert.equal(run([result(2, 'c')]), undefined);
});
