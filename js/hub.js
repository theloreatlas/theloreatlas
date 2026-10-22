/**
 * hub.js — The universe hub: hero, graph panel and section tiles.
 * Part of The Lore Atlas SPA (redesign Phase 5).
 *
 * The hero graph and the eight tile thumbnails are static SVG drawn from
 * LoreGraph.buildData(), the same spoiler-gated data the full graph page uses.
 * Entities past the bookmark never reach this file as objects: buildData()
 * returns only their count, and they are drawn as anonymous dots.
 */

// ── Modes ────────────────────────────────────────────────────────────────────

// One per tile, in tile order. `build` is the LoreGraph.buildData() option set;
// `label` is the hero panel's heading (the design's voice); `noun` follows the
// count; `section` is the entity-list route the "Open ..." link goes to.
const HUB_MODES = [
  { key: 'characters',    title: 'Characters',    label: "Who you've met",       noun: 'people',  section: 'characters',
    build: { characters: 'all' } },
  { key: 'cases',         title: 'Cases',         label: 'Cases opened',         noun: 'entries', section: 'cases',
    build: { characters: 'linked', layers: ['cases'] },     kind: 'layer' },
  { key: 'locations',     title: 'Locations',     label: 'Places visited',       noun: 'places',  section: 'locations',
    build: { characters: 'linked', layers: ['locations'] }, kind: 'layer' },
  { key: 'artifacts',     title: 'Artifacts',     label: 'Objects seen',         noun: 'entries', section: 'artifacts',
    build: { characters: 'linked', layers: ['artifacts'] }, kind: 'layer' },
  { key: 'factions',      title: 'Factions',      label: 'Groups encountered',   noun: 'entries', section: 'factions',
    build: { characters: 'linked', layers: ['factions'] },  kind: 'layer' },
  { key: 'timeline',      title: 'Timeline',      label: 'Events so far',        noun: 'events',  section: 'events',
    build: { characters: 'linked', events: true },          kind: 'layer' },
  { key: 'relationships', title: 'Relationships', label: "How they're connected", noun: 'people', section: 'relationships',
    build: { characters: 'all' }, colored: true, layoutAs: 'characters' },
  { key: 'graph',         title: 'Graph',         label: 'Everything so far',    noun: 'entries', section: 'graph',
    build: { characters: 'all', layers: ['cases', 'locations', 'artifacts', 'factions'], anchors: 'config' }, kind: 'all' },
];

// Tile blurbs. Per series, with generic fallbacks, so a new universe works
// without touching this file (a function gets the series id and returns text).
const HUB_COPY = {
  sherlock_holmes: {
    characters:    'Everyone Holmes and Watson meet',
    cases:         (sid) => `All ${LoreLoader.getAll(sid, 'cases').length} stories, solutions sealed`,
    locations:     'From Baker Street to the moor',
    artifacts:     'Treasures, ciphers and evidence',
    factions:      'Gangs, agencies and secret societies',
    timeline:      'Events in story order',
    relationships: 'Who knows whom, and how',
    graph:         'The whole network, mapped',
  },
};
const HUB_COPY_GENERIC = {
  characters:    'The people of the universe',
  cases:         'Every case, solutions sealed',
  locations:     'The places that matter',
  artifacts:     'Objects of note',
  factions:      'Groups and organisations',
  timeline:      'Events in story order',
  relationships: 'Who knows whom, and how',
  graph:         'The whole network, mapped',
};

function hubTileCopy(seriesId, key) {
  const v = (HUB_COPY[seriesId] || {})[key] || HUB_COPY_GENERIC[key];
  return typeof v === 'function' ? v(seriesId) : v;
}

// The selected tile. Module state, so it survives a bookmark change (which
// re-renders the route).
let hubModeKey = 'characters';

// ── Cache ────────────────────────────────────────────────────────────────────

// Data and layouts are built once per series and bookmark. A bookmark change
// re-renders the route with a new key and starts a fresh cache. Layouts do not
// depend on the theme (colours come from CSS), so a theme switch needs nothing.
const hubCache = { key: null, data: {}, layouts: {} };

function hubCacheFor(seriesId) {
  const pos = SpoilerGate.getPosition(seriesId);
  const key = seriesId + '|' + (pos ? pos.book + '.' + pos.chapter : '-');
  if (hubCache.key !== key) { hubCache.key = key; hubCache.data = {}; hubCache.layouts = {}; }
  return hubCache;
}

function hubData(seriesId, mode) {
  const c = hubCacheFor(seriesId);
  const k = mode.layoutAs || mode.key;
  if (!c.data[k]) c.data[k] = LoreGraph.buildData(seriesId, mode.build);
  return c.data[k];
}

