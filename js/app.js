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

// ── HTML escape utility ───────────────────────────────────────────────────────

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

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
    console.error('Data load failed:', err);
    content.innerHTML = '<p class="state-error">Failed to load data. Please try refreshing the page.</p>';
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
    html += `<h2><span class="series-label">Universe</span> &nbsp;${esc(s.name)}</h2>`;
    html += `<p style="font-size:0.9rem;color:#666;margin-bottom:1.25rem;font-family:sans-serif;">${esc(s.description)}</p>`;
    html += `<div class="entity-type-grid">`;

    for (const et of ENTITY_TYPES) {
      const entities = LoreLoader.getAll(s.id, et.key);
      if (entities.length === 0) continue;
      html += `
        <a class="entity-type-card" href="#/${encodeURIComponent(s.id)}/${encodeURIComponent(et.key)}">
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
        <a href="#/">Home</a> &rsaquo; <span class="series-label">${esc(series.name)}</span> &rsaquo; ${etConfig.label}
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
  const href = `#/${encodeURIComponent(seriesId)}/${encodeURIComponent(entityType)}/${encodeURIComponent(entity.id)}`;
  const name = getEntityName(entity, entityType);
  const meta = getEntityMeta(entity, entityType);
  const badge = getEntityBadge(entity, entityType);

  return `
    <a class="entity-list-item" href="${href}">
      <span class="item-name">${esc(name)}${badge}</span>
      <span class="item-meta">${esc(meta)}</span>
    </a>
  `;
}

// ── Cross-reference helpers ───────────────────────────────────────────────────

function guessEntityType(id) {
  const prefix = id.split('_')[0];
  const map = { char: 'characters', case: 'cases', faction: 'factions', book: 'books', loc: 'locations', artifact: 'artifacts', event: 'events', rel: 'relationships' };
  return map[prefix] || '';
}

function entityLink(id) {
  const entity = LoreLoader.getById(id);
  if (!entity) return esc(id);
  const name = getEntityName(entity, guessEntityType(id));
  const series = entity.series || '';
  const type = guessEntityType(id);
  const displayName = typeof name === 'string' ? name : id;
  return `<a href="#/${encodeURIComponent(series)}/${encodeURIComponent(type)}/${encodeURIComponent(id)}">${esc(displayName)}</a>`;
}

function formatSpoiler(threshold) {
  if (!threshold) return '—';
  return `Book ${threshold.book}, Ch. ${threshold.chapter}`;
}

function renderLinkedList(ids) {
  if (!ids || ids.length === 0) return '<span class="detail-none">None</span>';
  return ids.map(id => `<span class="detail-link-item">${entityLink(id)}</span>`).join('');
}

// ── Entity detail ─────────────────────────────────────────────────────────────

function renderEntityDetail(container, seriesId, entityType, id) {
  const entity = LoreLoader.getById(id);
  if (!entity) { renderNotFound(container); return; }
  const etConfig = ENTITY_TYPES.find(e => e.key === entityType);

  const breadcrumb = `
    <div class="page-header">
      <div class="breadcrumb">
        <a href="#/">Home</a> &rsaquo;
        <a href="#/${encodeURIComponent(seriesId)}/${encodeURIComponent(entityType)}">${etConfig ? etConfig.label : esc(entityType)}</a> &rsaquo;
        ${esc(getEntityName(entity, entityType))}
      </div>
      <h1>${esc(getEntityName(entity, entityType))}</h1>
    </div>
  `;

  let body = '';
  switch (entityType) {
    case 'characters':    body = renderCharacterDetail(entity); break;
    case 'cases':         body = renderCaseDetail(entity); break;
    case 'books':         body = renderBookDetail(entity); break;
    case 'factions':      body = renderFactionDetail(entity); break;
    case 'locations':     body = renderLocationDetail(entity); break;
    case 'artifacts':     body = renderArtifactDetail(entity); break;
    case 'events':        body = renderEventDetail(entity); break;
    case 'relationships': body = renderRelationshipDetail(entity); break;
    default:              body = '<p>Unknown entity type.</p>';
  }

  container.innerHTML = breadcrumb + `<div class="entity-detail">${body}</div>`;
}

