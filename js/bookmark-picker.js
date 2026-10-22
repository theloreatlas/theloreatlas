/**
 * bookmark-picker.js — Bookmark picker dialog + first-visit prompt
 * Part of The Lore Atlas SPA (redesign Phase 3).
 *
 * Both dialogs draw their book buttons and chapter/story units with the shared
 * helpers below. They write the bookmark only through setBookmark() /
 * clearBookmark() (reader-position.js), so the bar, the aria-live text and the
 * page re-gating all follow. All positions and widths go through CSSOM: the
 * CSP drops inline style attributes.
 */

// ── Shared: unit grid / story list, book buttons ─────────────────────────────

const UNIT_STATE_PHRASE = { read: 'read', current: 'your bookmark', unread: 'not read yet' };

// pos: { book, chapter } or null. With no position the picker shows everything
// as read (nothing is hidden); the first-visit prompt passes 'unread' so its
// grid starts blank.
function unitState(book, n, pos, noneState) {
  if (!pos) return noneState;
  const order = book.chronological_order;
  if (pos.book > order) return 'read';
  if (pos.book < order) return 'unread';
  if (n < pos.chapter) return 'read';
  return n === pos.chapter ? 'current' : 'unread';
}

// Story N of a collection is stories_contained[N-1]; show that case's title.
function storyTitle(book, n) {
  const id = (book.stories_contained || [])[n - 1];
  const entity = id ? LoreLoader.getById(id) : null;
  return (entity && (entity.title || entity.name)) || `Story ${n}`;
}

// Numbered grid for novels, two-column title list for collections. Clicking a
// unit calls onPick(n); the caller redraws (this re-renders and keeps focus).
// The units are one roving-tabindex group: a single Tab stop on the current
// unit (the first one when none is current); arrow keys move it.
function renderUnits(container, book, pos, onPick, noneState = 'read') {
  const novel = book.type === 'novel';
  const count = SpoilerGate.getChapterCount(book);
  container.replaceChildren();
  container.classList.toggle('is-grid', novel);
  container.classList.toggle('is-list', !novel);

  const states = Array.from({ length: count }, (_, i) => unitState(book, i + 1, pos, noneState));
  const stop = Math.max(0, states.indexOf('current')); // 0 when none is current

  for (let n = 1; n <= count; n++) {
    const state = states[n - 1];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = novel ? 'pk-cell' : 'pk-story';
    btn.dataset.state = state;
    btn.tabIndex = n - 1 === stop ? 0 : -1;
    if (state === 'current') btn.setAttribute('aria-current', 'true');

    if (novel) {
      btn.textContent = String(n);
      btn.setAttribute('aria-label', `Chapter ${n}, ${UNIT_STATE_PHRASE[state]}`);
    } else {
      const title = storyTitle(book, n);
      btn.innerHTML = `<span class="pk-story-n">${n}</span><span class="pk-story-t">${esc(title)}</span>`;
      btn.setAttribute('aria-label', `Story ${n}, ${title}, ${UNIT_STATE_PHRASE[state]}`);
    }

    btn.addEventListener('click', () => {
      onPick(n);
      const again = container.children[n - 1];
      if (again) again.focus();
    });
    container.appendChild(btn);
  }
}

