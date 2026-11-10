import test from 'node:test';
import assert from 'node:assert/strict';
import { SNAPSHOT, TOKENS, buildDocument, clampHeight, layoutProblems, themeCss } from '../src/shared/document.js';

const css = themeCss(SNAPSHOT.light);

test('the snapshot covers every theme variable in both appearances', () => {
  for (const appearance of ['light', 'dark']) {
    for (const name of Object.keys(TOKENS)) assert.ok(SNAPSHOT[appearance][name], `${appearance} ${name}`);
  }
});

test('theme values cannot close the style element or open a rule', () => {
  assert.equal(themeCss({ '--background': 'red</style><script>x()</script>{}' }), ':root{--background:red/stylescriptx()/script}');
});

test('the theme and bridge go first in the head so author rules win', () => {
  const doc = buildDocument('<!DOCTYPE html><html lang="en"><head><style>body{color:red}</style></head><body>x</body></html>', { css, appearance: 'dark' });
  assert.match(doc, /^<!DOCTYPE html><html data-theme="dark" style="color-scheme:dark" lang="en"><head><meta charset/);
  assert.ok(doc.indexOf('id="dsh-html-theme"') < doc.indexOf('body{color:red}'));
  assert.equal((doc.match(/<head/g) ?? []).length, 1);
});

test('documents without a head or without html still get one wrapper', () => {
  const noHead = buildDocument('<html><body>a</body></html>', { css, appearance: 'light' });
  assert.match(noHead, /^<!doctype html><html data-theme="light" style="color-scheme:light"><head><meta/);
  const fragment = buildDocument('<!doctype html><div>a</div>', { css, appearance: 'light' });
  assert.match(fragment, /<body><div>a<\/div><\/body><\/html>$/);
  assert.equal((fragment.match(/<!doctype/gi) ?? []).length, 1);
});

test('preview paints the thread background; the chat frame stays transparent', () => {
  assert.match(buildDocument('x', { css, appearance: 'light', preview: true }), /html\{background:var\(--background\)\}/);
  assert.doesNotMatch(buildDocument('x', { css, appearance: 'light' }), /html\{background:var\(--background\)\}/);
});

test('viewport-relative heights are reported, ordinary CSS is not', () => {
  assert.equal(layoutProblems('<style>.a{height:300px;width:100%}</style><p>100vh in prose</p>').length, 0);
  assert.equal(layoutProblems('<style>.chart{min-height:50vh}</style>').length, 1);
  assert.equal(layoutProblems('<div style="height: 100dvh"></div>').length, 1);
  assert.equal(layoutProblems('<style>html, body { height: 100% }</style>').length, 1);
  assert.equal(layoutProblems('<style>.box { height: 100% }</style>').length, 0);
});

test('heights clamp to the frame range', () => {
  assert.equal(clampHeight(10), 80);
  assert.equal(clampHeight(5000), 2000);
  assert.equal(clampHeight(5000, 20000), 5000);
  assert.equal(clampHeight(undefined), 80);
});
