/**
 * search.js — Search page (query, type chips, grouped results) + display helpers
 * Part of The Lore Atlas SPA (split from app.js, Session 13.5; redesigned in
 * Phase 6).
 *
 * Only entries the reader has reached are indexed. Entries past the bookmark
 * are counted, never named.
 */

// ── Search ────────────────────────────────────────────────────────────────────

// Type chips: the five the design always shows, plus any other type once it has
// a result. The selection is page-level state, so it survives a bookmark re-render.
const SEARCH_CORE_TYPES = ['characters', 'cases', 'locations', 'artifacts', 'factions'];
const searchUi = { type: 'all' };

const SEARCH_ICON = '<svg class="search-field-icon" width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>';

function getSearchQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('q') || '';
}

function renderSearch(container) {
  const query = getSearchQuery();

  container.innerHTML = `
    <div class="page-wide list-page search-page">
      <header class="list-head">
        <h1 class="list-title">Search</h1>
      </header>
      <div class="search-layout">
        <div class="search-main">
          <label class="search-field">${SEARCH_ICON}
            <input type="text" id="search-input" class="search-input" aria-label="Search the atlas"
                   placeholder="Search the atlas" autocomplete="off" enterkeyhint="search">
          </label>
          <div class="role-chips search-chips" id="search-chips" role="group" aria-label="Filter by type"></div>
          <p class="visually-hidden" id="search-status" role="status"></p>
          <div id="search-results"></div>
        </div>
        <aside class="search-note">
          <p class="label">How search works</p>
          <p>Only entries you've reached are searchable, so a name typed in can't reveal a character you haven't met.</p>
          <p>Press <kbd>/</kbd> anywhere to search.</p>
        </aside>
      </div>
    </div>`;

  const input = document.getElementById('search-input');
  input.value = query;  // Set via DOM property — handles all characters safely
  input.focus();

  const chips = document.getElementById('search-chips');
  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.search-chip');
    if (!chip) return;
    searchUi.type = chip.dataset.type;
    for (const c of chips.children) c.setAttribute('aria-pressed', String(c === chip));
    drawSearchResults();
  });
  document.getElementById('search-results').addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear]')) return;
    searchUi.type = 'all';
    for (const c of chips.children) c.setAttribute('aria-pressed', String(c.dataset.type === 'all'));
    drawSearchResults();
    input.focus();
  });

  let debounceTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const q = input.value.trim();
      const newPath = searchPath(q);
      const current = window.location.pathname + window.location.search;
      if (current !== newPath) {
        history.replaceState(null, '', newPath);
      }
      runSearch(q);
    }, 250);
  });

  runSearch(query.trim());
}

// Does a name, title or alias contain the (lowercased) query? Used for the
// matches the reader hasn't reached, where prose and nicknames don't count.
function nameMatchesQuery(entity, q, seriesId) {
  const names = [entity.name, entity.title, ...aliasNames(entity, seriesId, { canonical: true })];
  return names.some(n => typeof n === 'string' && n.toLowerCase().includes(q));
}

function entityMatchesQuery(entity, entityType, q, seriesId) {
  const status = SpoilerGate.getRevealStatus(entity, seriesId);

  // Hidden entities are never surfaced in search.
  if (status === 'hidden') return false;

  // Non-prose fields — always searchable.
  const fields = [
    entity.name,
    entity.title,
    entity.case_nickname,
    entity.relationship_type,
  ];

  // Prose fields — only searchable when fully revealed, and only the text
  // currently visible at the reader's position (Session 13.9 staged prose:
  // a withheld segment isn't in the DOM, so it shouldn't be searchable either).
  if (status === 'full') {
    for (const f of ['biography', 'synopsis', 'description', 'significance', 'notes']) {
      fields.push(proseText(entity, f, seriesId).text);
    }
  }

  for (const f of fields) {
    if (typeof f === 'string' && f.toLowerCase().includes(q)) return true;
  }

  // Aliases go through aliasNames() (Session 14.3): a staged alias isn't
  // searchable before its `from`, just as it isn't shown in "Also Known As".
  const arrays = [aliasNames(entity, seriesId), entity.tags];
  for (const arr of arrays) {
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string' && item.toLowerCase().includes(q)) return true;
      }
    }
  }

  // For relationships, also check the characters' names, but only a character
  // the reader has reached: a relationship can be visible while one end is not,
  // and its title already hides that name.
  if (entityType === 'relationships') {
    for (const id of [entity.character_a, entity.character_b]) {
      const c = LoreLoader.getById(id);
      if (c && c.name && SpoilerGate.isRevealed(c, seriesId) && c.name.toLowerCase().includes(q)) return true;
    }
  }

  return false;
}

