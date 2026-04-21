const { app, BrowserWindow, ipcMain, nativeTheme, Menu, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const yaml = require('js-yaml')

// ── Paths ──────────────────────────────────────────────────────────────────
const HOME = require('os').homedir()
const DATA_DIR = path.join(HOME, '.general-app')
const USER_UI_DIR = path.join(DATA_DIR, 'ui')
const MANIFEST_PATH = path.join(DATA_DIR, 'ui-manifest.json')
const PENDING_UPDATE_PATH = path.join(DATA_DIR, 'pending-update.yml')
const UPDATE_MD_PATH = path.join(DATA_DIR, 'UPDATE.md')
const BUILTIN_UI = path.join(__dirname, 'ui')

// ── Default settings ───────────────────────────────────────────────────────
const DEFAULT_SETTINGS_YML = `# ~/.general-app/settings.yml

# Color mode: system, light, or dark
# color_mode: system
`

// ── Inline AGENTS.md content ───────────────────────────────────────────────
const ROOT_AGENTS_MD = `# General App: User Data

This directory holds your General App configuration and UI source. Everything is fully modifiable.

## Structure

- [ui/](ui/AGENTS.md): the app's UI (index.html, app.js, settings.js, style.css, …).
- \`settings.yml\`: preferences (color mode).
- \`window-state.json\`: last window size and position.
- \`ui-manifest.json\`: baseline hashes of UI files, used to detect upstream changes.
- \`UPDATE.md\` / \`pending-update.yml\`: present only when an upstream UI update is ready to merge.

When editing anything in this directory, read [ui/AGENTS.md](ui/AGENTS.md) first.

## Applying Updates (/update-ui)

When \`UPDATE.md\` appears, the app's built-in UI has changed upstream. A machine-readable manifest is written to \`pending-update.yml\`:

\`\`\`yaml
source_dir: /path/to/~/.general-app/ui
builtin_dir: /path/to/app/ui
files:
  - path: app.js
    status: modified
    user_modified: true
\`\`\`

### For files the user has NOT modified (\`user_modified: false\`)

- **modified**: copy from \`builtin_dir\` to \`source_dir\`.
- **added**: copy the new file from \`builtin_dir\`.
- **deleted**: delete the file from \`source_dir\`.

### For files the user HAS modified (\`user_modified: true\`)

Read both the built-in (new upstream) version and the user's current version. Apply upstream changes while preserving the user's customizations.

- User changes always take priority.
- If both sides changed the same region, keep the user's version and add a comment noting what upstream intended.
- If upstream deleted it but the user modified it, keep the user's file with a comment.

After applying, tell the user to click "Mark as Resolved" in Settings.
`

const UI_AGENTS_MD = `# App UI

This directory holds the app's UI source. The app loads these files directly. Edit them and reload (Cmd+R) to see changes.

## Structure

\`\`\`
index.html     Shell
app.js         Preact app
settings.js    Settings view
style.css      Styles (light/dark, oklch)
lib/           Vendored Preact + htm + hooks
\`\`\`

- No build step, no transpiler. Plain ES modules using Preact + htm.
- Use the \`html\` tagged template literal (htm) instead of JSX.
- Keep it small.

## Persisting feature state

Two CRUD namespaces on \`window.app.*\`. Use them instead of \`localStorage\` or a database.

- \`window.app.data.*\` — scoped to \`~/.general-app/\`. Paths are relative; \`..\` and absolute paths are rejected.
- \`window.app.fs.*\` — unscoped. Accepts absolute paths and \`~/…\`. Use when a feature needs files outside \`~/.general-app/\` (an Obsidian vault, Desktop, external project).

Both expose the same surface. All calls return \`{ ok, data?, error? }\`. Writes \`mkdir -p\` the parent. \`delete\` moves to the OS trash (recoverable, not erased) and is recursive.

\`\`\`js
// Text + JSON
await window.app.data.writeJSON('notes.json', [{ body, created }])
const { ok, data } = await window.app.data.readJSON('notes.json')

// Binary (images, PDFs, etc.)
const res = await fetch(imageUrl)
await window.app.data.writeBlob('images/foo.png', await res.blob())
const { data: blob } = await window.app.data.readBlob('images/foo.png', 'image/png')
img.src = URL.createObjectURL(blob)

// Markdown with YAML frontmatter
await window.app.data.writeMarkdown('notes/today.md', {
  frontmatter: { title: 'Today', tags: ['log'] },
  body: '# Today\\n\\nNotes…\\n',
})
const { data: doc } = await window.app.data.readMarkdown('notes/today.md')
// doc = { frontmatter: { title, tags }, body }

// Same API, outside the data dir
await window.app.fs.readMarkdown('~/Documents/vault/ideas.md')
await window.app.fs.list('~/Desktop')

// Misc
await window.app.data.list()                   // [{ name, isDirectory }, …]
await window.app.data.exists('notes.json')     // { ok, data: boolean }
await window.app.data.delete('notes.json')
\`\`\`

Frontmatter round-trips through \`js-yaml\`: an empty \`frontmatter: {}\` writes no fence; rewriting drops comments inside the YAML block.

The app's own features (settings, window state, UI manifest, update flow) use the same primitives. There is no privileged internal path.

When the app updates and upstream UI files change, the parent directory's AGENTS.md describes the merge flow.
`

// ── Data API primitives (window.app.data.*) ────────────────────────────────
// Scoped to ~/.general-app/. Path traversal and absolute paths are rejected.
// The UI can read/write anything inside the data dir. These are also the
// primitives the app itself uses for user-data reads and writes, so a user
// feature has equivalent access to a shipped feature.
function resolveDataPath(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('path must be a non-empty string')
  }
  if (path.isAbsolute(name)) {
    throw new Error('path must be relative to ~/.general-app/')
  }
  const abs = path.resolve(DATA_DIR, name)
  const rel = path.relative(DATA_DIR, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path escapes ~/.general-app/')
  }
  return abs
}