// Arrow keys move between units: left/right by one, up/down by a row. Focus
// carries the Tab stop with it.
function bindUnitArrowKeys(container) {
  container.addEventListener('focusin', (e) => {
    if (e.target.parentNode !== container) return;
    for (const item of container.children) item.tabIndex = item === e.target ? 0 : -1;
  });
  container.addEventListener('keydown', (e) => {
    const keys = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 };
    if (!(e.key in keys)) return;
    const items = [...container.children];
    const i = items.indexOf(document.activeElement);
    if (i === -1) return;
    const cols = container.classList.contains('is-grid') ? 6 : 2;
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    const next = items[i + keys[e.key] * (vertical ? cols : 1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  });
}

function bookmarkLegend() {
  const legend = document.createElement('div');
  legend.className = 'pk-legend';
  legend.innerHTML = '<span><i class="pk-swatch" data-state="read"></i>Read</span>'
    + '<span><i class="pk-swatch" data-state="current"></i>Your bookmark</span>'
    + '<span><i class="pk-swatch" data-state="unread"></i>Not read yet</span>';
  return legend;
}

// One button per book: full title + year + progress bar (desktop list rows) and
// the short title (chips on phones / first visit); CSS picks which to show.
function buildBookButtons(listEl, books, seriesName, onSelect) {
  return books.map((book) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pk-book';
    btn.innerHTML = '<span class="pk-book-head">'
      + `<span class="pk-book-title">${esc(book.title)}</span>`
      + `<span class="pk-book-short">${esc(shortBookTitle(book.title, seriesName))}</span>`
      + `<span class="pk-book-year">${esc(book.publication_year ? String(book.publication_year) : '')}</span>`
      + '</span><span class="pk-book-bar"><span class="pk-book-fill"></span></span>';
    btn.addEventListener('click', () => {
      onSelect(book.chronological_order);
      btn.focus();
    });
    listEl.appendChild(btn);
    return btn;
  });
}

// selOrder: the book whose units are showing. pos drives the progress bars.
function updateBookButtons(buttons, books, selOrder, pos) {
  books.forEach((book, i) => {
    const btn = buttons[i];
    const order = book.chronological_order;
    const selected = order === selOrder;
    btn.setAttribute('aria-pressed', String(selected));
    btn.classList.toggle('is-selected', selected);
    btn.classList.toggle('is-later', !!pos && order > pos.book);

    let fraction = 1;
    if (pos) {
      if (order > pos.book) fraction = 0;
      else if (order === pos.book) fraction = Math.min(1, pos.chapter / SpoilerGate.getChapterCount(book));
    }
    btn.querySelector('.pk-book-fill').style.width = `${Math.round(fraction * 1000) / 10}%`;
  });
}

// ── Picker dialog ─────────────────────────────────────────────────────────────

let bookmarkPicker = null; // { dlg, els, buttons, selBook, opener } once built

const PICKER_MOBILE_QUERY = '(max-width: 760px)';

function buildBookmarkPicker() {
  const { books, seriesName } = bookmarkBar;
  const dlg = document.createElement('dialog');
  dlg.className = 'picker';
  dlg.setAttribute('aria-label', 'Move your bookmark');
  dlg.innerHTML = '<span class="pk-handle" aria-hidden="true"></span>'
    + '<p class="pk-sheet-title">Move your bookmark</p>'
    + '<div class="pk-books"><p class="pk-label">Book</p><div class="pk-booklist"></div></div>'
    + '<div class="pk-detail">'
    +   '<p class="pk-label pk-unit-label"></p>'
    +   '<div class="pk-head"><h2 class="pk-book-name"></h2><p class="pk-count"></p></div>'
    +   '<div class="pk-units"></div>'
    +   '<div class="pk-legend-slot"></div>'
    +   '<div class="pk-foot">'
    +     '<button type="button" class="pk-clear">Show everything</button>'
    +     '<span class="pk-current"></span>'
    +     '<button type="button" class="pk-done">Done</button>'
    +   '</div>'
    + '</div>'
    + '<p class="visually-hidden" aria-live="polite"></p>';

  const els = {
    unitLabel: dlg.querySelector('.pk-unit-label'),
    name:      dlg.querySelector('.pk-book-name'),
    count:     dlg.querySelector('.pk-count'),
    units:     dlg.querySelector('.pk-units'),
    legend:    dlg.querySelector('.pk-legend-slot'),
    clear:     dlg.querySelector('.pk-clear'),
    current:   dlg.querySelector('.pk-current'),
    done:      dlg.querySelector('.pk-done'),
    live:      dlg.querySelector('[aria-live]'),
    list:      dlg.querySelector('.pk-booklist'),
  };
  els.legend.appendChild(bookmarkLegend());

  const picker = { dlg, els, buttons: [], selBook: books[0].chronological_order, opener: null };
  picker.buttons = buildBookButtons(els.list, books, seriesName, (order) => {
    picker.selBook = order;
    renderBookmarkPicker();
  });
  bindUnitArrowKeys(els.units);

  els.clear.addEventListener('click', () => {
    clearBookmark();
    els.live.textContent = bookmarkBar.els.live.textContent;
    renderBookmarkPicker();
  });
  els.done.addEventListener('click', () => dlg.close());

  // A click that lands on the dialog element itself, outside its box, is the backdrop.
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right
      && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dlg.close();
  });

  dlg.addEventListener('close', () => {
    window.removeEventListener('resize', positionBookmarkPicker);
    if (picker.opener) {
      picker.opener.setAttribute('aria-expanded', 'false');
      picker.opener.focus();
    }
  });

  document.body.appendChild(dlg);
  return picker;
}

