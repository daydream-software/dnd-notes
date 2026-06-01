// Floating dark / light toggle for design-system previews.
//
// Reads localStorage['dndnotes-preview-theme'] if set, otherwise falls back
// to `prefers-color-scheme`. Sets `data-theme="light|dark"` on <html>; CSS
// in colors_and_type.css picks it up from there. Loaded with `defer` from
// each preview HTML — runs after parse, before DOMContentLoaded fires.
//
// State syncs across open preview tabs via the `storage` event so flipping
// the toggle in one tab updates all the others.

(function () {
  var root = document.documentElement
  var KEY = 'dndnotes-preview-theme'

  function resolve () {
    var stored = null
    try { stored = localStorage.getItem(KEY) } catch (_) {}
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }

  var btn = null

  function apply (mode) {
    root.dataset.theme = mode
    if (!btn) return
    btn.setAttribute('aria-pressed', mode === 'light' ? 'true' : 'false')
    btn.querySelector('.dndn-toggle-label').textContent = mode === 'light' ? 'Light' : 'Dark'
    btn.querySelector('.dndn-toggle-icon').textContent = mode === 'light' ? '◐' : '◑'
  }

  // Set theme before first paint (script runs after parse).
  apply(resolve())

  function mount () {
    btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('aria-label', 'Toggle color mode')
    btn.className = 'dndn-mode-toggle'

    var iconSpan = document.createElement('span')
    iconSpan.className = 'dndn-toggle-icon'
    iconSpan.setAttribute('aria-hidden', 'true')
    iconSpan.textContent = '◑'
    btn.appendChild(iconSpan)

    var labelSpan = document.createElement('span')
    labelSpan.className = 'dndn-toggle-label'
    labelSpan.textContent = 'Dark'
    btn.appendChild(labelSpan)
    btn.style.cssText = [
      'position: fixed',
      'top: 16px',
      'right: 16px',
      'z-index: 9999',
      'background: var(--bg-paper-strong)',
      'border: 1px solid var(--brand-line)',
      'border-radius: var(--radius-pill)',
      'padding: 6px 14px 6px 12px',
      'font-family: var(--font-sans)',
      'font-size: 12px',
      'font-weight: 600',
      'letter-spacing: 0.04em',
      'color: var(--fg-1)',
      'cursor: pointer',
      'display: inline-flex',
      'align-items: center',
      'gap: 8px',
      'backdrop-filter: blur(8px)',
      '-webkit-backdrop-filter: blur(8px)',
      'box-shadow: var(--shadow-sm)',
      'transition: background-color 200ms, border-color 200ms, color 200ms',
    ].join(';')

    btn.addEventListener('click', function () {
      var next = root.dataset.theme === 'light' ? 'dark' : 'light'
      try { localStorage.setItem(KEY, next) } catch (_) {}
      apply(next)
    })

    document.body.appendChild(btn)
    apply(resolve())

    window.addEventListener('storage', function (e) {
      if (e.key === KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        apply(e.newValue)
      }
    })
  }

  if (document.body) {
    mount()
  } else {
    document.addEventListener('DOMContentLoaded', mount)
  }
})()