// Simulation-space positions: a wide aspect for the hero panel, a wider one for
// the thumbnails.
function hubPositions(seriesId, mode, aspect, ticks) {
  const c = hubCacheFor(seriesId);
  const k = (mode.layoutAs || mode.key) + '@' + aspect;
  if (!c.layouts[k]) c.layouts[k] = LoreGraph.layoutStatic(hubData(seriesId, mode), { aspect, ticks });
  return c.layouts[k];
}

// ── Fit and labels ───────────────────────────────────────────────────────────

const HUB_LABEL_CHAR_W = 6.2;   // approx. width of a 12px Outfit character
const HUB_LABEL_MAX_W  = 150;
const HUB_LABEL_GAP    = 6;
const HUB_DOT_R        = 3;     // unreached dots: 6px across
const HUB_HERO = { rLo: 4,   rHi: 9, pad: 22, maxScale: 2.2, labels: true,  gap: HUB_LABEL_GAP };
const HUB_THUMB = { rLo: 2.4, rHi: 5.4, pad: 10, maxScale: 1.1, labels: false, gap: 0 };

// Fit the simulation positions into W x H and decide which labels fit. Labels
// go right of the node (left at the edge), most-connected first, and a label
// that would overlap another label or node is left out: the node stays, as a
// link with the same accessible name.
function hubFit(data, pos, W, H, o) {
  const items = data.nodes.map(n => ({ n, p: pos.get(n.id) })).filter(i => i.p);
  if (!items.length) return { nodes: [], links: [], avoid: [] };

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const { p } of items) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const labelW = n => Math.min(HUB_LABEL_MAX_W, n.name.length * HUB_LABEL_CHAR_W);
  const labelRoom = o.labels ? Math.max(...items.map(i => labelW(i.n))) * 0.5 : 0;
  const availW = W - 2 * o.pad - 2 * o.rHi - labelRoom;
  const availH = H - 2 * o.pad - 2 * o.rHi;
  const s = Math.min(o.maxScale, availW / Math.max(1, x1 - x0), availH / Math.max(1, y1 - y0));
  const ox = W / 2 - s * (x0 + x1) / 2;
  const oy = H / 2 - s * (y0 + y1) / 2;

  const maxDeg = Math.max(1, ...items.map(i => i.n.degree));
  const nodes = items.map(({ n, p }) => ({
    n, x: ox + s * p.x, y: oy + s * p.y, r: LoreGraph.radiusFor(n.degree, maxDeg, o.rLo, o.rHi), label: null,
  }));
  const byId = new Map(nodes.map(d => [d.n.id, d]));
  const links = data.links
    .map(l => ({ a: byId.get(l.source), b: byId.get(l.target), l }))
    .filter(e => e.a && e.b);

  const avoid = nodes.map(d => ({ x0: d.x - d.r - 5, x1: d.x + d.r + 5, y0: d.y - d.r - 5, y1: d.y + d.r + 5 }));
  if (o.labels) {
    const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    const placed = [];
    const order = nodes.slice().sort((a, b) => b.n.degree - a.n.degree || a.n.name.localeCompare(b.n.name));
    for (const d of order) {
      const w = labelW(d.n);
      const right = { x0: d.x + d.r + o.gap, x1: d.x + d.r + o.gap + w, y0: d.y - 8, y1: d.y + 8 };
      const left  = { x0: d.x - d.r - o.gap - w, x1: d.x - d.r - o.gap, y0: d.y - 8, y1: d.y + 8 };
      for (const [rect, anchor] of [[right, 'start'], [left, 'end']]) {
        if (rect.x0 < 4 || rect.x1 > W - 4 || rect.y0 < 2 || rect.y1 > H - 2) continue;
        if (placed.some(q => hit(rect, q))) continue;
        if (nodes.some((m, i) => m !== d && hit(rect, avoid[i]))) continue;
        d.label = { x: anchor === 'start' ? rect.x0 : rect.x1, y: d.y, anchor };
        placed.push(rect);
        break;
      }
    }
    avoid.push(...placed);
  }
  return { nodes, links, avoid };
}

// ── SVG ──────────────────────────────────────────────────────────────────────

// Tone names drive node colours in CSS (data-tone on the node).
function hubTone(n) {
  // Entity-type colour, as on the full graph: protagonists brighter gold.
  if (n.kind === 'character') return n.role === 'protagonist' ? 'protagonist' : 'character';
  return { cases: 'case', locations: 'location', artifacts: 'artifact', factions: 'faction', events: 'event' }[n.layer] || 'character';
}

