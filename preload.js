const { contextBridge, ipcRenderer } = require('electron')

// Build a CRUD surface bound to a given IPC channel prefix. `data` binds to
// the scoped `~/.general-app/` handlers; `fs` binds to the unscoped handlers
// that accept absolute or `~/` paths. Markdown parsing runs in the main
// process — preload is sandboxed and can't require `js-yaml`.
function makeApi(prefix) {
  return {
    read:       (name)       => ipcRenderer.invoke(`${prefix}-read`, name),
    write:      (name, text) => ipcRenderer.invoke(`${prefix}-write`, name, text),

    readBytes:  (name)        => ipcRenderer.invoke(`${prefix}-read-bytes`, name),
    writeBytes: (name, bytes) => ipcRenderer.invoke(`${prefix}-write-bytes`, name, bytes),

    readJSON: async (name) => {
      const r = await ipcRenderer.invoke(`${prefix}-read`, name)
      if (!r.ok) return r
      try { return { ok: true, data: JSON.parse(r.data) } }
      catch (err) { return { ok: false, error: err.message } }
    },
    writeJSON: (name, obj) => ipcRenderer.invoke(`${prefix}-write`, name, JSON.stringify(obj, null, 2)),

    readBlob: async (name, type) => {
      const r = await ipcRenderer.invoke(`${prefix}-read-bytes`, name)
      if (!r.ok) return r
      return { ok: true, data: new Blob([r.data], type ? { type } : undefined) }
    },
    writeBlob: async (name, blob) => {
      const buf = await blob.arrayBuffer()
      return ipcRenderer.invoke(`${prefix}-write-bytes`, name, buf)
    },

    readMarkdown:  (name)      => ipcRenderer.invoke(`${prefix}-read-markdown`, name),
    writeMarkdown: (name, doc) => ipcRenderer.invoke(`${prefix}-write-markdown`, name, doc),

    delete: (name)    => ipcRenderer.invoke(`${prefix}-delete`, name),
    exists: (name)    => ipcRenderer.invoke(`${prefix}-exists`, name),
    list:   (subpath) => ipcRenderer.invoke(`${prefix}-list`, subpath || (prefix === 'data' ? '' : '~')),
  }
}

const data = makeApi('data')
const fs   = makeApi('fs')

contextBridge.exposeInMainWorld('app', {
  getSettings:  ()  => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  onShowSettings:  (cb) => { ipcRenderer.removeAllListeners('show-settings'); ipcRenderer.on('show-settings', cb) },
  onSourceChanged: (cb) => { ipcRenderer.removeAllListeners('source-changed'); ipcRenderer.on('source-changed', cb) },
  onToast:         (cb) => { ipcRenderer.removeAllListeners('show-toast'); ipcRenderer.on('show-toast', (_e, msg) => cb(msg)) },
  reloadUI:        () => ipcRenderer.invoke('reload-ui'),

  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  prepareUpdate:   () => ipcRenderer.invoke('prepare-update'),
  finalizeUpdate:  () => ipcRenderer.invoke('finalize-update'),

  openPath:   (p) => ipcRenderer.invoke('open-path', p),
  resetUI:    ()  => ipcRenderer.invoke('reset-ui'),
  getUIPaths: ()  => ipcRenderer.invoke('get-ui-paths'),

  checkForAppUpdate:  () => ipcRenderer.invoke('check-for-app-update'),
  downloadAppUpdate:  () => ipcRenderer.invoke('download-app-update'),
  installAppUpdate:   () => ipcRenderer.invoke('install-app-update'),
  getAppUpdateState:  () => ipcRenderer.invoke('get-app-update-state'),
  onAppUpdateState:   (cb) => {
    ipcRenderer.removeAllListeners('app-update-state')
    ipcRenderer.on('app-update-state', (_e, s) => cb(s))
  },
  getAppVersion:     () => ipcRenderer.invoke('get-app-version'),
  isDevMode:         () => ipcRenderer.invoke('is-dev-mode'),

  data,
  fs,
})