function renderCharacterDetail(entity) {
  const aliases = entity.aliases && entity.aliases.length
    ? entity.aliases.map(a => esc(a)).join(', ')
    : '<span class="detail-none">None</span>';

  const tags = entity.tags && entity.tags.length
    ? `<div class="detail-tags">${entity.tags.map(t => `<span class="detail-tag">${esc(t)}</span>`).join('')}</div>`
    : '';

  return `
    <div class="detail-meta">
      ${entity.role ? `<span class="badge badge-${esc(entity.role.replace(/_/g, '-'))}">${esc(entity.role.replace(/_/g, ' '))}</span>` : ''}
      ${entity.status === 'deceased' ? '<span class="badge badge-deceased">deceased</span>' : ''}
    </div>
    ${entity.biography ? `<div class="detail-section"><h2>Biography</h2><p class="detail-prose">${esc(entity.biography)}</p></div>` : ''}
    <div class="detail-section"><h2>Also Known As</h2><p class="detail-prose">${aliases}</p></div>
    <div class="detail-section"><h2>Affiliations</h2><div class="detail-links">${renderLinkedList(entity.affiliations)}</div></div>
    <div class="detail-section"><h2>Cases</h2><div class="detail-links">${renderLinkedList(entity.cases)}</div></div>
    <div class="detail-section"><h2>Relationships</h2><div class="detail-links">${renderLinkedList(entity.relationships)}</div></div>
    ${tags ? `<div class="detail-section"><h2>Tags</h2>${tags}</div>` : ''}
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
    </div>
  `;
}

