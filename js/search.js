/**
 * search.js — Search query parsing, matching, results rendering + display helpers
 * Part of The Lore Atlas SPA (split from app.js, Session 13.5).
 */

// ── Search ────────────────────────────────────────────────────────────────────

function getSearchQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('q') || '';
}

function renderSearch(container) {
  const query = getSearchQuery();

  container.innerHTML = `
    <div class="page-header">
      <h1>Search</h1>
    </div>
    <div class="search-container">
      <input type="text" id="search-input" class="search-input"
             placeholder="Search characters, cases, locations…">
    </div>
    <div id="search-results"></div>
  `;

  const input = document.getElementById('search-input');
  input.value = query;  // Set via DOM property — handles all characters safely
  input.focus();

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
      renderSearchResults(q);
    }, 250);
  });

  if (query) {
    renderSearchResults(query);
  } else {
    renderSearchResults('');
  }
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

  // Prose fields — only searchable when fully revealed.
  if (status === 'full') {
    fields.push(entity.biography, entity.synopsis, entity.description, entity.significance, entity.notes);
  }

  for (const f of fields) {
    if (typeof f === 'string' && f.toLowerCase().includes(q)) return true;
  }

  const arrays = [entity.aliases, entity.tags];
  for (const arr of arrays) {
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string' && item.toLowerCase().includes(q)) return true;
      }
    }
  }

  // For relationships, also check resolved character names.
  if (entityType === 'relationships') {
    const charA = LoreLoader.getById(entity.character_a);
    const charB = LoreLoader.getById(entity.character_b);
    if (charA && charA.name && charA.name.toLowerCase().includes(q)) return true;
    if (charB && charB.name && charB.name.toLowerCase().includes(q)) return true;
  }

  return false;
}

function searchEntities(query) {
  if (!query) return [];
  const q = query.toLowerCase();
  const results = [];

  for (const series of LoreLoader.getSeries()) {
    for (const et of ENTITY_TYPES) {
      const entities = LoreLoader.getAll(series.id, et.key);
      for (const entity of entities) {
        if (entityMatchesQuery(entity, et.key, q, series.id)) {
          results.push({ entity, entityType: et.key, seriesId: series.id });
        }
      }
    }
  }

  return results;
}

function renderSearchResults(query) {
  const resultsContainer = document.getElementById('search-results');
  if (!resultsContainer) return;

  if (!query) {
    resultsContainer.innerHTML = '<p class="search-prompt">Enter a search term to find characters, cases, locations, and more.</p>';
    return;
  }

  const results = searchEntities(query);

  if (results.length === 0) {
    resultsContainer.innerHTML = `<p class="search-no-results">No results found for &ldquo;${esc(query)}&rdquo;</p>`;
    return;
  }

  const grouped = {};
  for (const r of results) {
    if (!grouped[r.entityType]) grouped[r.entityType] = [];
    grouped[r.entityType].push(r);
  }

  let html = `<p class="search-count">${results.length} result${results.length === 1 ? '' : 's'} for &ldquo;${esc(query)}&rdquo;</p>`;

  for (const et of ENTITY_TYPES) {
    const group = grouped[et.key];
    if (!group || group.length === 0) continue;

    html += `<div class="search-group">`;
    html += `<h2 class="search-group-heading">${et.label}</h2>`;
    html += `<div class="entity-list">`;
    for (const r of group) {
      const status = SpoilerGate.getRevealStatus(r.entity, r.seriesId);
      html += renderEntityListItem(r.entity, r.entityType, r.seriesId, status);
    }
    html += `</div></div>`;
  }

  resultsContainer.innerHTML = html;
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

function getEntityBadge(entity, entityType) {
  if (entityType === 'characters') {
    if (entity.role) {
      const cls = `badge-${entity.role.replace(/_/g, '-')}`;
      return `<span class="badge ${cls}">${esc(entity.role.replace(/_/g, ' '))}</span>`;
    }
    if (entity.status === 'deceased') {
      return `<span class="badge badge-deceased">deceased</span>`;
    }
  }
  if (entityType === 'books') {
    if (entity.type === 'novel') {
      return `<span class="badge badge-novel">novel</span>`;
    }
    if (entity.type === 'short_story_collection') {
      return `<span class="badge badge-collection">collection</span>`;
    }
  }
  return '';
}

