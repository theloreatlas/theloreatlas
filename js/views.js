/**
 * views.js — Nav state + all page/entity-detail render functions and view helpers
 * Part of The Lore Atlas SPA (split from app.js, Session 13.5).
 */

// ── Site chrome: nav active state, header search ─────────────────────────────

// Which primary nav item a route belongs to: 'atlas' | 'browse' | 'timeline' |
// 'graph' | 'search' | null. Browse covers every list and entry page except
// the timeline (events) and the graph.
function navKeyForRoute(parts) {
  if (parts.length === 0) return 'atlas';
  if (parts[0] === 'search') return 'search';
  if (parts[0] === 'series') return 'atlas';
  if (!LoreLoader.getSeriesById(parts[0])) return null;
  if (parts.length === 1) return 'atlas';
  if (parts[1] === 'events') return 'timeline';
  if (parts[1] === 'graph') return 'graph';
  return ENTITY_TYPES.some(t => t.key === parts[1]) ? 'browse' : null;
}

// Covers both the header nav and the bottom tab bar (each link has data-nav).
function updateNavActive(parts) {
  const key = navKeyForRoute(parts);
  document.querySelectorAll('[data-nav]').forEach(a => {
    const on = a.dataset.nav === key;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

let siteSearchInitialized = false;

function initSiteSearch() {
  if (siteSearchInitialized) return;
  const form  = document.getElementById('site-search');
  const input = document.getElementById('site-search-input');
  if (!form || !input) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    input.blur();
    navigate(searchPath(q));
  });

  // "/" jumps to search, unless the reader is typing somewhere or the field is
  // hidden (below 900px the tab bar's Search link takes over).
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!input.offsetParent) return;
    e.preventDefault();
    input.focus();
  });

  siteSearchInitialized = true;
}

// ── Lists ─────────────────────────────────────────────────────────────────────

// Filter and sort state per list. It lives in the module so it survives a
// bookmark re-render; typing in the filter redraws only the list body.
const listUi = {};

function listState(entityType) {
  return listUi[entityType] || (listUi[entityType] = { q: '', role: 'all', sort: 'first' });
}

const ROLE_ORDER = ['protagonist', 'supporting', 'antagonist', 'client'];
const ROLE_PLURALS = { protagonist: 'protagonists', supporting: 'supporting characters', antagonist: 'antagonists', client: 'clients' };

function listNoun(entityType, n) {
  const et = ENTITY_TYPES.find(e => e.key === entityType);
  return (n === 1 ? et.singular : et.label).toLowerCase();
}

// A case's story number inside its book (0 when unknown).
function storyNumber(caseEntity) {
  const book = LoreLoader.getById(caseEntity.source_book);
  const i = book && book.stories_contained ? book.stories_contained.indexOf(caseEntity.id) : -1;
  return i + 1;
}

// Where the reader is in a case: null with no bookmark; otherwise
// { key: finished | now | progress | unread, label }. A single-unit case is
// "Reading now" while the bookmark sits on it; a case across books has no
// "Ch. N of M", so it reads "Reading now" too.
function caseStatus(entity, pos, seriesId) {
  if (!pos) return null;
  const a = entity.first_mention, b = entity.full_reveal;
  const span = caseSpan(entity);
  if (a && span && span.units === 1 && SpoilerGate.comparePositions(pos, a) === 0) return { key: 'now', label: 'Reading now' };
  if (b && SpoilerGate.comparePositions(pos, b) >= 0) return { key: 'finished', label: 'Finished' };
  if (a && SpoilerGate.comparePositions(pos, a) >= 0) {
    if (!span) return { key: 'now', label: 'Reading now' };
    const book = bookByNumber(seriesId, span.book);
    return { key: 'progress', label: `${book ? bookUnitWord(book) : 'Ch.'} ${pos.chapter} of ${span.end}` };
  }
  return { key: 'unread', label: 'Not read' };
}

// The book a list row is grouped under; 0 = no first appearance ("Throughout").
function listBookNumber(entity, entityType) {
  if (entityType === 'cases') {
    const b = LoreLoader.getById(entity.source_book);
    return b ? b.chronological_order : 0;
  }
  return entity.first_mention ? entity.first_mention.book : 0;
}

/**
 * Groups a list's entities by book of first appearance and works out what the
 * bookmark hides. Hidden entities are only counted, never carried along:
 * those in the bookmark's own book become `laterInBook`, those in later books
 * go to `later`. Cases are the one exception (operator decision): every case in
 * a book the reader has reached is listed, since the book's stories are its
 * table of contents; only cases in later books collapse.
 */
function buildListModel(seriesId, entityType) {
  const entities = LoreLoader.getAll(seriesId, entityType);
  const books = LoreLoader.getAll(seriesId, 'books');
  const pos = SpoilerGate.getPosition(seriesId);
  const groups = new Map();
  const groupFor = (n) => {
    if (!groups.has(n)) groups.set(n, { bookNum: n, book: books.find(b => b.chronological_order === n) || null, rows: [], laterInBook: 0 });
    return groups.get(n);
  };
  const later = { count: 0, books: new Set() };
  let visibleCount = 0, hiddenCount = 0;

  for (const entity of entities) {
    const bookNum = listBookNumber(entity, entityType);
    const status = SpoilerGate.getRevealStatus(entity, seriesId);
    const inLaterBook = !!pos && bookNum > pos.book;

    if (entityType === 'cases' ? inLaterBook : status === 'hidden') {
      hiddenCount++;
      if (inLaterBook) { later.count++; later.books.add(bookNum); }
      else groupFor(bookNum).laterInBook++;
      continue;
    }
    groupFor(bookNum).rows.push({ entity, status });
    visibleCount++;
  }

  const ordered = [...groups.values()].sort((a, b) => (a.bookNum || Infinity) - (b.bookNum || Infinity));
  return { pos, groups: ordered, later: { count: later.count, bookCount: later.books.size }, visibleCount, hiddenCount, total: entities.length };
}

function listSummary(model, entityType, seriesId) {
  const { pos, visibleCount, hiddenCount, total } = model;
  if (!pos) return `${total} ${listNoun(entityType, total)}`;

  if (entityType === 'cases') {
    const tally = { finished: 0, active: 0, unread: 0 };
    for (const c of LoreLoader.getAll(seriesId, 'cases')) {
      const s = caseStatus(c, pos, seriesId);
      tally[s.key === 'finished' ? 'finished' : s.key === 'unread' ? 'unread' : 'active']++;
    }
    return [
      tally.finished && `${tally.finished} finished`,
      tally.active && `${tally.active} in progress`,
      tally.unread && `${tally.unread} not read`,
    ].filter(Boolean).join(' · ');
  }

  const reached = entityType === 'characters' ? 'met so far' : 'reached so far';
  return hiddenCount ? `${visibleCount} ${reached} · ${hiddenCount} hidden by your bookmark` : `${visibleCount} ${reached}`;
}

// ── List rows ─────────────────────────────────────────────────────────────────

function groupHeadHtml(group, entityType) {
  if (!group.bookNum) return `<header class="lgroup-head"><h2 class="lg-title">Throughout</h2></header>`;
  const meta = [group.book && group.book.publication_year, entityType === 'cases' && group.book && group.book.type === 'novel' && 'Novel']
    .filter(Boolean).join(' · ');
  return `<header class="lgroup-head"><span class="lg-num">${String(group.bookNum).padStart(2, '0')}</span>`
    + `<h2 class="lg-title">${esc(group.book ? group.book.title : `Book ${group.bookNum}`)}</h2>`
    + (meta ? `<span class="lg-meta">${esc(meta)}</span>` : '') + `</header>`;
}

