import { html } from '../lib/preact.js'

export function Toast({ message, onClick }) {
  if (!message) return null
  return html`<div class="toast ${onClick ? 'toast-action' : ''}" onClick=${onClick}>${message}</div>`
}
