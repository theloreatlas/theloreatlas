/**
 * reader-position.js — Bookmark bar (reading position + book strip, spoiler gating UI)
 * Part of The Lore Atlas SPA (split from app.js, Session 13.5; rebuilt as the
 * bookmark bar in redesign Phase 2).
 *
 * The position itself still lives in SpoilerGate (same localStorage key, so
 * saved positions carry over). This file is only the UI: one bar whose single
 * state (SpoilerGate.getPosition) is drawn into the desktop row + book strip
 * and the mobile progress bar by renderBookmarkBar().
 */

// ── Re-render on change ───────────────────────────────────────────────────────

// The position is saved to localStorage but nothing else reads it until the
// next render, so re-render the current route right away (it reads `location`,
// so ?layers= / ?selected= survive). Keeps the scroll offset: onRouteChange
// swaps in a short loading skeleton that would otherwise jump the page to the
// top.
//
// The graph page is the exception (Session 16): it re-gates in place, keeping
// the SVG, zoom, pan, layers and panel; the route is re-rendered only if that
// can't (refreshGraphViewInPlace() returns false).
async function rerenderForPositionChange() {
  if (refreshGraphViewInPlace()) return;
  const y = window.scrollY;
  await onRouteChange();
  window.scrollTo(0, y);
}

// ── Bookmark bar ──────────────────────────────────────────────────────────────

let bookmarkBar = null; // { seriesId, books, els } once initialised

// "The Sign of the Four" → "Sign of the Four"; "The Adventures of Sherlock
// Holmes" → "Adventures". Derived rather than hard-coded so a new universe's
// strip labels itself.
function shortBookTitle(title, seriesName) {
  let t = title.replace(/^(?:an?|the)\s+/i, '');
  if (seriesName) {
    const suffix = ` of ${seriesName}`;
    if (t.toLowerCase().endsWith(suffix.toLowerCase())) t = t.slice(0, -suffix.length);
  }
  return t || title;
}

function bookUnitWord(book) {
  return book.type === 'novel' ? 'Ch.' : 'Story';
}

function bookUnitNoun(book) {
  return book.type === 'novel' ? 'chapter' : 'story';
}

function initBookmarkBar() {
  if (bookmarkBar) return;

  const series = LoreLoader.getSeries();
  if (!series.length) return;

  // Single-series for now; multi-series support can be added later.
  const seriesId = series[0].id;
  const seriesName = series[0].name || '';
  const books = LoreLoader.getAll(seriesId, 'books')
    .slice()
    .sort((a, b) => (a.chronological_order || 0) - (b.chronological_order || 0));

  if (!books.length) return;

  const bar = document.getElementById('bookmark-bar');
  if (!bar) return;

  document.documentElement.dataset.universe = seriesId;
  initUniversePill(seriesId, seriesName);

  const els = {
    bar,
    progress: bar.querySelector('.bm-progress'),
    strip:    bar.querySelector('.bm-strip'),
    title:    bar.querySelector('#bookmark-title'),
    prev:     bar.querySelector('#bookmark-prev'),
    next:     bar.querySelector('#bookmark-next'),
    note:     bar.querySelector('#bookmark-note'),
    clear:    bar.querySelector('#bookmark-clear'),
    live:     bar.querySelector('#bookmark-live'),
    segs:     [],   // strip buttons, one per book
    progs:    [],   // mobile progress segments, one per book
  };

  // Segments are built once and updated in place so a click keeps keyboard focus.
  // Widths go through CSSOM: the CSP drops inline style attributes.
  for (const book of books) {
    const units = SpoilerGate.getChapterCount(book);

    const seg = document.createElement('button');
    seg.type = 'button';
    seg.className = 'bm-seg';
    seg.style.flexGrow = String(units);
    seg.setAttribute('aria-label',
      `Move bookmark to ${book.title}, ${bookUnitNoun(book)} 1`);
    seg.innerHTML = '<span class="bm-line"></span>'
      + `<span class="bm-seg-title">${esc(shortBookTitle(book.title, seriesName))}</span>`
      + `<span class="bm-seg-year">${esc(book.publication_year ? String(book.publication_year) : '')}</span>`;
    seg.addEventListener('click', () => setBookmark(book.chronological_order, 1));
    els.strip.appendChild(seg);
    els.segs.push(seg);

    const prog = document.createElement('span');
    prog.className = 'bm-prog-seg';
    prog.style.flexGrow = String(units);
    const fill = document.createElement('span');
    fill.className = 'bm-prog-fill';
    prog.appendChild(fill);
    els.progress.appendChild(prog);
    els.progs.push(prog);
  }

  els.prev.addEventListener('click', () => stepBookmark(-1));
  els.next.addEventListener('click', () => stepBookmark(1));
  els.clear.addEventListener('click', clearBookmark);
  els.title.setAttribute('aria-expanded', 'false');
  els.title.addEventListener('click', () => openBookmarkPicker(els.title));

  bookmarkBar = { seriesId, seriesName, books, els };
  renderBookmarkBar();
  bar.hidden = false;
  initFooter();
  maybeShowFirstVisit();
}

