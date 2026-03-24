/**
 * app.js — The Lore Atlas router and view renderer
 *
 * Hash-based routing:
 *   #/                          → Home
 *   #/series/:seriesId          → Series overview
 *   #/:seriesId/:entityType     → Entity list (e.g. #/sherlock_holmes/characters)
 *   #/:seriesId/:entityType/:id → Entity detail (Session 5)
 */

// ── Entity type display config ───────────────────────────────────────────────

const ENTITY_TYPES = [
  { key: 'characters',    label: 'Characters',    singular: 'Character'   },
  { key: 'cases',         label: 'Cases',         singular: 'Case'        },
  { key: 'books',         label: 'Books',         singular: 'Book'        },
  { key: 'factions',      label: 'Factions',      singular: 'Faction'     },
  { key: 'locations',     label: 'Locations',     singular: 'Location'    },
  { key: 'artifacts',     label: 'Artifacts',     singular: 'Artifact'    },
  { key: 'events',        label: 'Timeline Events', singular: 'Event'     },
  { key: 'relationships', label: 'Relationships', singular: 'Relationship'},
];

// ── Routing ──────────────────────────────────────────────────────────────────

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  return parts;
}

function navigate(path) {
  window.location.hash = '/' + path;
}

async function onRouteChange() {
  const parts = parseRoute();
  const content = document.getElementById('main-content');
  if (!content) return;

  // Show loading state
  content.innerHTML = '<p class="state-loading">Loading…</p>';

  try {
    await LoreLoader.load();
  } catch (err) {
    content.innerHTML = `<p class="state-error">Failed to load data: ${err.message}</p>`;
    return;
  }

  updateNavActive(parts);

  // Route dispatch
  if (parts.length === 0) {
    renderHome(content);
  } else if (parts.length === 1 && parts[0] === 'series') {
    renderHome(content);
  } else if (parts.length === 2) {
    const [seriesId, entityType] = parts;
    renderEntityList(content, seriesId, entityType);
  } else if (parts.length === 3) {
    // Entity detail — Session 5
    renderEntityDetail(content, parts[0], parts[1], parts[2]);
  } else {
    renderNotFound(content);
  }
}

// ── Nav active state ─────────────────────────────────────────────────────────

function updateNavActive(parts) {
  document.querySelectorAll('#site-nav a').forEach(a => a.classList.remove('active'));
  if (parts.length === 0) {
    const homeLink = document.querySelector('#site-nav a[href="#/"]');
    if (homeLink) homeLink.classList.add('active');
  }
}

// ── Views ────────────────────────────────────────────────────────────────────

function renderHome(container) {
  const series = LoreLoader.getSeries();
  let html = `
    <div class="home-hero">
      <h1>The Lore Atlas</h1>
      <p class="tagline">The interactive encyclopedia for public domain literary universes.</p>
    </div>
  `;

  for (const s of series) {
    html += `<div class="series-section">`;
    html += `<h2><span class="series-label">Universe</span> &nbsp;${s.name}</h2>`;
    html += `<p style="font-size:0.9rem;color:#666;margin-bottom:1.25rem;font-family:sans-serif;">${s.description}</p>`;
    html += `<div class="entity-type-grid">`;

    for (const et of ENTITY_TYPES) {
      const entities = LoreLoader.getAll(s.id, et.key);
      if (entities.length === 0) continue;
      html += `
        <a class="entity-type-card" href="#/${s.id}/${et.key}">
          <div class="card-label">Browse</div>
          <div class="card-title">${et.label}</div>
          <div class="card-count">${entities.length} ${entities.length === 1 ? et.singular : et.label}</div>
        </a>
      `;
    }

    html += `</div></div>`;
  }

  container.innerHTML = html;
}

function renderEntityList(container, seriesId, entityType) {
  const series = LoreLoader.getSeriesById(seriesId);
  const etConfig = ENTITY_TYPES.find(e => e.key === entityType);

  if (!series || !etConfig) {
    renderNotFound(container);
    return;
  }

  const entities = LoreLoader.getAll(seriesId, entityType);

  let html = `
    <div class="page-header">
      <div class="breadcrumb">
        <a href="#/">Home</a> &rsaquo; <span class="series-label">${series.name}</span> &rsaquo; ${etConfig.label}
      </div>
      <h1>${etConfig.label}</h1>
    </div>
    <div class="entity-list">
  `;

  if (entities.length === 0) {
    html += `<p class="state-loading">No entries yet.</p>`;
  } else {
    for (const entity of entities) {
      html += renderEntityListItem(entity, entityType, seriesId);
    }
  }

  html += `</div>`;
  container.innerHTML = html;
}

function renderEntityListItem(entity, entityType, seriesId) {
  const href = `#/${seriesId}/${entityType}/${entity.id}`;
  const name = getEntityName(entity, entityType);
  const meta = getEntityMeta(entity, entityType);
  const badge = getEntityBadge(entity, entityType);

  return `
    <a class="entity-list-item" href="${href}">
      <span class="item-name">${name}${badge}</span>
      <span class="item-meta">${meta}</span>
    </a>
  `;
}

// ── Entity detail (stub — built out in Session 5) ────────────────────────────

function renderEntityDetail(container, seriesId, entityType, id) {
  const entity = LoreLoader.getById(id);
  if (!entity) {
    renderNotFound(container);
    return;
  }
  const etConfig = ENTITY_TYPES.find(e => e.key === entityType);
  const series = LoreLoader.getSeriesById(seriesId);

  container.innerHTML = `
    <div class="page-header">
      <div class="breadcrumb">
        <a href="#/">Home</a> &rsaquo;
        <a href="#/${seriesId}/${entityType}">${etConfig ? etConfig.label : entityType}</a> &rsaquo;
        ${getEntityName(entity, entityType)}
      </div>
      <h1>${getEntityName(entity, entityType)}</h1>
    </div>
    <p style="color:#888;font-style:italic;font-family:sans-serif;font-size:0.95rem;">
      Full entity detail pages are coming in the next session.
    </p>
    <pre style="background:#f0ede8;padding:1.5rem;border-radius:4px;font-size:0.8rem;overflow-x:auto;margin-top:1.5rem;">${JSON.stringify(entity, null, 2)}</pre>
  `;
}

function renderNotFound(container) {
  container.innerHTML = `
    <div class="page-header"><h1>Page not found</h1></div>
    <p style="font-family:sans-serif;color:#666;">
      <a href="#/">← Back to home</a>
    </p>
  `;
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
  return `${nameA} &amp; ${nameB}`;
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
      return `<span class="badge ${cls}">${entity.role.replace(/_/g, ' ')}</span>`;
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

// ── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('hashchange', onRouteChange);
window.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hash || window.location.hash === '#') {
    window.location.hash = '#/';
  }
  onRouteChange();
});