function dataReadText(name) { return fs.readFileSync(resolveDataPath(name), 'utf8') }

function dataReadBytes(name) {
  const buf = fs.readFileSync(resolveDataPath(name))
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

function dataWrite(name, content) {
  const abs = resolveDataPath(name)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  if (typeof content === 'string') { fs.writeFileSync(abs, content, 'utf8'); return }
  let buf
  if (content instanceof Uint8Array) buf = Buffer.from(content.buffer, content.byteOffset, content.byteLength)
  else if (content instanceof ArrayBuffer) buf = Buffer.from(content)
  else if (Buffer.isBuffer(content)) buf = content
  else throw new Error('write() expects a string, Uint8Array, ArrayBuffer, or Buffer')
  fs.writeFileSync(abs, buf)
}

// Public delete: moves to the OS trash (macOS Trash, Windows Recycle Bin,
// XDG trash on Linux). Recoverable. Missing paths are a no-op.
async function dataDelete(name) {
  const abs = resolveDataPath(name)
  if (fs.existsSync(abs)) await shell.trashItem(abs)
}

// Internal: hard-delete for scaffold files the user never created (e.g.
// UPDATE.md, pending-update.yml). We don't want these cluttering the Trash.
function hardDelete(absPath) { fs.rmSync(absPath, { recursive: true, force: true }) }

function dataExists(name) { return fs.existsSync(resolveDataPath(name)) }
function dataList(name) {
  return fs.readdirSync(resolveDataPath(name || '.'), { withFileTypes: true })
    .map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
}

// YAML frontmatter: `---\n<yaml>\n---\n<body>`. Matches Jekyll / Hugo /
// Obsidian conventions. An empty or absent frontmatter block writes no fence.
// Parsing lives in main because preload runs sandboxed and can't require
// `js-yaml`.
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

function parseMarkdown(text) {
  const m = FM_RE.exec(text)
  if (!m) return { frontmatter: {}, body: text }
  let frontmatter = {}
  try { frontmatter = yaml.load(m[1]) || {} } catch { frontmatter = {} }
  return { frontmatter, body: m[2] }
}

function stringifyMarkdown(doc) {
  const { frontmatter, body } = doc || {}
  const hasFm = frontmatter && typeof frontmatter === 'object' && Object.keys(frontmatter).length > 0
  const fm = hasFm ? `---\n${yaml.dump(frontmatter).trimEnd()}\n---\n` : ''
  return fm + (body ?? '')
}

// Handle both sync and async return values so delete (which awaits
// shell.trashItem) can share the same wrapper as the rest of the API.
function wrap(fn) {
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      return result.then(data => ({ ok: true, data }), err => ({ ok: false, error: err.message }))
    }
    return { ok: true, data: result }
  } catch (err) { return { ok: false, error: err.message } }
}

