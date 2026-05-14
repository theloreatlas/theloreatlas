/**
 * spa-redirect.js — GitHub Pages SPA deep-link recovery.
 *
 * Pairs with 404.html. When GitHub Pages 404s on a deep URL like
 * /sherlock_holmes/characters/sherlock-holmes, 404.html captures the path
 * into sessionStorage and bounces the browser to /. This script runs in
 * index.html before any other JS, reads the stashed path, and rewrites the
 * URL bar back to the original path via history.replaceState — without a
 * navigation, so the app boots once on the correct route.
 *
 * Must load synchronously in <head> BEFORE app.js so parseRoute() sees
 * the corrected pathname on first run.
 *
 * Loaded as an external file (not inline) to keep the strict CSP intact
 * (script-src 'self' …; no 'unsafe-inline').
 */
(function () {
  var redirect = sessionStorage.getItem('spa_redirect');
  if (!redirect) return;
  sessionStorage.removeItem('spa_redirect');

  // Sanity check: only act on same-origin paths starting with '/'.
  // Defends against any value sneaking into sessionStorage from an
  // unrelated source.
  if (typeof redirect !== 'string' || redirect.charAt(0) !== '/') return;

  var current = window.location.pathname + window.location.search + window.location.hash;
  if (redirect === current) return;

  history.replaceState(null, '', redirect);
})();
