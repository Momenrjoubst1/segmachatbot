import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './i18n/i18next'
import { App } from './App'

// In dev, unregister any stale service worker left over from a production build.
// The SW caches hashed Vite URLs and can break HMR / cause 404s on every reload.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister())
  })
  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
