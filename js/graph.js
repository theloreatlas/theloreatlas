/**
 * graph.js — Relationship graph for The Lore Atlas
 * D3.js v7 force-directed layout, spoiler-gated, characters only (Release 2).
 */

const LoreGraph = (() => {

  const REL_COLORS = {
    ally:         '#c4a55a',
    enemy:        '#8b2020',
    family:       '#6a8a5a',
    professional: '#4a6a8a',
    romantic:     '#8a5a6a',
    mentor:       '#a07030',
    other:        '#7a7060',
  };

  const ROLE_COLORS = {
    protagonist: '#c4a55a',
    antagonist:  '#8b2020',
    supporting:  '#4a6a8a',
    client:      '#6a8a5a',
  };

  function relColor(type) {
    return REL_COLORS[type] || REL_COLORS.other;
  }

  function nodeColor(role) {
    return ROLE_COLORS[role] || '#7a7060';
  }

  function nodeRadius(degree) {
    return Math.max(6, Math.min(20, 6 + degree * 1.5));
  }

  // Layer ids in canonical (URL, toolbar and legend) order. Session 14.
  const LAYER_ORDER = ['cases', 'locations', 'artifacts', 'factions'];

  // Per-layer config. Each layer's entities become nodes linked to characters
  // only (bipartite). `anchorEdges: false` hides the edges to protagonists
  // ("anchors"), which would otherwise hairball: Holmes is in every case. The
  // shape means colour is never the only signal; every colour is >= 4.3:1
  // against the graph background (#ede4d3).
  const LAYER_CONFIG = {
    cases:     { label: 'Cases',     singular: 'Case',     glyph: '■', shape: d3.symbolSquare,   color: '#6e5a8a', anchorEdges: false, descField: 'synopsis' },
    locations: { label: 'Locations', singular: 'Location', glyph: '◆', shape: d3.symbolDiamond,  color: '#3f7364', anchorEdges: false, descField: 'description' },
    artifacts: { label: 'Artifacts', singular: 'Artifact', glyph: '▲', shape: d3.symbolTriangle, color: '#9a5a22', anchorEdges: false, descField: 'description' },
    factions:  { label: 'Factions',  singular: 'Faction',  glyph: '★', shape: d3.symbolStar,     color: '#56602a', anchorEdges: true,  descField: 'description' },
  };
  const LAYER_SYMBOL_AREA = 80;
  const LAYER_COLLIDE_R   = 9;
  const RING_RADIUS_FRAC  = 0.42;  // ring radius = this x min(usable width, height)
  const RING_STRENGTH     = 0.3;
  const LAYER_EDGE_DIST   = 70;
  const ISOLATE_STRENGTH  = 0.08;  // pull toward the centre for nodes with no drawn links
  const EARLY_FIT_ALPHA   = 0.3;   // load only: first, un-eased fit below this alpha
  const RING_PAD          = 64;    // adaptive ring: p90 of the inner nodes' distance from the centre + this
  const RING_SMOOTH       = 0.1;   // adaptive ring: R moves this fraction of the way to its target each tick
  const FIT_PAD           = 24;    // zoom-to-fit padding (px)
  const FIT_MS            = 300;
  const LABEL_MIN_SCALE   = 0.5;   // below this zoom scale, non-anchor character labels are hidden
  const MAX_LAYER_CHIPS   = 5;     // character panel: chips shown per active layer

  function layerEntityName(e) {
    return e.name || e.title || e.id;
  }

  // first_mention comparator (a missing first_mention sorts first).
  function byFirstMention(a, b) {
    const fa = a.first_mention || { book: 0, chapter: 0 };
    const fb = b.first_mention || { book: 0, chapter: 0 };
    return (fa.book - fb.book) || (fa.chapter - fb.chapter);
  }

  // Reading order: first_mention, then name.
  function byReadingOrder(a, b) {
    return byFirstMention(a, b) || layerEntityName(a).localeCompare(layerEntityName(b));
  }

  // Dedupe, drop unknown ids and put the rest in canonical order.
  function canonicalLayers(list) {
    const wanted = new Set(list);
    return LAYER_ORDER.filter(l => wanted.has(l));
  }

  function readLayersParam() {
    const raw = new URLSearchParams(location.search).get('layers');
    return canonicalLayers(raw ? raw.split(',') : []);
  }

  // The one place the graph writes its query string. Merges into the existing
  // params (so ?layers= survives a ?selected= change and vice versa). Keys
  // absent from `patch` are left alone; `selected: null` or an empty `layers`
  // removes that param.
  function writeGraphQuery(patch) {
    const params = new URLSearchParams(location.search);
    if ('selected' in patch) {
      if (patch.selected) params.set('selected', patch.selected);
      else params.delete('selected');
    }
    if ('layers' in patch) {
      const layers = canonicalLayers(patch.layers || []);
      if (layers.length) params.set('layers', layers.join(','));
      else params.delete('layers');
    }
    const qs = [...params].map(([k, v]) =>
      encodeURIComponent(k) + '=' +
      (k === 'layers' ? v.split(',').map(encodeURIComponent).join(',') : encodeURIComponent(v))
    ).join('&');
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  // ── Ego network (Session 15) ─────────────────────────────────────────────
  //
  // The one-hop, induced network around one character, case or location, at the
  // reader's position. Gating is the main graph's: a node renders iff
  // SpoilerGate.isRevealed(), an edge iff both endpoints render. Anchors are
  // kept (no anchor suppression in ego mode). Returns null when the centre is
  // missing, hidden or not a character, case or location; otherwise
  //   { centre, layer, charIds, rels, layerLinks }
  // where `layer` is null for a character centre, `charIds` are the visible
  // characters in the view (the centre first, for a character centre), `rels`
  // the revealed relationships whose two ends are both in the view, and
  // `layerLinks` the centre's own links (case/location centres only).
  const EGO_TYPES = { char: null, case: 'cases', loc: 'locations' };

  function egoNetwork(seriesId, focusId) {
    const prefix = String(focusId || '').split('_')[0];
    if (!(prefix in EGO_TYPES)) return null;
    const centre = LoreLoader.getById(focusId);
    if (!centre || !SpoilerGate.isRevealed(centre, seriesId)) return null;

    const charOk = new Set(LoreLoader.getAll(seriesId, 'characters')
      .filter(c => SpoilerGate.isRevealed(c, seriesId)).map(c => c.id));
    const rels = LoreLoader.getAll(seriesId, 'relationships').filter(r =>
      SpoilerGate.isRevealed(r, seriesId) && charOk.has(r.character_a) && charOk.has(r.character_b));

    const layer = EGO_TYPES[prefix];
    let charIds;
    if (!layer) {
      if (!charOk.has(focusId)) return null;
      charIds = [focusId];
      for (const r of rels) {
        if (r.character_a === focusId) charIds.push(r.character_b);
        else if (r.character_b === focusId) charIds.push(r.character_a);
      }
    } else {
      const field = layer === 'cases' ? 'characters_involved' : 'characters_associated';
      charIds = (centre[field] || []).filter(id => charOk.has(id));
    }
    charIds = [...new Set(charIds)];
    const inView = new Set(charIds);
    return {
      centre,
      layer,
      charIds,
      rels: rels.filter(r => inView.has(r.character_a) && inView.has(r.character_b)),
      layerLinks: layer ? charIds.map(charId => ({ entityId: focusId, charId })) : [],
    };
  }

  // Nodes in the ego network (the centre counts, whatever its type), or 0.
  function egoNodeCount(seriesId, focusId) {
    const net = egoNetwork(seriesId, focusId);
    return net ? net.charIds.length + (net.layer ? 1 : 0) : 0;
  }

  // opts.layerControls (default true): whether the layer toolbar is shown.
  // opts.syncUrl (default true): false = nothing reads or writes `location`.
  // opts.focusId: switches on ego mode (Session 15 mini-graphs): the one-hop
  //   network around that entity; no ring, layers, toolbar or legend.
  // opts.height: SVG height in px, or a function returning it (re-read on resize).
  function init(container, seriesId, opts = {}) {
    const syncUrl = opts.syncUrl !== false;
    const focusId = opts.focusId || null;
    const writeQuery = syncUrl ? writeGraphQuery : () => {};
    const allChars = LoreLoader.getAll(seriesId, 'characters');
    const allRels  = LoreLoader.getAll(seriesId, 'relationships');

    // Spoiler-gate: only revealed entities
    const chars  = allChars.filter(c => SpoilerGate.isRevealed(c, seriesId));
    const charIds = new Set(chars.map(c => c.id));

    const rels = allRels.filter(r =>
      SpoilerGate.isRevealed(r, seriesId) &&
      charIds.has(r.character_a) &&
      charIds.has(r.character_b)
    );

    if (chars.length === 0) {
      container.innerHTML = '<p class="state-loading">No characters visible at your current reading position.</p>';
      return;
    }

    // ── Layer data (Session 14) ──────────────────────────────────────────────
    //
    // Gating (locked rule): a layer entity renders iff SpoilerGate.isRevealed();
    // a layer<->character link renders iff both endpoints render, and an
    // artifact's ownership link also needs the reading position to have reached
    // that ownership_chain entry's `from`. Nothing here shows more than the
    // entity detail pages already list. Computed once: a position change
    // re-initialises the graph.

    const position = SpoilerGate.getPosition(seriesId);
    const anchorIds = new Set(allChars.filter(c => c.role === 'protagonist').map(c => c.id));

    // layerData[layer] = { entities, byId, links: [{ entityId, charId }] },
    // visible entities and links only (each link deduped).
    const layerData = {};
    for (const layer of LAYER_ORDER) {
      const entities = LoreLoader.getAll(seriesId, layer)
        .filter(e => SpoilerGate.isRevealed(e, seriesId))
        .sort(byReadingOrder);
      const byId = new Map(entities.map(e => [e.id, e]));
      const links = [];
      const seen = new Set();
      const add = (entityId, charId, from) => {
        if (!byId.has(entityId) || !charIds.has(charId)) return;
        if (from && position && SpoilerGate.comparePositions(position, from) < 0) return;
        const key = entityId + '>' + charId;
        if (seen.has(key)) return;
        seen.add(key);
        links.push({ entityId, charId });
      };
      for (const e of LoreLoader.getAll(seriesId, layer)) {
        if (layer === 'cases')     (e.characters_involved || []).forEach(c => add(e.id, c));
        if (layer === 'locations') (e.characters_associated || []).forEach(c => add(e.id, c));
        if (layer === 'artifacts') (e.ownership_chain || []).forEach(o => add(e.id, o.character_id, o.from));
        if (layer === 'factions')  (e.key_members || []).forEach(c => add(e.id, c));
      }
      if (layer === 'factions') {
        for (const c of allChars) (c.affiliations || []).forEach(f => add(f, c.id));
      }
      layerData[layer] = { entities, byId, links };
    }

    // Names of the visible anchors for the ring legend ("Holmes and Watson"),
    // built from the data: the last word of each name, alphabetical.
    function anchorNames() {
      const names = chars.filter(c => anchorIds.has(c.id)).map(c => c.name.trim().split(/\s+/).pop()).sort();
      if (names.length <= 1) return names.join('');
      return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    }

    // Canonicalise ?layers= up front (dedupe, drop unknowns, fix the order) and
    // rewrite the URL if that changed it.
    let activeLayers = syncUrl ? readLayersParam() : [];
    const rawLayers = syncUrl ? new URLSearchParams(location.search).get('layers') : null;
    if (rawLayers !== null && rawLayers !== activeLayers.join(',')) {
      writeQuery({ layers: activeLayers });
    }

    // Everything the graph shows at the current reading position and layer
    // selection. Pure: returns fresh spec objects, so update() can merge them
    // into the live nodes without losing their positions.
    function buildGraphData(layers) {
      // Degree count for node sizing
      const degree = {};
      for (const c of chars) degree[c.id] = 0;
      for (const r of rels) {
        degree[r.character_a] = (degree[r.character_a] || 0) + 1;
        degree[r.character_b] = (degree[r.character_b] || 0) + 1;
      }

      if (focusId) return buildEgoData(degree);

      // Node size comes from relationship degree only, so layers never inflate
      // Holmes.
      const nodes = chars.map(c => ({
        id:     c.id,
        kind:   'character',
        name:   c.name,
        role:   c.role || '',
        degree: degree[c.id] || 0,
        ring:   false,
      }));
      const links = rels.map(r => ({
        source: r.character_a,
        target: r.character_b,
        type:   r.relationship_type || 'other',
        relId:  r.id,
        key:    'rel:' + r.id,
      }));

      // Layer nodes (every visible entity) and their drawn edges.
      const layerNodes = [];
      const drawn = new Map();
      for (const layer of layers) {
        const cfg = LAYER_CONFIG[layer];
        for (const e of layerData[layer].entities) {
          const n = { id: e.id, kind: 'layer', layer, name: layerEntityName(e), degree: 0, ring: false,
                      first_mention: e.first_mention };
          layerNodes.push(n);
          drawn.set(e.id, 0);
        }
        for (const { entityId, charId } of layerData[layer].links) {
          if (anchorIds.has(charId) && !cfg.anchorEdges) continue;
          links.push({ source: entityId, target: charId, type: layer, layer, key: 'layer:' + entityId + '>' + charId });
          drawn.set(entityId, drawn.get(entityId) + 1);
        }
      }

      // Layer nodes with no drawn edge sit on an outer ring, in reading order
      // across all active layers (first_mention, layer order, name).
      const layerRank = id => LAYER_ORDER.indexOf(id);
      const ring = layerNodes.filter(n => drawn.get(n.id) === 0).sort((a, b) =>
        byFirstMention(a, b)
        || (layerRank(a.layer) - layerRank(b.layer))
        || a.name.localeCompare(b.name));
      ring.forEach((n, i) => { n.ring = true; n.ringIdx = i; n.ringN = ring.length; });

      return { nodes: nodes.concat(layerNodes), links };
    }

    // Ego mode (Session 15): the one-hop network around focusId. Character nodes
    // keep their *global* relationship-degree radius (Holmes is the same size
    // everywhere); a case or location centre is a layer-shaped node whose edges
    // to characters use the layer-edge style. No ring, and anchors are drawn.
    function buildEgoData(degree) {
      const net = egoNetwork(seriesId, focusId);
      if (!net) return { nodes: [], links: [] };
      const byId = new Map(chars.map(c => [c.id, c]));
      const nodes = net.charIds.map(id => {
        const c = byId.get(id);
        return { id, kind: 'character', name: c.name, role: c.role || '', degree: degree[id] || 0, ring: false };
      });
      const links = net.rels.map(r => ({
        source: r.character_a,
        target: r.character_b,
        type:   r.relationship_type || 'other',
        relId:  r.id,
        key:    'rel:' + r.id,
      }));
      if (net.layer) {
        nodes.unshift({ id: focusId, kind: 'layer', layer: net.layer, name: layerEntityName(net.centre),
                        degree: 0, ring: false, first_mention: net.centre.first_mention });
        for (const { entityId, charId } of net.layerLinks) {
          links.push({ source: entityId, target: charId, type: net.layer, layer: net.layer,
                       key: 'layer:' + entityId + '>' + charId });
        }
      }
      return { nodes, links };
    }

    let nodes = [];
    let links = [];
    let nodeById = {};   // node-by-id lookup, rebuilt by update()
    let neighbors = {};  // relationship neighbours (the panel's "Connected to"), rebuilt by update()
    let toolbar = null;  // the layer toolbar element (null when opts.layerControls is false)
    let drawnAdj = {};   // every drawn edge, either direction (label highlighting)

    const width  = container.clientWidth || 800;
    const heightFor = w => opts.height
      ? (typeof opts.height === 'function' ? opts.height() : opts.height)
      : Math.max(600, Math.round(w * 0.65));
    let   height = heightFor(width); // recomputed on resize

    // ── SVG + zoom layer ─────────────────────────────────────────────────────

    const svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', height)
      .attr('class', 'graph-svg')
      .attr('aria-label', 'Relationship graph');

    const g = svg.append('g').attr('class', 'graph-g');

    // Zoom to fit (Session 14.1): once the simulation settles, and again after a
    // layer toggle settles, the view is fitted to every node, unless the reader
    // has zoomed or panned themselves (zoom events with a sourceEvent: wheel,
    // drag, touch), in which case their view is left alone.
    let userTransformed = false;
    let fitPending = true;      // the final fit (alpha < 0.05, eased)
    let earlyFitPending = true; // load only: a first, un-eased fit at alpha < 0.3
    let toolbarObserver = null; // the toolbar's ResizeObserver, disconnected with the simulation

    const zoom = d3.zoom()
      .scaleExtent([0.25, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        if (event.sourceEvent) userTransformed = true;
        // Small scales: hide most character labels (CSS keys off this class).
        svg.classed('is-zoomed-out', event.transform.k < LABEL_MIN_SCALE);
      });
    svg.call(zoom);

    const linkLayer = g.append('g').attr('class', 'graph-links');
    const nodeLayer = g.append('g').attr('class', 'graph-nodes');
    let link = linkLayer.selectAll('line');
    let node = nodeLayer.selectAll('g');

    // ── Tooltip ──────────────────────────────────────────────────────────────

    const tooltip = d3.select(container)
      .append('div')
      .attr('class', 'graph-tooltip')
      .attr('aria-hidden', 'true')
      .style('opacity', 0);

    function showTooltip(event, html) {
      const rect = container.getBoundingClientRect();
      tooltip
        .style('opacity', 1)
        .html(html)
        .style('left', (event.clientX - rect.left + 14) + 'px')
        .style('top',  (event.clientY - rect.top  - 12) + 'px');
    }

    function moveTooltip(event) {
      const rect = container.getBoundingClientRect();
      tooltip
        .style('left', (event.clientX - rect.left + 14) + 'px')
        .style('top',  (event.clientY - rect.top  - 12) + 'px');
    }

    function hideTooltip() {
      tooltip.style('opacity', 0);
    }

    // Click and Enter/Space both land here.
    function activateNode(d) {
      if (focusId && d.id === focusId) return; // the centre of a mini-graph: nothing to open
      lastFocusedNodeId = d.id;
      if (selectedEntityId === d.id) closePanel();
      else if (selectedEntityId) swapPanel(d.id);
      else openPanel(d.id);
    }

    // ── Force simulation ─────────────────────────────────────────────────────

    // Called once this graph's DOM is gone (from a tick, or from the toolbar
    // observer, which fires when the toolbar is detached even after a settled
    // simulation has stopped ticking).
    function teardown() {
      simulation.stop();
      if (toolbarObserver) { toolbarObserver.disconnect(); toolbarObserver = null; }
    }

    // The simulation's centre and usable box. recenter() keeps this current
    // (it shifts left when the desktop panel opens); the ring targets read it.
    // R is the ring's current (adaptive) radius, 0 until the first tick.
    const layout = { cx: width / 2, cy: height / 2, w: width, h: height, R: 0 };

    const baseRingRadius = () => RING_RADIUS_FRAC * Math.min(layout.w, layout.h);

    function ringTarget(d) {
      const R = layout.R || baseRingRadius();
      const a = -Math.PI / 2 + (2 * Math.PI * d.ringIdx) / d.ringN; // 12 o'clock, clockwise
      return { x: layout.cx + R * Math.cos(a), y: layout.cy + R * Math.sin(a) };
    }

    // Pulls each ring node toward its target (strength RING_STRENGTH, via
    // d3.forceX/forceY's rule: velocity += offset x strength). Unlike forceX/Y
    // it is *not* scaled by alpha, and it reads the layout box live. Scaled by
    // alpha, the pull dies away just as the repulsion from ~100 other nodes does
    // not (repulsion falls off as 1/d), and the ring bulges well outside its
    // radius; unscaled, the ring settles on its radius as the simulation cools.
    //
    // The radius adapts (Session 14.1): each tick R eases toward
    // max(base radius, p90 of the other nodes' distance from the centre + RING_PAD),
    // so the ring always encloses the interior however far it spreads.
    function ringForce() {
      let ringNodes = [];
      let inner = [];
      const force = () => {
        if (ringNodes.length) {
          const dist = inner.map(d => Math.hypot(d.x - layout.cx, d.y - layout.cy)).sort((a, b) => a - b);
          const p90 = dist.length ? dist[Math.min(dist.length - 1, Math.ceil(0.9 * dist.length) - 1)] : 0;
          const target = Math.max(baseRingRadius(), p90 + RING_PAD);
          layout.R = (layout.R || baseRingRadius());
          layout.R += RING_SMOOTH * (target - layout.R);
        }
        for (const d of ringNodes) {
          const t = ringTarget(d);
          d.vx += (t.x - d.x) * RING_STRENGTH;
          d.vy += (t.y - d.y) * RING_STRENGTH;
        }
      };
      force.initialize = (all) => { ringNodes = all.filter(d => d.ring); inner = all.filter(d => !d.ring); };
      return force;
    }

    // Isolate gravity (Session 14.1b): a node with no drawn links in this view,
    // and not on the ring, has nothing pulling it in, so repulsion flings it far
    // out and stretches the fit. Give it a weak, unscaled pull to the centre
    // (velocity += offset x ISOLATE_STRENGTH). Reads drawnAdj and layout live.
    function isolateForce() {
      let all = [];
      const force = () => {
        for (const d of all) {
          if (d.ring || (drawnAdj[d.id] && drawnAdj[d.id].length)) continue;
          d.vx += (layout.cx - d.x) * ISOLATE_STRENGTH;
          d.vy += (layout.cy - d.y) * ISOLATE_STRENGTH;
        }
      };
      force.initialize = (nodesIn) => { all = nodesIn; };
      return force;
    }

    const collideRadius = d => d.kind === 'layer' ? LAYER_COLLIDE_R : nodeRadius(d.degree) + 5;

    const simulation = d3.forceSimulation(nodes)
      .force('link',      d3.forceLink(links).id(d => d.id).distance(d => d.layer ? LAYER_EDGE_DIST : 90))
      .force('charge',    d3.forceManyBody().strength(-220))
      .force('center',    d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(collideRadius))
      .force('ring',      ringForce())
      .force('isolate',   isolateForce())
      .on('tick', () => {
        // The route changed and this graph's DOM is gone: stop, rather than keep
        // ticking (and fitting) a detached SVG.
        if (!container.isConnected) { teardown(); return; }

        link
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);

        node.attr('transform', d => `translate(${d.x},${d.y})`);

        // Two-stage fit on load: a quick un-eased fit once the layout has taken
        // shape, then the eased final fit at settle. Toggles and resizes do only
        // the final fit (they set fitPending alone).
        const alpha = simulation.alpha();
        if (earlyFitPending && alpha < EARLY_FIT_ALPHA) {
          earlyFitPending = false;
          fitToView(true);
        }
        if (fitPending && alpha < 0.05) {
          fitPending = false;
          earlyFitPending = false;
          fitToView();
        }
      });

    // Fit every node (with its radius) into the usable box, FIT_PAD all round.
    // Never scales above 1; clamped to the zoom's scaleExtent. 300ms ease, none
    // under prefers-reduced-motion or when `instant` (the early fit).
    function fitToView(instant) {
      if (userTransformed || !nodes.length) return;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const n of nodes) {
        const r = n.kind === 'layer' ? LAYER_COLLIDE_R : nodeRadius(n.degree);
        x0 = Math.min(x0, n.x - r); x1 = Math.max(x1, n.x + r);
        y0 = Math.min(y0, n.y - r); y1 = Math.max(y1, n.y + r);
      }
      const w = layout.w, h = layout.h;
      const k = Math.max(0.25, Math.min(1,
        (w - 2 * FIT_PAD) / Math.max(1, x1 - x0),
        (h - 2 * FIT_PAD) / Math.max(1, y1 - y0)));
      const t = d3.zoomIdentity
        .translate(w / 2 - k * (x0 + x1) / 2, h / 2 - k * (y0 + y1) / 2)
        .scale(k);
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || instant) svg.call(zoom.transform, t);
      else svg.transition().duration(FIT_MS).call(zoom.transform, t);
    }

    // Rebuild the graph for the current reading position and layers, in place:
    // keyed joins, and existing node objects are kept so their x/y carry over.
    // New layer nodes spawn at the centroid of their drawn neighbours, or at
    // their ring target. `alpha` (optional) reheats the simulation; the first
    // call leaves it at 1.
    function update(alpha) {
      const data = buildGraphData(activeLayers);

      const prev = new Map(nodes.map(n => [n.id, n]));
      nodes = data.nodes.map(spec => {
        const old = prev.get(spec.id);
        if (!old) return spec;
        delete old.ringIdx; delete old.ringN;
        return Object.assign(old, spec);
      });
      links = data.links;

      nodeById = {};
      for (const n of nodes) nodeById[n.id] = n;
      neighbors = {};
      drawnAdj = {};
      for (const n of nodes) { neighbors[n.id] = []; drawnAdj[n.id] = []; }
      for (const l of links) {
        drawnAdj[l.source].push(l.target);
        drawnAdj[l.target].push(l.source);
        if (l.layer) continue; // `neighbors` is relationships only (the panel's "Connected to")
        neighbors[l.source].push({ id: l.target, type: l.type });
        neighbors[l.target].push({ id: l.source, type: l.type });
      }

      recenter();
      for (const n of nodes) {
        if (n.x !== undefined || n.kind !== 'layer') continue;
        const near = drawnAdj[n.id].map(id => nodeById[id]).filter(m => m && m.x !== undefined);
        if (near.length) {
          n.x = near.reduce((t, m) => t + m.x, 0) / near.length + (Math.random() - 0.5) * 4;
          n.y = near.reduce((t, m) => t + m.y, 0) / near.length + (Math.random() - 0.5) * 4;
        } else if (n.ring) {
          const t = ringTarget(n);
          n.x = t.x; n.y = t.y;
        }
      }

      simulation.nodes(nodes);
      simulation.force('link').links(links);

      // ── Links ──────────────────────────────────────────────────────────────

      link = linkLayer.selectAll('line')
        .data(links, d => d.key)
        .join(enter => enter.append('line')
          .attr('class', d => d.layer ? 'graph-link graph-link-layer' : 'graph-link')
          .attr('stroke', d => d.layer ? LAYER_CONFIG[d.layer].color : relColor(d.type))
          .attr('stroke-width', d => d.layer ? 1 : 1.5)
          .attr('stroke-opacity', d => d.layer ? 0.35 : 0.55)
          .attr('stroke-dasharray', d => d.layer ? '4 3' : null)
          .on('mouseover', (event, d) => {
            const srcName = typeof d.source === 'object' ? d.source.name : d.source;
            const tgtName = typeof d.target === 'object' ? d.target.name : d.target;
            const kind = d.layer ? LAYER_CONFIG[d.layer].singular.toLowerCase() : d.type;
            showTooltip(event,
              `<span class="tt-role">${esc(kind)}</span><br>${esc(srcName)} ↔ ${esc(tgtName)}`
            );
          })
          .on('mousemove', moveTooltip)
          .on('mouseleave', hideTooltip));

      // ── Nodes ──────────────────────────────────────────────────────────────

      node = nodeLayer.selectAll('g.graph-node')
        .data(nodes, d => d.id)
        .join(enter => {
          const n = enter.append('g')
            .attr('class', d => (d.kind === 'layer' ? 'graph-node graph-node-layer'
              : (anchorIds.has(d.id) ? 'graph-node is-anchor' : 'graph-node'))
              + (focusId && d.id === focusId ? ' is-focus' : ''))
            .attr('tabindex', 0)
            .attr('role', 'button')
            .attr('aria-label', d => d.kind === 'layer' ? `${LAYER_CONFIG[d.layer].singular}: ${d.name}` : d.name)
            .call(
              d3.drag()
                .on('start', dragstarted)
                .on('drag',  dragged)
                .on('end',   dragended)
            );

          // Characters are circles sized by relationship degree; layer nodes are
          // fixed-size shapes (shape + colour, so colour is never the only cue).
          n.filter(d => d.kind !== 'layer').append('circle')
            .attr('r', d => nodeRadius(d.degree))
            .attr('fill', d => nodeColor(d.role))
            .attr('stroke', '#1a1510')
            .attr('stroke-width', 1);

          n.filter(d => d.kind === 'layer').append('path')
            .attr('d', d => d3.symbol().type(LAYER_CONFIG[d.layer].shape).size(LAYER_SYMBOL_AREA)())
            .attr('fill', d => LAYER_CONFIG[d.layer].color)
            .attr('stroke', '#1a1510')
            .attr('stroke-width', 1);

          n.append('text')
            .attr('class', 'graph-label')
            .attr('dy', d => d.kind === 'layer' ? 22 : nodeRadius(d.degree) + 13)
            .attr('text-anchor', 'middle')
            .text(d => d.name);

          n.on('mouseover', (event, d) => {
              if (d.kind === 'layer') {
                const cnt = layerData[d.layer].links.filter(l => l.entityId === d.id).length;
                showTooltip(event,
                  `<strong>${esc(d.name)}</strong><br><span class="tt-role">${esc(LAYER_CONFIG[d.layer].singular)}</span>`
                  + `<br><span class="tt-degree">${cnt} character${cnt !== 1 ? 's' : ''}</span>`);
                return;
              }
              const roleLabel = d.role ? `<br><span class="tt-role">${esc(d.role.replace(/_/g, ' '))}</span>` : '';
              const degLabel  = `<br><span class="tt-degree">${d.degree} connection${d.degree !== 1 ? 's' : ''}</span>`;
              showTooltip(event, `<strong>${esc(d.name)}</strong>${roleLabel}${degLabel}`);
            })
            .on('mousemove', moveTooltip)
            .on('mouseleave', hideTooltip)
            .on('click', (event, d) => activateNode(d))
            .on('keydown', (event, d) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activateNode(d);
              }
            });

          return n;
        });

      markSelection();
      renderLegend();
      renderToolbar();
      if (alpha !== undefined) simulation.alpha(alpha).restart();
    }

    // Labels on layer nodes are hidden by default (CSS); the selected node and
    // its drawn neighbours get these classes so theirs show.
    function markSelection() {
      const near = new Set(selectedEntityId && drawnAdj[selectedEntityId] ? drawnAdj[selectedEntityId] : []);
      node.classed('is-selected', d => d.id === selectedEntityId)
          .classed('is-neighbor', d => near.has(d.id));
    }

    // ── Info panel (Session 13) ──────────────────────────────────────────────

    const PANEL_W = 320;
    // Read live rather than capturing at init: the panel switches between
    // right-dock and bottom-sheet at the same 768px breakpoint the CSS uses, so
    // a resize must change which layout the re-centring logic assumes.
    // Session 15: measure the viewport, as the CSS does, not the container (a
    // 740px mini-graph on a wide screen is a desktop layout).
    const isDesktopWidth = () => window.matchMedia('(min-width: 768px)').matches;

    let selectedEntityId = null;
    let lastFocusedNodeId = null;

    container.style.position = 'relative';

    const panel = document.createElement('aside');
    panel.id = 'graph-info-panel';
    panel.className = 'graph-info-panel';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('aria-label', 'Selected entity details');
    panel.setAttribute('tabindex', '-1');
    panel.hidden = true;
    container.appendChild(panel);

    function renderPanelContent(id) {
      const entity = LoreLoader.getById(id);
      const closeBtn = '<button class="panel-close" type="button" aria-label="Close panel">&times;</button>';
      if (!entity) return closeBtn + '<p class="panel-empty">Entity unavailable.</p>';
      if (nodeById[id] && nodeById[id].kind === 'layer') return renderLayerPanel(entity, nodeById[id].layer, closeBtn);

      const status = SpoilerGate.getRevealStatus(entity, seriesId);
      const name = entity.name || id;
      const roleBadge = entity.role
        ? `<span class="badge badge-${esc(entity.role.replace(/_/g, '-'))}">${esc(entity.role.replace(/_/g, ' '))}</span>`
        : '';

      const bioText = proseText(entity, 'biography', seriesId).text;
      const desc = status === 'partial'
        ? redactedProse(entity)
        : (bioText
            ? esc(firstSentencesForMeta(bioText, 120))
            : '<span class="panel-empty">No description available.</span>');

      // Unique neighbours, alphabetical (no edge-weight data → name sort).
      const seen = new Set();
      const uniq = [];
      for (const x of (neighbors[id] || [])) {
        if (!seen.has(x.id)) { seen.add(x.id); uniq.push(x); }
      }
      uniq.sort((a, b) =>
        (nodeById[a.id]?.name || '').localeCompare(nodeById[b.id]?.name || ''));

      // Ego mode: chips only for nodes in the view (a swap needs a node, and the
      // centre does nothing), but the count is the full gated number.
      let count = uniq.length;
      if (focusId) {
        const partners = new Set();
        for (const r of rels) {
          if (r.character_a === id) partners.add(r.character_b);
          else if (r.character_b === id) partners.add(r.character_a);
        }
        count = partners.size;
        for (let i = uniq.length - 1; i >= 0; i--) if (uniq[i].id === focusId) uniq.splice(i, 1);
      }
      const chips = uniq.slice(0, 5).map(x => {
        const nm = nodeById[x.id]?.name || x.id;
        // Colour goes in a data-* attribute, not style="" — the site's CSP omits
        // 'unsafe-inline' from style-src, so a style attribute is silently
        // dropped (chips would all fall back to gold). bindPanelControls()
        // applies it via CSSOM, which CSP does allow.
        return `<button class="panel-chip" type="button" data-entity="${esc(x.id)}" `
             + `data-chip-color="${esc(relColor(x.type))}">${esc(nm)}</button>`;
      }).join('');

      return `
        ${closeBtn}
        <h2 class="panel-name">${esc(name)}</h2>
        <div class="panel-badges">${roleBadge}</div>
        <p class="panel-desc">${desc}</p>
        <p class="panel-count">Connected to ${count} ${count === 1 ? 'entity' : 'entities'}</p>
        ${chips ? `<div class="panel-chips">${chips}</div>` : ''}${renderLayerSections(id)}
        <a class="panel-view-full" href="${entityPath(seriesId, 'characters', id)}">View full page &rarr;</a>
      `;
    }

    // A chip that swaps the panel to another node. The colour travels in a
    // data-* attribute and is applied via CSSOM in bindPanelControls().
    function chipHtml(id, name, color) {
      return `<button class="panel-chip" type="button" data-entity="${esc(id)}" `
           + `data-chip-color="${esc(color)}">${esc(name)}</button>`;
    }

    // Character panel: one section per active layer, from the data's visible
    // links (not the drawn edges, which leave out the anchors), so Holmes's 60
    // cases show here even though none is drawn. First 5 in reading order.
    function renderLayerSections(charId) {
      return activeLayers.map(layer => {
        const ids = new Set(layerData[layer].links.filter(l => l.charId === charId).map(l => l.entityId));
        if (ids.size === 0) return '';
        const cfg = LAYER_CONFIG[layer];
        const ents = layerData[layer].entities.filter(e => ids.has(e.id)); // already reading order
        const chips = ents.slice(0, MAX_LAYER_CHIPS)
          .map(e => chipHtml(e.id, layerEntityName(e), cfg.color)).join('');
        const more = ents.length > MAX_LAYER_CHIPS
          ? `<span class="panel-more">+${ents.length - MAX_LAYER_CHIPS} more</span>` : '';
        return `<p class="panel-count">${esc(cfg.label)} (${ents.length})</p>`
             + `<div class="panel-chips">${chips}${more}</div>`;
      }).join('');
    }

    // Layer-node panel: title, type badge, description, every visible linked
    // character (anchors included), full-page link.
    function renderLayerPanel(entity, layer, closeBtn) {
      const cfg = LAYER_CONFIG[layer];
      const status = SpoilerGate.getRevealStatus(entity, seriesId);
      let desc;
      if (status === 'partial') {
        desc = redactedProse(entity);
      } else {
        const { text, nextFrom } = proseText(entity, cfg.descField, seriesId);
        desc = text ? esc(firstSentencesForMeta(text, 120)) : '<span class="panel-empty">No description available.</span>';
        if (nextFrom) {
          desc += ` <span class="prose-more">[More after Book ${esc(nextFrom.book)}, Ch. ${esc(nextFrom.chapter)}]</span>`;
        }
      }

      const linked = layerData[layer].links
        .filter(l => l.entityId === entity.id)
        .map(l => allChars.find(c => c.id === l.charId))
        .sort((a, b) => a.name.localeCompare(b.name));
      const chips = linked.map(c => chipHtml(c.id, c.name, cfg.color)).join('');

      return `
        ${closeBtn}
        <h2 class="panel-name">${esc(layerEntityName(entity))}</h2>
        <div class="panel-badges"><span class="badge badge-layer badge-layer-${esc(layer)}">${esc(cfg.singular)}</span></div>
        <p class="panel-desc">${desc}</p>
        <p class="panel-count">Characters (${linked.length})</p>
        ${chips ? `<div class="panel-chips">${chips}</div>` : ''}
        <a class="panel-view-full" href="${entityPath(seriesId, layer, entity.id)}">View full page &rarr;</a>
      `;
    }

    function bindPanelControls() {
      const closeBtn = panel.querySelector('.panel-close');
      if (closeBtn) closeBtn.addEventListener('click', closePanel);

      panel.querySelectorAll('.panel-chip').forEach(btn => {
        if (btn.dataset.chipColor) {
          btn.style.setProperty('--chip-color', btn.dataset.chipColor);
        }
        btn.addEventListener('click', () => {
          lastFocusedNodeId = btn.dataset.entity;
          swapPanel(btn.dataset.entity);
        });
      });

      const full = panel.querySelector('.panel-view-full');
      if (full) full.addEventListener('click', (e) => {
        // Honour modifier-clicks (open in new tab); plain click → SPA navigate.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(full.getAttribute('href'));
      });
    }

    // Shift the simulation's centre of mass left when the desktop panel is open
    // so the graph re-settles in the still-visible area. Reads current width and
    // panel state, so it stays correct across resizes and breakpoint crossings.
    function recenter() {
      const w = container.clientWidth || width;
      const usable = (isDesktopWidth() && selectedEntityId !== null) ? w - PANEL_W : w;
      layout.cx = usable / 2; layout.cy = height / 2; layout.w = usable; layout.h = height;
      simulation.force('center', d3.forceCenter(layout.cx, layout.cy));
    }

    function openPanel(id, opts) {
      const restore = opts && opts.restore;
      selectedEntityId = id;
      panel.innerHTML = renderPanelContent(id);
      bindPanelControls();
      panel.hidden = false;
      requestAnimationFrame(() => panel.classList.add('open'));
      markSelection();
      if (!restore) {
        recenter();
        simulation.alpha(0.3).restart();
        writeQuery({ selected: id });
        panel.focus();
      }
    }

    function swapPanel(id) {
      // No slide, no re-centre (viewport width unchanged) — just swap content + URL.
      selectedEntityId = id;
      panel.innerHTML = renderPanelContent(id);
      bindPanelControls();
      markSelection();
      writeQuery({ selected: id });
    }

    // opts.restoreFocus === false skips returning focus to the last node (used
    // when a layer toggle closes the panel and focus should stay on the toolbar).
    function closePanel(opts) {
      if (selectedEntityId === null) return;
      selectedEntityId = null;
      markSelection();
      panel.classList.remove('open');
      writeQuery({ selected: null });
      recenter();
      simulation.alpha(0.3).restart();

      const finish = () => {
        if (selectedEntityId === null) panel.hidden = true;
        panel.removeEventListener('transitionend', finish);
      };
      panel.addEventListener('transitionend', finish);
      setTimeout(finish, 260); // fallback if transitionend doesn't fire

      if (!(opts && opts.restoreFocus === false)) focusNode(lastFocusedNodeId);
    }

    function focusNode(id) {
      if (!id) return;
      const el = node.filter(d => d.id === id).node();
      if (el && el.focus) el.focus();
    }

    // Background-click dismissal with 6px movement threshold (decision 2).
    let downPos = null;
    svg.on('mousedown', (event) => { downPos = { x: event.clientX, y: event.clientY }; });
    svg.on('mouseup', (event) => {
      if (selectedEntityId === null || !downPos) { downPos = null; return; }
      if (event.target === svg.node()) {
        const dist = Math.abs(event.clientX - downPos.x) + Math.abs(event.clientY - downPos.y);
        if (dist < 6) closePanel();
      }
      downPos = null;
    });
    svg.on('touchstart', (event) => {
      const t = event.touches[0];
      downPos = t ? { x: t.clientX, y: t.clientY } : null;
    });
    svg.on('touchend', (event) => {
      if (selectedEntityId === null || !downPos) { downPos = null; return; }
      const t = event.changedTouches[0];
      if (t && event.target === svg.node()) {
        const dist = Math.abs(t.clientX - downPos.x) + Math.abs(t.clientY - downPos.y);
        if (dist < 6) closePanel();
      }
      downPos = null;
    });

    // Swipe-down on the mobile bottom sheet dismisses it.
    let sheetStartY = null;
    panel.addEventListener('touchstart', (e) => {
      sheetStartY = e.touches[0] ? e.touches[0].clientY : null;
    }, { passive: true });
    panel.addEventListener('touchend', (e) => {
      if (sheetStartY === null) return;
      const endY = e.changedTouches[0] ? e.changedTouches[0].clientY : sheetStartY;
      if (endY - sheetStartY > 40) closePanel();
      sheetStartY = null;
    });

    // Esc closes the panel anywhere on the graph page. Self-removing once the
    // graph DOM is replaced (SPA navigation) to avoid leaking listeners.
    function onKeyDown(e) {
      if (!document.body.contains(panel)) {
        document.removeEventListener('keydown', onKeyDown);
        return;
      }
      if (e.key === 'Escape' && selectedEntityId !== null) {
        e.preventDefault();
        closePanel();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    // Build the graph, then restore selection from URL (?selected=…) — only if
    // the entity is present in the built (spoiler-gated) node set.
    createToolbar();
    update();

    const requested = syncUrl ? new URLSearchParams(location.search).get('selected') : null;
    if (requested) {
      if (nodeById[requested]) {
        lastFocusedNodeId = requested;
        openPanel(requested, { restore: true });
      } else {
        writeQuery({ selected: null });
      }
    }

    // Keep the layout correct when the viewport changes (device rotation, window
    // resize, desktop↔mobile breakpoint crossings). Debounced; self-removing once
    // the graph DOM is replaced by SPA navigation, matching the keydown handler.
    let resizeTimer = null;
    function onResize() {
      if (!document.body.contains(container)) {
        window.removeEventListener('resize', onResize);
        return;
      }
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const w = container.clientWidth;
        if (!w) return;
        height = heightFor(w);
        svg.attr('height', height);
        recenter();
        fitPending = true;
        simulation.alpha(0.3).restart();
      }, 150);
    }
    window.addEventListener('resize', onResize);

    // ── Legend ───────────────────────────────────────────────────────────────

    function renderLegend() {
      d3.select(container).select('.graph-legend').remove();
      if (focusId) return; // mini-graphs have no legend

      const presentTypes = [...new Set(links.filter(l => !l.layer).map(l => l.type))].sort();
      const hasRing = nodes.some(n => n.ring);
      if (presentTypes.length === 0 && activeLayers.length === 0) return;

      const legend = d3.select(container)
        .append('div')
        .attr('class', 'graph-legend');

      if (presentTypes.length > 0) {
        legend.append('p').attr('class', 'graph-legend-title').text('Relationship types');

        for (const type of presentTypes) {
          const item = legend.append('div').attr('class', 'graph-legend-item');
          item.append('span')
            .attr('class', 'graph-legend-swatch')
            .style('background', relColor(type));
          item.append('span').text(type);
        }
      }

      if (activeLayers.length > 0) {
        legend.append('p').attr('class', 'graph-legend-title').text('Layers');

        for (const layer of activeLayers) {
          const cfg = LAYER_CONFIG[layer];
          const item = legend.append('div').attr('class', 'graph-legend-item graph-legend-layer');
          item.append('span')
            .attr('class', 'graph-legend-glyph')
            .attr('aria-hidden', 'true')
            .style('color', cfg.color)
            .text(cfg.glyph);
          item.append('span').text(cfg.label);
        }

        if (hasRing) {
          const who = anchorNames();
          legend.append('p')
            .attr('class', 'graph-legend-note')
            .text(`Outer ring: linked only to ${who || 'no visible character'}${who ? ', or to no character' : ''}.`);
        }
      }
    }

    // ── Layer toolbar (Session 14) ───────────────────────────────────────────
    //
    // Persistent (not the contextual info panel, which closes). First child of
    // the container, above the SVG. Default is all layers off.

    function createToolbar() {
      if (opts.layerControls === false) return;
      toolbar = document.createElement('div');
      toolbar.className = 'graph-layers';
      toolbar.setAttribute('role', 'group');
      toolbar.setAttribute('aria-label', 'Graph layers');
      container.insertBefore(toolbar, container.firstChild);

      for (const layer of LAYER_ORDER) {
        const cfg = LAYER_CONFIG[layer];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'graph-layer-btn';
        btn.dataset.layer = layer;
        btn.innerHTML =
          `<span class="graph-layer-glyph" aria-hidden="true">${cfg.glyph}</span>`
          + `<span class="graph-layer-label">${esc(cfg.label)}</span>`
          + `<span class="graph-layer-count"></span>`
          + `<span class="graph-layer-hint"></span>`;
        btn.querySelector('.graph-layer-glyph').style.setProperty('color', cfg.color);
        btn.style.setProperty('--layer-color', cfg.color);
        btn.addEventListener('click', () => {
          if (btn.getAttribute('aria-disabled') === 'true') return;
          toggleLayer(layer);
        });
        toolbar.appendChild(btn);
      }

      // The desktop info panel docks to the container's right edge; start it
      // below the toolbar so it never covers the toggles. Set via CSSOM (the
      // CSP drops inline style attributes).
      const syncPanelTop = () => {
        if (!container.isConnected) { teardown(); return; }
        container.style.setProperty('--graph-toolbar-h', toolbar.offsetHeight + 'px');
      };
      syncPanelTop();
      if (typeof ResizeObserver !== 'undefined') {
        toolbarObserver = new ResizeObserver(syncPanelTop);
        toolbarObserver.observe(toolbar);
      }
    }

    // Counts show nodes visible *now* at the reading position. A layer with none
    // is aria-disabled with a hint, but keeps its state in the URL so it lights
    // up once the reader gets there.
    function renderToolbar() {
      if (!toolbar) return;
      for (const btn of toolbar.querySelectorAll('.graph-layer-btn')) {
        const layer = btn.dataset.layer;
        const n = layerData[layer].entities.length;
        const disabled = n === 0;
        btn.setAttribute('aria-pressed', activeLayers.includes(layer) ? 'true' : 'false');
        btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        btn.classList.toggle('is-disabled', disabled);
        btn.querySelector('.graph-layer-count').textContent = String(n);
        btn.querySelector('.graph-layer-hint').textContent = disabled ? 'None yet at your reading position' : '';
      }
    }

    function toggleLayer(layer) {
      setLayers(activeLayers.includes(layer)
        ? activeLayers.filter(l => l !== layer)
        : activeLayers.concat(layer));
    }

    // Set the active layers, in place (no re-init). Writes ?layers=, keeps or
    // closes the open panel depending on whether its node survived.
    function setLayers(list) {
      const next = canonicalLayers(list);
      if (next.join(',') === activeLayers.join(',')) return;
      activeLayers = next;
      writeQuery({ layers: activeLayers });
      fitPending = true;
      update(0.5);

      if (selectedEntityId !== null) {
        if (nodeById[selectedEntityId]) {
          // Counts and sections change with the layers, so re-render in place.
          panel.innerHTML = renderPanelContent(selectedEntityId);
          bindPanelControls();
        } else {
          closePanel({ restoreFocus: false });
        }
      }
    }

    // ── Drag handlers ────────────────────────────────────────────────────────

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // Controller handle — lets callers (e.g. Session 15 mini-graphs) drive this
    // graph instance's panel. openPanel/swapPanel/closePanel close over this
    // instance's simulation, nodes, and panel element.
    return {
      openPanel,
      swapPanel,
      closePanel,
      setLayers,
      getLayers: () => activeLayers.slice(),
      getSelectedEntityId: () => selectedEntityId,
    };
  }

  return { init, egoNodeCount };

})();
