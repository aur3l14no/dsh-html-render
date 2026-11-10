// The frame contract in a real browser: a sandboxed srcdoc iframe reports its
// content height, applies theme messages, hands links to the parent, and cannot
// reach the parent's DOM or storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { MESSAGE_SOURCE, SNAPSHOT, buildDocument, themeCss } from '../src/shared/document.js';

test('sandboxed frame bridge', async () => {
  const browser = await chromium.launch({ channel: 'chrome', executablePath: process.env.CHROME_PATH || undefined });
  try {
    const page = await browser.newPage();
    await page.route('http://dsh.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto('http://dsh.test/');
    const doc = buildDocument(`<div id="box" style="height:150px"></div><a id="link" href="https://example.com/x">x</a>
      <script>
        let leaked = 'no';
        try { leaked = String(parent.document.title); } catch { }
        try { localStorage.getItem('x'); leaked += ',storage'; } catch { }
        document.title = leaked;
        addEventListener('message', event => { if (event.data === 'grow') document.getElementById('box').style.height = '400px'; });
      </script>`, { css: themeCss(SNAPSHOT.light), appearance: 'light' });
    const result = await page.evaluate(async ({ doc, source, dark }) => {
      const messages = [];
      addEventListener('message', event => { if (event.data?.source === source) messages.push(event.data); });
      const frame = document.createElement('iframe');
      frame.sandbox = 'allow-scripts allow-forms';
      frame.srcdoc = doc;
      frame.style.cssText = 'width:500px;height:100px;border:0';
      document.body.append(frame);
      await new Promise(resolve => { frame.onload = resolve; });
      await new Promise(resolve => setTimeout(resolve, 300));
      frame.contentWindow.postMessage('grow', '*');
      await new Promise(resolve => setTimeout(resolve, 300));
      frame.contentWindow.postMessage({ source, type: 'theme', css: dark, appearance: 'dark' }, '*');
      await new Promise(resolve => setTimeout(resolve, 100));
      return { messages, origin: (() => { try { return frame.contentWindow.location.href; } catch { return 'opaque'; } })() };
    }, { doc, source: MESSAGE_SOURCE, dark: themeCss(SNAPSHOT.dark) });
    const heights = result.messages.filter(item => item.type === 'height').map(item => item.height);
    // 150px box + 8px padding on both sides + the link line, then the box grows by 250px.
    assert.ok(heights.length >= 2, JSON.stringify(heights));
    assert.ok(heights[0] > 166 && heights[0] < 220, `first ${heights[0]}`);
    assert.equal(heights.at(-1) - heights[0], 250);
    assert.equal(result.origin, 'opaque');

    const frame = page.frames()[1];
    assert.equal(await frame.title(), 'no');
    assert.equal(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim()), '#151517');
    assert.equal(await frame.evaluate(() => document.documentElement.style.colorScheme), 'dark');
    await page.evaluate(() => {
      window.linkMessage = new Promise(resolve => {
        addEventListener('message', event => { if (event.data?.type === 'link') resolve(event.data.url); });
      });
    });
    await frame.click('#link');
    const link = await page.evaluate(() => window.linkMessage);
    assert.equal(link, 'https://example.com/x');
  } finally {
    await browser.close();
  }
});