ipcMain.handle('data-read',           (_e, n)    => wrap(() => dataReadText(n)))
ipcMain.handle('data-read-bytes',     (_e, n)    => wrap(() => dataReadBytes(n)))
ipcMain.handle('data-write',          (_e, n, t) => wrap(() => { dataWrite(n, t); return null }))
ipcMain.handle('data-write-bytes',    (_e, n, b) => wrap(() => { dataWrite(n, b); return null }))
ipcMain.handle('data-read-markdown',  (_e, n)    => wrap(() => parseMarkdown(dataReadText(n))))
ipcMain.handle('data-write-markdown', (_e, n, d) => wrap(() => { dataWrite(n, stringifyMarkdown(d)); return null }))
ipcMain.handle('data-delete',         (_e, n)    => wrap(async () => { await dataDelete(n); return null }))
ipcMain.handle('data-exists',         (_e, n)    => wrap(() => dataExists(n)))
ipcMain.handle('data-list',           (_e, p)    => wrap(() => dataList(p)))

// ── Filesystem API (window.app.fs.*) ───────────────────────────────────────
// Unscoped read/write for paths anywhere on disk. Accepts absolute paths and
// `~/…` (expanded to the user's home). Use this when a feature needs to touch
// files outside `~/.general-app/` (e.g. a user's notes vault, Desktop, iCloud
// Drive). For app-managed state, prefer the scoped `data` API above.
function resolveFsPath(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('path must be a non-empty string')
  }
  let p = name
  if (p === '~') p = HOME
  else if (p.startsWith('~/')) p = path.join(HOME, p.slice(2))
  if (!path.isAbsolute(p)) {
    throw new Error('fs paths must be absolute (start with / or ~/)')
  }
  return path.normalize(p)
}

function fsReadText(name)   { return fs.readFileSync(resolveFsPath(name), 'utf8') }
function fsReadBytes(name)  {
  const buf = fs.readFileSync(resolveFsPath(name))
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}
function fsWrite(name, content) {
  const abs = resolveFsPath(name)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  if (typeof content === 'string') { fs.writeFileSync(abs, content, 'utf8'); return }
  let buf
  if (content instanceof Uint8Array) buf = Buffer.from(content.buffer, content.byteOffset, content.byteLength)
  else if (content instanceof ArrayBuffer) buf = Buffer.from(content)
  else if (Buffer.isBuffer(content)) buf = content
  else throw new Error('write() expects a string, Uint8Array, ArrayBuffer, or Buffer')
  fs.writeFileSync(abs, buf)
}
async function fsDelete(name) {
  const abs = resolveFsPath(name)
  if (fs.existsSync(abs)) await shell.trashItem(abs)
}
function fsExists(name) { return fs.existsSync(resolveFsPath(name)) }
function fsList(name) {
  return fs.readdirSync(resolveFsPath(name), { withFileTypes: true })
    .map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
}

ipcMain.handle('fs-read',           (_e, n)    => wrap(() => fsReadText(n)))
ipcMain.handle('fs-read-bytes',     (_e, n)    => wrap(() => fsReadBytes(n)))
ipcMain.handle('fs-write',          (_e, n, t) => wrap(() => { fsWrite(n, t); return null }))
ipcMain.handle('fs-write-bytes',    (_e, n, b) => wrap(() => { fsWrite(n, b); return null }))
ipcMain.handle('fs-read-markdown',  (_e, n)    => wrap(() => parseMarkdown(fsReadText(n))))
ipcMain.handle('fs-write-markdown', (_e, n, d) => wrap(() => { fsWrite(n, stringifyMarkdown(d)); return null }))
ipcMain.handle('fs-delete',         (_e, n)    => wrap(async () => { await fsDelete(n); return null }))
ipcMain.handle('fs-exists',         (_e, n)    => wrap(() => fsExists(n)))
ipcMain.handle('fs-list',           (_e, p)    => wrap(() => fsList(p)))

// ── Bundle utilities (hash, walk, copy) ────────────────────────────────────
function hashFile(filePath) {
  const data = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

function walkDir(dir, prefix = '') {
  const results = {}
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) Object.assign(results, walkDir(path.join(dir, entry.name), rel))
    else results[rel] = hashFile(path.join(dir, entry.name))
  }
  return results
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(s, d)
    else fs.copyFileSync(s, d)
  }
}

