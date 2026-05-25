/**
 * Cold-start interstitial served to a navigation while its tenant wakes from
 * scale-to-zero (#396). Self-contained HTML — the tenant app is not up yet, so
 * it cannot reference the app's assets. Styling is derived from the design
 * system (packages/theme + docs/design-system): the background gradient, the
 * D&D Notes product mark (quill in ink bottle), the primary #a78bfa, Geist, and
 * calm sentence-case copy.
 *
 * The page polls WAKE_STATUS_PATH and reloads the original URL once the tenant
 * is ready; after a deadline it shows an actionable error state instead of
 * spinning forever.
 */

/** Reserved, collision-proof paths the activator intercepts (never proxied). */
export const ACTIVATOR_RESERVED_PREFIX = '/__dnd-notes-activator__'
export const WAKE_STATUS_PATH = `${ACTIVATOR_RESERVED_PREFIX}/wake-status`
export const FONT_PATH = `${ACTIVATOR_RESERVED_PREFIX}/geist.woff2`

/** How long the page polls before giving up and offering a retry. */
const POLL_DEADLINE_MS = 60_000
const POLL_INTERVAL_MS = 1_500

// The canonical product mark from packages/theme/assets/dnd-notes-mark.svg,
// inlined verbatim (do not redraw). color="#a78bfa" drives currentColor.
const PRODUCT_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" color="#a78bfa" width="56" height="56" role="img" aria-label="D&amp;D Notes">
  <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M 23 58 H 49 A 4 4 0 0 0 53 54 V 44 A 4 4 0 0 0 49 40 H 23 A 4 4 0 0 0 19 44 V 54 A 4 4 0 0 0 23 58 Z"/>
    <line x1="22" y1="48" x2="50" y2="48" stroke-opacity="0.55"/>
    <path d="M 28 40 V 36 A 2 2 0 0 1 30 34 H 42 A 2 2 0 0 1 44 36 V 40"/>
    <path d="M 30 34 V 31 H 42 V 34"/>
  </g>
  <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <line x1="9" y1="9" x2="32" y2="32"/>
    <path d="M 10 8 C 24 10, 32 18, 32 32 C 22 32, 14 24, 9 9 Z" fill="currentColor" fill-opacity="0.18"/>
    <line x1="14" y1="14" x2="18.5" y2="18" stroke-width="2"/>
    <line x1="18" y1="18" x2="23" y2="22" stroke-width="2"/>
    <line x1="22" y1="22" x2="27" y2="26.5" stroke-width="2"/>
  </g>
</svg>`

export function renderColdStartInterstitial(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Waking your workspace</title>
<style>
  @font-face {
    font-family: 'Geist';
    src: url('${FONT_PATH}') format('woff2-variations'),
         url('${FONT_PATH}') format('woff2');
    font-weight: 100 900;
    font-display: swap;
  }
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #e2e8f0;
    background:
      radial-gradient(circle at top, rgba(124, 58, 237, 0.28), transparent 35%),
      linear-gradient(180deg, #020617 0%, #0f172a 48%, #111827 100%);
    background-attachment: fixed;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    max-width: 420px;
    text-align: center;
    padding: 40px 32px;
    border-radius: 18px;
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(167, 139, 250, 0.22);
    box-shadow: 0 24px 48px rgba(2, 6, 23, 0.26);
    backdrop-filter: blur(14px);
  }
  .spinner {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 3px solid rgba(167, 139, 250, 0.22);
    border-top-color: #a78bfa;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
  h1 { margin: 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 0; color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
  .error { display: none; }
  .error button {
    margin-top: 4px;
    font: inherit;
    font-weight: 600;
    color: #0f172a;
    background: #a78bfa;
    border: none;
    border-radius: 18px;
    padding: 10px 20px;
    cursor: pointer;
  }
  .error button:hover { background: #b9a4fb; }
  body.timed-out .live { display: none; }
  body.timed-out .error { display: flex; flex-direction: column; align-items: center; gap: 16px; }
</style>
</head>
<body>
  <main class="card">
    ${PRODUCT_MARK}
    <div class="live" role="status" aria-live="polite">
      <div class="spinner" style="margin: 0 auto 20px"></div>
      <h1>Waking your workspace</h1>
      <p>Your workspace was resting to save resources. This usually takes a few seconds.</p>
    </div>
    <div class="error">
      <h1>This is taking longer than usual</h1>
      <p>Your workspace has not responded yet. You can try again.</p>
      <button type="button" onclick="location.reload()">Try again</button>
    </div>
  </main>
  <script>
    (function () {
      var deadline = Date.now() + ${POLL_DEADLINE_MS};
      function fail() { document.body.classList.add('timed-out'); }
      function poll() {
        if (Date.now() > deadline) { fail(); return; }
        fetch('${WAKE_STATUS_PATH}', { headers: { 'accept': 'application/json' }, cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (j && j.ready) { location.reload(); return; }
            setTimeout(poll, ${POLL_INTERVAL_MS});
          })
          .catch(function () { setTimeout(poll, ${POLL_INTERVAL_MS}); });
      }
      poll();
    })();
  </script>
</body>
</html>`
}
