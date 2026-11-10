// Headless Chrome for html_preview. One browser serves every call and closes
// after a quiet minute; each call gets its own context, so pages never share state.
import { chromium } from 'playwright-core';
import { SNAPSHOT, buildDocument, themeCss } from '../shared/document.js';

const IDLE_CLOSE_MS = 60_000;
const LOAD_TIMEOUT_MS = 15_000;
const SETTLE_MS = 400;
const MAX_SCREENSHOT_HEIGHT = 4000;
const MAX_CONSOLE_LINES = 40;
const MAX_CONSOLE_CHARS = 500;
// Content taller at a taller viewport follows the frame height, which never settles in a fitted frame.
const PROBE_HEIGHTS = [600, 1400];

export class PreviewBrowser {
  /** @param options.executablePath - Chrome or Chromium binary; empty uses the installed Google Chrome. */
  constructor({ executablePath, logger }) {
    this.executablePath = executablePath || undefined;
    this.logger = logger;
    this.launching = undefined;
    this.timer = undefined;
    this.active = 0;
  }

  async browser() {
    clearTimeout(this.timer);
    this.launching ??= chromium.launch({
      headless: true,
      ...(this.executablePath ? { executablePath: this.executablePath } : { channel: 'chrome' }),
    }).then(browser => {
      browser.on('disconnected', () => { this.launching = undefined; });
      return browser;
    }, error => {
      this.launching = undefined;
      const where = this.executablePath ?? 'Google Chrome (channel "chrome")';
      throw new Error(`html_preview could not start ${where}: ${error.message.split('\n')[0]}. Install Google Chrome or set browserPath in the html-render plugin config.`);
    });
    return this.launching;
  }

  idle() {
    if (this.active > 0) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.close().catch(() => {}), IDLE_CLOSE_MS);
    this.timer.unref?.();
  }

  async close() {
    clearTimeout(this.timer);
    const launching = this.launching;
    this.launching = undefined;
    if (launching) await (await launching.catch(() => undefined))?.close();
  }

  /**
   * Load a page as the chat frame would and photograph it.
   * @returns `{ png, contentHeight, console, problems }`.
   */
  async capture(html, { width, appearance }, signal) {
    this.active += 1;
    let context;
    try {
      const browser = await this.browser();
      signal?.throwIfAborted();
      context = await browser.newContext({
        viewport: { width, height: PROBE_HEIGHTS[0] },
        deviceScaleFactor: 1,
        colorScheme: appearance,
        reducedMotion: 'reduce',
      });
      const abort = () => context?.close().catch(() => {});
      signal?.addEventListener('abort', abort, { once: true });
      try {
        return await this.#capture(context, html, { width, appearance });
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    } finally {
      await context?.close().catch(() => {});
      this.active -= 1;
      this.idle();
    }
  }

  async #capture(context, html, { width, appearance }) {
    const page = await context.newPage();
    const messages = [];
    const note = line => {
      if (messages.length < MAX_CONSOLE_LINES) messages.push(line.length > MAX_CONSOLE_CHARS ? `${line.slice(0, MAX_CONSOLE_CHARS)}…` : line);
    };
    page.on('console', message => note(`[${message.type()}] ${message.text()}`));
    page.on('pageerror', error => note(`[pageerror] ${error.message}`));
    page.on('requestfailed', request => {
      if (!request.url().startsWith('data:')) note(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
    });
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));

    const document = buildDocument(html, { css: themeCss(SNAPSHOT[appearance]), appearance, preview: true });
    let timedOut = false;
    await page.setContent(document, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS }).catch(error => {
      if (error?.name !== 'TimeoutError') throw error;
      timedOut = true;
    });
    const measure = () => page.evaluate(async settle => {
      await document.fonts?.ready;
      await new Promise(resolve => setTimeout(resolve, settle));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return Math.ceil(document.documentElement.getBoundingClientRect().height);
    }, SETTLE_MS);

    const short = await measure();
    await page.setViewportSize({ width, height: PROBE_HEIGHTS[1] });
    const tall = await measure();
    const problems = [];
    if (timedOut) problems.push(`The page did not finish loading within ${LOAD_TIMEOUT_MS / 1000}s; a remote resource may be slow or unreachable.`);
    if (tall - short > 40) {
      problems.push(`Content height follows the frame height (${short}px at a ${PROBE_HEIGHTS[0]}px viewport, ${tall}px at ${PROBE_HEIGHTS[1]}px): remove vh units, height:100% on html/body, and min-height tied to the viewport.`);
    }
    const contentHeight = short;
    const shotHeight = Math.min(Math.max(contentHeight, 1), MAX_SCREENSHOT_HEIGHT);
    await page.setViewportSize({ width, height: shotHeight });
    await measure();
    const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
    if (contentHeight > MAX_SCREENSHOT_HEIGHT) problems.push(`The screenshot shows only the top ${MAX_SCREENSHOT_HEIGHT}px.`);
    return { png, contentHeight, console: messages, problems };
  }
}
