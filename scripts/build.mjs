// Bundle src/client.js into the self-contained client module DSH loads; React comes from DSH.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

// Both come from DSH at load time.
const EXTERNAL = new Set(['react', '@deepseek-ai/dsh-client-ui-primitives']);
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const result = await build({
  entryPoints: [new URL('../src/client.js', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  external: [...EXTERNAL],
  loader: { '.css': 'text' },
  metafile: true,
});
for (const output of Object.values(result.metafile.outputs)) {
  for (const dependency of output.imports) {
    if (!EXTERNAL.has(dependency.path)) throw new Error(`Unexpected runtime dependency: ${dependency.path}`);
  }
}
const artifact = `/* ${manifest.name} ${manifest.version} */\n`
  + `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory(require){\n`
  + `const module={exports:{}};const exports=module.exports;\n`
  + result.outputFiles[0].text + `\nreturn module.exports;\n}});\n`;
await writeFile(new URL('../client.js', import.meta.url), artifact);
console.log(`Built ${manifest.name}: ${Buffer.byteLength(artifact).toLocaleString()} bytes.`);
