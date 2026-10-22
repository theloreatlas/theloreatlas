/**
 * universe-switcher.js — The header universe pill and its switcher dialog
 * Part of The Lore Atlas SPA (redesign Phase 6).
 *
 * A popover under the pill on desktop, a bottom sheet on phones (the same
 * dialog patterns as the bookmark picker: showModal, Escape, backdrop click,
 * focus back to the opener). One row per series, each with that universe's own
 * bookmark; the current one is marked. Widths go through CSSOM: the CSP drops
 * inline style attributes.
 */

let universeSwitcher = null; // { dlg, list, opener } once built

// Share of a universe's chapters/stories the bookmark has passed, 0 with no
// bookmark. (The bookmark bar treats "no bookmark" as everything read; here an
// empty bar sits next to "No bookmark set", which reads more naturally.)
function seriesProgress(seriesId) {
  const pos = SpoilerGate.getPosition(seriesId);
  if (!pos) return 0;
  const books = LoreLoader.getAll(seriesId, 'books');
  let total = 0, done = 0;
  for (const b of books) {
    const units = SpoilerGate.getChapterCount(b);
    total += units;
    if (b.chronological_order < pos.book) done += units;
    else if (b.chronological_order === pos.book) done += Math.min(units, pos.chapter);
  }
  return total ? done / total : 0;
}

function universeRowHtml(series, currentId) {
  const stories = LoreLoader.getAll(series.id, 'cases').length;
  const pos = SpoilerGate.getPosition(series.id);
  const current = series.id === currentId;
  const pct = Math.round(seriesProgress(series.id) * 1000) / 10;
  return `<li><a class="sw-row" href="/${encodeURIComponent(series.id)}/" data-universe="${esc(series.id)}"${current ? ' aria-current="true"' : ''}>`
    + `<span class="sw-swatch" aria-hidden="true"></span>`
    + `<span class="sw-body">`
    +   `<span class="sw-name">${esc(series.name)}</span>`
    +   `<span class="sw-meta">${esc([series.author, `${stories} ${stories === 1 ? 'story' : 'stories'}`].filter(Boolean).join(' · '))}</span>`
    +   `<span class="sw-pos"><span class="sw-bar"><span class="sw-fill" data-pct="${pct}"></span></span>`
    +   `<span class="sw-pos-text">${esc(pos ? formatPosition(pos, series.id) : 'No bookmark set')}</span></span>`
    + `</span>`
    + (current ? '<span class="sw-current">Current</span>' : '')
    + `</a></li>`;
}

const UNIVERSE_SLOT = '<li class="sw-slot" aria-hidden="true"><span class="sw-swatch"></span>'
  + '<span class="sw-body"><span class="sw-slot-name">Next universe</span><span class="sw-slot-meta">Coming later</span></span></li>';

function buildUniverseSwitcher() {
  const dlg = document.createElement('dialog');
  dlg.className = 'switcher';
  dlg.setAttribute('aria-labelledby', 'sw-title');
  dlg.innerHTML = '<span class="pk-handle" aria-hidden="true"></span>'
    + '<h2 class="pk-label sw-title" id="sw-title">Universes</h2>'
    + '<ul class="sw-list"></ul>'
    + '<p class="sw-note">Each universe keeps its own bookmark.</p>';
  const sw = { dlg, list: dlg.querySelector('.sw-list'), opener: null };

  // A click that lands on the dialog element itself, outside its box, is the backdrop.
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('.sw-row')) { dlg.close(); return; } // the link still navigates
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right
      && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dlg.close();
  });

  dlg.addEventListener('close', () => {
    window.removeEventListener('resize', positionUniverseSwitcher);
    if (sw.opener) {
      sw.opener.setAttribute('aria-expanded', 'false');
      sw.opener.focus();
    }
  });

  document.body.appendChild(dlg);
  return sw;
}

// Desktop: left edge on the pill, kept inside the gutters. Phones: the CSS
// bottom sheet, so clear any offsets.
function positionUniverseSwitcher() {
  const { dlg, opener } = universeSwitcher;
  if (window.matchMedia(PICKER_MOBILE_QUERY).matches) {
    ['top', 'left', 'max-height'].forEach(p => dlg.style.removeProperty(p));
    return;
  }
  const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 48;
  const anchor = opener.getBoundingClientRect();
  const top = anchor.bottom + 8;
  const left = Math.max(gutter / 2, Math.min(anchor.left, window.innerWidth - dlg.offsetWidth - gutter / 2));
  dlg.style.setProperty('top', `${top}px`);
  dlg.style.setProperty('left', `${left}px`);
  dlg.style.setProperty('max-height', `${window.innerHeight - top - 16}px`);
}

function openUniverseSwitcher(opener) {
  if (!bookmarkBar) return;
  if (!universeSwitcher) universeSwitcher = buildUniverseSwitcher();
  const sw = universeSwitcher;
  sw.opener = opener;

  // Rebuilt on every open: the bookmarks may have moved since the last one.
  sw.list.innerHTML = LoreLoader.getSeries().map(s => universeRowHtml(s, bookmarkBar.seriesId)).join('')
    + UNIVERSE_SLOT + UNIVERSE_SLOT;
  for (const fill of sw.list.querySelectorAll('.sw-fill')) fill.style.width = `${fill.dataset.pct}%`;

  opener.setAttribute('aria-expanded', 'true');
  sw.dlg.showModal();
  positionUniverseSwitcher();
  window.addEventListener('resize', positionUniverseSwitcher);
}

// Called once from initUniversePill (reader-position.js).
function bindUniverseSwitcher(pill) {
  pill.addEventListener('click', () => openUniverseSwitcher(pill));
}
