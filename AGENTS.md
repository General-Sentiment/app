# General App

A minimal Electron shell for LLM-built apps. One window, no build step, plain ES modules with Preact + htm.

User data lives in `~/.general-app/`. See that directory's `AGENTS.md` for the user-facing layout.

## How the UI source works

The UI ships in the app bundle at `ui/`. On first launch of a packaged build, those files copy into `~/.general-app/ui/`. The app reads from there after that. Edit them directly or through an agent.

**Dev mode (`npm start`) reads from this repo's `ui/` directly.** Edits in the source tree render live. The user's `~/.general-app/ui/` is ignored in dev.

When a new version ships UI changes, the app diffs the bundled files against a manifest of hashes from the last baseline. Settings shows a banner when an update is ready. Running `/update-ui` in an agent merges upstream changes on top of the user's edits.

## Structure (this repo)

- `ui/`: the app's UI. No build step. Plain ES modules with Preact + htm.
  - `index.html`: shell.
  - `app.js`: Preact app (home view, settings route).
  - `settings.js`: settings view.
  - `style.css`: styles (light/dark, oklch).
  - `lib/`: vendored Preact + htm + hooks.
  - `components/`: small reusable pieces (Toast, SettingsGear).

## Data API (plugin surface)

Two CRUD namespaces exposed via [preload.js](preload.js) and implemented in [main.js](main.js):

- `window.app.data.*` — scoped to `~/.general-app/`. Paths are relative; absolute paths and `..` traversal are rejected. Use this for app-managed state (notes, bookmarks, saved images).
- `window.app.fs.*` — unscoped. Accepts absolute paths and `~/…` (expanded to the user's home). Use this when a feature legitimately needs files outside `~/.general-app/` (a user's Obsidian vault, Desktop, an external project).

Both namespaces expose the same surface. Core features (settings, window state, UI manifest, update flow) run on the `data` primitives. There is no privileged internal path. A feature added by a user's agent has the same access as a feature shipped in the app. When adding persistence, use these APIs. Skip `localStorage` and embedded DBs.

```js
// Text + JSON
await window.app.data.write(name, text)
await window.app.data.read(name)        // { ok, data: string }
await window.app.data.writeJSON(name, obj)
await window.app.data.readJSON(name)    // { ok, data: any }

// Binary
await window.app.data.writeBytes(name, uint8OrArrayBuffer)
await window.app.data.readBytes(name)   // { ok, data: Uint8Array }
await window.app.data.writeBlob(name, blob)
await window.app.data.readBlob(name, type?)  // { ok, data: Blob }

// Markdown with YAML frontmatter
await window.app.data.writeMarkdown(name, { frontmatter, body })
await window.app.data.readMarkdown(name) // { ok, data: { frontmatter, body } }

// Misc
await window.app.data.exists(name)      // { ok, data: boolean }
await window.app.data.list(subpath?)    // { ok, data: [{ name, isDirectory }] }
await window.app.data.delete(name)

// Same surface, unscoped: any absolute or ~/-prefixed path
await window.app.fs.readMarkdown('~/Documents/notes/today.md')
await window.app.fs.list('~/Desktop')
```

- For `data.*`, `name` is relative to `~/.general-app/`. Absolute paths and `..` traversal are rejected.
- For `fs.*`, `name` must be absolute (`/…`) or home-relative (`~/…`). Relative paths are rejected.
- Calls return `{ ok: true, data? }` or `{ ok: false, error }`. No throws.
- Writes `mkdir -p` the parent automatically.
- `delete` moves the path to the OS trash (macOS Trash, Windows Recycle Bin, XDG trash on Linux) so it's recoverable, not erased. Recursive. Missing paths are a no-op.
- `list()` defaults to the data-dir root for `data`, and to `~` for `fs`.

### Markdown with frontmatter

`readMarkdown` parses a `---`-fenced YAML block at the top of the file and returns `{ frontmatter, body }`. Files without a fence read as `{ frontmatter: {}, body: <entire file> }`.

`writeMarkdown({ frontmatter, body })` emits the fence only when `frontmatter` has keys — so writing `{ frontmatter: {}, body: '…' }` produces a clean markdown file with no header.

```js
await window.app.fs.writeMarkdown('~/Notes/2026-04-19.md', {
  frontmatter: { title: 'Today', tags: ['log'] },
  body: '# Today\n\nNotes…\n',
})

const { data: doc } = await window.app.fs.readMarkdown('~/Notes/2026-04-19.md')
doc.frontmatter.tags.push('done')
await window.app.fs.writeMarkdown('~/Notes/2026-04-19.md', doc)
```

Parsing and serialization live in preload.js and use the bundled `js-yaml`. Round-tripping rewrites the YAML block — comments inside frontmatter are not preserved.

### Adding a feature

1. Decide scope. App-managed state → `data.*` under `~/.general-app/` (e.g. `notes.json`, `bookmarks/items.json`, `clips/<id>.png`). Touching a user's existing files → `fs.*` with an explicit path from settings or a picker.
2. Write through the API. Main-process code calls `dataReadText` / `dataWrite` / `fsReadText` / etc. UI code calls `window.app.data.*` / `window.app.fs.*`. Same primitives underneath.
3. If the main process needs to react immediately (apply a setting, refresh a list), add a dedicated IPC handler alongside. The data/fs APIs are the substrate. Handlers like `save-settings` are convenience wrappers that also trigger side effects.

## Conventions

- No build tools. UI is vanilla ES modules importing from `./lib/preact.js`.
- Use `html` tagged template literals (htm) instead of JSX.
- Keep it small.
