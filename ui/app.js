import { html, render, useState, useEffect, useRef } from './lib/preact.js'
import { SettingsView } from './settings.js'
import { Toast } from './components/toast.js'
import { SettingsGear } from './components/settings-gear.js'

function App() {
  const [view, setView] = useState('home') // 'home' | 'settings'
  const [toast, setToast] = useState(null)
  const [toastAction, setToastAction] = useState(null)
  const toastTimer = useRef(null)

  useEffect(() => {
    window.app.onShowSettings(() => setView('settings'))
    window.app.onToast((msg) => {
      setToast(null)
      setToastAction(null)
      setTimeout(() => {
        setToast(msg)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 2000)
      }, 10)
    })
    window.app.onSourceChanged(() => {
      setToast('Reload')
      setToastAction(() => () => window.app.reloadUI())
      clearTimeout(toastTimer.current)
    })
  }, [])

  return html`
    <${Toast} message=${toast} onClick=${toastAction} />
    ${view === 'settings'
      ? html`<${SettingsView} onBack=${() => setView('home')} />`
      : html`
        <main class="home">
          <${SettingsGear} onClick=${() => setView('settings')} />
          <div class="home-inner">
            <p class="home-hint">
              Edit <code>ui/app.js</code> or open <code>~/.general-app/</code>
              in a coding agent and tell it what to build.
            </p>
            <p class="home-shortcut">Press <kbd>⌘,</kbd> for settings.</p>
          </div>
        </main>
      `
    }
  `
}

render(html`<${App} />`, document.getElementById('app'))
