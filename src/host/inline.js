// Local images named by absolute path become data: URIs, because neither the
// headless preview nor the chat frame can read the Host's files.
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};
// The inlined page is kept in the result's meta and so in the Session log; keep it small.
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

// Any quoted string (attribute, JS or CSS) or CSS url() naming an absolute
// image path, as T3 matches them: a gallery built in a script inlines too.
const EXTENSIONS = Object.keys(MEDIA_TYPES).map(extension => extension.slice(1)).join('|');
const ABSOLUTE = String.raw`(?:file://|/(?!/))`;
const LOCAL_IMAGE = new RegExp(
  String.raw`(["'\x60])(${ABSOLUTE}(?:(?!\1)[^\r\n]){0,2048}?\.(?:${EXTENSIONS}))\1`
    + String.raw`|url\(\s*(${ABSOLUTE}[^\s"'\x60()]{0,2048}?\.(?:${EXTENSIONS}))\s*\)`,
  'gid',
);

/** The file a reference names: file: URLs are decoded, as are %-escapes in plain paths. */
function localPath(reference) {
  if (reference.startsWith('file://')) {
    try { return fileURLToPath(reference); } catch { return undefined; }
  }
  try { return decodeURI(reference); } catch { return reference; }
}

const latin1 = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));

// Judge the bytes, not the name, so a key or .env renamed to .png is never inlined.
// isImageBytes, hasSvgRoot and afterDoctype are ported from T3 Code (MIT; see THIRD_PARTY_NOTICES.md).
export function isImageBytes(bytes) {
  const head = latin1(bytes, 0, 12);
  if (
    head.startsWith('\x89PNG')
    || head.startsWith('\xff\xd8\xff')
    || head.startsWith('GIF8')
    || head.startsWith('\0\0\x01\0')
    || (head.startsWith('BM') && head.slice(6, 10) === '\0\0\0\0')
    || (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP')
    || /^ftyp(?:avif|avis|mif1)$/.test(head.slice(4, 12))
  ) return true;
  return hasSvgRoot(new TextDecoder().decode(bytes.subarray(0, 4096)));
}

const after = (text, token, from) => {
  const at = text.indexOf(token, from);
  return at === -1 ? -1 : at + token.length;
};

function hasSvgRoot(text) {
  let at = 0;
  while (at !== -1) {
    while (/\s/.test(text.charAt(at))) at += 1;
    if (text.startsWith('<?', at)) at = after(text, '?>', at + 2);
    else if (text.startsWith('<!--', at)) at = after(text, '-->', at + 4);
    else if (text.slice(at, at + 9).toLowerCase() === '<!doctype') at = afterDoctype(text, at + 9);
    else return /^<svg[ \t\r\n/>]/.test(text.slice(at, at + 5));
  }
  return false;
}

function afterDoctype(text, from) {
  let inSubset = false;
  let at = from;
  while (at !== -1 && at < text.length) {
    const char = text[at];
    if (char === '"' || char === "'") at = after(text, char, at + 1);
    else if (inSubset && text.startsWith('<!--', at)) at = after(text, '-->', at + 4);
    else if (inSubset && text.startsWith('<?', at)) at = after(text, '?>', at + 2);
    else if (char === '>' && !inSubset) return at + 1;
    else {
      if (char === '[') inSubset = true;
      else if (char === ']') inSubset = false;
      at += 1;
    }
  }
  return -1;
}

/**
 * Replace absolute local image references with data: URIs.
 * @param html - page source.
 * @param read - `(path, maxBytes, signal) => Promise<Uint8Array>`; throws when unreadable.
 * @returns `{ html, inlined, problems }`; each problem names an image left as it was.
 */
export async function inlineLocalImages(html, read, signal) {
  const references = [];
  for (const match of html.matchAll(LOCAL_IMAGE)) {
    const span = match.indices[2] ?? match.indices[3];
    const path = localPath(html.slice(span[0], span[1]));
    if (path) references.push({ start: span[0], end: span[1], path });
  }
  const data = new Map();
  const problems = [];
  let total = 0;
  for (const path of new Set(references.map(reference => reference.path))) {
    signal?.throwIfAborted();
    let bytes;
    try {
      bytes = await read(path, MAX_IMAGE_BYTES, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      problems.push(`${path} could not be read: ${error?.message ?? error}`);
      continue;
    }
    if (!isImageBytes(bytes)) {
      problems.push(`${path} is not an image file.`);
      continue;
    }
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) {
      problems.push(`${path} was not inlined: local images exceed ${MAX_TOTAL_BYTES / 1024 / 1024} MB in total.`);
      continue;
    }
    data.set(path, `data:${MEDIA_TYPES[extname(path).toLowerCase()]};base64,${Buffer.from(bytes).toString('base64')}`);
  }
  if (data.size === 0) return { html, inlined: 0, problems };
  const parts = [];
  let cursor = 0;
  for (const reference of references) {
    const uri = data.get(reference.path);
    if (uri === undefined) continue;
    parts.push(html.slice(cursor, reference.start), uri);
    cursor = reference.end;
  }
  parts.push(html.slice(cursor));
  return { html: parts.join(''), inlined: data.size, problems };
}

/** A reader that goes through the Session filesystem when one is mounted. */
export function fileReader(fs, cwd) {
  if (!fs) return (path, maxBytes) => readFile(path).then(bytes => {
    if (bytes.byteLength > maxBytes) throw new Error(`larger than ${maxBytes / 1024 / 1024} MB`);
    return bytes;
  });
  return async (path, maxBytes, signal) => {
    const target = await fs.resolve(path, { cwd, signal });
    const info = await fs.stat(target, signal);
    if (info === undefined) throw new Error('file not found');
    if (info.type !== 'file') throw new Error('not a regular file');
    return fs.readBytes(target, signal, maxBytes);
  };
}

const HTML_FILE = /\.html?$/i;
// Like the image check, judge the content: a renamed .env does not start like a page.
const DOCUMENT_START = /^\s*<(?:!doctype\s+html|html)[\s>]/i;

/** The page an html_preview/html_render `path` names, read once: later edits to the file do not reach it. */
export async function readPage(read, path, maxLength, signal) {
  const unreadable = reason => new Error(
    `${path} is not a readable HTML document${reason ? ` (${reason})` : ''}. Pass an absolute path to a .html file that starts with <!doctype html> or <html>, or pass html instead.`,
  );
  if (!path.startsWith('/') || !HTML_FILE.test(path)) throw unreadable();
  let bytes;
  try {
    // UTF-8 takes at most 4 bytes per character; the caller checks the length in characters.
    bytes = await read(path, maxLength * 4, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw unreadable(error?.message ?? String(error));
  }
  const html = new TextDecoder().decode(bytes);
  if (!DOCUMENT_START.test(html)) throw unreadable();
  return html;
}