function renderCaseDetail(entity) {
  const notableElements = entity.notable_elements && entity.notable_elements.length
    ? `<ul class="detail-list">${entity.notable_elements.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '<span class="detail-none">None</span>';

  return `
    <div class="detail-meta">
      ${entity.source_book ? `<span class="detail-meta-item">Source: ${entityLink(entity.source_book)}</span>` : ''}
      ${entity.case_nickname ? `<span class="detail-meta-item detail-nickname">&ldquo;${esc(entity.case_nickname)}&rdquo;</span>` : ''}
    </div>
    ${entity.synopsis ? `<div class="detail-section"><h2>Synopsis</h2><p class="detail-prose">${esc(entity.synopsis)}</p></div>` : ''}
    ${entity.solution ? `
    <div class="detail-section">
      <h2>Solution</h2>
      <details class="spoiler-box">
        <summary>Reveal solution <span class="spoiler-warning">— contains spoilers</span></summary>
        <p class="detail-prose">${esc(entity.solution)}</p>
      </details>
    </div>` : ''}
    <div class="detail-section"><h2>Characters Involved</h2><div class="detail-links">${renderLinkedList(entity.characters_involved)}</div></div>
    <div class="detail-section"><h2>Locations</h2><div class="detail-links">${renderLinkedList(entity.locations)}</div></div>
    <div class="detail-section"><h2>Artifacts</h2><div class="detail-links">${renderLinkedList(entity.artifacts_involved)}</div></div>
    <div class="detail-section"><h2>Notable Elements</h2>${notableElements}</div>
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
      ${entity.timeline_position ? `<span>Timeline position: ${esc(formatSpoiler(entity.timeline_position))}</span>` : ''}
    </div>
  `;
}

function renderBookDetail(entity) {
  return `
    <div class="detail-meta">
      ${entity.type === 'novel' ? '<span class="badge badge-novel">novel</span>' : ''}
      ${entity.type === 'short_story_collection' ? '<span class="badge badge-collection">collection</span>' : ''}
      ${entity.publication_year ? `<span class="detail-meta-item">${esc(String(entity.publication_year))}</span>` : ''}
      ${entity.chronological_order ? `<span class="detail-meta-item">Vol. ${esc(String(entity.chronological_order))}</span>` : ''}
    </div>
    ${entity.description ? `<div class="detail-section"><h2>Description</h2><p class="detail-prose">${esc(entity.description)}</p></div>` : ''}
    <div class="detail-section"><h2>Stories Contained</h2><div class="detail-links">${renderLinkedList(entity.stories_contained)}</div></div>
  `;
}

function renderFactionDetail(entity) {
  return `
    <div class="detail-meta">
      ${entity.type ? `<span class="badge badge-faction">${esc(entity.type.replace(/_/g, ' '))}</span>` : ''}
      ${entity.alignment ? `<span class="detail-meta-item">${esc(entity.alignment)}</span>` : ''}
      ${entity.active_period ? `<span class="detail-meta-item">${esc(entity.active_period)}</span>` : ''}
    </div>
    ${entity.description ? `<div class="detail-section"><h2>Description</h2><p class="detail-prose">${esc(entity.description)}</p></div>` : ''}
    <div class="detail-section"><h2>Key Members</h2><div class="detail-links">${renderLinkedList(entity.key_members)}</div></div>
    <div class="detail-section"><h2>Cases Involved</h2><div class="detail-links">${renderLinkedList(entity.cases_involved)}</div></div>
    ${entity.parent_org ? `<div class="detail-section"><h2>Parent Organization</h2><div class="detail-links"><span class="detail-link-item">${entityLink(entity.parent_org)}</span></div></div>` : ''}
    ${entity.child_orgs && entity.child_orgs.length ? `<div class="detail-section"><h2>Sub-Organizations</h2><div class="detail-links">${renderLinkedList(entity.child_orgs)}</div></div>` : ''}
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
    </div>
  `;
}

function renderLocationDetail(entity) {
  return `
    <div class="detail-meta">
      ${entity.type ? `<span class="detail-meta-item">${esc(entity.type)}</span>` : ''}
      ${entity.real_world_basis ? `<span class="detail-meta-item detail-real-world">Real world: ${esc(entity.real_world_basis)}</span>` : ''}
    </div>
    ${entity.description ? `<div class="detail-section"><h2>Description</h2><p class="detail-prose">${esc(entity.description)}</p></div>` : ''}
    <div class="detail-section"><h2>Associated Characters</h2><div class="detail-links">${renderLinkedList(entity.characters_associated)}</div></div>
    <div class="detail-section"><h2>Cases Occurring Here</h2><div class="detail-links">${renderLinkedList(entity.cases_occurring_here)}</div></div>
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
    </div>
  `;
}

function renderArtifactDetail(entity) {
  const ownershipChain = entity.ownership_chain && entity.ownership_chain.length
    ? entity.ownership_chain.map(o => `
        <div class="ownership-entry">
          <span class="ownership-name">${entityLink(o.character_id)}</span>
          <span class="ownership-period">${esc(formatSpoiler(o.from))} — ${esc(formatSpoiler(o.to))}</span>
        </div>`).join('')
    : '<span class="detail-none">No ownership data</span>';

  return `
    <div class="detail-meta">
      ${entity.type ? `<span class="detail-meta-item">${esc(entity.type)}</span>` : ''}
    </div>
    ${entity.description ? `<div class="detail-section"><h2>Description</h2><p class="detail-prose">${esc(entity.description)}</p></div>` : ''}
    ${entity.significance ? `<div class="detail-section"><h2>Significance</h2><p class="detail-prose">${esc(entity.significance)}</p></div>` : ''}
    <div class="detail-section"><h2>Ownership Chain</h2><div class="ownership-chain">${ownershipChain}</div></div>
    <div class="detail-section"><h2>Appears In</h2><div class="detail-links">${renderLinkedList(entity.appearance_history)}</div></div>
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
    </div>
  `;
}

function renderEventDetail(entity) {
  return `
    <div class="detail-meta">
      ${entity.event_type ? `<span class="badge badge-event-${esc(entity.event_type)}">${esc(entity.event_type)}</span>` : ''}
      ${entity.date_or_position ? `<span class="detail-meta-item">${esc(entity.date_or_position)}</span>` : ''}
    </div>
    ${entity.description ? `<div class="detail-section"><h2>Description</h2><p class="detail-prose">${esc(entity.description)}</p></div>` : ''}
    <div class="detail-section"><h2>Characters Involved</h2><div class="detail-links">${renderLinkedList(entity.characters_involved)}</div></div>
    <div class="detail-section"><h2>Cases Linked</h2><div class="detail-links">${renderLinkedList(entity.cases_linked)}</div></div>
    ${entity.location ? `<div class="detail-section"><h2>Location</h2><div class="detail-links"><span class="detail-link-item">${entityLink(entity.location)}</span></div></div>` : ''}
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
    </div>
  `;
}

function renderRelationshipDetail(entity) {
  return `
    <div class="detail-meta">
      ${entity.relationship_type ? `<span class="badge badge-rel-${esc(entity.relationship_type)}">${esc(entity.relationship_type)}</span>` : ''}
    </div>
    <div class="detail-section">
      <h2>Characters</h2>
      <div class="detail-links">
        ${entity.character_a ? `<span class="detail-link-item">${entityLink(entity.character_a)}</span>` : ''}
        ${entity.character_b ? `<span class="detail-link-item">${entityLink(entity.character_b)}</span>` : ''}
      </div>
    </div>
    ${entity.first_established ? `<div class="detail-section"><h2>First Established</h2><div class="detail-links"><span class="detail-link-item">${entityLink(entity.first_established)}</span></div></div>` : ''}
    ${entity.notes ? `<div class="detail-section"><h2>Notes</h2><p class="detail-prose">${esc(entity.notes)}</p></div>` : ''}
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
    </div>
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
  return `${esc(nameA)} &amp; ${esc(nameB)}`;
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

// ── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('hashchange', onRouteChange);
window.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hash || window.location.hash === '#') {
    window.location.hash = '#/';
  }
  onRouteChange();
});
