/**
 * views.js — Nav state + all page/entity-detail render functions and view helpers
 * Part of The Lore Atlas SPA (split from app.js, Session 13.5).
 */

// ── Nav active state ─────────────────────────────────────────────────────────

function updateNavActive(parts) {
  document.querySelectorAll('#site-nav a').forEach(a => a.classList.remove('active'));
  if (parts.length === 0) {
    const homeLink = document.querySelector('#site-nav a[href="/"]');
    if (homeLink) homeLink.classList.add('active');
  }
}

// ── Mobile nav toggle (hamburger, ≤768px) ───────────────────────────────────

let navToggleInitialized = false;

function initNavToggle() {
  if (navToggleInitialized) return;
  const toggle = document.getElementById('nav-toggle');
  const nav    = document.getElementById('site-nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const isOpen = document.body.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Close on link click (route change also closes it, but a click on the
  // already-active link doesn't trigger a route change).
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) closeNavMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNavMenu();
  });

  navToggleInitialized = true;
}

function closeNavMenu() {
  document.body.classList.remove('nav-open');
  const toggle = document.getElementById('nav-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
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
        <a class="entity-type-card" href="${entityListPath(s.id, et.key)}">
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
        <a href="/">Home</a> &rsaquo; <span class="series-label">${esc(series.name)}</span> &rsaquo; ${etConfig.label}
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
  return `<a href="${entityPath(seriesId, type, id)}">${esc(displayName)}</a>`;
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

// ── Detail-section builders ───────────────────────────────────────────────────
//
// The eight render*Detail functions below are assembled from these four pieces.
// Keeping the markup in one place means a change to section chrome (or to how
// redaction is applied) lands everywhere at once.

/**
 * A prose field's value with spoiler redaction applied: the escaped,
 * currently-visible segments (Session 13.9 staged prose), or the redaction
 * placeholder when the entity is only partially revealed. When segments are
 * withheld by reading position, appends a "[More after Book X, Ch. Y]" hint.
 */
function proseValue(entity, status, field) {
  if (status === 'partial') return redactedProse(entity);
  const { text, nextFrom } = proseText(entity, field, entity.series);
  let html = esc(text);
  if (nextFrom) {
    html += ` <span class="prose-more">[More after Book ${esc(nextFrom.book)}, Ch. ${esc(nextFrom.chapter)}]</span>`;
  }
  return html;
}

/**
 * Prose detail section. Renders nothing when the field is empty.
 */
function proseSection(label, entity, status, field) {
  if (!entity[field]) return '';
  return `<div class="detail-section"><h2>${label}</h2><p class="detail-prose">${proseValue(entity, status, field)}</p></div>`;
}

/**
 * Detail section wrapping a list of cross-referenced entity links.
 */
function linkSection(label, ids) {
  return `<div class="detail-section"><h2>${label}</h2><div class="detail-links">${renderLinkedList(ids)}</div></div>`;
}

/**
 * Detail section wrapping a single cross-referenced entity link.
 */
function singleLinkSection(label, id) {
  return `<div class="detail-section"><h2>${label}</h2><div class="detail-links"><span class="detail-link-item">${entityLink(id)}</span></div></div>`;
}

/**
 * The "First appears / Full reveal" footer shown on gated entity details.
 * `extra` appends type-specific rows (e.g. a case's timeline position).
 */
function thresholdFooter(entity, extra = '') {
  return `
    <div class="spoiler-thresholds">
      <span>First appears: ${esc(formatSpoiler(entity.first_mention))}</span>
      <span>Full reveal: ${esc(formatSpoiler(entity.full_reveal))}</span>
      ${extra}
    </div>
  `;
}

// ── Mini-graph (Session 15) ───────────────────────────────────────────────────

// Characters, cases and locations get a "Connections" graph: the one-hop network
// around the entity, only when the gated network has at least 3 nodes (else the
// section is left out, with no empty state). The section's markup is built by
// connectionsSection(); mountMiniGraph() runs after the detail HTML is in the DOM.
const MINI_GRAPH_MIN_NODES = 3;

function connectionsSection(entity, entityType) {
  if (!['characters', 'cases', 'locations'].includes(entityType)) return '';
  if (LoreGraph.egoNodeCount(entity.series, entity.id) < MINI_GRAPH_MIN_NODES) return '';
  const layers = entityType === 'cases' ? '&layers=cases' : entityType === 'locations' ? '&layers=locations' : '';
  const href = `/${encodeURIComponent(entity.series)}/graph/?selected=${encodeURIComponent(entity.id)}${layers}`;
  return `
    <div class="detail-section detail-connections" aria-label="Connections graph">
      <h2>Connections</h2>
      <div class="mini-graph" data-focus-id="${esc(entity.id)}"></div>
      <p class="mini-graph-link"><a href="${esc(href)}">Open in full graph &rarr;</a> <span class="mini-graph-hint">&middot; Pinch or Ctrl/&#8984; + scroll to zoom</span></p>
    </div>`;
}

function mountMiniGraph(container, seriesId) {
  const el = container.querySelector('.mini-graph');
  if (!el) return;
  LoreGraph.init(el, seriesId, {
    layerControls: false,
    syncUrl: false,
    focusId: el.dataset.focusId,
    height: () => (window.matchMedia('(max-width: 767px)').matches ? 300 : 360),
  });
}

// ── Entity detail ─────────────────────────────────────────────────────────────

function renderEntityDetail(container, seriesId, entityType, id) {
  const entity = LoreLoader.getById(id);
  if (!entity) { renderNotFound(container); return; }

  const status = SpoilerGate.getRevealStatus(entity, seriesId);
  const etConfig = ENTITY_TYPES.find(e => e.key === entityType);
  const typeLabel = etConfig ? etConfig.label : esc(entityType);
  const listHref = entityListPath(seriesId, entityType);

  // Entity is before the reader's current position — don't reveal anything.
  if (status === 'hidden') {
    container.innerHTML = `
      <div class="page-header">
        <div class="breadcrumb">
          <a href="/">Home</a> &rsaquo;
          <a href="${listHref}">${typeLabel}</a>
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

  const breadcrumb = `
    <div class="page-header">
      <div class="breadcrumb">
        <a href="/">Home</a> &rsaquo;
        <a href="${listHref}">${typeLabel}</a> &rsaquo;
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
  mountMiniGraph(container, seriesId);
}

function renderCharacterDetail(entity, status) {
  const aliasList = aliasNames(entity, entity.series);
  const aliases = aliasList.length
    ? aliasList.map(a => esc(a)).join(', ')
    : '<span class="detail-none">None</span>';

  const tags = entity.tags && entity.tags.length
    ? `<div class="detail-tags">${entity.tags.map(t => `<span class="detail-tag">${esc(t)}</span>`).join('')}</div>`
    : '';

  return `
    <div class="detail-meta">
      ${entity.role ? `<span class="badge badge-${esc(entity.role.replace(/_/g, '-'))}">${esc(entity.role.replace(/_/g, ' '))}</span>` : ''}
      ${entity.status === 'deceased' ? '<span class="badge badge-deceased">deceased</span>' : ''}
    </div>
    ${proseSection('Biography', entity, status, 'biography')}
    ${connectionsSection(entity, 'characters')}
    <div class="detail-section"><h2>Also Known As</h2><p class="detail-prose">${aliases}</p></div>
    ${linkSection('Affiliations', entity.affiliations)}
    ${linkSection('Cases', entity.cases)}
    ${linkSection('Relationships', entity.relationships)}
    ${tags ? `<div class="detail-section"><h2>Tags</h2>${tags}</div>` : ''}
    ${thresholdFooter(entity)}
  `;
}

function renderCaseDetail(entity, status) {
  // Gated like prose (D4, Session 13.7): notable elements can name spoilers
  // (e.g. Sign of Four's list names Jonathan Small), so redact them while
  // the case is only partially revealed, same as any other prose field.
  let notableElements;
  if (status === 'partial') {
    notableElements = `<p class="detail-prose">${redactedProse(entity)}</p>`;
  } else {
    notableElements = entity.notable_elements && entity.notable_elements.length
      ? `<ul class="detail-list">${entity.notable_elements.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`
      : '<span class="detail-none">None</span>';
  }

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
    ${proseSection('Synopsis', entity, status, 'synopsis')}
    ${connectionsSection(entity, 'cases')}
    ${solutionSection}
    ${linkSection('Characters Involved', entity.characters_involved)}
    ${linkSection('Locations', entity.locations)}
    ${linkSection('Artifacts', entity.artifacts_involved)}
    <div class="detail-section"><h2>Notable Elements</h2>${notableElements}</div>
    ${thresholdFooter(entity, entity.timeline_position ? `<span>Timeline position: ${esc(formatSpoiler(entity.timeline_position))}</span>` : '')}
  `;
}

function renderBookDetail(entity, status) {
  return `
    <div class="detail-meta">
      ${entity.type === 'novel' ? '<span class="badge badge-novel">novel</span>' : ''}
      ${entity.type === 'short_story_collection' ? '<span class="badge badge-collection">collection</span>' : ''}
      ${entity.publication_year ? `<span class="detail-meta-item">${esc(String(entity.publication_year))}</span>` : ''}
      ${entity.chronological_order ? `<span class="detail-meta-item">Vol. ${esc(String(entity.chronological_order))}</span>` : ''}
    </div>
    ${proseSection('Description', entity, status, 'description')}
    ${linkSection('Stories Contained', entity.stories_contained)}
  `;
}

function renderFactionDetail(entity, status) {
  return `
    <div class="detail-meta">
      ${entity.type ? `<span class="badge badge-faction">${esc(entity.type.replace(/_/g, ' '))}</span>` : ''}
      ${entity.alignment ? `<span class="detail-meta-item">${esc(entity.alignment)}</span>` : ''}
      ${entity.active_period ? `<span class="detail-meta-item">${esc(entity.active_period)}</span>` : ''}
    </div>
    ${proseSection('Description', entity, status, 'description')}
    ${linkSection('Key Members', entity.key_members)}
    ${linkSection('Cases Involved', entity.cases_involved)}
    ${entity.parent_org ? singleLinkSection('Parent Organization', entity.parent_org) : ''}
    ${entity.child_orgs && entity.child_orgs.length ? linkSection('Sub-Organizations', entity.child_orgs) : ''}
    ${thresholdFooter(entity)}
  `;
}

function renderLocationDetail(entity, status) {
  return `
    <div class="detail-meta">
      ${entity.type ? `<span class="detail-meta-item">${esc(entity.type)}</span>` : ''}
      ${entity.real_world_basis ? `<span class="detail-meta-item detail-real-world">Real world: ${esc(entity.real_world_basis)}</span>` : ''}
    </div>
    ${proseSection('Description', entity, status, 'description')}
    ${connectionsSection(entity, 'locations')}
    ${linkSection('Associated Characters', entity.characters_associated)}
    ${linkSection('Cases Occurring Here', entity.cases_occurring_here)}
    ${thresholdFooter(entity)}
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

  return `
    <div class="detail-meta">
      ${entity.type ? `<span class="detail-meta-item">${esc(entity.type)}</span>` : ''}
    </div>
    ${proseSection('Description', entity, status, 'description')}
    ${proseSection('Significance', entity, status, 'significance')}
    <div class="detail-section"><h2>Ownership Chain</h2><div class="ownership-chain">${ownershipChain}</div></div>
    ${linkSection('Appears In', entity.appearance_history)}
    ${thresholdFooter(entity)}
  `;
}

function renderEventDetail(entity, status) {
  return `
    <div class="detail-meta">
      ${entity.event_type ? `<span class="badge badge-event-${esc(entity.event_type)}">${esc(entity.event_type)}</span>` : ''}
      ${entity.date_or_position ? `<span class="detail-meta-item">${esc(entity.date_or_position)}</span>` : ''}
    </div>
    ${proseSection('Description', entity, status, 'description')}
    ${linkSection('Characters Involved', entity.characters_involved)}
    ${linkSection('Cases Linked', entity.cases_linked)}
    ${entity.location ? singleLinkSection('Location', entity.location) : ''}
    ${thresholdFooter(entity)}
  `;
}

function renderRelationshipDetail(entity, status) {
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
    ${entity.first_established ? singleLinkSection('First Established', entity.first_established) : ''}
    ${proseSection('Notes', entity, status, 'notes')}
    ${thresholdFooter(entity)}
  `;
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

function renderGraph(container, seriesId) {
  const series = LoreLoader.getSeriesById(seriesId);
  if (!series) { renderNotFound(container); return; }

  container.innerHTML = `
    <a class="skip-link" href="#graph-after">Skip past the graph</a>
    <div class="page-header">
      <div class="breadcrumb">
        <a href="/">Home</a> &rsaquo;
        <span class="series-label">${esc(series.name)}</span> &rsaquo;
        Relationship Graph
      </div>
      <h1>Relationship Graph</h1>
    </div>
    <div class="graph-view-toggle" role="group" aria-label="Graph view">
      <button type="button" data-mode="graph" aria-pressed="true">Graph</button>
      <button type="button" data-mode="list" aria-pressed="false">List</button>
    </div>
    <div class="graph-wrap">
      <div id="graph-container"></div>
      <p class="graph-hint" id="graph-after" tabindex="-1">
        <span class="hint-coarse">Pinch to zoom &nbsp;·&nbsp; Drag to pan &nbsp;·&nbsp; Tap a node for details</span>
        <span class="hint-fine">Scroll to zoom &nbsp;·&nbsp; Drag to pan &nbsp;·&nbsp; Click any node for details</span>
      </p>
    </div>
    <div class="graph-list-view" hidden></div>
  `;

  // A fragment navigation would fire popstate, and the router re-renders on
  // popstate: focus the target by hand instead.
  const skip = container.querySelector('.skip-link');
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.getElementById('graph-after');
    if (target) target.focus();
  });

  const wrap = container.querySelector('.graph-wrap');
  const listEl = container.querySelector('.graph-list-view');
  const graphContainer = document.getElementById('graph-container');
  const buttons = [...container.querySelectorAll('.graph-view-toggle button')];
  const wide = window.matchMedia('(min-width: 768px)');
  let mode = readGraphViewMode(); // 'graph' | 'list'; list applies only below 768px
  let controller = null;
  let initialized = false;

  const listActive = () => mode === 'list' && !wide.matches;

  // The graph is built lazily: a page that opens in list mode doesn't pay for it
  // until the reader switches to Graph or the viewport reaches 768px.
  function showGraph() {
    const wasHidden = wrap.hidden;
    listEl.hidden = true;
    wrap.hidden = false;
    skip.hidden = false;
    if (!initialized) {
      initialized = true;
      controller = LoreGraph.init(graphContainer, seriesId) || null;
    } else if (wasHidden && controller) {
      controller.relayout(); // a rotation while hidden measured 0
    }
  }

  function showList() {
    if (controller && controller.getSelectedEntityId()) controller.closePanel({ restoreFocus: false });
    wrap.hidden = true;
    skip.hidden = true;
    listEl.hidden = false;
    listEl.innerHTML = graphListHtml(seriesId);
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

