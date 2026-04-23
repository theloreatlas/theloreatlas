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
  content.classList.remove('page-enter');

  try {
    await LoreLoader.load();
  } catch (err) {
    console.error('Data load failed:', err);
    content.innerHTML = '<p class="state-error">Failed to load data. Please try refreshing the page.</p>';
    return;
  }

  initReaderPositionPicker();
  updateNavActive(parts);

  // Route dispatch
  if (parts.length === 0) {
    renderHome(content);
  } else if (parts.length === 1 && parts[0] === 'series') {
    renderHome(content);
  } else if (parts.length >= 1 && parts[0].split('?')[0] === 'search') {
    renderSearch(content);
  } else if (parts.length === 2) {
    const [seriesId, entityType] = parts;
    if (entityType === 'graph') {
      renderGraph(content, seriesId);
    } else {
      renderEntityList(content, seriesId, entityType);
    }
  } else if (parts.length === 3) {
    // Entity detail — Session 5
    renderEntityDetail(content, parts[0], parts[1], parts[2]);
  } else {
    renderNotFound(content);
  }

  // Trigger entrance animation after render
  void content.offsetWidth; // force reflow
  content.classList.add('page-enter');
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
    html += `<h2><span class="series-label">Universe</span></h2>`;
    html += `<p class="series-universe-name">${esc(s.name)}</p>`;
    if (s.description) {
      html += `<p class="series-description">${esc(s.description)}</p>`;
    }
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

  // Filter out entities the reader hasn't reached yet.
  const visible = entities.filter(e => SpoilerGate.isRevealed(e, seriesId));
  const hiddenCount = entities.length - visible.length;

  let html = `
    <div class="page-header">
      <div class="breadcrumb">
        <a href="#/">Home</a> &rsaquo; <span class="series-label">${esc(series.name)}</span> &rsaquo; ${etConfig.label}
      </div>
      <h1>${etConfig.label}</h1>
    </div>
    <div class="entity-list">
  `;

  if (visible.length === 0 && hiddenCount > 0) {
    html += `<p class="state-loading">No entries visible at your current reading position.</p>`;
  } else if (visible.length === 0) {
    html += `<p class="state-loading">No entries yet.</p>`;
  } else {
    for (const entity of visible) {
      const status = SpoilerGate.getRevealStatus(entity, seriesId);
      html += renderEntityListItem(entity, entityType, seriesId, status);
    }
  }

  html += `</div>`;

  if (hiddenCount > 0) {
    html += `<p class="list-gated-note">${hiddenCount} entr${hiddenCount === 1 ? 'y' : 'ies'} hidden by your reading position.</p>`;
  }
  container.innerHTML = html;
}