function caseRowHtml(row, pos, seriesId) {
  const { entity, status } = row;
  const cs = caseStatus(entity, pos, seriesId);
  const ready = status === 'full';
  return `<a class="lrow lrow-case" href="${entityRowHref(entity)}"${cs ? ` data-read="${cs.key}"` : ''}>`
    + `<span class="lr-num">${storyNumber(entity) || ''}</span>`
    + `<span class="lr-name">${esc(entityDisplayName(entity, 'cases'))}</span>`
    + `<span class="lr-status">${cs ? `<span class="chip-sm" data-case="${cs.key}">${esc(cs.label)}</span>` : ''}</span>`
    + `<span class="lr-solution" data-ready="${ready}">${ready ? 'Solution ready' : 'Sealed'}</span></a>`;
}

function listRowHtml(row, entityType, group, seriesId, seriesName) {
  const { entity, status } = row;
  const first = entity.first_mention;
  const unit = first ? positionIn(first, group.bookNum, seriesId) : '';
  const flag = status === 'partial' ? '<span class="chip-sm" data-case="partial">Partial</span>' : '';
  const name = esc(entityDisplayName(entity, entityType));
  const from = first ? `From ${group.book ? shortBookTitle(group.book.title, seriesName) + ', ' : ''}${unit}` : '';

  if (entityType === 'characters') {
    const rels = visibleRelationships(entity).rows.length;
    const tone = roleTone(entity.role);
    return `<a class="lrow lrow-char" href="${entityRowHref(entity)}">`
      + `<span class="lr-name">${dotHtml(tone, 'lr-dot')}<span>${name}</span></span>`
      + `<span class="lr-role">${dotHtml(tone)}${esc(humanize(entity.role))}</span>`
      + `<span class="lr-first">${esc(unit || '—')}</span>`
      + `<span class="lr-conn">${rels} connection${rels === 1 ? '' : 's'}</span>`
      + `<span class="lr-flag">${flag}</span>`
      + `<span class="lr-sub">${esc(from)}</span></a>`;
  }

  const meta = getEntityMeta(entity, entityType);
  const metaHtml = entityType === 'relationships' && entity.relationship_type
    ? `<span class="rel-line" data-rel="${relTypeGroup(entity.relationship_type)}"></span>${esc(humanize(meta))}`
    : esc(entityType === 'factions' || entityType === 'locations' || entityType === 'artifacts' ? humanize(meta) : meta);
  return `<a class="lrow lrow-gen" href="${entityRowHref(entity)}">`
    + `<span class="lr-name"><span>${name}</span></span>`
    + `<span class="lr-type">${metaHtml}</span>`
    + `<span class="lr-first">${esc(unit || '—')}</span>`
    + `<span class="lr-flag">${flag}</span>`
    + `<span class="lr-sub">${esc([meta && humanize(meta), from].filter(Boolean).join(' · '))}</span></a>`;
}

function booksBodyHtml(seriesId) {
  const books = LoreLoader.getAll(seriesId, 'books').slice().sort((a, b) => (a.chronological_order || 0) - (b.chronological_order || 0));
  if (!books.length) return '<p class="state-loading">No entries yet.</p>';
  const rows = books.map(b => {
    const n = SpoilerGate.getChapterCount(b);
    return `<a class="lrow lrow-book" href="${entityRowHref(b)}">`
      + `<span class="lr-num">${String(b.chronological_order || '').padStart(2, '0')}</span>`
      + `<span class="lr-name"><span>${esc(b.title)}</span></span>`
      + `<span class="lr-year">${esc(b.publication_year ? String(b.publication_year) : '')}</span>`
      + `<span class="lr-type">${esc(bookTypeLabel(b))}</span>`
      + `<span class="lr-count">${n} ${bookUnitNoun(b)}${n === 1 ? '' : 's'}</span></a>`;
  }).join('');
  return `<div class="lrows">${rows}</div>`;
}

// ── List body ─────────────────────────────────────────────────────────────────

function listBodyHtml(model, entityType, ui, seriesId) {
  const series = LoreLoader.getSeriesById(seriesId);
  const seriesName = series ? series.name : '';
  const q = ui.q.trim().toLowerCase();
  const filtering = !!q || ui.role !== 'all';

  const byName = (a, b) => entityDisplayName(a.entity, entityType).localeCompare(entityDisplayName(b.entity, entityType));
  const byFirst = (a, b) => entityType === 'cases'
    ? storyNumber(a.entity) - storyNumber(b.entity)
    : (a.entity.first_mention ? a.entity.first_mention.chapter : 0) - (b.entity.first_mention ? b.entity.first_mention.chapter : 0);

  let html = '';
  for (const group of model.groups) {
    const rows = group.rows
      .filter(r => (!q || entityDisplayName(r.entity, entityType).toLowerCase().includes(q))
        && (ui.role === 'all' || r.entity.role === ui.role))
      .sort(ui.sort === 'name' ? byName : byFirst);
    // Filtering narrows to what matched, so the "later in this book" counts are dropped.
    const n = filtering ? 0 : group.laterInBook;
    if (!rows.length && !n) continue;

    html += `<section class="lgroup">${groupHeadHtml(group, entityType)}`
      + (rows.length ? `<div class="lrows">${rows.map(r => entityType === 'cases'
          ? caseRowHtml(r, model.pos, seriesId)
          : listRowHtml(r, entityType, group, seriesId, seriesName)).join('')}</div>` : '')
      + (n ? `<p class="more-note">${n} more ${listNoun(entityType, n)} appear${n === 1 ? 's' : ''} later in this book</p>` : '')
      + `</section>`;
  }

  if (!filtering && model.later.count) {
    const n = model.later.count;
    html += entityType === 'cases'
      ? fogBlock(`${n} ${listNoun('cases', n)} in ${model.later.bookCount} later book${model.later.bookCount === 1 ? '' : 's'}.`)
      : fogBlock(`${n} ${listNoun(entityType, n)} first appear${n === 1 ? 's' : ''} in ${n === 1 ? 'a later book' : 'later books'}.`,
          { aside: 'Move your bookmark forward to reveal them' });
  }

  if (html) return html;
  if (!filtering) return '<p class="state-loading">No entries yet.</p>';

  const roleOnly = ui.role !== 'all' && !q;
  const title = roleOnly ? `No ${ROLE_PLURALS[ui.role] || humanize(ui.role).toLowerCase()} yet` : 'Nothing matches';
  const line = roleOnly && model.hiddenCount ? 'More may appear as your bookmark moves forward.' : 'Try a different name or filter.';
  return `<div class="list-empty"><h2 class="empty-title">${esc(title)}</h2><p>${line}</p><button type="button" class="btn btn-secondary" data-clear>Clear filter</button></div>`;
}

const FILTER_ICON = '<svg class="filter-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>';
const SORT_CARET = '<svg class="sort-caret" width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg>';

