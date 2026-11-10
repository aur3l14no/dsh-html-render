import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Loader and lifetime contract of the built client module; the frame itself is covered by frame.test.mjs.
test('built client uses shared React and releases every registration', async () => {
  const artifact = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  let definition;
  const head = new Set();
  const document = { head: { append: node => head.add(node) }, createElement: () => ({ dataset: {}, remove() { head.delete(this); } }) };
  vm.runInNewContext(artifact, { document, window: { __ModuleLoader__: { load(value) { definition = value; } } } });
  assert.equal(definition.id, manifest.name);
  const plugin = definition.factory(name => {
    assert.ok(['react', '@deepseek-ai/dsh-client-ui-primitives'].includes(name), name);
    return name === 'react' ? { createElement() {}, memo: component => component } : {};
  });
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale', 'uiConversation']);
  const active = new Set();
  const cleanup = [];
  const definitions = [];
  plugin.apply({
    effect(fn) { cleanup.push(fn()); },
    uiConversation: { events: { register(definition) { definitions.push(definition.kind); } } },
    locale: { register(namespace, locale, dict) {
      assert.equal(namespace, manifest.name);
      assert.ok(dict.fullscreen && dict['row.previewTitle'] && dict['row.source']);
      active.add(locale);
      return () => active.delete(locale);
    } },
    slots: {
      inject(name, fn) { assert.equal(fn.length, 0); cleanup.push(fn()); },
      register(entry, component) {
        assert.equal(typeof component, 'function');
        const key = entry.key;
        active.add(key);
        return () => active.delete(key);
      },
    },
  });
  assert.deepEqual(definitions, ['html-render']);
  assert.deepEqual([...active].sort(), ['en', 'html-render', 'html_preview', 'html_render', 'zh']);
  assert.equal(head.size, 1);
  for (const dispose of cleanup) dispose();
  assert.equal(active.size, 0);
  assert.equal(head.size, 0);
});
