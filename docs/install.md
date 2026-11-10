# Installing DSH HTML Render (for agents)

You are installing [DSH HTML Render](https://github.com/aur3l14no/dsh-html-render),
a plugin bundle for DSH, into the user's DSH profile. It adds two tools to every
agent of that profile, so tell the user what you will run before running it.

## 1. Find the DSH and the profile

- In a terminal, `dsh --version` must print `0.2.x` (the bundle accepts
  `>=0.2.2-alpha.2 <0.3.0`). Older or newer: stop and tell the user.
- The usual target is the `web` profile, the one `dsh web` starts. If the user
  runs the DSH Desktop app, its profile cannot be changed from the `dsh`
  command: use the `plugin_manager` tool inside DSH, or have the user follow the
  Plugins-page steps in the README.

## 2. Pick the package

Open https://github.com/aur3l14no/dsh-html-render/releases/latest and take the
download address of its `dsh-html-render-<version>.tgz` asset. Use that
versioned address, not a `/latest/` link: the profile's lockfile pins the
file's checksum.

## 3. Install

From a terminal, with `<url>` from step 2:

```sh
dsh plugin --profile web add <url>
```

`dsh plugin add` installs the package and turns its bundle on.

Inside DSH, with the `plugin_manager` tool (Creator mode; each call asks the
user for approval): `install_bundle` with `<url>` as the spec.

## 4. Check the browser

`html_preview` needs Google Chrome, or a Chrome or Chromium binary set as
`browserPath` on the `html-render` entry of the profile's `cordis.patch.yml`.
On macOS, Google Chrome lives in `/Applications/Google Chrome.app`; on Linux,
`which google-chrome chromium chromium-browser`. If none is installed, tell the
user: pages still render, but the agent cannot preview them.

## 5. Apply and check

- A running DSH whose profile does not reload live needs a restart (`dsh web`
  for the Web profile); `plugin_manager` results say when a restart is
  required.
- Check: `@local/dsh-html-render` appears among the profile's bundles without
  an error (Plugins page, `list_bundles`, or `dsh.profile.bundles` in the
  profile's `package.json`), and a new session's agent has the tools
  `html_preview` and `html_render`.

## 6. Tell the user how to start

Ask for something visual, such as "chart this CSV". The agent previews the page,
then shows it in the chat where it called `html_render`.

## Do not

- Grant a version exemption (`allow-version`, `set_version_exemption`) unless
  the user explicitly accepts the risk for that exact version pair.
- Edit the profile's `cordis.patch.yml` or other plugins to make the install
  succeed, beyond setting `browserPath` when the user asks. Report the error
  to the user instead.
