import { html, useState, useEffect } from './lib/preact.js'

export function SettingsView({ onBack }) {
  const [settings, setSettings] = useState(null)
  const [uiPaths, setUIPaths] = useState(null)
  const [updateStatus, setUpdateStatus] = useState(null)
  const [message, setMessage] = useState('')
  // { status, version?, percent?, error? } — status ∈ 'idle'|'available'|'downloading'|'ready'|'error'
  const [appUpdate, setAppUpdate] = useState({ status: 'idle' })
  const [appVersion, setAppVersion] = useState('')
  const [devMode, setDevMode] = useState(false)

  function refresh() {
    window.app.getSettings().then(setSettings)
    window.app.getUIPaths().then(setUIPaths)
    window.app.getUpdateStatus().then(setUpdateStatus)
    window.app.getAppVersion().then(setAppVersion)
    window.app.isDevMode().then(setDevMode)
  }

  useEffect(() => {
    refresh()
    window.app.getAppUpdateState().then(s => { if (s) setAppUpdate(s) })
    window.app.onAppUpdateState(setAppUpdate)
    window.app.checkForAppUpdate()
  }, [])

  const resetToDefault = async () => {
    const result = await window.app.resetUI()
    if (result.success) {
      setMessage('Reset to defaults. Reloading...')
      refresh()
    } else {
      setMessage('Error: ' + (result.error || 'reset failed'))
    }
  }

  if (!settings || !uiPaths) return html`<div class="settings-view"><div class="settings-loading">Loading...</div></div>`

  return html`
    <div class="settings-view">
      <div class="settings-header">
        <span class="settings-title">Settings</span>
        <button class="settings-close" onClick=${onBack} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      <div class="settings-body">

        ${appUpdate?.status === 'available' && html`
          <div class="settings-update-banner">
            <span class="settings-update-text">v${appUpdate.version} is available</span>
            <button class="settings-btn settings-btn-primary" onClick=${() => window.app.downloadAppUpdate()}>Update</button>
          </div>
        `}

        ${appUpdate?.status === 'downloading' && html`
          <div class="settings-update-banner">
            <span class="settings-update-text">v${appUpdate.version} is available</span>
            <button class="settings-btn" disabled>Downloading ${appUpdate.percent ?? 0}%</button>
          </div>
        `}

        ${appUpdate?.status === 'ready' && html`
          <div class="settings-update-banner">
            <span class="settings-update-text">v${appUpdate.version} is available</span>
            <button class="settings-btn settings-btn-primary" onClick=${() => window.app.installAppUpdate()}>Restart to Update</button>
          </div>
        `}

        ${appUpdate?.status === 'error' && html`
          <div class="settings-update-banner">
            <span class="settings-update-text">Update failed</span>
            <button class="settings-btn settings-btn-primary" onClick=${() => window.app.checkForAppUpdate()}>Retry</button>
          </div>
          <p class="settings-hint settings-update-hint">${appUpdate.error || 'An unknown error occurred.'}</p>
        `}

        ${updateStatus?.pending && html`
          <div class="settings-update-banner">
            <span class="settings-update-text">UI Update Available</span>
            <button class="settings-btn settings-btn-primary" onClick=${async () => {
              await window.app.prepareUpdate()
              window.app.openPath(uiPaths.dataDir)
            }}>Open</button>
          </div>
          <p class="settings-hint settings-update-hint">The built-in UI has changed upstream. Open <code>~/.general-app</code> in Claude Code, Codex, or your agent of choice and ask it to merge the update.</p>
        `}

        ${((appUpdate?.status && appUpdate.status !== 'idle') || updateStatus?.pending) && html`
          <hr class="settings-divider" />
        `}

        <div class="settings-field">
          <label class="settings-label">Appearance</label>
          <p class="settings-hint">Choose a color mode for the interface.</p>
          <div class="settings-segmented">
            ${['system', 'light', 'dark'].map(mode => html`
              <button
                class="settings-segment ${(settings.color_mode || 'system') === mode ? 'active' : ''}"
                onClick=${async () => {
                  const updated = { ...settings, color_mode: mode }
                  await window.app.saveSettings(updated)
                  setSettings(updated)
                }}
              >${mode}</button>
            `)}
          </div>
        </div>

        <hr class="settings-divider" />

        <div class="settings-field">
          <label class="settings-label">UI Source</label>
          <p class="settings-hint">${uiPaths.isDev
            ? 'Dev mode: the app is reading the UI from this repo. Edits to the repo render live.'
            : 'The app reads its UI from this directory. Edit the files directly, or open the folder in Claude Code and tell it what you want to change.'
          }</p>

          <div class="settings-value">${uiPaths.active}</div>

          <div class="settings-actions">
            <button class="settings-btn settings-btn-primary" onClick=${() => window.app.openPath(uiPaths.active)}>Open</button>
            ${!uiPaths.isDev && html`
              <button class="settings-btn" onClick=${resetToDefault}>Reset to Default</button>
            `}
          </div>
        </div>

        ${message && html`<div class="settings-message">${message}</div>`}

        ${devMode && html`
          <hr class="settings-divider" />

          <div class="settings-field dev-tools">
            <label class="settings-label">Dev Tools</label>
            <p class="settings-hint">Preview UI states. These overrides are local to this session.</p>

            <div class="dev-tools-group">
              <span class="dev-tools-label">App Update Banner</span>
              <div class="settings-segmented">
                ${[
                  ['Hidden', 'idle', () => setAppUpdate({ status: 'idle' })],
                  ['Available', 'available', () => setAppUpdate({ status: 'available', version: '1.0.0' })],
                  ['Downloading', 'downloading', () => setAppUpdate({ status: 'downloading', version: '1.0.0', percent: 42 })],
                  ['Ready', 'ready', () => setAppUpdate({ status: 'ready', version: '1.0.0' })],
                ].map(([label, status, action]) => html`
                  <button class="settings-segment ${appUpdate?.status === status ? 'active' : ''}" onClick=${action}>${label}</button>
                `)}
              </div>
            </div>

            <div class="dev-tools-group">
              <span class="dev-tools-label">UI Update Status</span>
              <div class="settings-segmented">
                ${[
                  ['None', () => setUpdateStatus({ pending: false })],
                  ['Pending', () => setUpdateStatus({ pending: true })],
                ].map(([label, action]) => html`
                  <button class="settings-segment ${
                    label === 'None' && !updateStatus?.pending ? 'active' :
                    label === 'Pending' && updateStatus?.pending ? 'active' : ''
                  }" onClick=${action}>${label}</button>
                `)}
              </div>
            </div>
          </div>
        `}

        <details class="settings-details">
          <summary class="settings-details-summary">How to install updates</summary>
          <div class="settings-details-body">
            <p>When the built-in UI changes, open <code>~/.general-app</code> in an AI coding agent:</p>
            <ul>
              <li><strong>Claude Code</strong>: run <code>/update-ui</code></li>
              <li><strong>Codex</strong>: ask it to merge upstream changes from the built-in UI</li>
              <li><strong>Any agent</strong>: point it at the directory and ask it to apply <code>UPDATE.md</code></li>
            </ul>
            <p>The agent diffs the built-in files against your copies and merges changes, preserving your modifications.</p>
          </div>
        </details>

        <div class="settings-footer">
          <span class="settings-footer-title">General App</span>
          ${appVersion && html`<span class="settings-footer-version">v${appVersion}</span>`}
        </div>
      </div>
    </div>
  `
}