function renderEntityListItem(entity, entityType, seriesId, status) {
  const href = `#/${encodeURIComponent(seriesId)}/${encodeURIComponent(entityType)}/${encodeURIComponent(entity.id)}`;
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

// ── Cross-reference helpers ───────────────────────────────────────────────────

function guessEntityType(id) {
  const prefix = id.split('_')[0];
  const map = { char: 'characters', case: 'cases', faction: 'factions', book: 'books', loc: 'locations', artifact: 'artifacts', event: 'events', rel: 'relationships' };
  return map[prefix] || '';
}

function entityLink(id) {
  const entity = LoreLoader.getById(id);
  if (!entity) return esc(id);

  const seriesId = entity.series || '';
  const status = seriesId ? SpoilerGate.getRevealStatus(entity, seriesId) : 'full';

  // Entity is before the reader's position — the name itself is a spoiler.
  if (status === 'hidden') {
    return `<span class="link-gated">[not yet revealed]</span>`;
  }

  const name = getEntityName(entity, guessEntityType(id));
  const type = guessEntityType(id);
  const displayName = typeof name === 'string' ? name : id;
  return `<a href="#/${encodeURIComponent(seriesId)}/${encodeURIComponent(type)}/${encodeURIComponent(id)}">${esc(displayName)}</a>`;
}

function formatSpoiler(threshold) {
  if (!threshold) return '—';
  return `Book ${threshold.book}, Ch. ${threshold.chapter}`;
}

function renderLinkedList(ids) {
  if (!ids || ids.length === 0) return '<span class="detail-none">None</span>';
  return ids.map(id => `<span class="detail-link-item">${entityLink(id)}</span>`).join('');
}

// ── Spoiler helpers ───────────────────────────────────────────────────────────

/**
 * Returns the HTML string to display in place of a redacted prose field.
 * Uses the entity's full_reveal threshold to tell the reader where to look.
 */
function redactedProse(entity) {
  const t = entity.full_reveal;
  const where = t ? `Book ${t.book}, Ch. ${t.chapter}` : 'a later point';
  return `<span class="spoiler-redacted">[Spoilers past ${where}]</span>`;
}

// ── Entity detail ─────────────────────────────────────────────────────────────

function renderEntityDetail(container, seriesId, entityType, id) {
  const entity = LoreLoader.getById(id);
  if (!entity) { renderNotFound(container); return; }

  const status = SpoilerGate.getRevealStatus(entity, seriesId);

  // Entity is before the reader's current position — don't reveal anything.
  if (status === 'hidden') {
    const etConfig = ENTITY_TYPES.find(e => e.key === entityType);
    container.innerHTML = `
      <div class="page-header">
        <div class="breadcrumb">
          <a href="#/">Home</a> &rsaquo;
          <a href="#/${encodeURIComponent(seriesId)}/${encodeURIComponent(entityType)}">${etConfig ? etConfig.label : esc(entityType)}</a>
        </div>
        <h1>Entry not yet reached</h1>
      </div>
      <div class="spoiler-blocked">
        <p class="detail-prose">This entry contains spoilers beyond your current reading position.</p>
        <p class="detail-prose">Adjust the reading position bar above to reveal it.</p>
      </div>
    `;
    return;
  }

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
    case 'characters':    body = renderCharacterDetail(entity, status); break;
    case 'cases':         body = renderCaseDetail(entity, status); break;
    case 'books':         body = renderBookDetail(entity, status); break;
    case 'factions':      body = renderFactionDetail(entity, status); break;
    case 'locations':     body = renderLocationDetail(entity, status); break;
    case 'artifacts':     body = renderArtifactDetail(entity, status); break;
    case 'events':        body = renderEventDetail(entity, status); break;
    case 'relationships': body = renderRelationshipDetail(entity, status); break;
    default:              body = '<p>Unknown entity type.</p>';
  }

  container.innerHTML = breadcrumb + `<div class="entity-detail">${body}</div>`;
}