const hubNum = (v) => Math.round(v * 10) / 10;

function hubDotsSvg(count, W, H, avoid) {
  const pts = LoreGraph.scatterDots(count, { x0: 8, y0: 8, x1: W - 8, y1: H - 8 }, avoid);
  // Nothing but a position: no id, name, class, title, link or tabindex.
  return `<g class="hub-unreached" aria-hidden="true">${pts.map(p =>
    `<circle cx="${hubNum(p.x)}" cy="${hubNum(p.y)}" r="${HUB_DOT_R}"/>`).join('')}</g>`;
}

function hubEdgesSvg(fit, colored) {
  return `<g class="hub-edges">${fit.links.map(({ a, b, l }) => {
    const rel = colored && !l.layer ? ` data-rel="${esc(relTypeGroup(l.type))}"` : '';
    return `<line class="hub-edge${rel ? ' hub-edge-rel' : ''}"${rel} x1="${hubNum(a.x)}" y1="${hubNum(a.y)}" x2="${hubNum(b.x)}" y2="${hubNum(b.y)}"/>`;
  }).join('')}</g>`;
}

// Hero nodes: links to the entry (the SPA hook below navigates them). A node
// whose label was left out keeps its accessible name.
function hubNodesSvg(fit, seriesId) {
  return `<g class="hub-nodes">${fit.nodes.map(d => {
    const n = d.n;
    const href = entityPath(seriesId, guessEntityType(n.id), n.id);
    const glow = n.role === 'protagonist' ? `<circle class="hub-glow" r="${hubNum(d.r + 4)}"/>` : '';
    const text = d.label
      ? `<text class="hub-label" x="${hubNum(d.label.x - d.x)}" y="0" dy="0.35em" text-anchor="${d.label.anchor}">${esc(n.name)}</text>` : '';
    return `<a class="hub-node" data-tone="${esc(hubTone(n))}" href="${esc(href)}" aria-label="${esc(n.name)}" transform="translate(${hubNum(d.x)} ${hubNum(d.y)})">`
      + glow
      + `<circle class="hub-focus" r="${hubNum(d.r + 4)}"/>`
      + `<circle class="hub-shape" r="${hubNum(d.r)}"/>`
      + text
      + `</a>`;
  }).join('')}</g>`;
}

function hubThumbNodesSvg(fit) {
  return `<g>${fit.nodes.map(d =>
    `<circle class="hub-shape" data-tone="${esc(hubTone(d.n))}" cx="${hubNum(d.x)}" cy="${hubNum(d.y)}" r="${hubNum(d.r)}"/>`).join('')}</g>`;
}

const HUB_THUMB_W = 248;
const HUB_THUMB_H = 112;
const HUB_THUMB_DOTS = 30; // a thumbnail needs the texture, not the whole count

function hubThumbSvg(seriesId, mode) {
  const data = hubData(seriesId, mode);
  const fit = hubFit(data, hubPositions(seriesId, mode, 2.2, 220), HUB_THUMB_W, HUB_THUMB_H, HUB_THUMB);
  return `<svg class="hub-thumb" viewBox="0 0 ${HUB_THUMB_W} ${HUB_THUMB_H}" preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false">`
    + hubDotsSvg(Math.min(data.hiddenCount, HUB_THUMB_DOTS), HUB_THUMB_W, HUB_THUMB_H, fit.avoid)
    + hubEdgesSvg(fit, mode.colored)
    + hubThumbNodesSvg(fit)
    + `</svg>`;
}

// ── Hero panel ───────────────────────────────────────────────────────────────

function hubCount(mode, data, seriesId) {
  const n = mode.kind === 'all' ? data.nodes.length
    : data.nodes.filter(x => x.kind === (mode.kind || 'character')).length;
  if (!SpoilerGate.getPosition(seriesId)) return `All ${n} ${mode.noun}`;
  return mode.noun === 'people' ? `${n} people met so far` : `${n} ${mode.noun} so far`;
}

function hubLegendHtml(data) {
  const present = new Set(data.links.filter(l => !l.layer).map(l => relTypeGroup(l.type)));
  const items = REL_GROUPS.filter(g => present.has(g.key));
  if (!items.length) return '';
  return `<ul class="hub-legend" aria-label="Relationship colors">${items.map(g =>
    `<li><span class="hub-legend-line" data-rel="${esc(g.key)}" aria-hidden="true"></span>${esc(g.label)}</li>`).join('')}</ul>`;
}