// The pill is a button that opens the universe switcher (universe-switcher.js).
function initUniversePill(seriesId, seriesName) {
  const pill = document.getElementById('universe-pill');
  if (!pill || !seriesName) return;
  bindUniverseSwitcher(pill);
  const words = seriesName.trim().split(/\s+/);
  const long  = pill.querySelector('.universe-name');
  const short = pill.querySelector('.universe-name-short');
  if (long)  long.textContent  = seriesName;
  if (short) short.textContent = words[words.length - 1];
}

// ── Position changes ──────────────────────────────────────────────────────────

function bookmarkIndex(pos) {
  return bookmarkBar.books.findIndex(b => b.chronological_order === pos.book);
}

// Save, redraw the bar, tell screen readers, then re-gate the page.
function setBookmark(bookNum, chapter) {
  const { seriesId, books } = bookmarkBar;
  SpoilerGate.setPosition(seriesId, bookNum, chapter);
  renderBookmarkBar();
  const book = books.find(b => b.chronological_order === bookNum);
  bookmarkBar.els.live.textContent = book
    ? `Bookmark: ${book.title}, ${bookUnitWord(book)} ${chapter}`
    : `Bookmark: Book ${bookNum}, ${chapter}`;
  rerenderForPositionChange();
}

function clearBookmark() {
  SpoilerGate.clearPosition(bookmarkBar.seriesId);
  renderBookmarkBar();
  bookmarkBar.els.live.textContent = 'Bookmark cleared. Everything is shown.';
  rerenderForPositionChange();
}

// One unit forward/back, crossing book boundaries.
function stepBookmark(delta) {
  const { seriesId, books } = bookmarkBar;
  const pos = SpoilerGate.getPosition(seriesId);
  if (!pos) return;
  const i = bookmarkIndex(pos);
  if (i === -1) return;

  const count = SpoilerGate.getChapterCount(books[i]);
  if (delta > 0) {
    if (pos.chapter < count) return setBookmark(pos.book, pos.chapter + 1);
    if (i < books.length - 1) return setBookmark(books[i + 1].chronological_order, 1);
  } else {
    if (pos.chapter > 1) return setBookmark(pos.book, pos.chapter - 1);
    if (i > 0) {
      const prev = books[i - 1];
      return setBookmark(prev.chronological_order, SpoilerGate.getChapterCount(prev));
    }
  }
}

// ── Footer ────────────────────────────────────────────────────────────────────

const RESET_CONFIRM_MS = 4000;