// → { results: [{ entity, entityType, seriesId }], hidden: { [entityType]: n } }
// `hidden` only counts entities past the bookmark whose name or alias matches;
// nothing about them is kept.
function searchEntities(query) {
  const out = { results: [], hidden: {} };
  if (!query) return out;
  const q = query.toLowerCase();

  for (const series of LoreLoader.getSeries()) {
    for (const et of ENTITY_TYPES) {
      const entities = LoreLoader.getAll(series.id, et.key);
      for (const entity of entities) {
        if (entityMatchesQuery(entity, et.key, q, series.id)) {
          out.results.push({ entity, entityType: et.key, seriesId: series.id });
        } else if (et.key !== 'relationships'
            && SpoilerGate.getRevealStatus(entity, series.id) === 'hidden'
            && nameMatchesQuery(entity, q, series.id)) {
          out.hidden[et.key] = (out.hidden[et.key] || 0) + 1;
        }
      }
    }
  }

  return out;
}

// The matched part of a name in <mark>. The raw name is split first and each
// piece escaped on its own, so nothing the data or the query holds becomes markup.
function highlightMatch(name, q) {
  const i = name.toLowerCase().indexOf(q);
  // A case-fold that changes length (a few non-ASCII letters) would misplace the mark.
  if (i === -1 || name.toLowerCase().length !== name.length) return esc(name);
  return esc(name.slice(0, i)) + `<mark>${esc(name.slice(i, i + q.length))}</mark>` + esc(name.slice(i + q.length));
}

// Dot colour by entity type, as on the hub and graph (protagonists brighter gold).
function searchTone(entity, entityType) {
  if (entityType === 'characters') return entity.role === 'protagonist' ? 'protagonist' : 'character';
  return ['cases', 'locations', 'artifacts', 'factions'].includes(entityType) ? entityType.replace(/s$/, '') : 'character';
}

function searchRowHtml(r, q) {
  const first = r.entity.first_mention;
  return `<a class="srow" href="${entityPath(r.seriesId, r.entityType, r.entity.id)}">`
    + dotHtml(searchTone(r.entity, r.entityType))
    + `<span class="srow-text"><span class="srow-name">${highlightMatch(String(entityDisplayName(r.entity, r.entityType)), q)}</span>`
    + (first ? `<span class="srow-sub">First appears in ${esc(formatPosition(first, r.seriesId))}</span>` : '')
    + `</span><span class="srow-open" aria-hidden="true">Open &rarr;</span></a>`;
}

// What the current query found; the chips redraw when it changes, the results
// also when the selected type does.
let searchState = { q: '', results: [], hidden: {} };

function runSearch(q) {
  const found = searchEntities(q);
  searchState = { q, results: found.results, hidden: found.hidden };

  const counts = {};
  for (const r of found.results) counts[r.entityType] = (counts[r.entityType] || 0) + 1;
  const types = ENTITY_TYPES.filter(et => SEARCH_CORE_TYPES.includes(et.key) || counts[et.key]);
  if (searchUi.type !== 'all' && !types.some(t => t.key === searchUi.type)) searchUi.type = 'all';

  const chip = (key, label, n) => `<button type="button" class="role-chip search-chip" data-type="${key}" aria-pressed="${searchUi.type === key}">`
    + `${esc(label)}${q ? `<span class="search-chip-n">${n}</span>` : ''}</button>`;
  const chips = document.getElementById('search-chips');
  if (chips) {
    chips.innerHTML = chip('all', 'All', found.results.length)
      + types.map(et => chip(et.key, et.label, counts[et.key] || 0)).join('');
  }

  drawSearchResults();
}

