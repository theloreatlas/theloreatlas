/**
 * theme.js — Dark/Light theme for The Lore Atlas
 * Loaded synchronously in <head>, before the stylesheets, so data-theme is on
 * <html> before first paint (no flash). Dark is the default; tokens.css treats
 * anything that is not "light" as dark. Choice persists in localStorage.
 */

const LoreTheme = (() => {

  const STORAGE_KEY = 'loreAtlas_theme';

  function get() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function syncOptions() {
    const current = get();
    document.querySelectorAll('[data-theme-option]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.themeOption === current));
    });
  }

  function set(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* storage blocked: theme still applies for this page */ }
    syncOptions();
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark';

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-option]').forEach(btn => {
      btn.addEventListener('click', () => set(btn.dataset.themeOption));
    });
    syncOptions();
  });

  return { get, set };
})();