// Draws the hero graph into `body` at its current size.
function hubDrawHero(body, seriesId, mode) {
  const W = Math.round(body.clientWidth) || 600;
  const H = Math.round(body.clientHeight) || 420;
  const data = hubData(seriesId, mode);
  const fit = hubFit(data, hubPositions(seriesId, mode, 1.4, 300), W, H, HUB_HERO);
  const hidden = data.hiddenCount;
  const empty = fit.nodes.length === 0;
  body.innerHTML =
    `<svg class="hub-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(mode.label)}: graph of what you have reached">`
    + hubDotsSvg(hidden, W, H, fit.avoid)
    + hubEdgesSvg(fit, mode.colored)
    + hubNodesSvg(fit, seriesId)
    + `</svg>`
    + (empty ? '<p class="hub-empty">Nothing here yet at your bookmark.</p>' : '')
    + (mode.colored ? hubLegendHtml(data) : '')
    + (hidden ? `<p class="visually-hidden">${hidden} more ${hidden === 1 ? 'entry is' : 'entries are'} past your bookmark and drawn as unlabeled dots.</p>` : '');
}

function hubSectionHref(seriesId, mode) {
  return mode.section === 'graph' ? `/${encodeURIComponent(seriesId)}/graph/` : entityListPath(seriesId, mode.section);
}

// ── Page ─────────────────────────────────────────────────────────────────────

function renderHome(container, seriesId) {
  const series = seriesId ? LoreLoader.getSeriesById(seriesId) : LoreLoader.getSeries()[0];
  if (!series) { renderNotFound(container); return; }
  const sid = series.id;
  const sidEnc = encodeURIComponent(sid);
  const words = String(series.name).trim().split(/\s+/).map(esc).join('<br>');

  const tiles = HUB_MODES.map((m, i) => `
    <button type="button" class="hub-tile" data-mode="${esc(m.key)}" aria-pressed="false">
      ${hubThumbSvg(sid, m)}
      <span class="hub-tile-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="hub-tile-title">${esc(m.title)}</span>
      <span class="hub-tile-desc">${esc(hubTileCopy(sid, m.key))}</span>
    </button>`).join('');

  container.innerHTML = `
    <div class="hub">
      <section class="hub-hero">
        <div class="hub-copy">
          <h1>${words}</h1>
          ${series.description ? `<p class="hub-desc">${esc(series.description)}</p>` : ''}
          <div class="hub-actions">
            <a class="btn btn-primary" href="${entityListPath(sid, 'characters')}">Enter the atlas</a>
            <a class="btn btn-secondary" href="/${sidEnc}/graph/">Open the graph</a>
          </div>
        </div>
        <div class="hub-panel">
          <div class="hub-panel-head">
            <h2 class="label hub-mode-label"></h2>
            <p class="hub-count" aria-live="polite"></p>
            <a class="hub-open" href="#"></a>
          </div>
          <div class="hub-panel-body"></div>
        </div>
      </section>
      <section class="hub-tiles" aria-label="Sections of the atlas">${tiles}</section>
    </div>`;

  const labelEl = container.querySelector('.hub-mode-label');
  const countEl = container.querySelector('.hub-count');
  const openEl = container.querySelector('.hub-open');
  const body = container.querySelector('.hub-panel-body');
  const tileEls = [...container.querySelectorAll('.hub-tile')];
  let drawnW = 0;

  function show(key) {
    const mode = HUB_MODES.find(m => m.key === key) || HUB_MODES[0];
    hubModeKey = mode.key;
    for (const t of tileEls) t.setAttribute('aria-pressed', String(t.dataset.mode === mode.key));
    labelEl.textContent = mode.label;
    countEl.textContent = hubCount(mode, hubData(sid, mode), sid);
    openEl.textContent = `Open ${mode.title.toLowerCase()} →`;
    openEl.setAttribute('href', hubSectionHref(sid, mode));
    hubDrawHero(body, sid, mode);
    drawnW = Math.round(body.clientWidth);
    // The fade-in on a mode change (the design allows 300ms).
    body.classList.remove('is-fresh');
    void body.offsetWidth;
    body.classList.add('is-fresh');
  }

  for (const t of tileEls) t.addEventListener('click', () => show(t.dataset.mode));

  // Node links are SVG <a>s, which the global link hook skips (an SVG anchor's
  // .target is not a string), so route them here.
  body.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.hub-node');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });

  show(hubModeKey);

  // Redraw when the panel's width changes (a rotation, the stacked layout).
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (!body.isConnected) { ro.disconnect(); return; }
      const w = Math.round(body.clientWidth);
      if (w && w !== drawnW) { drawnW = w; hubDrawHero(body, sid, HUB_MODES.find(m => m.key === hubModeKey)); }
    });
    ro.observe(body);
  }
}
