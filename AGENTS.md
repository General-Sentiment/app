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

The UI has a scoped CRUD API at `window.app.data.*`. It is exposed via [preload.js](preload.js) and implemented by the `data-*` IPC handlers in [main.js](main.js). This is the single read/write surface for `~/.general-app/`.

Core features (settings, window state, UI manifest, update flow) run on the same primitives. There is no privileged internal path. A feature added by a user's agent has the same access as a feature shipped in the app. When adding persistence, use this API. Skip `localStorage` and embedded DBs.

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

// Misc
await window.app.data.exists(name)      // { ok, data: boolean }
await window.app.data.list(prefix?)     // { ok, data: [{ name, isDirectory }] }
await window.app.data.delete(name)
```

- `name` is relative to `~/.general-app/`. Absolute paths and `..` traversal are rejected.
- Calls return `{ ok: true, data? }` or `{ ok: false, error }`. No throws.
- Writes `mkdir -p` the parent automatically.
- `delete` is recursive.

Adding a feature:

1. Pick a sensible path under `~/.general-app/`. `notes.json`. `bookmarks/items.json`. `clips/<id>.png`.
2. Write through the API. Main-process code calls `dataReadText` / `dataWrite` / etc. UI code calls `window.app.data.*`. Same primitives underneath.
3. If the main process needs to react immediately (apply a setting, refresh a list), add a dedicated IPC handler alongside the data API. The data API is the substrate. Handlers like `save-settings` are convenience wrappers that also trigger side effects.

## Conventions

- No build tools. UI is vanilla ES modules importing from `./lib/preact.js`.
- Use `html` tagged template literals (htm) instead of JSX.
- Keep it small.