// ── Data directory bootstrap ───────────────────────────────────────────────
function writeIfMissing(name, contents) {
  if (!dataExists(name)) dataWrite(name, contents)
}

function writeInitialManifest() {
  dataWrite('ui-manifest.json', JSON.stringify({
    baselined_at: new Date().toISOString(),
    builtin_version: require('./package.json').version,
    files: walkDir(BUILTIN_UI),
  }, null, 2))
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })

  // In packaged builds, the app reads the UI from ~/.general-app/ui/.
  // Seed it from the bundle the first time we run. In dev runs we skip this;
  // the app reads directly from the repo's ui/ so edits render live.
  if (app.isPackaged) {
    if (!dataExists('ui')) {
      copyDirRecursive(BUILTIN_UI, USER_UI_DIR)
      writeInitialManifest()
    } else if (!dataExists('ui-manifest.json')) {
      writeInitialManifest()
    }
  }

  writeIfMissing('settings.yml', DEFAULT_SETTINGS_YML)
  writeIfMissing('AGENTS.md', ROOT_AGENTS_MD)
  if (dataExists('ui')) writeIfMissing('ui/AGENTS.md', UI_AGENTS_MD)
}

// ── Settings ───────────────────────────────────────────────────────────────
function loadSettings() {
  try { return yaml.load(dataReadText('settings.yml')) || {} } catch { return {} }
}

function saveSettings(newSettings) {
  dataWrite('settings.yml', yaml.dump(newSettings))
  settings = newSettings
  applyColorMode()
}

function applyColorMode() {
  const mode = settings.color_mode || 'system'
  nativeTheme.themeSource = mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : 'system'
}

// ── Window state ───────────────────────────────────────────────────────────
function loadWindowState() {
  try { return JSON.parse(dataReadText('window-state.json')) } catch { return null }
}

function saveWindowState(bounds) {
  lastWindowBounds = bounds
  dataWrite('window-state.json', JSON.stringify(bounds))
}

// ── UI resolution ──────────────────────────────────────────────────────────
function getUIPath() {
  return app.isPackaged ? USER_UI_DIR : BUILTIN_UI
}

// ── Update flow ────────────────────────────────────────────────────────────
function checkForUIUpdates() {
  // In dev we're editing source directly; there's nothing to "update."
  if (!app.isPackaged) return { pending: false }
  if (!dataExists('ui') || !dataExists('ui-manifest.json')) return { pending: false }
  try {
    const manifest = JSON.parse(dataReadText('ui-manifest.json'))
    const builtinHashes = walkDir(BUILTIN_UI)
    const files = []

    for (const [rel, hash] of Object.entries(builtinHashes)) {
      const manifestHash = manifest.files?.[rel]
      if (!manifestHash) {
        files.push({ path: rel, status: 'added', user_modified: false })
      } else if (hash !== manifestHash) {
        const userRel = 'ui/' + rel
        let userModified = false
        if (dataExists(userRel)) userModified = hashFile(resolveDataPath(userRel)) !== manifestHash
        files.push({ path: rel, status: 'modified', user_modified: userModified })
      }
    }

    for (const rel of Object.keys(manifest.files || {})) {
      if (!builtinHashes[rel]) {
        const userRel = 'ui/' + rel
        const userModified = dataExists(userRel) && hashFile(resolveDataPath(userRel)) !== manifest.files[rel]
        files.push({ path: rel, status: 'deleted', user_modified: userModified })
      }
    }

    return { pending: files.length > 0, files }
  } catch {
    return { pending: false }
  }
}

// ── Shared state ───────────────────────────────────────────────────────────
let settings = {}
let lastWindowBounds = null
const windows = new Map()  // webContentsId -> WindowState

// App update state. status ∈ 'idle' | 'available' | 'downloading' | 'ready' | 'error'
let appUpdateState = { status: 'idle' }

function broadcastAppUpdate(state) {
  appUpdateState = state
  for (const ws of windows.values()) {
    if (ws.win && !ws.win.isDestroyed()) {
      ws.win.webContents.send('app-update-state', state)
    }
  }
}

