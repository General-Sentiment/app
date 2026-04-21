# General App

An ultralight starter kit for agentically built apps. One window, no build step, plain ES modules with Preact. Point an agent at it. Tell it what to build.

[General Browser](https://generalsentiment.co/browser/) is built with it.

**macOS only for now.**

## Stack

Electron shell. Preact + htm (no JSX). Plain JavaScript, native ES modules. No build step.

## Philosophy

Small by design. The shell hosts your app. You build the rest.

The source ships with the app. No build step. No bundler. No transpiler. The code you see is the code that runs. First launch copies it to `~/.general-app/ui/`. Edit freely.

The app updates. Your edits stay. An LLM merges upstream changes around what you've done. The codebase evolves like a living thing. Upstream grafts onto your mutations. Every copy diverges.

## Usage

Launch it. A placeholder home view opens. That's your starting point. Press `⌘,` for settings. Two ways to add features: edit `ui/app.js` in the repo, or open `~/.general-app/` in an AI coding agent.

## Shortcuts

| Key           | Action       |
| ------------- | ------------ |
| Cmd+,         | Settings     |
| Cmd+T / Cmd+N | New window   |
| Cmd+W         | Close window |
| Cmd+R         | Reload       |

## User data

Everything lives in `~/.general-app/`. First run creates it:

```
~/.general-app/
  AGENTS.md          Overview for AI agents
  settings.yml       Color mode
  window-state.json  Last window size and position
  ui-manifest.json   Hashes used to detect upstream UI changes
  ui/                The app's UI (index.html, app.js, settings.js, style.css, …)
    AGENTS.md
```

Open the folder in an AI coding agent. The `AGENTS.md` files explain the rest.

## Plugin architecture

Two CRUD namespaces. Same surface. Different scope.

- `window.app.data.*` — scoped to `~/.general-app/`. Relative paths only. Use for app-managed state: notes, bookmarks, saved images, annotations.
- `window.app.fs.*` — unscoped. Absolute paths or `~/…`. Use when a feature needs files outside the data dir: an Obsidian vault, Desktop, an external project.

```js
// App state
await window.app.data.writeJSON("notes.json", [{ body, created }]);
const { ok, data } = await window.app.data.readJSON("notes.json");

const res = await fetch(imageUrl);
await window.app.data.writeBlob("images/foo.png", await res.blob());

// Anywhere on disk
await window.app.fs.writeMarkdown("~/Notes/2026-04-19.md", {
  frontmatter: { title: "Today", tags: ["log"] },
  body: "# Today\n\nNotes…\n",
});
const { data: doc } = await window.app.fs.readMarkdown("~/Notes/2026-04-19.md");
```

No privileged internal path. Settings, window state, UI manifest, update flow all run on the same primitives. An agent-built feature gets the same access core code has. The API is the plugin architecture. You build on the surface the app is built on.

Every call returns `{ ok, data?, error? }`. `data.*` rejects absolute paths and `..`. `fs.*` rejects relative paths. Full surface on both: `read`, `write`, `readJSON`, `writeJSON`, `readBytes`, `writeBytes`, `readBlob`, `writeBlob`, `readMarkdown`, `writeMarkdown`, `delete`, `exists`, `list`.

### Markdown with frontmatter

`readMarkdown` parses a leading `---`-fenced YAML block and returns `{ frontmatter, body }`. Files with no fence read as `{ frontmatter: {}, body: <file> }`. `writeMarkdown({ frontmatter, body })` emits the fence only when `frontmatter` has keys. Round-trips through `js-yaml` — the YAML block is rewritten, so comments inside it are not preserved.

## Customizing the UI

The UI lives at `~/.general-app/ui/`. First launch seeds it from the bundle. Edit files directly. Or open the folder in an agent and tell it what to change.

Upstream changes the bundle. Settings shows a banner. Run `/update-ui` in Claude Code (or your agent) to merge around your edits.

### How updates merge

A manifest at `~/.general-app/ui-manifest.json` holds SHA-256 hashes. Each launch re-hashes the bundle and diffs against it. The diff tags each file: added, modified, or deleted. It catches divergence in your copy too, and marks conflicts.

Click **Open** on the banner. It writes `UPDATE.md` (human) and `pending-update.yml` (machine), then reveals the directory. Run `/update-ui` in an agent. Untouched files copy straight from the bundle. Touched files are where the LLM earns its keep. It reads both versions, understands the intent, merges. Your edits win. If both sides changed the same region, your version stays. A comment notes what upstream wanted.

Click **Mark as Resolved** to re-baseline the manifest. The cycle resets.

Inexact by design. Updates ship code alongside intent. The LLM reads that intent against whatever your copy has become. Two users diverge, get the same update, land in different places. Features drift. Behavior shifts. Closer to genetic code than software. Changes graft onto a living organism. The outcome depends on what was already there. Every copy becomes its own lineage.

## Structure

```
main.js          Electron main process
preload.js       IPC bridge
AGENTS.md        Guidance for agents editing this repo
assets/          App icon
ui/
  index.html     Shell
  app.js         Preact app
  settings.js    Settings view
  style.css      Styles (light/dark, oklch)
  lib/           Vendored preact + htm + hooks
```