function drawSearchResults() {
  const resultsContainer = document.getElementById('search-results');
  if (!resultsContainer) return;
  const { q, results, hidden } = searchState;
  const status = document.getElementById('search-status');

  if (!q) {
    resultsContainer.innerHTML = emptyState('Type a name, case, place or object.', "Results only include what you've reached.");
    if (status) status.textContent = '';
    return;
  }

  const type = searchUi.type;
  const shown = type === 'all' ? results : results.filter(r => r.entityType === type);
  const hiddenN = type === 'all'
    ? Object.values(hidden).reduce((a, b) => a + b, 0)
    : (hidden[type] || 0);
  const fog = hiddenN
    ? fogBlock(`${hiddenN} more match${hiddenN === 1 ? '' : 'es'} past your bookmark. Names aren't shown.`)
    : '';
  const lower = q.toLowerCase();

  if (!shown.length) {
    resultsContainer.innerHTML = emptyState("Nothing you've reached matches.",
        type === 'all' ? 'Try another spelling, or a shorter part of the name.' : 'Try another type, or clear the filter.',
        type === 'all' ? null : { label: 'Show all types', attr: 'data-clear' })
      + fog;
    if (status) status.textContent = 'No results';
    return;
  }

  let html = `<p class="search-count">${shown.length} result${shown.length === 1 ? '' : 's'} for &ldquo;${esc(q)}&rdquo;</p>`;
  for (const et of ENTITY_TYPES) {
    const group = shown.filter(r => r.entityType === et.key);
    if (!group.length) continue;
    html += `<section class="search-group"><h2 class="search-group-head">${esc(et.label)}<span>${group.length}</span></h2>`
      + `<div class="search-rows">${group.map(r => searchRowHtml(r, lower)).join('')}</div></section>`;
  }
  resultsContainer.innerHTML = html + fog;
  if (status) status.textContent = `${shown.length} result${shown.length === 1 ? '' : 's'}`;
}

// ── Display helpers ───────────────────────────────────────────────────────────

function getEntityName(entity, entityType) {
  switch (entityType) {
    case 'characters':    return entity.name || entity.id;
    case 'cases':         return entity.title || entity.id;
    case 'books':         return entity.title || entity.id;
    case 'factions':      return entity.name || entity.id;
    case 'locations':     return entity.name || entity.id;
    case 'artifacts':     return entity.name || entity.id;
    case 'events':        return entity.name || entity.id;
    case 'relationships': return formatRelationship(entity);
    default:              return entity.name || entity.title || entity.id;
  }
}

function formatRelationship(entity) {
  const a = LoreLoader.getById(entity.character_a);
  const b = LoreLoader.getById(entity.character_b);
  const nameA = a ? a.name : entity.character_a;
  const nameB = b ? b.name : entity.character_b;
  return `${nameA} & ${nameB}`;
}

function getEntityMeta(entity, entityType) {
  switch (entityType) {
    case 'characters':
      return entity.status === 'deceased' ? 'Deceased' : entity.role || '';
    case 'cases':
      return entity.case_nickname || '';
    case 'books':
      return entity.publication_year ? `${entity.publication_year}` : '';
    case 'factions':
      return entity.type ? entity.type.replace(/_/g, ' ') : '';
    case 'locations':
      return entity.type || '';
    case 'artifacts':
      return entity.type || '';
    case 'events':
      return entity.date_or_position || '';
    case 'relationships':
      return entity.relationship_type || '';
    default:
      return '';
  }
}