function renderBookmarkPicker() {
  const { seriesId, books } = bookmarkBar;
  const { els, buttons, selBook } = bookmarkPicker;
  const pos = SpoilerGate.getPosition(seriesId);
  const book = books.find(b => b.chronological_order === selBook) || books[0];
  const novel = book.type === 'novel';
  const count = SpoilerGate.getChapterCount(book);

  updateBookButtons(buttons, books, selBook, pos);

  els.unitLabel.textContent = novel ? 'Chapters' : 'Stories';
  els.name.textContent = book.title;
  els.count.textContent = `${count} ${novel ? 'chapters' : 'stories'}`;
  els.legend.hidden = !novel;

  renderUnits(els.units, book, pos, (n) => {
    setBookmark(book.chronological_order, n);
    els.live.textContent = bookmarkBar.els.live.textContent;
    renderBookmarkPicker();
  });

  const cur = pos && books.find(b => b.chronological_order === pos.book);
  els.current.replaceChildren();
  if (cur) {
    const strong = document.createElement('strong');
    strong.textContent = `${cur.title}, ${bookUnitWord(cur)} ${pos.chapter}`;
    els.current.append('Bookmark: ', strong);
  } else {
    els.current.textContent = pos ? `Bookmark: Book ${pos.book}` : 'No bookmark set';
  }
  els.clear.hidden = !pos;
}

// Desktop: a popover under the bookmark bar, left edge on the title button,
// kept inside the gutters. Phones: the CSS bottom sheet, so clear any offsets.
function positionBookmarkPicker() {
  const { dlg, opener } = bookmarkPicker;
  if (window.matchMedia(PICKER_MOBILE_QUERY).matches) {
    ['top', 'left', 'max-height'].forEach(p => dlg.style.removeProperty(p));
    return;
  }
  const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 48;
  const barBottom = bookmarkBar.els.bar.getBoundingClientRect().bottom;
  const anchor = opener.getBoundingClientRect();
  const width = dlg.offsetWidth;
  const top = Math.max(8, Math.min(barBottom + 8, window.innerHeight - 320));
  const left = Math.max(gutter, Math.min(anchor.left, window.innerWidth - width - gutter));
  dlg.style.setProperty('top', `${top}px`);
  dlg.style.setProperty('left', `${left}px`);
  dlg.style.setProperty('max-height', `${window.innerHeight - top - 16}px`);
}

function openBookmarkPicker(opener) {
  if (!bookmarkBar) return;
  if (!bookmarkPicker) bookmarkPicker = buildBookmarkPicker();
  const { seriesId, books } = bookmarkBar;
  const pos = SpoilerGate.getPosition(seriesId);
  // Start on the bookmark's book, or the first book when there is none.
  bookmarkPicker.selBook = pos && books.some(b => b.chronological_order === pos.book)
    ? pos.book
    : books[0].chronological_order;
  bookmarkPicker.opener = opener;
  opener.setAttribute('aria-expanded', 'true');

  renderBookmarkPicker();
  bookmarkPicker.dlg.showModal();
  // Land on the selected book rather than the scrollable list container.
  const selected = bookmarkPicker.dlg.querySelector('.pk-book.is-selected');
  if (selected) selected.focus();
  positionBookmarkPicker();
  window.addEventListener('resize', positionBookmarkPicker);
}

// Empty-state "Move my bookmark" buttons (views.js emptyState + PICKER_ACTION).
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-open-picker]')) return;
  if (bookmarkBar) openBookmarkPicker(bookmarkBar.els.title);
});

// ── First visit ───────────────────────────────────────────────────────────────

