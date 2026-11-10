// html_preview checks a page in headless Chrome and shows the model a PNG;
// html_render shows the finished page in the chat. The Web client renders it
// from the recorded call (src/client.js), or from the page kept in the
// result's meta when it came from a file or had images inlined.
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  DEFAULT_WIDTH, MAX_HEIGHT, MAX_HTML_LENGTH, MAX_WIDTH, MIN_HEIGHT, MIN_WIDTH, layoutProblems,
} from './src/shared/document.js';
import { fileReader, inlineLocalImages, readPage } from './src/host/inline.js';
import { PreviewBrowser } from './src/host/preview.js';

export const name = 'html-render';
// fs, workingDirectory, attachments and llm are optional and read where each call runs.
export const inject = ['tools'];

export const Config = z.object({
  browserPath: z.string().default('')
    .description('Chrome or Chromium binary for html_preview. Empty uses the installed Google Chrome.'),
});

const MODEL_LOOKUP_MS = 10_000;

const THEME_RULES = `Frame width is the reply width (about 728px on desktop, about 360px on phones), on the thread background. Leave html, body and the outer element without a background color, outer card, border, banner title or side padding; this wins over any rule that sets a page background. The base sheet adds an overridable 8px html padding for focus rings and shadows, and sets text color, font and size. Use fluid widths within it. A box that needs its own background gets 16px padding and var(--radius) corners. Give charts fixed pixel heights and let content set the page height: vh units and height:100% on html or body are rejected because the frame grows to fit its content. Use the theme CSS variables on :root, not fixed colors: --background, --foreground, --muted, --card, --popover, --secondary, --border, --ring, --primary, --accent, --destructive, --warning, --success, --info, --code-background (most have a matching -foreground; accent, destructive and warning also have -surface), --chart-1 to --chart-6, --radius, --font-sans, --font-mono. They follow the user's light or dark theme live.`;

const PAGE_RULES = 'Self-contained: inline <style> and <script>. Local images given as absolute paths are inlined. Remote URLs load as-is; links open in a new browser tab.';

const SOURCE_PARAMS = {
  path: { type: 'string', description: 'Absolute .html file path. Prefer it for a page you wrote: edit the file between previews instead of resending the page.' },
  html: { type: 'string', description: 'Inline HTML. Pass exactly one of path or html.' },
};

function checkHtml(html, label) {
  if (html.trim() === '') throw new Error(`${label} is empty.`);
  if (html.length > MAX_HTML_LENGTH) throw new Error(`${label} is ${html.length} characters; the limit is ${MAX_HTML_LENGTH}.`);
}

function integerIn(value, low, high, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < low || value > high) throw new Error(`${label} must be an integer from ${low} to ${high}.`);
  return value;
}

