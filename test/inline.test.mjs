import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileReader, inlineLocalImages, isImageBytes, readPage } from '../src/host/inline.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('absolute and file: image references become data URIs; URLs and relative paths stay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'html-render-'));
  const png = join(dir, 'a b.png');
  await writeFile(png, PNG);
  const svg = join(dir, 'icon.svg');
  await writeFile(svg, '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
  const html = `<img src="${encodeURI(png)}"><img src='${pathToFileURL(svg)}'>`
    + `<style>.x{background:url(${svg})}</style><img src="https://example.com/a.png"><img src="rel.png"><a href="/docs/page">x</a>`
    + `<script>const shots = [\`${png}\`];</script>`;
  const result = await inlineLocalImages(html, fileReader(undefined));
  assert.equal(result.inlined, 2);
  assert.deepEqual(result.problems, []);
  assert.match(result.html, /<img src="data:image\/png;base64,iVBORw=="><img src='data:image\/svg\+xml;base64,/);
  assert.match(result.html, /url\(data:image\/svg\+xml;base64,[^)]+\)/);
  assert.match(result.html, /https:\/\/example.com\/a.png.*rel\.png.*href="\/docs\/page"/);
  assert.match(result.html, /const shots = \[`data:image\/png;base64,iVBORw==`\]/);
});

test('missing files and files that are not images are left as they were and reported', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'html-render-'));
  const secret = join(dir, 'key.png');
  await writeFile(secret, '-----BEGIN OPENSSH PRIVATE KEY-----');
  const html = `<img src="/no/such/file.png"><img src="${secret}">`;
  const result = await inlineLocalImages(html, fileReader(undefined));
  assert.equal(result.html, html);
  assert.equal(result.inlined, 0);
  assert.match(result.problems[0], /^\/no\/such\/file\.png could not be read: /);
  assert.equal(result.problems[1], `${secret} is not an image file.`);
});

test('image bytes are recognized by their signature', () => {
  assert.ok(isImageBytes(PNG));
  assert.ok(isImageBytes(Buffer.from('GIF89a')));
  assert.ok(isImageBytes(Buffer.from('<!-- c --><!DOCTYPE svg [<!ENTITY a "x>">]><svg>')));
  assert.ok(!isImageBytes(Buffer.from('<html><svg></svg></html>')));
  assert.ok(!isImageBytes(Buffer.from('AWS_SECRET=1')));
});

test('the Session filesystem is used when one is mounted', async () => {
  const calls = [];
  const fs = {
    resolve: async (path, { cwd }) => { calls.push(['resolve', path, cwd]); return { path }; },
    stat: async () => ({ type: 'file' }),
    readBytes: async (target, _signal, maxBytes) => { calls.push(['read', target.path, maxBytes]); return Buffer.from('GIF8'); },
  };
  const result = await inlineLocalImages('<img src="/w/a.gif">', fileReader(fs, '/w'));
  assert.equal(result.html, '<img src="data:image/gif;base64,R0lGOA==">');
  assert.deepEqual(calls[0], ['resolve', '/w/a.gif', '/w']);
});

test('a page file must be an absolute .html path to a document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'html-render-'));
  const page = join(dir, 'chart.html');
  await writeFile(page, '﻿\n<!DOCTYPE html><p>hi</p>');
  const notPage = join(dir, 'notes.html');
  await writeFile(notPage, 'TOKEN=abc');
  const read = fileReader(undefined);
  assert.equal(await readPage(read, page, 1000), '\n<!DOCTYPE html><p>hi</p>');
  await assert.rejects(readPage(read, 'chart.html', 1000), /chart\.html is not a readable HTML document\. Pass an absolute path/);
  await assert.rejects(readPage(read, join(dir, 'a.txt'), 1000), /is not a readable HTML document/);
  await assert.rejects(readPage(read, notPage, 1000), /notes\.html is not a readable HTML document\./);
  await assert.rejects(readPage(read, join(dir, 'gone.html'), 1000), /gone\.html is not a readable HTML document \(ENOENT/);
  await assert.rejects(readPage(read, page, 2), /larger than/);
});
