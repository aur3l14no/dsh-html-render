# Contributing

This guide is for whoever maintains the plugin: building and testing it,
following new DeepSeek Harness (DSH) releases, following T3 Code's work on the
same feature, and releasing. Users want the [README](README.md).

## Build and test

```sh
npm install --ignore-scripts
npm run build      # bundles src/client.js into client.js
npm test           # needs Google Chrome, or CHROME_PATH pointing at Chrome or Chromium
npm run check
```

`npm test` takes the DSH packages from `devDependencies`. To test against an
installed DSH instead, point `DSH_RUNTIME_ROOT` at its app directory (the one
whose `node_modules/@deepseek-ai` holds the DSH packages):

```sh
DSH_RUNTIME_ROOT=/path/to/dsh/app npm test
```

To try a checkout in DSH, add it to a profile with
`dsh plugin --profile web add link:$PWD` and restart DSH. Host changes need a
restart; client changes need `npm run build` and a page reload.

## How the plugin is put together

| File | Side | Role |
| --- | --- | --- |
| `index.js` | Host | Registers `html_preview` and `html_render`: parameters, descriptions, the `path`/`html` source, result text and `presentationMeta` |
| `src/host/inline.js` | Host | Reads a page file; inlines local images after checking their bytes |
| `src/host/preview.js` | Host | Headless Chrome through `playwright-core`: screenshot, content height, console |
| `src/shared/document.js` | Both | Wraps a page for the frame: theme variables, base CSS, the bridge script (height, theme, links); size limits; layout checks |
| `src/shared/theme-snapshot.json` | Both | DSH theme values the preview uses; written by `npm run snapshot-theme` |
| `src/shared/definition.js` | Client | The Conversation node definition that places a rendered page in the chat |
| `src/client.js` | Client | Live theme, the sandboxed frame, slot registrations |
| `src/rows.js`, `src/style.css` | Client | Tool-call rows for both tools |
| `cordis.patch.yml`, `package.json` (`dsh` key) | Bundle | How DSH mounts the Host plugin and loads the client |

The rendered page is not stored separately. The client reads it from the
session log: from the `html_render` call's `html` argument, or from the
result's `meta.html` when the page came from a file or had images inlined.

## Following DeepSeek Harness

### What to read

Start with the DSH plugin docs (all in
[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)):

| Doc | Read it for |
| --- | --- |
| `docs/user/develop/basic/index.md`, `tool.md`, `config.md`, `publish.md` | A first plugin, a first tool, plugin config, packaging (host packages go in both `peerDependencies` and `devDependencies`) |
| `docs/cookbook/extension-cookbook.md` | Which extension point a feature belongs to. A chat element is a `ConversationNodeDefinition` plus a `conversation.chat.node` renderer, not a turn-tail widget |
| `docs/cookbook/adding-a-tool.md` | `defineTool`: `output.schema`, `output.render`, `presentationMeta`, timeouts, concurrency |
| `docs/cookbook/adding-a-package.md` | Package layout, README sections, and the display metadata the Plugins page shows (`locale/*.json` `meta`, `meta.detail`) |
| `docs/cookbook/adding-a-plugin-preview.md` | The optional illustration on a bundle's Plugins page |
| `docs/subsystems/conversation.md` | Node definitions: `match`, `start`, `update`, `buildViewNode`, `anchorSeq`, `groupTree` |
| `docs/subsystems/slots.md`, `client-modules.md` | Slot registration and the client module loader (which imports are provided at runtime) |
| `docs/subsystems/tools.md`, `filesystem.md`, `attachment.md` | The tool registry, the session filesystem, attachments |

When docs and behavior disagree, the installed packages decide. Read the
README and `lib/types` of `@deepseek-ai/dsh-tools`,
`dsh-client-ui-conversation`, `dsh-client-ui-chat`, `dsh-client-ui-theme` and
`dsh-fs` in the DSH you target.

### What this plugin depends on

These are the DSH surfaces a release can break. Each row says where the plugin
uses it and what notices a break.

| Surface | Used in | Caught by |
| --- | --- | --- |
| `defineTool` options; `presentationMeta` arriving as `tool/result` `data.meta` | `index.js` | `tools.test.mjs` with `DSH_RUNTIME_ROOT` (registry); a manual render (meta) |
| Session services from `exec.agent.ctx`: `fs` (`resolve`, `stat`, `readBytes`), `workingDirectory.ensure`, `attachments.saveImage`, `llm.resolveModelInfo`, `agent.session.requestHeader()` | `index.js`, `src/host/inline.js` | Unit tests use stand-ins, so check `lib/types` and do a manual preview with an image model |
| `tool/call` (`name`, `callId`, `arguments`) and `tool/result` (`message.toolCallId`, `message.isError`, `meta`) event shapes | `src/shared/definition.js` | `definition.test.mjs` (shapes are copied in; re-check against the session docs) |
| `ConversationNodeDefinition` fields and `groupTree: 'turn'` | `src/shared/definition.js` | Manual: the page shows mid-turn and survives the fold |
| `tool.call.toolview` props: `phase`, `block.argsRaw`, `block.call.argsRaw`, `block.content`, `block.isError`, `block.error`, `inspect`, `loadImage`, `t` | `src/rows.js` | `rows.test.mjs` (props are copied in) and a manual look |
| Runtime-provided client modules: `react`, `@deepseek-ai/dsh-client-ui-primitives` (icons, `TextShimmer`) | `scripts/build.mjs`, `src/rows.js` | `bundle.test.mjs`; a missing icon renders nothing rather than failing |
| Theme tokens (`--dsw-*`) and the `data-ds-dark-theme` attribute on `body` | `TOKENS` in `src/shared/document.js`, `src/client.js` | Nothing automatic: re-run `snapshot-theme` and compare colors by eye |
| Bundle manifest: `dsh.bundle.patch`, `dsh.client` (`platform`, `immediately`, `inject`) | `package.json`, `cordis.patch.yml` | DSH refuses to load the bundle |

