const { contextBridge, ipcRenderer } = require('electron')

// Scoped CRUD for ~/.general-app/. Use to persist feature state (notes,
// bookmarks, saved images, etc.) without reaching for localStorage or a
// separate database. All paths are relative to the data dir. Path traversal
// and absolute paths are rejected by the main process.
const data = {
  read:       (name)       => ipcRenderer.invoke('data-read', name),
  write:      (name, text) => ipcRenderer.invoke('data-write', name, text),

  readBytes:  (name)        => ipcRenderer.invoke('data-read-bytes', name),
  writeBytes: (name, bytes) => ipcRenderer.invoke('data-write-bytes', name, bytes),

  readJSON: async (name) => {
    const r = await ipcRenderer.invoke('data-read', name)
    if (!r.ok) return r
    try { return { ok: true, data: JSON.parse(r.data) } }
    catch (err) { return { ok: false, error: err.message } }
  },
  writeJSON: (name, obj) => ipcRenderer.invoke('data-write', name, JSON.stringify(obj, null, 2)),

  readBlob: async (name, type) => {
    const r = await ipcRenderer.invoke('data-read-bytes', name)
    if (!r.ok) return r
    return { ok: true, data: new Blob([r.data], type ? { type } : undefined) }
  },
  writeBlob: async (name, blob) => {
    const buf = await blob.arrayBuffer()
    return ipcRenderer.invoke('data-write-bytes', name, buf)
  },

  delete: (name)   => ipcRenderer.invoke('data-delete', name),
  exists: (name)   => ipcRenderer.invoke('data-exists', name),
  list:   (prefix) => ipcRenderer.invoke('data-list', prefix || ''),
}

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
})