autoUpdater.on('update-available', (info) => {
  broadcastAppUpdate({ status: 'available', version: info?.version })
})
autoUpdater.on('update-not-available', () => {
  broadcastAppUpdate({ status: 'idle' })
})
autoUpdater.on('download-progress', (progress) => {
  broadcastAppUpdate({
    status: 'downloading',
    version: appUpdateState.version,
    percent: Math.round(progress?.percent || 0),
  })
})
autoUpdater.on('update-downloaded', (info) => {
  broadcastAppUpdate({ status: 'ready', version: info?.version })
})
autoUpdater.on('error', (err) => {
  broadcastAppUpdate({ status: 'error', error: err?.message || String(err) })
})

// ── Shortcuts ──────────────────────────────────────────────────────────────
function registerShortcuts(contents, getState) {
  contents.on('before-input-event', (event, input) => {
    if (!input.meta && !input.control) return
    const state = getState()
    if (!state) return
    const key = input.key?.toLowerCase()

    if (key === ',' && input.type === 'keyDown') {
      event.preventDefault()
      state.win.webContents.send('show-settings')
    } else if ((key === 't' || key === 'n') && !input.shift && input.type === 'keyDown') {
      event.preventDefault()
      openNewWindow()
    } else if (key === 'r' && !input.shift && input.type === 'keyDown') {
      event.preventDefault()
      state.win.webContents.reload()
    } else if (key === 'w' && !input.shift && input.type === 'keyDown') {
      event.preventDefault()
      state.win.close()
    }
  })
}

