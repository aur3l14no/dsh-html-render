// Record the light and dark values of every theme variable from the installed
// DSH token sheets, so html_preview paints what the chat frame will show.
// Usage: DSH_RUNTIME_ROOT=/path/to/dsh/app node scripts/snapshot-theme.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { TOKENS } from '../src/shared/document.js';

const root = process.env.DSH_RUNTIME_ROOT;
if (!root) throw new Error('Set DSH_RUNTIME_ROOT to the app directory of an installed DSH (the one whose node_modules holds @deepseek-ai/dsh-client-ui-theme)');
const require = createRequire(join(root, 'package.json'));
const themeEntry = require.resolve('@deepseek-ai/dsh-client-ui-theme/client');
const bundle = await readFile(themeEntry, 'utf8');
const sheets = [];
for (const name of ['base', 'design_platform']) {
  const match = new RegExp(`var ${name}_css_default = ("(?:[^"\\\\]|\\\\.)*");`).exec(bundle);
  if (!match) throw new Error(`${name}.css not found in ${themeEntry}; the theme bundle layout changed`);
  sheets.push(JSON.parse(match[1]));
}
const manifest = JSON.parse(await readFile(join(themeEntry, '../../package.json'), 'utf8'));

const browser = await chromium.launch({ channel: 'chrome', executablePath: process.env.CHROME_PATH || undefined });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><style>${sheets.join('\n')}</style></head><body></body></html>`);
  const read = dark => page.evaluate(({ tokens, dark }) => {
    document.body.toggleAttribute('data-ds-dark-theme', dark);
    const style = getComputedStyle(document.body);
    return Object.fromEntries(Object.entries(tokens).map(([name, source]) => [name, style.getPropertyValue(source).trim()]));
  }, { tokens: TOKENS, dark });
  const snapshot = { source: `${manifest.name}@${manifest.version}`, light: await read(false), dark: await read(true) };
  for (const appearance of ['light', 'dark']) {
    const missing = Object.entries(snapshot[appearance]).filter(([, value]) => value === '').map(([name]) => name);
    if (missing.length > 0) throw new Error(`No ${appearance} value for ${missing.join(', ')}; update TOKENS`);
  }
  await writeFile(new URL('../src/shared/theme-snapshot.json', import.meta.url), `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Recorded ${Object.keys(TOKENS).length} variables from ${snapshot.source}`);
} finally {
  await browser.close();
}