function renderEntityList(container, seriesId, entityType) {
  const series = LoreLoader.getSeriesById(seriesId);
  const etConfig = ENTITY_TYPES.find(e => e.key === entityType);

  if (!series || !etConfig) {
    renderNotFound(container);
    return;
  }

  const isBooks = entityType === 'books';
  const model = isBooks ? null : buildListModel(seriesId, entityType);
  const ui = listState(entityType);

  // Role chips come from the roles present in what the reader can see.
  let roles = [];
  if (entityType === 'characters') {
    const present = new Set(model.groups.flatMap(g => g.rows.map(r => r.entity.role)).filter(Boolean));
    roles = [...present].sort((a, b) => (ROLE_ORDER.indexOf(a) + 1 || 99) - (ROLE_ORDER.indexOf(b) + 1 || 99));
  }
  if (ui.role !== 'all' && !roles.includes(ui.role)) ui.role = 'all';

  const total = LoreLoader.getAll(seriesId, entityType).length;
  const summary = isBooks ? `${total} ${listNoun('books', total)}` : listSummary(model, entityType, seriesId);

  const controls = isBooks ? '' : `
    <div class="list-controls">
      <label class="list-filter">${FILTER_ICON}<input type="search" placeholder="Filter by name" aria-label="Filter by name" autocomplete="off"></label>
      ${roles.length ? `<div class="role-chips" role="group" aria-label="Filter by role">
        ${['all', ...roles].map(r => `<button type="button" class="role-chip" data-role="${esc(r)}" aria-pressed="${ui.role === r}">${r === 'all' ? 'All' : esc(humanize(r))}</button>`).join('')}
      </div>` : ''}
      <label class="list-sort"><span>Sort:</span>
        <select aria-label="Sort"><option value="first">First appearance</option><option value="name">Name</option></select>${SORT_CARET}</label>
    </div>`;

  container.innerHTML = `
    <div class="page-wide list-page">
      ${crumbsHtml(seriesId, [{ label: etConfig.label }])}
      <header class="list-head">
        <h1 class="list-title">${esc(etConfig.label)}</h1>
        <p class="list-summary">${esc(summary)}</p>
      </header>
      ${controls}
      <div class="list-body"></div>
    </div>`;

  const body = container.querySelector('.list-body');
  const draw = () => {
    body.innerHTML = isBooks ? booksBodyHtml(seriesId) : listBodyHtml(model, entityType, ui, seriesId);
  };
  draw();
  if (isBooks) return;

  const input = container.querySelector('.list-filter input');
  const select = container.querySelector('.list-sort select');
  const chips = [...container.querySelectorAll('.role-chip')];
  input.value = ui.q; // a property, not markup: the text is the reader's
  select.value = ui.sort;

  input.addEventListener('input', () => { ui.q = input.value; draw(); });
  select.addEventListener('change', () => { ui.sort = select.value; draw(); });
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      ui.role = chip.dataset.role;
      for (const c of chips) c.setAttribute('aria-pressed', String(c === chip));
      draw();
    });
  }
  body.addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear]')) return;
    ui.q = '';
    ui.role = 'all';
    input.value = '';
    for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.role === 'all'));
    draw();
    input.focus();
  });
}

// Used by search results (restyled in Phase 6).
function renderEntityListItem(entity, entityType, seriesId, status) {
  const href = entityPath(seriesId, entityType, entity.id);
  const name = getEntityName(entity, entityType);
  const meta = getEntityMeta(entity, entityType);
  const badge = getEntityBadge(entity, entityType);
  const gatedBadge = (status === 'partial')
    ? `<span class="badge badge-gated">partial</span>`
    : '';

  return `
    <a class="entity-list-item" href="${href}">
      <span class="item-name">${esc(name)}${badge}${gatedBadge}</span>
      <span class="item-meta">${esc(meta)}</span>
    </a>
  `;
}

// ── Shared bits: names, positions, fog, breadcrumbs ──────────────────────────

