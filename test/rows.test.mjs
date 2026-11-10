import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// React and DSH's primitives come from the browser; the row model needs neither.
registerHooks({
  resolve: (specifier, context, next) => ['react', '@deepseek-ai/dsh-client-ui-primitives'].includes(specifier)
    ? { url: 'data:text/javascript,export default {}', shortCircuit: true } : next(specifier, context),
});
const { rowModel } = await import('../src/rows.js');

test('rows read arguments, text and the screenshot from each stage', () => {
  const argsRaw = JSON.stringify({ html: '<p>x</p>', width: 400, appearance: 'dark' });
  assert.equal(rowModel({ phase: 'preparing', block: {} }).state, 'preparing');
  assert.deepEqual(rowModel({ phase: 'start', block: { argsRaw } }).args.width, 400);
  const image = { attachmentId: 'sha256:x', width: 400, height: 120 };
  const done = rowModel({ phase: 'result', block: {
    isError: false, call: { argsRaw }, content: [{ type: 'text', text: 'contentHeight: 120px at width 400px' }, { type: 'image', attachment: image }],
  } });
  assert.equal(done.state, 'done');
  assert.equal(done.image, image);
  assert.match(done.text, /^contentHeight: 120px/);
  const failed = rowModel({ phase: 'result', block: { isError: true, call: null, content: [], error: { code: 'TOOL_ERROR', reason: 'bad html' } } });
  assert.deepEqual([failed.state, failed.text, failed.args], ['error', 'bad html', {}]);
});