// The Universes column comes from the data; "Reset my bookmarks" clears every
// series' bookmark and first-visit flag after a second click (the label asks,
// and goes back after a few seconds).
function initFooter() {
  const list = document.getElementById('footer-universes');
  if (list) {
    list.innerHTML = LoreLoader.getSeries().map(s =>
      `<li><a href="/${encodeURIComponent(s.id)}/">${esc(s.name)}</a></li>`).join('')
      + '<li class="footer-faint">More coming</li>';
  }

  const btn = document.getElementById('reset-bookmarks');
  if (!btn) return;
  const label = btn.textContent;
  let timer = null;
  const disarm = () => {
    clearTimeout(timer);
    btn.textContent = label;
    btn.removeAttribute('data-armed');
  };
  btn.addEventListener('click', () => {
    if (!btn.hasAttribute('data-armed')) {
      btn.dataset.armed = '';
      btn.textContent = 'Click again to reset';
      bookmarkBar.els.live.textContent = 'Click again to reset all your bookmarks.';
      timer = setTimeout(disarm, RESET_CONFIRM_MS);
      return;
    }
    disarm();
    resetAllBookmarks();
  });
  // Moving on without confirming cancels it.
  btn.addEventListener('blur', disarm);
}

function resetAllBookmarks() {
  for (const s of LoreLoader.getSeries()) {
    SpoilerGate.clearPosition(s.id);
    try { localStorage.removeItem(firstVisitKey(s.id)); } catch { /* storage blocked */ }
  }
  renderBookmarkBar();
  bookmarkBar.els.live.textContent = 'All bookmarks reset. Everything is shown.';
  rerenderForPositionChange();
}

// ── Render ────────────────────────────────────────────────────────────────────

function setSplitText(parent, long, short) {
  parent.querySelector('.bm-long').textContent = long;
  parent.querySelector('.bm-short').textContent = short;
}

function renderBookmarkBar() {
  const { seriesId, seriesName, books, els } = bookmarkBar;
  const pos = SpoilerGate.getPosition(seriesId);
  const curIdx = pos ? bookmarkIndex(pos) : -1;
  const cur = curIdx === -1 ? null : books[curIdx];

  const bookEl = els.title.querySelector('.bm-book');
  const unitEl = els.title.querySelector('.bm-unit');

  if (!pos) {
    setSplitText(bookEl, 'No bookmark set', 'No bookmark');
    setSplitText(unitEl, 'Spoilers are visible', 'all visible');
    els.note.textContent = 'Everything is shown. Set a bookmark to hide what you haven’t read.';
  } else if (cur) {
    const count = SpoilerGate.getChapterCount(cur);
    const word = bookUnitWord(cur);
    setSplitText(bookEl, cur.title, shortBookTitle(cur.title, seriesName));
    setSplitText(unitEl, `${word} ${pos.chapter} of ${count}`, `${word} ${pos.chapter}`);
    els.note.textContent = 'Nothing past your bookmark is shown';
  } else {
    // Saved position names a book that no longer exists.
    setSplitText(bookEl, `Book ${pos.book}`, `Book ${pos.book}`);
    setSplitText(unitEl, `Ch. ${pos.chapter}`, `Ch. ${pos.chapter}`);
    els.note.textContent = 'Nothing past your bookmark is shown';
  }

  const noun = cur ? bookUnitNoun(cur) : 'chapter';
  els.prev.setAttribute('aria-label', `Previous ${noun}`);
  els.next.setAttribute('aria-label', `Next ${noun}`);
  els.prev.disabled = !cur || (curIdx === 0 && pos.chapter <= 1);
  els.next.disabled = !cur
    || (curIdx === books.length - 1 && pos.chapter >= SpoilerGate.getChapterCount(cur));
  els.clear.hidden = !pos;

  books.forEach((book, i) => {
    const seg = els.segs[i];
    const prog = els.progs[i];
    const units = SpoilerGate.getChapterCount(book);

    // No bookmark: everything counts as read. A stale book number: nothing is current.
    let state = 'read';
    let fraction = 1;
    if (pos && cur) {
      if (i > curIdx) { state = 'later'; fraction = 0; }
      else if (i === curIdx) { state = 'current'; fraction = Math.min(1, pos.chapter / units); }
    }

    seg.classList.toggle('is-read', state === 'read');
    seg.classList.toggle('is-current', state === 'current');
    seg.classList.toggle('is-later', state === 'later');
    if (state === 'current') seg.setAttribute('aria-current', 'true');
    else seg.removeAttribute('aria-current');

    const pct = `${Math.round(fraction * 1000) / 10}%`;
    seg.querySelector('.bm-line').style.width = pct;
    prog.firstChild.style.width = pct;
  });
}