function renderCharacterDetail(entity, status) {
  const aliases = entity.aliases && entity.aliases.length
    ? entity.aliases.map(a => esc(a)).join(', ')
    : '<span class="detail-none">None</span>';

  const tags = entity.tags && entity.tags.length
    ? `<div class="detail-tags">${entity.tags.map(t => `<span class="detail-tag">${esc(t)}</span>`).join('')}</div>`
    : '';

  const biographyContent = status === 'partial' ? redactedProse(entity) : esc(entity.biography);

  return `
    <div class="detail-meta">
      ${entity.role ? `<span class="badge badge-${esc(entity.role.replace(/_/g, '-'))}">${esc(entity.role.replace(/_/g, ' '))}</span>` : ''}
      ${entity.status === 'deceased' ? '<span class="badge badge-deceased">deceased</span>' : ''}
    </div>
    ${entity.biography ? `<div class="detail-section"><h2>Biography</h2><p class="detail-prose">${biographyContent}</p></div>` : ''}
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

function renderCaseDetail(entity, status) {
  const notableElements = entity.notable_elements && entity.notable_elements.length
    ? `<ul class="detail-list">${entity.notable_elements.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '<span class="detail-none">None</span>';

  const synopsisContent = status === 'partial' ? redactedProse(entity) : esc(entity.synopsis);

  // Solution is always gated at full_reveal. When partial: redact. When full: keep <details>.
  let solutionSection = '';
  if (entity.solution) {
    if (status === 'partial') {
      solutionSection = `
        <div class="detail-section">
          <h2>Solution</h2>
          <p class="detail-prose">${redactedProse(entity)}</p>
        </div>`;
    } else {
      solutionSection = `
        <div class="detail-section">
          <h2>Solution</h2>
          <details class="spoiler-box">
            <summary>Reveal solution <span class="spoiler-warning">— contains spoilers</span></summary>
            <p class="detail-prose">${esc(entity.solution)}</p>
          </details>
        </div>`;
    }
  }

  return `
    <div class="detail-meta">
      ${entity.source_book ? `<span class="detail-meta-item">Source: ${entityLink(entity.source_book)}</span>` : ''}
      ${entity.case_nickname ? `<span class="detail-meta-item detail-nickname">&ldquo;${esc(entity.case_nickname)}&rdquo;</span>` : ''}
    </div>
    ${entity.synopsis ? `<div class="detail-section"><h2>Synopsis</h2><p class="detail-prose">${synopsisContent}</p></div>` : ''}
    ${solutionSection}
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

function renderBookDetail(entity, status) {
  const descriptionContent = status === 'partial' ? redactedProse(entity) : esc(entity.description);

  return `
    <div class="detail-meta">
      ${entity.type === 'novel' ? '<span class="badge badge-novel">novel</span>' : ''}
      ${entity.type === 'short_story_collection' ? '<span class="badge badge-collection">collection</span>' : ''}
      ${entity.publication_year ? `<span class="detail-meta-item">${esc(String(entity.publication_year))}</span>` : ''}
      ${entity.chronological_order ? `<span class="detail-meta-item">Vol. ${esc(String(entity.chronological_order))}</span>` : ''}
    </div>
    ${entity.description ? `<div class="detail-section"><h2>Description</h2><p class="detail-prose">${descriptionContent}</p></div>` : ''}
    <div class="detail-section"><h2>Stories Contained</h2><div class="detail-links">${renderLinkedList(entity.stories_contained)}</div></div>
  `;
}

function renderFactionDetail(entity, status) {
  const descriptionContent = status === 'partial' ? redactedProse(entity) : esc(entity.description);

  return `
    <div class="detail-meta">
      ${entity.type ? `<span class="badge badge-faction">${esc(entity.type.replace(/_/g, ' '))}</span>` : ''}
      ${entity.alignment ? `<span class="detail-meta-item">${esc(entity.alignment)}</span>` : ''}
      ${entity.active_period ? `<span class="detail-meta-item">${esc(entity.active_period)}</span>` : ''}
    </div>
    ${entity.description ? `<div class="detail-section"><h2>Description</h2><p class="detail-prose">${descriptionContent}</p></div>` : ''}
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

function renderLocationDetail(entity, status) {
  const descriptionContent = status === 'partial' ? redactedProse(entity) : esc(entity.description);

  return `
    <div class="detail-meta">
      ${entity.type ? `<span class="detail-meta-item">${esc(entity.type)}</span>` : ''}
      ${entity.real_world_basis ? `<span class="detail-meta-item detail-real-world">Real world: ${esc(entity.real_world_basis)}</span>` : ''}
    </div>
    ${entity.description ? `<div class="detail-section"><h2>Description</h2><p class="detail-prose">${descriptionContent}</p></div>` : ''}
    <div class="detail-section"><h2>Associated Characters</h2><div class="detail-links">${renderLinkedList(entity.characters_associated)}</div></div>
    <div class="detail-section"><h2>Cases Occurring Here</h2><div class="detail-links">${renderLinkedList(entity.cases_occurring_here)}</div></div>
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
    </div>
  `;
}

function renderArtifactDetail(entity, status) {
  const ownershipChain = entity.ownership_chain && entity.ownership_chain.length
    ? entity.ownership_chain.map(o => `
        <div class="ownership-entry">
          <span class="ownership-name">${entityLink(o.character_id)}</span>
          <span class="ownership-period">${esc(formatSpoiler(o.from))} — ${esc(formatSpoiler(o.to))}</span>
        </div>`).join('')
    : '<span class="detail-none">No ownership data</span>';

  const descriptionContent   = status === 'partial' ? redactedProse(entity) : esc(entity.description);
  const significanceContent  = status === 'partial' ? redactedProse(entity) : esc(entity.significance);

  return `
    <div class="detail-meta">
      ${entity.type ? `<span class="detail-meta-item">${esc(entity.type)}</span>` : ''}
    </div>
    ${entity.description ? `<div class="detail-section"><h2>Description</h2><p class="detail-prose">${descriptionContent}</p></div>` : ''}
    ${entity.significance ? `<div class="detail-section"><h2>Significance</h2><p class="detail-prose">${significanceContent}</p></div>` : ''}
    <div class="detail-section"><h2>Ownership Chain</h2><div class="ownership-chain">${ownershipChain}</div></div>
    <div class="detail-section"><h2>Appears In</h2><div class="detail-links">${renderLinkedList(entity.appearance_history)}</div></div>
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
    </div>
  `;
}

function renderEventDetail(entity, status) {
  const descriptionContent = status === 'partial' ? redactedProse(entity) : esc(entity.description);

  return `
    <div class="detail-meta">
      ${entity.event_type ? `<span class="badge badge-event-${esc(entity.event_type)}">${esc(entity.event_type)}</span>` : ''}
      ${entity.date_or_position ? `<span class="detail-meta-item">${esc(entity.date_or_position)}</span>` : ''}
    </div>
    ${entity.description ? `<div class="detail-section"><h2>Description</h2><p class="detail-prose">${descriptionContent}</p></div>` : ''}
    <div class="detail-section"><h2>Characters Involved</h2><div class="detail-links">${renderLinkedList(entity.characters_involved)}</div></div>
    <div class="detail-section"><h2>Cases Linked</h2><div class="detail-links">${renderLinkedList(entity.cases_linked)}</div></div>
    ${entity.location ? `<div class="detail-section"><h2>Location</h2><div class="detail-links"><span class="detail-link-item">${entityLink(entity.location)}</span></div></div>` : ''}
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
    </div>
  `;
}

function renderRelationshipDetail(entity, status) {
  const notesContent = status === 'partial' ? redactedProse(entity) : esc(entity.notes);

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
    ${entity.notes ? `<div class="detail-section"><h2>Notes</h2><p class="detail-prose">${notesContent}</p></div>` : ''}
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
    </div>
  `;
}

function renderGraph(container, seriesId) {
  const series = LoreLoader.getSeriesById(seriesId);
  if (!series) { renderNotFound(container); return; }

  container.innerHTML = `
    <div class="page-header">
      <div class="breadcrumb">
        <a href="#/">Home</a> &rsaquo;
        <span class="series-label">${esc(series.name)}</span> &rsaquo;
        Relationship Graph
      </div>
      <h1>Relationship Graph</h1>
    </div>
    <div class="graph-wrap">
      <div id="graph-container"></div>
      <p class="graph-hint">Scroll to zoom &nbsp;·&nbsp; Drag to pan &nbsp;·&nbsp; Click a character to view their page</p>
    </div>
  `;

  LoreGraph.init(document.getElementById('graph-container'), seriesId);
}

function renderNotFound(container) {
  container.innerHTML = `
    <div class="page-header"><h1>Page not found</h1></div>
    <p><a href="#/">← Back to home</a></p>
  `;
}

// ── Search ────────────────────────────────────────────────────────────────────

function getSearchQuery() {
  const hash = window.location.hash;
  const qIndex = hash.indexOf('?q=');
  if (qIndex === -1) return '';
  return decodeURIComponent(hash.substring(qIndex + 3));
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
      const newHash = q ? '#/search?q=' + encodeURIComponent(q) : '#/search';
      if (window.location.hash !== newHash) {
        history.replaceState(null, '', newHash);
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

// ── Reader Position Picker ────────────────────────────────────────────────────

let readerPickerInitialized = false;

function initReaderPositionPicker() {
  if (readerPickerInitialized) return;

  const series = LoreLoader.getSeries();
  if (!series.length) return;

  // Single-series for now; multi-series support can be added later.
  const seriesId = series[0].id;
  const books = LoreLoader.getAll(seriesId, 'books')
    .slice()
    .sort((a, b) => (a.chronological_order || 0) - (b.chronological_order || 0));

  if (!books.length) return;

  const bar         = document.getElementById('reader-position-bar');
  const bookSelect  = document.getElementById('rp-book');
  const chapSelect  = document.getElementById('rp-chapter');
  const clearBtn    = document.getElementById('rp-clear');
  const statusEl    = document.getElementById('rp-status');

  if (!bar || !bookSelect || !chapSelect || !clearBtn || !statusEl) return;

  // Populate book dropdown
  bookSelect.innerHTML = '<option value="">— Select a book —</option>';
  for (const book of books) {
    const opt = document.createElement('option');
    opt.value = String(book.chronological_order);
    opt.textContent = `${book.chronological_order}. ${book.title}`;
    bookSelect.appendChild(opt);
  }

  // Restore saved position
  const saved = SpoilerGate.getPosition(seriesId);
  if (saved) {
    bookSelect.value = String(saved.book);
    populateChapters(saved.book, books, chapSelect);
    chapSelect.disabled = false;
    chapSelect.value = String(saved.chapter);
    rpUpdateStatus(saved, books, statusEl);
  }

  // Book change → repopulate chapters, auto-set ch. 1, save
  bookSelect.addEventListener('change', () => {
    const bookNum = parseInt(bookSelect.value, 10);
    if (isNaN(bookNum)) {
      chapSelect.innerHTML = '<option value="">Ch. —</option>';
      chapSelect.disabled = true;
      SpoilerGate.clearPosition(seriesId);
      statusEl.textContent = '';
      return;
    }
    populateChapters(bookNum, books, chapSelect);
    chapSelect.disabled = false;
    chapSelect.value = '1';
    SpoilerGate.setPosition(seriesId, bookNum, 1);
    rpUpdateStatus({ book: bookNum, chapter: 1 }, books, statusEl);
  });

  // Chapter change → save
  chapSelect.addEventListener('change', () => {
    const bookNum    = parseInt(bookSelect.value, 10);
    const chapterNum = parseInt(chapSelect.value, 10);
    if (isNaN(bookNum) || isNaN(chapterNum)) return;
    SpoilerGate.setPosition(seriesId, bookNum, chapterNum);
    rpUpdateStatus({ book: bookNum, chapter: chapterNum }, books, statusEl);
  });

  // Clear → reset to ungated
  clearBtn.addEventListener('click', () => {
    SpoilerGate.clearPosition(seriesId);
    bookSelect.value = '';
    chapSelect.innerHTML = '<option value="">Ch. —</option>';
    chapSelect.disabled = true;
    statusEl.textContent = '';
  });

  bar.hidden = false;
  readerPickerInitialized = true;
}

function populateChapters(bookNum, books, chapSelect) {
  const book  = books.find(b => b.chronological_order === bookNum);
  const count = book ? SpoilerGate.getChapterCount(book) : 20;
  chapSelect.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Ch. ${i}`;
    chapSelect.appendChild(opt);
  }
}

function rpUpdateStatus(pos, books, statusEl) {
  const book = books.find(b => b.chronological_order === pos.book);
  const title = book ? book.title : `Book ${pos.book}`;
  statusEl.textContent = `Gating: ${title}, Ch. ${pos.chapter}`;
}

// ── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('hashchange', onRouteChange);
window.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hash || window.location.hash === '#') {
    window.location.hash = '#/';
  }
  onRouteChange();
});