function humanize(s) {
  const t = String(s || '').replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// A relationship's title names two characters, so each name is gated on its own.
function relationshipTitle(entity) {
  const name = (id) => {
    const c = LoreLoader.getById(id);
    if (!c) return id;
    return SpoilerGate.isRevealed(c, c.series) ? getEntityName(c, 'characters') : '[not yet revealed]';
  };
  return `${name(entity.character_a)} & ${name(entity.character_b)}`;
}

function entityDisplayName(entity, entityType) {
  return entityType === 'relationships' ? relationshipTitle(entity) : getEntityName(entity, entityType);
}

// "Ch. 12" when `pos` is in the given book, else the full "Book, Ch. 12".
function positionIn(pos, bookNum, seriesId) {
  if (!pos) return '';
  if (pos.book !== bookNum) return formatPosition(pos, seriesId);
  const book = bookByNumber(seriesId, pos.book);
  return `${book ? bookUnitWord(book) : 'Ch.'} ${pos.chapter}`;
}

function bookTypeLabel(book) {
  return book.type === 'novel' ? 'Novel' : book.type === 'short_story_collection' ? 'Short story collection' : humanize(book.type);
}

// Tone names drive the dot colours in CSS (data-tone).
function roleTone(role) {
  return ['protagonist', 'supporting', 'antagonist', 'client'].includes(role) ? role : 'character';
}

function dotHtml(tone, cls = '') {
  return `<span class="dot${cls ? ' ' + cls : ''}" data-tone="${esc(tone)}"></span>`;
}

// The "past your bookmark" block. `html` (and `aside`, a quieter line at the
// right) must already be escaped. The inline variant (tag 'span') is for the
// graph panel, which puts it inside a <p>.
function fogBlock(html, { lead = 'Past your bookmark.', tag = 'div', aside = '' } = {}) {
  const text = `<strong>${esc(lead)}</strong> ${html}`;
  if (!aside) return `<${tag} class="fog-block">${text}</${tag}>`;
  return `<${tag} class="fog-block fog-block-split"><span>${text}</span> <span class="fog-aside">${aside}</span></${tag}>`;
}

function crumbsHtml(seriesId, trail) {
  const parts = [`<a href="/${encodeURIComponent(seriesId)}/">Atlas</a>`]
    .concat(trail.map(t => t.href ? `<a href="${t.href}">${esc(t.label)}</a>` : `<span aria-current="page">${esc(t.label)}</span>`));
  return `<nav class="crumbs" aria-label="Breadcrumb">${parts.join('<span class="crumb-sep" aria-hidden="true">/</span>')}</nav>`;
}

// ── Cross-reference helpers ───────────────────────────────────────────────────

function guessEntityType(id) {
  const prefix = id.split('_')[0];
  const map = { char: 'characters', case: 'cases', faction: 'factions', book: 'books', loc: 'locations', artifact: 'artifacts', event: 'events', rel: 'relationships' };
  return map[prefix] || '';
}

// A name or a gated placeholder, for places that show one link inline (facts,
// ownership chain, graph list). A hidden entity is never named.
function entityLink(id) {
  const entity = LoreLoader.getById(id);
  if (!entity) return esc(id);

  const seriesId = entity.series || '';
  const status = seriesId ? SpoilerGate.getRevealStatus(entity, seriesId) : 'full';

  // Entity is before the reader's position — the name itself is a spoiler.
  if (status === 'hidden') {
    return `<span class="link-gated">[not yet revealed]</span>`;
  }

  const type = guessEntityType(id);
  const name = entityDisplayName(entity, type);
  const displayName = typeof name === 'string' ? name : id;
  return `<a href="${entityPath(seriesId, type, id)}">${esc(displayName)}</a>`;
}

/**
 * Splits referenced ids into the entities the reader has reached and a count of
 * the rest. Callers render only `visible`; the hidden ones are never named.
 */
function revealedSplit(ids, seriesId) {
  const visible = [];
  let hiddenCount = 0;
  for (const id of ids || []) {
    const e = LoreLoader.getById(id);
    if (!e) continue;
    if (SpoilerGate.isRevealed(e, e.series || seriesId)) visible.push(e);
    else hiddenCount++;
  }
  return { visible, hiddenCount };
}

function moreNote(n, noun = '') {
  return n ? `<p class="more-note">${n} more${noun ? ' ' + noun : ''} after your bookmark</p>` : '';
}

// A character's relationships the reader can see: the relationship entity AND
// the character at the other end must both be revealed.
function visibleRelationships(char) {
  const rows = [];
  let hiddenCount = 0;
  for (const rid of char.relationships || []) {
    const rel = LoreLoader.getById(rid);
    if (!rel) continue;
    const other = LoreLoader.getById(rel.character_a === char.id ? rel.character_b : rel.character_a);
    if (!other) continue;
    if (SpoilerGate.isRevealed(rel, char.series) && SpoilerGate.isRevealed(other, char.series)) {
      rows.push({ rel, other, type: rel.relationship_type || 'other' });
    } else {
      hiddenCount++;
    }
  }
  return { rows, hiddenCount };
}

function entityRowHref(entity) {
  return entityPath(entity.series, guessEntityType(entity.id), entity.id);
}

function shortBookOf(bookId, seriesId) {
  const book = LoreLoader.getById(bookId);
  const series = LoreLoader.getSeriesById(seriesId);
  return book ? shortBookTitle(book.title, series ? series.name : '') : '';
}

// ── Spoiler helpers ───────────────────────────────────────────────────────────

/**
 * Stands in for a prose field the entity only partially reveals. Inline-safe
 * with tag 'span' (the graph panel), a block with 'div' (detail pages).
 */
function redactedProse(entity, tag = 'span') {
  const t = entity.full_reveal;
  const where = t ? formatPosition(t, entity.series) : 'a later point';
  return fogBlock(`The full entry opens at ${esc(where)}.`, { tag });
}

// Every prose field that can hold staged segments.
const PROSE_FIELDS = ['biography', 'description', 'synopsis', 'significance', 'notes'];
const PROSE_LABELS = {
  biography: 'Biography', description: 'Description', synopsis: 'The case so far',
  significance: 'Significance', notes: 'Notes',
};

// True when any staged segment is still withheld at the reader's position.
function hasWithheldProse(entity) {
  return PROSE_FIELDS.some(f => proseText(entity, f, entity.series).nextFrom);
}

// The latest position at which this entry is complete: full_reveal, pushed later
// by any staged segment that opens after it. Reads thresholds only, never text.
// Staged segments only count when they open inside the first-mention book: a
// later-book `from` would tell the reader the entry continues in that book,
// which is more than the "story continues at" hint ever reveals (only the
// earliest withheld segment).
function completePoint(entity) {
  let latest = entity.full_reveal || entity.first_mention;
  const book = entity.first_mention && entity.first_mention.book;
  for (const f of PROSE_FIELDS) {
    if (!Array.isArray(entity[f])) continue;
    for (const seg of entity[f]) {
      if (seg && seg.from && seg.from.book === book
          && SpoilerGate.comparePositions(seg.from, latest) > 0) latest = seg.from;
    }
  }
  return latest;
}

// ── Detail-section builders ───────────────────────────────────────────────────
//
// The eight *View functions below hand renderEntityDetail the pieces of a page;
// these helpers build the sections they share, so redaction and section chrome
// change in one place.

/**
 * The paragraphs of one prose field: one <p> per visible staged segment, then a
 * single fog block when segments are withheld; the whole field is a fog block
 * when the entity is only partially revealed.
 */
function proseBody(entity, status, field) {
  if (status === 'partial') return redactedProse(entity, 'div');
  const { segments, nextFrom } = proseText(entity, field, entity.series);
  let html = segments.map(s => `<p>${esc(s)}</p>`).join('');
  if (nextFrom) {
    const baseBook = entity.first_mention ? entity.first_mention.book : entity.chronological_order;
    html += fogBlock(`The story continues at ${esc(positionIn(nextFrom, baseBook, entity.series))}.`);
  }
  return html;
}

function proseSection(entity, status, field) {
  if (!entity[field]) return '';
  const body = proseBody(entity, status, field);
  if (!body) return '';
  return `<section class="entry-section"><h2 class="label">${PROSE_LABELS[field]}</h2><div class="prose">${body}</div></section>`;
}

// A titled list block; `rowsHtml` is the <li>s, `hiddenCount` the "N more" line.
function listBlock(label, rowsHtml, hiddenCount, noun, wide = false) {
  if (!rowsHtml && !hiddenCount) return '';
  return `<section class="entry-list${wide ? ' entry-list-wide' : ''}"><h2 class="label">${esc(label)}</h2>${rowsHtml ? `<ul class="rows">${rowsHtml}</ul>` : ''}${moreNote(hiddenCount, noun)}</section>`;
}

function itemRow(entity, note) {
  const n = note ? note(entity) : '';
  return `<li><a class="row" href="${entityRowHref(entity)}"><span class="row-name">${esc(entityDisplayName(entity, guessEntityType(entity.id)))}</span>${n ? `<span class="row-note">${esc(n)}</span>` : ''}</a></li>`;
}

/**
 * A gated, counted list of cross-referenced entities. `note` maps an entity to
 * the muted text at the row's right; `noun` customises the "N more …" line.
 */
function itemList(label, ids, seriesId, { note, noun } = {}) {
  const { visible, hiddenCount } = revealedSplit(ids, seriesId);
  return listBlock(label, visible.map(e => itemRow(e, note)).join(''), hiddenCount, noun);
}

function factsCard(rows) {
  const items = rows.filter(r => r && r[1]);
  if (!items.length) return '';
  return `<dl class="facts entry-facts">${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

// ── Where this entry opens up ─────────────────────────────────────────────────

// One cell per unit of the first-mention book: skeleton before the entry
// appears, tinted while it is partial, bright from its complete point on.
function opensUpCard(entity, seriesId) {
  const first = entity.first_mention;
  const book = first && bookByNumber(seriesId, first.book);
  if (!book) return '';

  const units = SpoilerGate.getChapterCount(book);
  const word = bookUnitWord(book);
  const pos = SpoilerGate.getPosition(seriesId);
  const complete = completePoint(entity);
  // A complete point in a later book leaves every cell after the first partial.
  const doneAt = complete.book === first.book ? complete.chapter : Infinity;
  const youHere = pos && pos.book === first.book && pos.chapter >= 1 && pos.chapter <= units;

  let cells = '';
  for (let n = 1; n <= units; n++) {
    const state = n < first.chapter ? 'before' : n >= doneAt ? 'full' : 'partial';
    cells += `<span class="cell" data-state="${state}" title="${esc(`${word} ${n}`)}">${youHere && n === pos.chapter ? '<span class="you">You</span>' : ''}</span>`;
  }

  const legend = [];
  if (doneAt === first.chapter) {
    legend.push(`<li><span class="swatch" data-state="full"></span>${esc(`${word} ${first.chapter}`)} &middot; entry appears in full</li>`);
  } else {
    legend.push(`<li><span class="swatch" data-state="partial"></span>${esc(`${word} ${first.chapter}`)} &middot; entry appears, partly</li>`);
    legend.push(doneAt === Infinity
      ? `<li><span class="swatch" data-state="full"></span>Full entry &middot; ${esc(formatPosition(complete, seriesId))}</li>`
      : `<li><span class="swatch" data-state="full"></span>${esc(`${word} ${complete.chapter}`)} &middot; full entry</li>`);
  }
  if (pos) {
    legend.push(`<li><span class="swatch swatch-you"></span>Your bookmark &middot; ${esc(positionIn(pos, first.book, seriesId))}</li>`);
  }

  return `<section class="panel entry-opens"><h2 class="label">Where this entry opens up</h2>`
    + `<p class="opens-book">${esc(book.title)}</p>`
    + `<div class="strip">${cells}</div>`
    + `<ul class="legend">${legend.join('')}</ul></section>`;
}

// ── Connections (mini-graph) ──────────────────────────────────────────────────

// Characters, cases and locations get a "Connections" panel: the one-hop network
// around the entity, only when the gated network has at least 3 nodes (else the
// panel is left out, with no empty state). Wide screens show the graph;
// phones hide it and show the revealed related characters as chips instead.
// mountMiniGraph() runs after the detail HTML is in the DOM.
const MINI_GRAPH_MIN_NODES = 3;

function connectionChips(entity, entityType) {
  let visible, hiddenCount;
  if (entityType === 'characters') {
    const rels = visibleRelationships(entity);
    visible = rels.rows.map(r => r.other);
    hiddenCount = rels.hiddenCount;
  } else {
    ({ visible, hiddenCount } = revealedSplit(entityType === 'cases' ? entity.characters_involved : entity.characters_associated, entity.series));
  }
  if (!visible.length && !hiddenCount) return '';
  const chips = visible.map(e => `<a class="chip chip-link" href="${entityRowHref(e)}">${esc(getEntityName(e, 'characters'))}</a>`).join('');
  return `<div class="conn-chips">${chips ? `<div class="chips">${chips}</div>` : ''}${moreNote(hiddenCount, 'connections')}</div>`;
}

function connectionsPanel(entity, entityType) {
  if (!['characters', 'cases', 'locations'].includes(entityType)) return '';
  if (LoreGraph.egoNodeCount(entity.series, entity.id) < MINI_GRAPH_MIN_NODES) return '';
  const layers = entityType === 'cases' ? '&layers=cases' : entityType === 'locations' ? '&layers=locations' : '';
  const href = `/${encodeURIComponent(entity.series)}/graph/?selected=${encodeURIComponent(entity.id)}${layers}`;
  return `
    <section class="panel entry-connections" aria-label="Connections">
      <header class="panel-head"><h2 class="label">Connections</h2><a href="${esc(href)}">Open in full graph &rarr;</a></header>
      <div class="mini-graph" data-focus-id="${esc(entity.id)}"></div>
      <p class="mini-graph-hint">Pinch or Ctrl/&#8984; + scroll to zoom</p>
      ${connectionChips(entity, entityType)}
    </section>`;
}

function mountMiniGraph(container, seriesId) {
  const el = container.querySelector('.mini-graph');
  if (!el) return;
  const mount = () => LoreGraph.init(el, seriesId, {
    syncUrl: false,
    focusId: el.dataset.focusId,
    height: 300,
  });

  // Hidden on phones (chips replace it), so don't build it there; build it if
  // the viewport grows past the breakpoint (rotation, resize).
  const narrow = window.matchMedia('(max-width: 760px)');
  if (!narrow.matches) { mount(); return; }
  const onChange = () => {
    if (!el.isConnected) { narrow.removeEventListener('change', onChange); return; }
    if (narrow.matches || el.firstChild) return;
    narrow.removeEventListener('change', onChange);
    mount();
  };
  narrow.addEventListener('change', onChange);
}

// ── Entity detail ─────────────────────────────────────────────────────────────

function renderEntityDetail(container, seriesId, entityType, id) {
  const entity = LoreLoader.getById(id);
  if (!entity) { renderNotFound(container); return; }

  const status = SpoilerGate.getRevealStatus(entity, seriesId);
  const etConfig = ENTITY_TYPES.find(e => e.key === entityType) || { label: entityType, singular: entityType };

  // Entity is before the reader's current position — don't reveal anything.
  if (status === 'hidden') {
    renderNotReached(container, entity, seriesId, entityType, etConfig);
    return;
  }

  const builders = {
    characters: characterView, cases: caseView, books: bookView, factions: factionView,
    locations: locationView, artifacts: artifactView, events: eventView, relationships: relationshipView,
  };
  const build = builders[entityType];
  if (!build) { container.innerHTML = '<p>Unknown entity type.</p>'; return; }

  const view = build(entity, status);
  container.innerHTML = entryHtml(entity, seriesId, entityType, etConfig, status, view);
  mountMiniGraph(container, seriesId);
  if (view.onMount) view.onMount(container);
}

/**
 * The page template. `view`: { label?, labelTone?, chip?: {label, tone},
 * chips?, aka?, facts?: [[label, html]], prose, lists, side }. Left column
 * (head, prose, lists) and right column (facts + side) share a grid whose areas
 * reorder below 1100px and 760px (see styles.css).
 */
function entryHtml(entity, seriesId, entityType, etConfig, status, view) {
  const pos = SpoilerGate.getPosition(seriesId);
  const first = entity.first_mention;

  const chips = [];
  if (view.chip) chips.push(`<span class="chip">${dotHtml(view.chip.tone)}${esc(view.chip.label)}</span>`);
  if (view.chips) chips.push(...view.chips);
  if (first && entityType !== 'cases') {
    chips.push(`<span class="chip">First appears in ${esc(formatPosition(first, seriesId))}</span>`);
  }
  // Only a label: it says what the reader sees, it doesn't decide it.
  if (pos && first) {
    const partial = status === 'partial' || hasWithheldProse(entity);
    chips.push(`<span class="chip chip-status" data-status="${partial ? 'partial' : 'full'}">${partial ? 'Partial' : 'Complete'} at your bookmark</span>`);
  }

  const line = [view.chip && view.chip.label, first && `from ${formatPosition(first, seriesId)}`].filter(Boolean).join(' · ');

  return `<div class="page-wide entry">`
    + crumbsHtml(seriesId, [{ label: etConfig.label, href: entityListPath(seriesId, entityType) }, { label: entityDisplayName(entity, entityType) }])
    + `<div class="entry-grid">`
    + `<header class="entry-head">`
    +   `<p class="entry-label label">${view.labelTone ? dotHtml(view.labelTone) : ''}${esc(view.label || etConfig.singular)}</p>`
    +   `<h1 class="entry-title">${esc(entityDisplayName(entity, entityType))}</h1>`
    +   (chips.length ? `<div class="chips entry-chips">${chips.join('')}</div>` : '')
    +   (line ? `<p class="entry-line">${esc(line)}</p>` : '')
    +   (view.aka || '')
    + `</header>`
    + `<div class="entry-prose">${view.prose || ''}</div>`
    + `<div class="entry-lists">${view.lists || ''}</div>`
    + `<aside class="entry-side">${factsCard(view.facts || [])}${view.side || ''}</aside>`
    + `</div></div>`;
}

// ── Not reached ───────────────────────────────────────────────────────────────

// The whole page is one fog panel: nothing about the entity is named.
function renderNotReached(container, entity, seriesId, entityType, etConfig) {
  const first = entity.first_mention;
  const pos = SpoilerGate.getPosition(seriesId);
  const book = bookByNumber(seriesId, first.book);
  const unit = `${book ? bookUnitWord(book) : 'Ch.'} ${first.chapter}`;
  const target = book && !(pos && pos.book === first.book) ? `${book.title}, ${unit}` : unit;

  container.innerHTML = `<div class="page-wide entry">`
    + crumbsHtml(seriesId, [{ label: etConfig.label, href: entityListPath(seriesId, entityType) }, { label: 'Not reached yet' }])
    + `<section class="not-reached">`
    +   `<h1 class="not-reached-title">Not reached yet</h1>`
    +   `<p>This entry opens at ${esc(formatPosition(first, seriesId))}. Its name and details stay hidden until your bookmark gets there.</p>`
    +   `<button type="button" class="btn btn-primary">Move my bookmark to ${esc(target)}</button>`
    + `</section></div>`;

  container.querySelector('.not-reached .btn').addEventListener('click', () => setBookmark(first.book, first.chapter));
}

// ── Per-type views ────────────────────────────────────────────────────────────

function characterView(entity, status) {
  const aliasList = aliasNames(entity, entity.series);
  const rels = visibleRelationships(entity);
  const relRows = rels.rows.map(({ other, type }) => `<li><a class="row" href="${entityRowHref(other)}"><span class="row-name">${esc(getEntityName(other, 'characters'))}</span><span class="row-note"><span class="rel-line" data-rel="${relTypeGroup(type)}"></span>${esc(humanize(type))}</span></a></li>`).join('');

  const tags = entity.tags && entity.tags.length
    ? `<section class="entry-list entry-list-wide"><h2 class="label">Tags</h2><div class="chips">${entity.tags.map(t => `<span class="chip chip-tag">${esc(t)}</span>`).join('')}</div></section>`
    : '';

  return {
    chip: entity.role ? { label: humanize(entity.role), tone: roleTone(entity.role) } : null,
    chips: entity.status === 'deceased' ? ['<span class="chip">Deceased</span>'] : [],
    aka: aliasList.length ? `<p class="entry-aka">Also known as ${aliasList.map(a => esc(a)).join(', ')}</p>` : '',
    prose: proseSection(entity, status, 'biography'),
    lists: listBlock('Relationships', relRows, rels.hiddenCount, '')
      + itemList('Appears in', entity.cases, entity.series, { note: c => shortBookOf(c.source_book, entity.series), noun: 'appearances' })
      + itemList('Affiliations', entity.affiliations, entity.series, { note: f => humanize(f.type) })
      + tags,
    side: connectionsPanel(entity, 'characters') + opensUpCard(entity, entity.series),
  };
}

// ── Cases ─────────────────────────────────────────────────────────────────────

// Which cases' solutions the reader chose to show. Per case, this session only;
// it outlives a bookmark re-render because the page re-reads it.
const revealedSolutions = new Set();

// The units a case spans inside one book (a novel: all its chapters). Null when
// it runs across books (e.g. The Final Problem).
function caseSpan(entity) {
  const a = entity.first_mention, b = entity.full_reveal;
  if (!a || !b || a.book !== b.book) return null;
  return { book: a.book, start: a.chapter, end: b.chapter, units: b.chapter - a.chapter + 1 };
}

function solutionBody(entity, status) {
  const endAt = positionIn(entity.full_reveal, entity.first_mention ? entity.first_mention.book : 0, entity.series);
  if (status !== 'full') {
    return fogBlock(`Opens when your bookmark reaches the end of the case${endAt ? ` (${esc(endAt)})` : ''}.`, { lead: 'Sealed.' });
  }
  if (revealedSolutions.has(entity.id)) {
    return `<div class="solution-text prose"><p>${esc(entity.solution)}</p></div>`
      + `<div class="solution-bar"><button type="button" class="btn btn-secondary" data-solution="hide">Hide</button></div>`;
  }
  const finished = SpoilerGate.getPosition(entity.series) ? 'You’ve finished this case. The solution' : 'The solution';
  return `<div class="solution-bar"><p>${finished} stays hidden until you choose to see it.</p>`
    + `<button type="button" class="btn btn-primary" data-solution="show">Reveal solution</button></div>`;
}

function solutionBlock(entity, status) {
  if (!entity.solution) return '';
  const end = positionIn(entity.full_reveal, entity.first_mention ? entity.first_mention.book : 0, entity.series);
  return `<section class="solution">`
    + `<header class="solution-head"><h2 class="label">Solution</h2>${end ? `<span class="solution-end">Ends at ${esc(end)}</span>` : ''}</header>`
    + `<div class="solution-body">${solutionBody(entity, status)}</div></section>`;
}

// Reveal / Hide swap only the block's body, so the page keeps its scroll and
// the new button takes focus.
function wireSolution(container, entity, status) {
  const box = container.querySelector('.solution');
  if (!box) return;
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-solution]');
    if (!btn) return;
    if (btn.dataset.solution === 'show') revealedSolutions.add(entity.id);
    else revealedSolutions.delete(entity.id);
    box.querySelector('.solution-body').innerHTML = solutionBody(entity, status);
    const next = box.querySelector('button[data-solution]');
    if (next) next.focus();
  });
}

// "Your progress through this case": a chapter strip for cases that span more
// than one unit of a book. Reuses the picker's read / current / unread cells.
function caseProgressCard(entity, seriesId) {
  const pos = SpoilerGate.getPosition(seriesId);
  const span = caseSpan(entity);
  if (!pos || !span || span.units < 2) return '';
  const book = bookByNumber(seriesId, span.book);
  const word = book ? bookUnitWord(book) : 'Ch.';

  let cells = '';
  for (let n = span.start; n <= span.end; n++) {
    const state = pos.book > span.book ? 'read'
      : pos.book < span.book ? 'unread'
      : n < pos.chapter ? 'read' : n === pos.chapter ? 'current' : 'unread';
    cells += `<span class="cell" data-state="${state}" title="${esc(`${word} ${n}`)}">${state === 'current' ? '<span class="you">You</span>' : ''}</span>`;
  }
  return `<section class="panel entry-progress"><h2 class="label">Your progress through this case</h2>`
    + `<div class="strip">${cells}</div>`
    + `<p class="strip-ends"><span>${esc(`${word} ${span.start}`)}</span><span>${esc(`${word} ${span.end}`)} &middot; solution opens</span></p></section>`;
}

function caseView(entity, status) {
  const book = LoreLoader.getById(entity.source_book);
  if (status !== 'full') revealedSolutions.delete(entity.id); // a bookmark move back re-seals it

  // Gated like prose (D4, Session 13.7): notable elements can name spoilers
  // (e.g. Sign of Four's list names Jonathan Small), so they are redacted while
  // the case is only partially revealed.
  const hasNotable = entity.notable_elements && entity.notable_elements.length;
  const notable = status === 'partial'
    ? `<section class="entry-list entry-list-wide"><h2 class="label">Notable elements</h2>${redactedProse(entity, 'div')}</section>`
    : hasNotable
      ? `<section class="entry-list entry-list-wide"><h2 class="label">Notable elements</h2><ul class="bullets">${entity.notable_elements.map(e => `<li>${esc(e)}</li>`).join('')}</ul></section>`
      : '';

  return {
    label: book ? `Case · ${book.type === 'novel' ? 'Novel' : 'Story'}` : 'Case',
    facts: [
      entity.source_book ? ['Book', entityLink(entity.source_book)] : null,
      entity.first_mention ? ['Opened', esc(formatPosition(entity.first_mention, entity.series))] : null,
      book && book.type === 'novel' ? ['Chapters', esc(String(SpoilerGate.getChapterCount(book)))] : null,
      entity.case_nickname ? ['Nickname', esc(entity.case_nickname)] : null,
    ],
    prose: proseSection(entity, status, 'synopsis') + solutionBlock(entity, status),
    lists: itemList('People involved', entity.characters_involved, entity.series)
      + itemList('Places', entity.locations, entity.series, { note: l => humanize(l.type) })
      + itemList('Artifacts', entity.artifacts_involved, entity.series)
      + notable,
    side: caseProgressCard(entity, entity.series) + connectionsPanel(entity, 'cases'),
    onMount: container => wireSolution(container, entity, status),
  };
}

function bookView(entity, status) {
  return {
    chip: { label: bookTypeLabel(entity), tone: 'book' },
    facts: [
      entity.publication_year ? ['Year', esc(String(entity.publication_year))] : null,
      ['Type', esc(bookTypeLabel(entity))],
      entity.chronological_order ? ['Volume', esc(String(entity.chronological_order))] : null,
    ],
    prose: proseSection(entity, status, 'description'),
    lists: itemList(entity.type === 'novel' ? 'Story' : 'Stories', entity.stories_contained, entity.series, { noun: 'stories' }),
  };
}

function factionView(entity, status) {
  return {
    labelTone: 'faction',
    chip: entity.type ? { label: humanize(entity.type), tone: 'faction' } : null,
    facts: [
      entity.type ? ['Type', esc(humanize(entity.type))] : null,
      entity.alignment ? ['Alignment', esc(humanize(entity.alignment))] : null,
      entity.active_period ? ['Active period', esc(entity.active_period)] : null,
      entity.parent_org ? ['Parent organization', entityLink(entity.parent_org)] : null,
    ],
    prose: proseSection(entity, status, 'description'),
    lists: itemList('Members', entity.key_members, entity.series)
      + itemList('Cases', entity.cases_involved, entity.series, { note: c => shortBookOf(c.source_book, entity.series) })
      + itemList('Sub-organizations', entity.child_orgs, entity.series),
    side: opensUpCard(entity, entity.series),
  };
}

function locationView(entity, status) {
  return {
    labelTone: 'location',
    chip: entity.type ? { label: humanize(entity.type), tone: 'location' } : null,
    facts: [
      entity.type ? ['Type', esc(humanize(entity.type))] : null,
      entity.real_world_basis ? ['Real-world basis', esc(entity.real_world_basis)] : null,
      entity.first_mention ? ['First appears', esc(formatPosition(entity.first_mention, entity.series))] : null,
    ],
    prose: proseSection(entity, status, 'description'),
    lists: itemList('Cases that start here', entity.cases_occurring_here, entity.series, { note: c => shortBookOf(c.source_book, entity.series) })
      + itemList('Connected to', entity.characters_associated, entity.series),
    side: connectionsPanel(entity, 'locations') + opensUpCard(entity, entity.series),
  };
}

function artifactView(entity, status) {
  const chain = (entity.ownership_chain || []).map(o => {
    const from = formatPosition(o.from, entity.series);
    const to = formatPosition(o.to, entity.series);
    return `<li><div class="row"><span class="row-name">${entityLink(o.character_id)}</span><span class="row-note">${esc(from === to ? from : `${from} – ${to}`)}</span></div></li>`;
  }).join('');

  return {
    labelTone: 'artifact',
    chip: entity.type ? { label: humanize(entity.type), tone: 'artifact' } : null,
    facts: [
      entity.type ? ['Type', esc(humanize(entity.type))] : null,
      entity.first_mention ? ['First appears', esc(formatPosition(entity.first_mention, entity.series))] : null,
    ],
    prose: proseSection(entity, status, 'description') + proseSection(entity, status, 'significance'),
    lists: listBlock('Ownership chain', chain, 0, '', true)
      + itemList('Appears in', entity.appearance_history, entity.series, { note: c => shortBookOf(c.source_book, entity.series) }),
    side: opensUpCard(entity, entity.series),
  };
}

function eventView(entity, status) {
  return {
    chip: entity.event_type ? { label: humanize(entity.event_type), tone: 'event' } : null,
    facts: [
      entity.date_or_position ? ['When', esc(entity.date_or_position)] : null,
      entity.event_type ? ['Type', esc(humanize(entity.event_type))] : null,
      entity.location ? ['Location', entityLink(entity.location)] : null,
    ],
    prose: proseSection(entity, status, 'description'),
    lists: itemList('Characters involved', entity.characters_involved, entity.series)
      + itemList('Cases linked', entity.cases_linked, entity.series, { note: c => shortBookOf(c.source_book, entity.series) }),
    side: opensUpCard(entity, entity.series),
  };
}

function relationshipView(entity, status) {
  const type = entity.relationship_type;
  return {
    facts: [
      type ? ['Type', `<span class="rel-line" data-rel="${relTypeGroup(type)}"></span>${esc(humanize(type))}`] : null,
      entity.first_established ? ['First established', entityLink(entity.first_established)] : null,
    ],
    prose: proseSection(entity, status, 'notes'),
    lists: itemList('Characters', [entity.character_a, entity.character_b], entity.series),
    side: opensUpCard(entity, entity.series),
  };
}

// ── Graph page (Session 16: list mode, in-place position changes) ────────────

// The graph page's live view, so a reading-position change can update it in
// place instead of re-rendering the route. `refresh` returns true when it
// handled the change.
let activeGraphView = null;
let graphPageTeardown = null;

function refreshGraphViewInPlace() {
  const v = activeGraphView;
  return !!(v && v.container.isConnected && v.refresh());
}

// Called at the start of every route change: drops the graph page's media-query
// listener and its live view.
function teardownGraphPage() {
  if (graphPageTeardown) graphPageTeardown();
  graphPageTeardown = null;
  activeGraphView = null;
}

const GRAPH_VIEW_KEY = 'graph-view-mode';

function readGraphViewMode() {
  try { return localStorage.getItem(GRAPH_VIEW_KEY) === 'list' ? 'list' : 'graph'; } catch (e) { return 'graph'; }
}

function writeGraphViewMode(mode) {
  try { localStorage.setItem(GRAPH_VIEW_KEY, mode); } catch (e) { /* storage unavailable: the choice just isn't remembered */ }
}

/**
 * What list mode shows, and what the graph shows with no layers: the characters
 * revealed at the reader's position, each with the revealed relationships whose
 * two ends are both visible, by name. One helper, so the list and an oracle test
 * can be checked against the same filter.
 * Returns [{ id, name, partners: [{ id, name, type }] }].
 */
function graphListData(seriesId) {
  const chars = LoreLoader.getAll(seriesId, 'characters').filter(c => SpoilerGate.isRevealed(c, seriesId));
  const byId = new Map(chars.map(c => [c.id, c]));
  const rels = LoreLoader.getAll(seriesId, 'relationships').filter(r =>
    SpoilerGate.isRevealed(r, seriesId) && byId.has(r.character_a) && byId.has(r.character_b));
  const byName = (a, b) => a.name.localeCompare(b.name);
  return chars.map(c => ({
    id: c.id,
    name: c.name,
    partners: rels
      .filter(r => r.character_a === c.id || r.character_b === c.id)
      .map(r => {
        const pid = r.character_a === c.id ? r.character_b : r.character_a;
        return { id: pid, name: byId.get(pid).name, type: r.relationship_type || 'other' };
      })
      .sort(byName),
  })).sort(byName);
}

function graphListHtml(seriesId) {
  const items = graphListData(seriesId);
  if (!items.length) return '<p class="state-loading">No characters visible at your current reading position.</p>';
  return '<ul class="graph-list">' + items.map(c => `
    <li class="graph-list-char" data-id="${esc(c.id)}">${entityLink(c.id)}${c.partners.length
      ? '<ul class="graph-list-rels">' + c.partners.map(p =>
          `<li data-id="${esc(p.id)}" data-type="${esc(p.type)}">${entityLink(p.id)} <span class="graph-list-type">${esc(p.type)}</span></li>`).join('') + '</ul>'
      : '<p class="graph-list-none">No connections at your reading position.</p>'}</li>`).join('') + '</ul>';
}

// "6 met so far · 14 hidden by your bookmark", or "30 characters" with no bookmark.
function graphSummary(seriesId) {
  const total = LoreLoader.getAll(seriesId, 'characters').length;
  const shown = graphListData(seriesId).length;
  if (!SpoilerGate.getPosition(seriesId)) return `${total} characters`;
  return `${shown} met so far · ${total - shown} hidden by your bookmark`;
}

// The sidebar's rows. Characters are always drawn, so that row is checked and
// disabled; the four layers and five relationship groups toggle. Layer glyphs
// match the shapes on the canvas (shape + colour, never colour alone).
function graphSideHtml() {
  const layerRows = LoreGraph.LAYER_ORDER.map(l => `
    <li><label class="graph-check">
      <input type="checkbox" data-layer="${esc(l)}">
      <span class="graph-check-box" aria-hidden="true"></span>
      <span class="graph-check-mark" data-layer="${esc(l)}" aria-hidden="true">${esc(LoreGraph.LAYER_CONFIG[l].glyph)}</span>
      <span class="graph-check-label">${esc(LoreGraph.LAYER_CONFIG[l].label)}</span>
      <span class="graph-check-count"></span>
    </label></li>`).join('');
  const relRows = REL_GROUPS.map(g => `
    <li><label class="graph-check">
      <input type="checkbox" data-rel="${esc(g.key)}">
      <span class="graph-check-box" aria-hidden="true"></span>
      <span class="graph-check-line" data-rel="${esc(g.key)}" aria-hidden="true"></span>
      <span class="graph-check-label">${esc(g.label)}</span>
    </label></li>`).join('');
  return `
    <h2 class="label">Show</h2>
    <ul class="graph-checks">
      <li><label class="graph-check">
        <input type="checkbox" checked disabled>
        <span class="graph-check-box" aria-hidden="true"></span>
        <span class="graph-check-mark" data-layer="characters" aria-hidden="true">&#9679;</span>
        <span class="graph-check-label">Characters</span>
      </label></li>${layerRows}
    </ul>
    <h2 class="label">Relationships</h2>
    <ul class="graph-checks">${relRows}</ul>
    <p class="graph-ring-note" hidden></p>
    <div class="graph-fog" hidden></div>`;
}

function renderGraph(container, seriesId) {
  const series = LoreLoader.getSeriesById(seriesId);
  if (!series) { renderNotFound(container); return; }

  container.innerHTML = `
    <div class="graph-page">
      <a class="skip-link" href="#graph-after">Skip past the graph</a>
      <header class="graph-head">
        ${crumbsHtml(seriesId, [{ label: 'Graph' }])}
        <div class="graph-head-row">
          <h1>Graph</h1>
          <p class="graph-summary"></p>
          <div class="graph-view-toggle" role="group" aria-label="Graph view">
            <button type="button" data-mode="graph" aria-pressed="true">Graph</button>
            <button type="button" data-mode="list" aria-pressed="false">List</button>
          </div>
        </div>
      </header>
      <div class="graph-body">
        <aside class="graph-side" aria-label="Graph filters">
          <button type="button" class="graph-side-toggle" aria-expanded="false" aria-controls="graph-side-body">
            <span>Filters</span>
            <svg class="sort-caret" width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg>
          </button>
          <div class="graph-side-body" id="graph-side-body">${graphSideHtml()}</div>
        </aside>
        <div class="graph-stage">
          <div class="graph-wrap">
            <div id="graph-container"></div>
            <p class="graph-hint" id="graph-after" tabindex="-1">
              <span class="hint-coarse">Pinch to zoom &nbsp;·&nbsp; Drag to pan &nbsp;·&nbsp; Tap a node for details</span>
              <span class="hint-fine">Scroll to zoom &nbsp;·&nbsp; Drag to pan &nbsp;·&nbsp; Click any node for details</span>
            </p>
          </div>
          <div class="graph-list-view" hidden></div>
        </div>
      </div>
    </div>
  `;

  // A fragment navigation would fire popstate, and the router re-renders on
  // popstate: focus the target by hand instead.
  const skip = container.querySelector('.skip-link');
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.getElementById('graph-after');
    if (target) target.focus();
  });

  const side = container.querySelector('.graph-side');
  const sideToggle = container.querySelector('.graph-side-toggle');
  const wrap = container.querySelector('.graph-wrap');
  const listEl = container.querySelector('.graph-list-view');
  const summaryEl = container.querySelector('.graph-summary');
  const graphContainer = document.getElementById('graph-container');
  const buttons = [...container.querySelectorAll('.graph-view-toggle button')];
  const wide = window.matchMedia('(min-width: 761px)');
  let mode = readGraphViewMode(); // 'graph' | 'list'; list applies only on phones
  let controller = null;
  let initialized = false;

  const listActive = () => mode === 'list' && !wide.matches;

  // ── Sidebar ────────────────────────────────────────────────────────────────
  // Redrawn in place from the graph's stats after every update, so a focused
  // checkbox keeps focus.
  function renderSide(stats) {
    summaryEl.textContent = graphSummary(seriesId);
    for (const input of side.querySelectorAll('input[data-layer]')) {
      const layer = input.dataset.layer;
      const n = stats.layerCounts[layer];
      const on = stats.layers.includes(layer);
      input.checked = on;
      input.disabled = n === 0 && !on; // nothing to show yet at this bookmark
      input.closest('label').querySelector('.graph-check-count').textContent = n === 0 ? 'none yet' : String(n);
    }
    for (const input of side.querySelectorAll('input[data-rel]')) {
      input.checked = stats.relGroups.includes(input.dataset.rel);
    }
    const ring = side.querySelector('.graph-ring-note');
    ring.textContent = stats.ringNote;
    ring.hidden = !stats.ringNote;
    const fog = side.querySelector('.graph-fog');
    const n = stats.hiddenCount;
    fog.hidden = n === 0;
    fog.innerHTML = n === 0 ? ''
      : fogBlock(`${n} ${n === 1 ? 'entry is' : 'entries are'} shown as ${n === 1 ? 'an unlabeled dot' : 'unlabeled dots'}.`);
  }

  side.addEventListener('change', (e) => {
    const input = e.target;
    if (!controller || !input.matches('input[type="checkbox"]')) return;
    if (input.dataset.layer) {
      const set = new Set(controller.getLayers());
      if (input.checked) set.add(input.dataset.layer); else set.delete(input.dataset.layer);
      controller.setLayers([...set]);
    } else if (input.dataset.rel) {
      const set = new Set(controller.getRelGroups());
      if (input.checked) set.add(input.dataset.rel); else set.delete(input.dataset.rel);
      controller.setRelGroups([...set]);
    }
  });

  // Phones: the filters sit behind a disclosure above the canvas.
  sideToggle.addEventListener('click', () => {
    const open = side.classList.toggle('is-open');
    sideToggle.setAttribute('aria-expanded', String(open));
  });

  // The graph is built lazily: a page that opens in list mode doesn't pay for it
  // until the reader switches to Graph or the viewport reaches 761px.
  function showGraph() {
    const wasHidden = wrap.hidden;
    listEl.hidden = true;
    wrap.hidden = false;
    side.hidden = false;
    skip.hidden = false;
    if (!initialized) {
      initialized = true;
      controller = LoreGraph.init(graphContainer, seriesId, { onUpdate: renderSide }) || null;
      side.hidden = !controller; // nothing visible: just the empty-state message
    } else if (wasHidden && controller) {
      controller.relayout(); // a rotation while hidden measured 0
    }
  }

  function showList() {
    if (controller && controller.getSelectedEntityId()) controller.closePanel({ restoreFocus: false });
    wrap.hidden = true;
    side.hidden = true;
    skip.hidden = true;
    listEl.hidden = false;
    listEl.innerHTML = graphListHtml(seriesId);
    summaryEl.textContent = graphSummary(seriesId);
  }

  function apply() {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    if (listActive()) showList(); else showGraph();
  }

  for (const b of buttons) {
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      writeGraphViewMode(mode);
      apply();
    });
  }

  function onWideChange() {
    if (!graphContainer.isConnected) { wide.removeEventListener('change', onWideChange); return; }
    apply();
  }
  wide.addEventListener('change', onWideChange);
  graphPageTeardown = () => wide.removeEventListener('change', onWideChange);

  apply();

  activeGraphView = {
    container: graphContainer,
    refresh: () => {
      if (listActive()) {
        // The hidden graph would be stale: drop it, and it is rebuilt on the
        // next switch to Graph.
        if (controller) { controller.destroy(); controller = null; }
        graphContainer.replaceChildren();
        initialized = false;
        listEl.innerHTML = graphListHtml(seriesId);
        summaryEl.textContent = graphSummary(seriesId);
        return true;
      }
      return !!controller && controller.refresh();
    },
  };
}

function renderNotFound(container) {
  container.innerHTML = `
    <div class="page-header"><h1>Page not found</h1></div>
    <p><a href="/">← Back to home</a></p>
  `;
}

