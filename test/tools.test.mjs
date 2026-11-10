// Runs the tools against real headless Chrome (Google Chrome, or CHROME_PATH).
// Host packages come from the devDependencies, or from an installed DSH when
// DSH_RUNTIME_ROOT is set: DSH_RUNTIME_ROOT=/path/to/dsh/app npm test
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeRoot = process.env.DSH_RUNTIME_ROOT;
if (runtimeRoot) {
  const parentURL = pathToFileURL(resolve(runtimeRoot, 'package.json')).href;
  registerHooks({
    resolve: (specifier, context, next) => next(specifier, specifier.startsWith('@deepseek-ai/') ? { ...context, parentURL } : context),
  });
}
const { apply, name, inject, Config } = await import('../index.js');

function mount({ acceptsImages = true } = {}) {
  const tools = new Map();
  const disposers = [];
  const saved = [];
  const services = {
    attachments: { saveImage: async image => { saved.push(image); return { id: `img-${saved.length}`, mediaType: image.mediaType }; } },
    llm: { resolveModelInfo: async () => ({ inputModalities: acceptsImages ? ['text', 'image'] : ['text'] }) },
  };
  const ctx = {
    tools: { register: definition => tools.set(definition.name, definition) },
    effect: fn => disposers.push(fn()),
    get: key => services[key],
    logger: { warn() {} },
  };
  apply(ctx, { browserPath: process.env.CHROME_PATH ?? '' });
  const agent = { options: { provider: 'p', model: 'm' }, session: {} };
  const run = (name, args) => tools.get(name).execute(args, { agent, signal: new AbortController().signal });
  return { tools, run, saved, dispose: () => Promise.all(disposers.map(fn => fn())) };
}

const mounted = [];
after(() => Promise.all(mounted.map(item => item.dispose())));

const PAGE = `<!doctype html><html><head><style>
  .bar{height:24px;background:var(--chart-1);border-radius:var(--radius);margin:8px 0}
</style></head><body><h3>Sales</h3><div class="bar" style="width:60%"></div><div class="bar" style="width:30%"></div>
<script>console.log('rendered', getComputedStyle(document.documentElement).getPropertyValue('--background'))</script></body></html>`;

test('html_preview returns contentHeight, console output and a PNG', async () => {
  const plugin = mount();
  mounted.push(plugin);
  const value = await plugin.run('html_preview', { html: PAGE, appearance: 'dark', width: 400 });
  assert.ok(value.contentHeight > 80 && value.contentHeight < 300, `contentHeight ${value.contentHeight}`);
  assert.match(value.text, /^contentHeight: \d+px at width 400px, dark theme/);
  assert.match(value.text, /\[log\] rendered #151517/);
  assert.doesNotMatch(value.text, /Problems:/);
  assert.equal(value.image.id, 'img-1');
  const png = plugin.saved[0].data;
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 400);
  assert.equal(png.readUInt32BE(20), value.contentHeight);
  const content = plugin.tools.get('html_preview').output.render({}, value);
  assert.deepEqual(content.map(block => block.type), ['text', 'image']);
});

test('html_preview flags content that follows the frame height and reports page errors', async () => {
  const plugin = mount({ acceptsImages: false });
  mounted.push(plugin);
  const value = await plugin.run('html_preview', { html: '<style>body{min-height:100vh}</style><p>x</p><script>nope()</script>' });
  assert.match(value.text, /Problems:\n- Uses viewport height units/);
  assert.match(value.text, /Content height follows the frame height/);
  assert.match(value.text, /\[pageerror\] nope is not defined/);
  assert.match(value.text, /does not accept images/);
  assert.equal(value.image, undefined);
  assert.equal(plugin.saved.length, 0);
});

test('html_render refuses viewport heights and keeps the page out of model content', async () => {
  const plugin = mount();
  mounted.push(plugin);
  await assert.rejects(plugin.run('html_render', { html: '<style>html,body{height:100%}</style>', title: 'T', height: 200 }), /height:100% on html or body/);
  await assert.rejects(plugin.run('html_render', { html: '<p>x</p>', title: 'T', height: 5000 }), /height must be an integer from 80 to 2000/);
  const definition = plugin.tools.get('html_render');
  const value = await plugin.run('html_render', { html: PAGE, title: ' Sales ', height: 160 });
  assert.deepEqual(value, { title: 'Sales', height: 160 });
  assert.deepEqual(definition.output.render({}, value), [{ type: 'text', text: 'Rendered "Sales" for the user.' }]);
  assert.deepEqual(definition.output.presentationMeta({}, value), { tool: 'html_render', title: 'Sales', height: 160 });
});

test('both tools take a page file by path, and html_render keeps a snapshot of it', async () => {
  const plugin = mount({ acceptsImages: false });
  mounted.push(plugin);
  const dir = await mkdtemp(join(tmpdir(), 'html-render-'));
  const file = join(dir, 'sales.html');
  await writeFile(file, PAGE);
  const shot = await plugin.run('html_preview', { path: file, width: 400 });
  assert.match(shot.text, /^contentHeight: \d+px at width 400px, light theme/);
  const value = await plugin.run('html_render', { path: file, title: 'Sales', height: 160 });
  assert.deepEqual(value, { title: 'Sales', height: 160, path: file, html: PAGE });
  await writeFile(file, '<!doctype html><p>edited later</p>');
  assert.deepEqual(plugin.tools.get('html_render').output.presentationMeta({}, value), { tool: 'html_render', title: 'Sales', height: 160, path: file, html: PAGE });
  await assert.rejects(plugin.run('html_render', { path: file, html: PAGE, title: 'T', height: 160 }), /Pass exactly one of html or path/);
  await assert.rejects(plugin.run('html_preview', {}), /Pass exactly one of html or path/);
  await assert.rejects(plugin.run('html_render', { path: join(dir, 'missing.html'), title: 'T', height: 160 }), /missing\.html is not a readable HTML document/);
});

test('html_render refuses a page whose local images cannot be inlined', async () => {
  const plugin = mount();
  mounted.push(plugin);
  await assert.rejects(
    plugin.run('html_render', { html: '<img src="/no/such/chart.png">', title: 'T', height: 160 }),
    /\/no\/such\/chart\.png could not be read: .* Fix the page/,
  );
  const value = await plugin.run('html_preview', { html: '<img src="/no/such/chart.png">' });
  assert.match(value.text, /Problems:\n- \/no\/such\/chart\.png could not be read/);
});

test('the DSH tool registry accepts both tools and shows the model their schemas', async t => {
  const [{ Context }, { SystemPrompt }, { ToolRuntime }, native] = await Promise.all([
    import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-system-prompt'),
    import('@deepseek-ai/dsh-tools'), import('@deepseek-ai/dsh-tool-executor-native'),
  ]);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false });
  await ctx.plugin(ToolRuntime, {});
  await ctx.plugin(native, {});
  await ctx.plugin({ name, inject, Config, apply }, {});
  const schemas = Object.fromEntries(ctx.tools.schemas().map(schema => [schema.name, schema]));
  assert.deepEqual(Object.keys(schemas).sort(), ['html_preview', 'html_render']);
  assert.deepEqual(schemas.html_render.parameters.required.sort(), ['height', 'title']);
  assert.deepEqual(Object.keys(schemas.html_preview.parameters.properties).slice(0, 2), ['path', 'html']);
  assert.deepEqual(schemas.html_preview.parameters.properties.appearance.enum, ['light', 'dark']);
  assert.match(schemas.html_render.description, /--chart-1 to --chart-6/);
});