// ── Window creation ────────────────────────────────────────────────────────
function createWindowState() {
  const saved = lastWindowBounds || loadWindowState()
  const state = { win: null }

  state.win = new BrowserWindow({
    width: saved?.width || 1200,
    height: saved?.height || 800,
    minWidth: 414,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000' : '#fff',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  state.win.loadFile(path.join(getUIPath(), 'index.html'))
  registerShortcuts(state.win.webContents, () => state)
  const wcId = state.win.webContents.id
  windows.set(wcId, state)

  const saveBounds = debounce(() => {
    if (state.win && !state.win.isDestroyed()) saveWindowState(state.win.getBounds())
  }, 500)
  state.win.on('resize', saveBounds)
  state.win.on('move', saveBounds)

  state.win.on('closed', () => {
    windows.delete(wcId)
    state.win = null
  })

  return state
}

function openNewWindow() {
  const focused = BrowserWindow.getFocusedWindow()
  const state = createWindowState()
  if (focused) {
    const [x, y] = focused.getPosition()
    state.win.setPosition(x + 20, y + 20)
  } else if (lastWindowBounds?.x != null) {
    state.win.setPosition(lastWindowBounds.x, lastWindowBounds.y)
  }
  return state
}

function stateFromEvent(event) { return windows.get(event.sender.id) }

function focusedState() {
  for (const state of windows.values()) {
    if (state.win && state.win.isFocused()) return state
  }
  return windows.values().next().value || null
}

function debounce(fn, ms) {
  let timer
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
}

// ── IPC: settings, UI reload, update flow, shell integration ───────────────
ipcMain.handle('get-settings',  () => settings)
ipcMain.handle('save-settings', (_e, newSettings) => { saveSettings(newSettings) })

ipcMain.handle('reload-ui', (e) => {
  const state = stateFromEvent(e)
  if (state?.win) state.win.loadFile(path.join(getUIPath(), 'index.html'))
})

ipcMain.handle('get-update-status', () => checkForUIUpdates())

ipcMain.handle('prepare-update', () => {
  const status = checkForUIUpdates()
  if (!status.pending) return { success: false, error: 'No updates' }
  const lines = [
    '# Pending Update',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Version: ${require('./package.json').version}`,
    `Source: ${USER_UI_DIR}`,
    `Built-in: ${BUILTIN_UI}`,
    '',
    '## Changed Files',
    '',
    '| File | Status | You Modified |',
    '|------|--------|--------------|',
  ]
  for (const f of status.files) {
    lines.push(`| ${f.path} | ${f.status} | ${f.user_modified ? 'yes' : 'no'} |`)
  }
  lines.push('')
  lines.push('## How to apply')
  lines.push('')
  lines.push('Run `/update-ui` in Claude Code from this directory, or apply manually.')
  lines.push('After applying, click "Mark as Resolved" in Settings.')
  lines.push('')
  dataWrite('UPDATE.md', lines.join('\n'))
  dataWrite('pending-update.yml', yaml.dump({
    from_version: require('./package.json').version,
    source_dir: USER_UI_DIR,
    builtin_dir: BUILTIN_UI,
    files: status.files,
  }))
  return { success: true, path: UPDATE_MD_PATH }
})

ipcMain.handle('finalize-update', () => {
  try {
    writeInitialManifest()
    if (dataExists('pending-update.yml')) hardDelete(resolveDataPath('pending-update.yml'))
    if (dataExists('UPDATE.md')) hardDelete(resolveDataPath('UPDATE.md'))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// App shell auto-update (electron-updater). Wired but dormant until the
// package.json publish config is filled in.
ipcMain.handle('get-app-update-state', () => appUpdateState)

ipcMain.handle('check-for-app-update', async () => {
  if (!app.isPackaged) return { available: false, error: 'Updates disabled in dev mode' }
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result?.updateInfo) return { available: false }
    return {
      available: result.updateInfo.version !== app.getVersion(),
      version: result.updateInfo.version,
      currentVersion: app.getVersion(),
    }
  } catch (err) {
    return { available: false, error: err.message }
  }
})

ipcMain.handle('download-app-update', async () => {
  if (!app.isPackaged) return { success: false, error: 'Updates disabled in dev mode' }
  try { await autoUpdater.downloadUpdate(); return { success: true } }
  catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('install-app-update', () => {
  if (!app.isPackaged) return { success: false, error: 'Updates disabled in dev mode' }
  if (appUpdateState.status !== 'ready') return { success: false, error: 'Update not ready' }
  // Force-destroy windows before quitAndInstall so a pending close handler
  // can't swallow the quit. Run in setImmediate to let the IPC reply return first.
  setImmediate(() => {
    for (const ws of windows.values()) {
      if (ws.win && !ws.win.isDestroyed()) ws.win.destroy()
    }
    autoUpdater.quitAndInstall(false, true)
  })
  return { success: true }
})
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('is-dev-mode',     () => !app.isPackaged)

// In packaged builds, paths inside the .asar can't be opened by the OS.
function resolveForShell(p) { return p.replace(/\.asar([\\/])/, '.asar.unpacked$1') }

ipcMain.handle('open-path', async (_e, p) => {
  const err = await shell.openPath(resolveForShell(p))
  if (err) console.error('open-path failed:', err, 'path:', p)
})

ipcMain.handle('reset-ui', async () => {
  if (!app.isPackaged) return { success: false, error: 'Not available in dev mode' }
  // Trash the user's ui/ dir so their edits are recoverable from the Trash.
  if (dataExists('ui')) await dataDelete('ui')
  copyDirRecursive(BUILTIN_UI, USER_UI_DIR)
  writeInitialManifest()
  writeIfMissing('ui/AGENTS.md', UI_AGENTS_MD)
  if (dataExists('pending-update.yml')) hardDelete(resolveDataPath('pending-update.yml'))
  if (dataExists('UPDATE.md')) hardDelete(resolveDataPath('UPDATE.md'))
  startWatchers()
  for (const state of windows.values()) {
    if (state.win) state.win.loadFile(path.join(getUIPath(), 'index.html'))
  }
  return { success: true }
})

ipcMain.handle('get-ui-paths', () => ({
  builtin: BUILTIN_UI,
  active: getUIPath(),
  user: USER_UI_DIR,
  dataDir: DATA_DIR,
  isDev: !app.isPackaged,
}))

// ── Live-reload watcher ────────────────────────────────────────────────────
let watchers = []
function stopWatchers() { for (const w of watchers) w.close(); watchers = [] }

function startWatchers() {
  stopWatchers()
  const dir = getUIPath()
  if (!dir || !fs.existsSync(dir)) return
  try {
    const watcher = fs.watch(dir, { recursive: true }, debounce(() => {
      for (const state of windows.values()) {
        if (state.win) state.win.webContents.send('source-changed')
      }
    }, 300))
    watchers.push(watcher)
  } catch {}
}

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => openNewWindow() },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            const state = focusedState()
            if (state?.win) state.win.webContents.send('show-settings')
          },
        },
      ],
    },
  ]))
  ensureDataDir()
  settings = loadSettings()
  applyColorMode()
  startWatchers()
  openNewWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (windows.size === 0) openNewWindow()
})

app.on('web-contents-created', (_event, contents) => {
  // External links open in the default browser, not inside our window.
  contents.setWindowOpenHandler(({ url }) => {
    if (url) shell.openExternal(url)
    return { action: 'deny' }
  })
})