export function apply(ctx, config) {
  const preview = new PreviewBrowser({ executablePath: config.browserPath, logger: ctx.logger });
  ctx.effect(() => () => preview.close(), 'html-render: preview browser');

  /** A service as the calling agent sees it, else as this plugin does. */
  const service = (exec, key) => exec.agent?.ctx?.get(key) ?? ctx.get(key);

  async function reader(exec) {
    const workingDirectory = service(exec, 'workingDirectory');
    const cwd = exec.agent && workingDirectory
      ? await workingDirectory.ensure(exec.agent, exec.signal).catch(() => undefined)
      : undefined;
    return fileReader(service(exec, 'fs'), cwd);
  }

  /** The page a call names, with its local images inlined. The file is read once, here. */
  async function load(args, exec) {
    const hasPath = typeof args.path === 'string';
    if (hasPath === (typeof args.html === 'string')) throw new Error('Pass exactly one of html or path.');
    const read = await reader(exec);
    const source = hasPath ? await readPage(read, args.path, MAX_HTML_LENGTH, exec.signal) : args.html;
    checkHtml(source, hasPath ? args.path : 'html');
    const { html, inlined, problems } = await inlineLocalImages(source, read, exec.signal);
    return { source, html, inlined, problems };
  }

  async function acceptsImages(exec) {
    const { agent, signal } = exec;
    const llm = service(exec, 'llm');
    if (!llm || !agent) return false;
    const routed = agent.session.requestHeader?.()?.config;
    const provider = routed?.provider ?? agent.options?.provider;
    const model = routed?.model ?? agent.options?.model;
    if (!provider || !model) return false;
    const lookup = AbortSignal.any([signal, AbortSignal.timeout(MODEL_LOOKUP_MS)].filter(Boolean));
    const info = await llm.resolveModelInfo(provider, model, lookup).catch(() => undefined);
    return info?.inputModalities?.includes('image') === true;
  }

  ctx.tools.register(defineTool({
    name: 'html_preview',
    description: `Check an HTML page before html_render: load it in headless Chrome as the chat frame would and return a PNG, its contentHeight and console output. ${PAGE_RULES} The theme and layout rules are in html_render.`,
    parameters: {
      ...SOURCE_PARAMS,
      appearance: { type: 'string', enum: ['light', 'dark'], description: 'Theme to load the page in. Default light.' },
      width: { type: 'integer', description: `CSS pixels, ${MIN_WIDTH} to ${MAX_WIDTH}. Default ${DEFAULT_WIDTH}. Use about 390 for phones.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          contentHeight: { type: 'integer', required: true },
          image: { type: 'json' },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: value.text },
        ...(value.image ? [{ type: 'image', attachment: value.image }] : []),
      ],
    },
    timeoutMs: 90_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const width = integerIn(args.width, MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH, 'width');
      const appearance = args.appearance === 'dark' ? 'dark' : 'light';
      const page = await load(args, exec);
      const shot = await preview.capture(page.html, { width, appearance }, exec.signal);
      const problems = [...layoutProblems(page.source), ...shot.problems, ...page.problems];
      const lines = [
        `contentHeight: ${shot.contentHeight}px at width ${width}px, ${appearance} theme. Pass it as html_render's height (${MIN_HEIGHT} to ${MAX_HEIGHT}).`,
        ...(problems.length ? ['Problems:', ...problems.map(item => `- ${item}`)] : []),
        shot.console.length ? `Console:\n${shot.console.join('\n')}` : 'Console: empty.',
      ];
      const attachments = service(exec, 'attachments');
      if (!attachments || !(await acceptsImages(exec))) {
        lines.push('The current model does not accept images, so the screenshot is not attached.');
        return { text: lines.join('\n'), contentHeight: shot.contentHeight };
      }
      const ref = await attachments.saveImage({ data: shot.png, mediaType: 'image/png', name: 'html-preview.png' });
      return { text: lines.join('\n'), contentHeight: shot.contentHeight, image: JSON.parse(JSON.stringify(ref)) };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'html_render',
    description: `Show a finished HTML page (chart, diagram, table, mockup) to the user in the DSH chat, in a sandboxed frame at this point of the conversation: text you write after the call appears below the page. Check it with html_preview first and pass the same path or html. Do not announce or restate the page in your reply. The frame starts at the given height and then fits the content, up to 20000px. ${PAGE_RULES} ${THEME_RULES}`,
    parameters: {
      ...SOURCE_PARAMS,
      title: { type: 'string', required: true, description: 'Short name of the page, at most 200 characters.' },
      height: { type: 'integer', required: true, description: `Frame height in CSS pixels, ${MIN_HEIGHT} to ${MAX_HEIGHT}. Use the contentHeight from html_preview.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          height: { type: 'integer', required: true },
          path: { type: 'string' },
          html: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered "${value.title}" for the user.`,
      }],
      // Never model-visible. The page is read from the call arguments unless it came
      // from a file or inlining changed it; then the snapshot taken here is the page.
      presentationMeta: (_args, value) => ({
        tool: 'html_render',
        title: value.title,
        height: value.height,
        ...(value.path === undefined ? {} : { path: value.path }),
        ...(value.html === undefined ? {} : { html: value.html }),
      }),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const title = args.title.trim();
      if (title === '' || title.length > 200) throw new Error('title must be 1 to 200 characters.');
      const height = integerIn(args.height, MIN_HEIGHT, MAX_HEIGHT, undefined, 'height');
      const page = await load(args, exec);
      const problems = [...layoutProblems(page.source), ...page.problems];
      if (problems.length > 0) throw new Error(`${problems.join(' ')} Fix the page, check it with html_preview, and call html_render again.`);
      const fromFile = typeof args.path === 'string';
      return {
        title,
        height,
        ...(fromFile ? { path: args.path } : {}),
        ...(fromFile || page.inlined > 0 ? { html: page.html } : {}),
      };
    },
  }));
}