function firstVisitKey(seriesId) {
  return `loreAtlas_firstVisitAnswered_${seriesId}`;
}

// Once per universe, and only for visitors with no saved bookmark. If storage
// is unavailable we could never remember the answer, so don't ask at all.
function maybeShowFirstVisit() {
  const { seriesId } = bookmarkBar;
  if (SpoilerGate.getPosition(seriesId)) return;
  try {
    if (localStorage.getItem(firstVisitKey(seriesId))) return;
  } catch {
    return;
  }
  showFirstVisit();
}

function showFirstVisit() {
  const { seriesId, seriesName, books } = bookmarkBar;
  const first = books[0];
  const dlg = document.createElement('dialog');
  dlg.className = 'first-visit';
  dlg.setAttribute('aria-labelledby', 'fv-title');
  dlg.innerHTML = '<p class="pk-label">Before you start</p>'
    + `<h2 class="fv-title" id="fv-title">How far into ${esc(seriesName)} are you?</h2>`
    + '<p class="fv-lead">We’ll hide everything past that point: names, events, relationships, even search results.</p>'
    + '<div class="fv-options">'
    +   '<button type="button" class="fv-option" data-fv="start"><strong>I’m just starting</strong>'
    +     `<span>Bookmark at ${esc(first.title)}, ${bookUnitWord(first)} 1</span></button>`
    +   '<button type="button" class="fv-option" data-fv="partway" aria-expanded="false" aria-controls="fv-pick">'
    +     '<strong>I’m partway through</strong><span>Choose the book and chapter</span></button>'
    +   '<div class="fv-pick" id="fv-pick" hidden>'
    +     '<div class="fv-books"></div><div class="pk-units"></div><div class="pk-legend-slot"></div>'
    +     '<button type="button" class="pk-done fv-set" disabled>Set my bookmark</button>'
    +   '</div>'
    +   '<button type="button" class="fv-option" data-fv="all"><strong>I’ve read it all</strong>'
    +     '<span>Show everything, no spoiler limits</span></button>'
    + '</div>'
    + '<p class="fv-note">Saved on this device. Change it any time from the bookmark bar.</p>';

  const partway = dlg.querySelector('[data-fv="partway"]');
  const pick    = dlg.querySelector('.fv-pick');
  const units   = dlg.querySelector('.pk-units');
  const setBtn  = dlg.querySelector('.fv-set');
  dlg.querySelector('.pk-legend-slot').appendChild(bookmarkLegend());

  // Picking here only stages a choice; nothing is saved until "Set my bookmark".
  const state = { sel: first.chronological_order, pending: null };

  const redraw = () => {
    const book = books.find(b => b.chronological_order === state.sel);
    updateBookButtons(buttons, books, state.sel, null);
    dlg.querySelector('.pk-legend-slot').hidden = book.type !== 'novel';
    renderUnits(units, book, state.pending, (n) => {
      state.pending = { book: state.sel, chapter: n };
      setBtn.disabled = false;
      redraw();
    }, 'unread');
  };
  const buttons = buildBookButtons(dlg.querySelector('.fv-books'), books, seriesName, (order) => {
    state.sel = order;
    redraw();
  });
  bindUnitArrowKeys(units);

  dlg.querySelector('[data-fv="start"]').addEventListener('click', () => {
    setBookmark(first.chronological_order, 1);
    dlg.close();
  });
  dlg.querySelector('[data-fv="all"]').addEventListener('click', () => dlg.close());
  partway.addEventListener('click', () => {
    const open = pick.hidden;
    pick.hidden = !open;
    partway.setAttribute('aria-expanded', String(open));
    if (open) redraw();
  });
  setBtn.addEventListener('click', () => {
    if (!state.pending) return;
    setBookmark(state.pending.book, state.pending.chapter);
    dlg.close();
  });

  // Any way out (a choice, or Escape) counts as answered, so it never nags.
  dlg.addEventListener('close', () => {
    try { localStorage.setItem(firstVisitKey(seriesId), '1'); } catch { /* storage blocked */ }
    dlg.remove();
  });

  document.body.appendChild(dlg);
  dlg.showModal();
}