### Moving to a new DSH version

1. Read the DSH release notes and the diff of the docs above since the last
   version.
2. Update the DSH versions in `peerDependencies`, `devDependencies` and
   `engines.dsh`, then `npm install --ignore-scripts`.
3. Run `npm test`, then `DSH_RUNTIME_ROOT=<the new DSH> npm test`.
4. Run `DSH_RUNTIME_ROOT=<the new DSH> npm run snapshot-theme` and look at the
   diff of `src/shared/theme-snapshot.json`.
5. Do the [manual check](#manual-check).

## Following T3 Code

The feature comes from T3 Code's `html_preview` and `html_render`. The tool
shapes, theme variables and layout rules are kept the same on purpose, so a page
works in both and an agent used to one is at home in the other.

**Read T3's source on `main`**, not an installed T3 build. The released app lags
`main`, and a minified bundle hides changes. This plugin once missed the `path`
parameter that way.

Last reviewed: `pingdotgg/t3code@d313b2a` (2026-11-10). See what changed since:

```sh
git clone --filter=blob:none https://github.com/pingdotgg/t3code.git && cd t3code
git log --oneline d313b2aff31991ab94c8ac80cdc38a54dd575604..origin/main -- \
  packages/shared/src/htmlRender.ts apps/server/src/htmlRender apps/server/src/mcp/toolkits/html \
  apps/web/src/components/chat/HtmlRender*.tsx apps/web/src/components/files/BrowserDocumentFrame.tsx \
  apps/web/src/hooks/useHtmlRenderTheme.ts packages/provider-core/src/server/orchestrationInstructions.ts \
  docs/user/html-renders.md
```

Then update the commit above.

### Where each piece lives

| T3 Code | Owns | Here |
| --- | --- | --- |
| `apps/server/src/mcp/toolkits/html/tools.ts` | Tool names, descriptions, parameter schemas | `index.js` |
| `apps/server/src/mcp/toolkits/html/handlers.ts` | `path` vs `html`, who may pass a path | `load()` in `index.js` |
| `packages/shared/src/htmlRender.ts` | Height limits, theme variables, `HTML_RENDER_THEME_GUIDE` and `HTML_RENDER_LAYOUT_GUIDE` wording, base CSS, the bootstrap script | `src/shared/document.js`; the guide wording in `index.js` |
| `apps/server/src/htmlRender/HtmlRender.ts` | Reading a page file, inlining and checking images, refusing `vh`, publishing | `src/host/inline.js`, `layoutProblems` in `src/shared/document.js` |
| `apps/server/src/htmlRender/headlessChrome.ts` | Screenshot, content height, console capture | `src/host/preview.js` |
| `apps/server/src/htmlRender/publicProxy.ts` | Blocking private addresses during previews | Not ported |
| `apps/web/src/components/chat/HtmlRenderFrame.tsx`, `HtmlRenderDialog.tsx`, `apps/web/src/components/files/BrowserDocumentFrame.tsx` | The frame, fitting its height, full screen, zoom | `Frame` in `src/client.js` |
| `apps/web/src/hooks/useHtmlRenderTheme.ts` | Live theme for the frame | The theme store in `src/client.js` |
| `packages/provider-core/src/server/orchestrationInstructions.ts` | The system-prompt line telling agents when to draw | Nothing: this plugin adds no system prompt |
| `packages/shared/src/t3McpToolPresentation.ts` | Tool row labels | `src/rows.js` |
| `docs/user/html-renders.md` | User documentation | `README.md` |

### Deliberate differences

Keep these when syncing, unless DSH changes the reason:

- **Storage.** T3 saves the page as an attachment and loads it by a signed URL.
  Here the page stays in the session log (call argument or result `meta`), so
  local images have tighter limits (1 MB each, 2 MB per page; T3 allows 10 MB
  and 25 MB).
- **Placement.** T3 shows pages above the final reply; here a page sits where
  the call happened, as a Conversation node.
- **`path` for everyone.** T3 allows `path` only in full-access threads because
  its server reads files on the caller's behalf. DSH confines writes, not reads.
- **Preview theme.** T3 previews in dark by default and with its own palette;
  here light by default, with the recorded DSH theme.
- **Screenshots** go only to models that accept images.

### Not ported yet

From T3 at the reviewed commit: measuring heights at nine widths when
publishing (so the frame starts near its final height on any screen), zoom
controls, opening a clicked image, forwarding app shortcuts from inside the
frame, and the preview's private-address blocking (`publicProxy.ts`).

## Manual check

On a DSH with the plugin linked, with a model that accepts images:

1. Ask for a chart written to a file and previewed at 728 and 390 px. The
   preview rows show screenshots; the calls pass `path`, not `html`.
2. The page appears where `html_render` was called, while the turn runs; text
   written afterwards is below it.
3. When the turn ends and its tool calls fold, the page stays.
4. Switch DSH between light and dark: the page follows without reloading.
5. Reload the page and reopen the session: the page renders from history.
6. Hover the page and open it full screen; click a link in it.

## Releasing

1. Bump `version` in `package.json`, and the version in the README's Install
   addresses.
2. `npm run build && npm test && npm run check`.
3. `npm pack`, then rename `local-dsh-html-render-<version>.tgz` to
   `dsh-html-render-<version>.tgz`.
4. Commit, tag `v<version>`, push, and create a GitHub release with the
   tarball attached. Say which DSH versions it supports in the notes.

`docs/install.md` sends agents to the latest release, so it needs no change.
