/**
 * graph.js — Relationship graph for The Lore Atlas
 * D3.js v7 force-directed layout, spoiler-gated, characters only (Release 2).
 */

const LoreGraph = (() => {

  // Colours are CSS var() strings so the graph follows the theme with no
  // re-render. Apply them to SVG with .style(), never .attr(): var() does not
  // resolve inside SVG presentation attributes.
  // Relationships colour by the design's five groups (relTypeGroup in core.js);
  // the label keeps the data's own type.
  function relColor(type) {
    return `var(--rel-${relTypeGroup(type)})`;
  }

  // Nodes are coloured by entity type (design 3a/8a): every character is the
  // character gold, protagonists a brighter gold. Role shows in the panel.
  function nodeColor(role) {
    return role === 'protagonist' ? 'var(--type-protagonist)' : 'var(--type-character)';
  }

  // Node radius from connection count among the visible edges, relative to the
  // busiest node in the same view (square root, so a hub does not swamp the
  // rest). lo/hi are the radius range in px.
  function radiusFor(degree, maxDegree, lo, hi) {
    return lo + (hi - lo) * Math.sqrt(Math.min(1, degree / Math.max(1, maxDegree)));
  }
  const NODE_R_MIN = 5;
  const NODE_R_MAX = 12;

  // Layer ids in canonical (URL and sidebar) order. Session 14.
  const LAYER_ORDER = ['cases', 'locations', 'artifacts', 'factions'];

  // Per-layer config. Each layer's entities become nodes linked to characters
  // only (bipartite). `anchorEdges: false` hides the edges to protagonists
  // ("anchors"), which would otherwise hairball: Holmes is in every case. The
  // shape means colour is never the only signal. The colours are the --type-*
  // tokens, which are tuned per theme against the graph background (--panel).
  const LAYER_CONFIG = {
    cases:     { label: 'Cases',     singular: 'Case',     glyph: '■', shape: d3.symbolSquare,   color: 'var(--type-case)', anchorEdges: false, descField: 'synopsis' },
    locations: { label: 'Locations', singular: 'Location', glyph: '◆', shape: d3.symbolDiamond,  color: 'var(--type-location)', anchorEdges: false, descField: 'description' },
    artifacts: { label: 'Artifacts', singular: 'Artifact', glyph: '▲', shape: d3.symbolTriangle, color: 'var(--type-artifact)', anchorEdges: false, descField: 'description' },
    factions:  { label: 'Factions',  singular: 'Faction',  glyph: '★', shape: d3.symbolStar,     color: 'var(--type-faction)', anchorEdges: true,  descField: 'description' },
  };
  const LAYER_SYMBOL_AREA = 80;
  const LAYER_COLLIDE_R   = 9;
  const LAYER_RING_R      = 8;     // a layer node's selection ring sits outside this radius
  const RING_RADIUS_FRAC  = 0.42;  // ring radius = this x min(usable width, height)
  const RING_STRENGTH     = 0.3;
  const LAYER_EDGE_DIST   = 70;
  const ISOLATE_STRENGTH  = 0.08;  // pull toward the centre for nodes with no drawn links
  const EARLY_FIT_ALPHA   = 0.3;   // load only: first, un-eased fit below this alpha
  const RING_PAD          = 64;    // adaptive ring: p90 of the inner nodes' distance from the centre + this
  const RING_SMOOTH       = 0.1;   // adaptive ring: R moves this fraction of the way to its target each tick
  const FIT_PAD           = 28;    // zoom-to-fit padding (px)
  const FIT_MAX_SCALE     = 1.6;   // a small graph is magnified this far at most
  const CANVAS_H          = 640;   // the full graph's canvas height on desktop (px)
  const LABEL_CHAR_W      = 6.4;   // approx. width of a 12px label character, for the fit box
  const labelCharW        = () => isNarrow() ? 7.4 : LABEL_CHAR_W; // phone labels are 0.8rem
  const LABEL_GAP         = 6;     // node edge to label
  const DOT_R             = 3;     // unreached dot radius (a 6px dot)
  const FIT_MS            = 300;
  const TAP_RADIUS_PX     = 22;    // touch/pen tap: nearest node within this many screen px (a 44px target)
  const TAP_MOVE_MOUSE    = 6;     // a press that moves this far (px) is a drag, not a tap
  const TAP_MOVE_TOUCH    = 10;
  const TAP_MAX_MS        = 500;   // a longer press is a long-press (reserved), not a tap

  // Phone layout (Session 16). Read live, so a resize across the breakpoint
  // re-reads it. > 760px is the desktop layout, unchanged.
  const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;
  // Below this zoom scale, non-anchor character labels are hidden. On a phone a
  // label shows only if it renders at >= 8px (0.8rem x 0.625).
  const labelMinScale = () => isNarrow() ? 0.625 : 0.5;
  // The smallest scale a fit or a manual zoom-out may reach.
  const fitMinScale = () => isNarrow() ? 0.12 : 0.25;
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

  // ?rel= lists the relationship groups drawn; absent means all, "none" means
  // none. Unknown names are dropped and the order is the sidebar's.
  function canonicalRel(list) {
    const wanted = new Set(list);
    return REL_GROUPS.map(g => g.key).filter(k => wanted.has(k));
  }

  function relParamValue(list) {
    const groups = canonicalRel(list);
    if (groups.length === REL_GROUPS.length) return null;
    return groups.length ? groups.join(',') : 'none';
  }

  function readRelParam() {
    const raw = new URLSearchParams(location.search).get('rel');
    if (raw === null) return REL_GROUPS.map(g => g.key);
    return raw === 'none' ? [] : canonicalRel(raw.split(','));
  }

  // The one place the graph writes its query string. Merges into the existing
  // params (so ?layers= survives a ?selected= change and vice versa). Keys
  // absent from `patch` are left alone; `selected: null`, an empty `layers` or
  // a full `rel` removes that param.
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
    if ('rel' in patch) {
      const value = relParamValue(patch.rel || []);
      if (value) params.set('rel', value);
      else params.delete('rel');
    }
    const qs = [...params].map(([k, v]) =>
      encodeURIComponent(k) + '=' +
      (k === 'layers' || k === 'rel' ? v.split(',').map(encodeURIComponent).join(',') : encodeURIComponent(v))
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

  // ── Shared gated data ────────────────────────────────────────────────────
  //
  // One place applies the spoiler rules, for the full graph, the hub and its
  // thumbnails. Gating (locked rule, Session 14): only revealed entities; a
  // layer entity renders iff SpoilerGate.isRevealed(); a layer<->character link
  // renders iff both endpoints render, and an artifact's ownership link also
  // needs the reading position to have reached that ownership_chain entry's
  // `from`. Nothing here shows more than the entity detail pages already list.
  //
  // Returns { allChars, chars, charIds, rels, layerData, eventData, position }.
  // layerData[layer] / eventData = { entities, byId, links: [{ entityId, charId }],
  // total }: visible entities and links only (each link deduped); `total`
  // counts every entity of the type, so total - entities.length is how many are
  // past the bookmark (a number, never names).
  function gateData(seriesId) {
    const allChars = LoreLoader.getAll(seriesId, 'characters');
    const chars = allChars.filter(c => SpoilerGate.isRevealed(c, seriesId));
    const charIds = new Set(chars.map(c => c.id));
    const rels = LoreLoader.getAll(seriesId, 'relationships').filter(r =>
      SpoilerGate.isRevealed(r, seriesId) && charIds.has(r.character_a) && charIds.has(r.character_b));
    const position = SpoilerGate.getPosition(seriesId);

    const collect = (type, sourceEdges, fromOf) => {
      const all = LoreLoader.getAll(seriesId, type);
      const entities = all.filter(e => SpoilerGate.isRevealed(e, seriesId)).sort(byReadingOrder);
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
      sourceEdges(all, add);
      return { entities, byId, links, total: all.length };
    };

    const layerData = {};
    for (const layer of LAYER_ORDER) {
      layerData[layer] = collect(layer, (all, add) => {
        for (const e of all) {
          if (layer === 'cases')     (e.characters_involved || []).forEach(c => add(e.id, c));
          if (layer === 'locations') (e.characters_associated || []).forEach(c => add(e.id, c));
          if (layer === 'artifacts') (e.ownership_chain || []).forEach(o => add(e.id, o.character_id, o.from));
          if (layer === 'factions')  (e.key_members || []).forEach(c => add(e.id, c));
        }
        if (layer === 'factions') {
          for (const c of allChars) (c.affiliations || []).forEach(f => add(f, c.id));
        }
      });
    }
    const eventData = collect('events', (all, add) => {
      for (const e of all) (e.characters_involved || []).forEach(c => add(e.id, c));
    });
    return { allChars, chars, charIds, rels, layerData, eventData, position };
  }

  // The hub and the full graph's node and edge set. Pure: fresh objects on
  // every call, and hidden entities appear only in `hiddenCount` (never as
  // objects with ids), so callers cannot leak them.
  //   o.characters  'all' (default) | 'linked' (only characters linked to a
  //                 shown layer entity) | 'none'
  //   o.layers      layer ids to include (cases, locations, artifacts, factions)
  //   o.events      include timeline events as a layer-style type
  //   o.anchors     'all' (default) draws every layer link; 'config' hides the
  //                 protagonist links the layer config marks as hairball
  //   o.relGroups   Set of relationship groups to draw (default: all)
  //   o.relationships  draw character-character edges (default: iff characters 'all')
  // Returns { nodes, links, hiddenCount }. A node is
  // { id, kind: 'character' | 'layer', layer?, name, role, degree, first_mention };
  // a link { source, target, type, layer?, key } with ids; `degree` counts the
  // links returned.
  function assemble(gate, o) {
    const layers = o.layers || [];
    const charMode = o.characters || 'all';
    const anchorIds = new Set(gate.allChars.filter(c => c.role === 'protagonist').map(c => c.id));
    const drawRels = o.relationships !== undefined ? o.relationships : charMode === 'all';

    const links = [];
    if (drawRels) {
      for (const r of gate.rels) {
        if (o.relGroups && !o.relGroups.has(relTypeGroup(r.relationship_type))) continue;
        links.push({ source: r.character_a, target: r.character_b, type: r.relationship_type || 'other',
                     key: 'rel:' + r.id });
      }
    }

    const layerNodes = [];
    const addLayer = (layer, data, cfg) => {
      for (const e of data.entities) {
        layerNodes.push({ id: e.id, kind: 'layer', layer, name: layerEntityName(e), role: '', degree: 0,
                          first_mention: e.first_mention });
      }
      for (const { entityId, charId } of data.links) {
        if (o.anchors === 'config' && cfg && !cfg.anchorEdges && anchorIds.has(charId)) continue;
        links.push({ source: entityId, target: charId, type: layer, layer, key: layer + ':' + entityId + '>' + charId });
      }
    };
    for (const layer of layers) addLayer(layer, gate.layerData[layer], LAYER_CONFIG[layer]);
    if (o.events) addLayer('events', gate.eventData, null);

    let charList = gate.chars;
    if (charMode === 'none') charList = [];
    else if (charMode === 'linked') {
      const linked = new Set(links.filter(l => l.layer).map(l => l.target));
      charList = gate.chars.filter(c => linked.has(c.id));
    }
    const nodes = charList.map(c => ({ id: c.id, kind: 'character', name: c.name, role: c.role || '', degree: 0,
                                       first_mention: c.first_mention }));
    nodes.push(...layerNodes);

    // A link survives only when both ends are in the node set (a 'linked'
    // character list can be filtered by the layer, and events carry no ring).
    const have = new Set(nodes.map(n => n.id));
    const kept = links.filter(l => have.has(l.source) && have.has(l.target));
    const deg = new Map();
    for (const l of kept) {
      deg.set(l.source, (deg.get(l.source) || 0) + 1);
      deg.set(l.target, (deg.get(l.target) || 0) + 1);
    }
    for (const n of nodes) n.degree = deg.get(n.id) || 0;

    let hiddenCount = 0;
    if (charMode === 'all') hiddenCount += gate.allChars.length - gate.chars.length;
    for (const layer of layers) hiddenCount += gate.layerData[layer].total - gate.layerData[layer].entities.length;
    if (o.events) hiddenCount += gate.eventData.total - gate.eventData.entities.length;
    return { nodes, links: kept, hiddenCount };
  }

  function buildData(seriesId, opts) {
    return assemble(gateData(seriesId), opts || {});
  }

  // ── Static layout and unreached dots ─────────────────────────────────────
  //
  // layoutStatic() runs a d3 force simulation synchronously (no animation) and
  // returns Map id -> { x, y } in simulation space; the caller fits that to its
  // box. Deterministic: d3's forces use fixed-seed jiggle, and nodes keep the
  // order they were given. `aspect` (width / height) widens the layout so a wide
  // thumbnail is not filled by a round blob.
  function layoutStatic(data, { aspect = 1.4, ticks = 300, distance = 46 } = {}) {
    const nodes = data.nodes.map(n => ({ id: n.id }));
    const links = data.links.map(l => ({ source: l.source, target: l.target }));
    const sim = d3.forceSimulation(nodes)
      .force('link',    d3.forceLink(links).id(d => d.id).distance(distance).strength(0.7))
      .force('charge',  d3.forceManyBody().strength(-95))
      .force('x',       d3.forceX().strength(0.045))
      .force('y',       d3.forceY().strength(0.045 * Math.max(1, aspect) * 1.4))
      .force('collide', d3.forceCollide(11))
      .stop();
    for (let i = 0; i < ticks; i++) sim.tick();
    return new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  }

  // Seeded pseudo-random in [0, 1): mulberry32.
  function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Unlabeled "past your bookmark" dots. Positions come from a constant seed
  // and the dot's index alone: the Nth dot is in the same place whichever
  // entity it stands for, so a position can never identify a hidden entry. Each
  // dot tries a few candidates and takes the first that clears `avoid` (rects
  // {x0,y0,x1,y1} around the labeled nodes) and the dots already placed.
  const DOT_SEED = 0x10A7A5;
  function scatterDots(count, box, avoid) {
    const out = [];
    const gap = 9;
    const clear = (p) =>
      !avoid.some(r => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1)
      && !out.some(q => Math.abs(q.x - p.x) < gap && Math.abs(q.y - p.y) < gap);
    for (let i = 0; i < count; i++) {
      const rnd = seededRandom(DOT_SEED + i * 7919);
      let pick = null;
      for (let t = 0; t < 14; t++) {
        const p = { x: box.x0 + rnd() * (box.x1 - box.x0), y: box.y0 + rnd() * (box.y1 - box.y0) };
        if (!pick) pick = p;
        if (clear(p)) { pick = p; break; }
      }
      out.push(pick);
    }
    return out;
  }

  // Live graph instances (Session 15b). Each init() registers a teardown; the
  // next init() tears down every instance whose container has left the DOM, so
  // stale document/window listeners are bounded to the current page's.
  const liveInstances = new Set();
  let graphSeq = 0; // unique ids for each instance's aria-describedby help text (Session 16)

  // Nodes in the ego network (the centre counts, whatever its type), or 0.
  function egoNodeCount(seriesId, focusId) {
    const net = egoNetwork(seriesId, focusId);
    return net ? net.charIds.length + (net.layer ? 1 : 0) : 0;
  }

  // opts.syncUrl (default true): false = nothing reads or writes `location`.
  // opts.focusId: switches on ego mode (Session 15 mini-graphs): the one-hop
  //   network around that entity; no ring, layers, zoom controls or dots.
  // opts.height: SVG height in px, or a function returning it (re-read on resize).
  // opts.onUpdate(stats): called after every update with layer counts, the
  //   active layers and relationship groups, the unreached count and the
  //   outer-ring note, for the page's sidebar. The layer and relationship
  //   toggles live there, driving setLayers() and setRelGroups() on the handle.
  function init(container, seriesId, opts = {}) {
    for (const inst of [...liveInstances]) {
      if (!inst.container.isConnected) inst.teardown();
    }
    const syncUrl = opts.syncUrl !== false;
    const focusId = opts.focusId || null;
    const writeQuery = syncUrl ? writeGraphQuery : () => {};
    const allChars = LoreLoader.getAll(seriesId, 'characters');
    const anchorIds = new Set(allChars.filter(c => c.role === 'protagonist').map(c => c.id));

    // ── Gated data ───────────────────────────────────────────────────────────
    //
    // gateData() applies the spoiler rules (see "Shared gated data"). It runs at
    // init and again from refresh() (Session 16: a reading-position change
    // updates the graph in place).
    let gate = null;
    let position = null;
    let chars = [];
    let charIds = new Set();
    let rels = [];
    // layerData[layer] = { entities, byId, links: [{ entityId, charId }], total },
    // visible entities and links only (each link deduped).
    let layerData = {};
    let relDegree = {};    // visible relationships per character (ego-mode node size)
    let maxRelDegree = 1;

    function computeGating() {
      gate = gateData(seriesId);
      ({ chars, charIds, rels, layerData, position } = gate);
      relDegree = {};
      for (const c of chars) relDegree[c.id] = 0;
      for (const r of rels) {
        relDegree[r.character_a] += 1;
        relDegree[r.character_b] += 1;
      }
      maxRelDegree = Math.max(1, ...Object.values(relDegree));
    }

    computeGating();

    if (chars.length === 0) {
      container.innerHTML = emptyState('No characters yet', 'Characters appear as your bookmark moves through the books.', PICKER_ACTION);
      return;
    }

    // Names of the visible anchors for the ring legend ("Holmes and Watson"),
    // built from the data: the last word of each name, alphabetical.
    function anchorNames() {
      const names = chars.filter(c => anchorIds.has(c.id)).map(c => c.name.trim().split(/\s+/).pop()).sort();
      if (names.length <= 1) return names.join('');
      return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    }

    // Canonicalise ?layers= and ?rel= up front (dedupe, drop unknowns, fix the
    // order) and rewrite the URL if that changed it.
    let activeLayers = syncUrl ? readLayersParam() : [];
    const rawLayers = syncUrl ? new URLSearchParams(location.search).get('layers') : null;
    if (rawLayers !== null && rawLayers !== activeLayers.join(',')) {
      writeQuery({ layers: activeLayers });
    }
    // Relationship groups to draw between characters (all by default).
    let activeRel = syncUrl ? readRelParam() : REL_GROUPS.map(g => g.key);
    const rawRel = syncUrl ? new URLSearchParams(location.search).get('rel') : null;
    if (rawRel !== null && rawRel !== relParamValue(activeRel)) writeQuery({ rel: activeRel });

    // Everything the graph shows at the current reading position, layers and
    // relationship filter. Pure: returns fresh spec objects, so update() can
    // merge them into the live nodes without losing their positions.
    function buildGraphData(layers) {
      if (focusId) return buildEgoData();

      const data = assemble(gate, {
        characters: 'all',
        layers,
        anchors: 'config',
        relGroups: new Set(activeRel),
      });

      // Layer nodes with no drawn edge sit on an outer ring, in reading order
      // across all active layers (first_mention, layer order, name).
      const layerRank = id => LAYER_ORDER.indexOf(id);
      for (const n of data.nodes) n.ring = false;
      const ring = data.nodes.filter(n => n.kind === 'layer' && n.degree === 0).sort((a, b) =>
        byFirstMention(a, b)
        || (layerRank(a.layer) - layerRank(b.layer))
        || a.name.localeCompare(b.name));
      ring.forEach((n, i) => { n.ring = true; n.ringIdx = i; n.ringN = ring.length; });
      return data;
    }

    // Ego mode (Session 15): the one-hop network around focusId. Character nodes
    // keep their *global* relationship-degree radius (Holmes is the same size
    // everywhere); a case or location centre is a layer-shaped node whose edges
    // to characters use the layer-edge style. No ring, anchors are drawn, and no
    // unreached dots (the ego network is small; the entry's lists count what is
    // past the bookmark).
    function buildEgoData() {
      const net = egoNetwork(seriesId, focusId);
      if (!net) return { nodes: [], links: [], hiddenCount: 0 };
      const byId = new Map(chars.map(c => [c.id, c]));
      const nodes = net.charIds.map(id => {
        const c = byId.get(id);
        return { id, kind: 'character', name: c.name, role: c.role || '', degree: relDegree[id] || 0, ring: false };
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
      return { nodes, links, hiddenCount: 0 };
    }

    let nodes = [];
    let links = [];
    let hasRendered = false; // true once update() has run (the spawn rule differs after the first)
    let nodeById = {};   // node-by-id lookup, rebuilt by update()
    let neighbors = {};  // relationship neighbours (the panel's "Connected to"), rebuilt by update()
    let drawnAdj = {};   // every drawn edge, either direction (label highlighting)

    const width  = container.clientWidth || 800;
    // Phone main graph: the whole SVG fits under the sticky header once the
    // reader scrolls to it (320-600px). Desktop is unchanged.
    const phoneHeight = () => {
      const header = document.querySelector('header');
      const headerH = header ? header.offsetHeight : 62;
      return Math.max(320, Math.min(600, window.innerHeight - (headerH + 24)));
    };
    const heightFor = w => opts.height
      ? (typeof opts.height === 'function' ? opts.height() : opts.height)
      : (isNarrow() ? phoneHeight() : CANVAS_H);
    let   height = heightFor(width); // recomputed on resize

    // ── SVG + zoom layer ─────────────────────────────────────────────────────

    const svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', height)
      .attr('class', 'graph-svg')
      .attr('aria-label', 'Relationship graph');

    // Keyboard instructions, read after the SVG's label (Session 16). Each
    // instance gets its own id, so a page with a mini-graph and a main graph
    // can't collide.
    const helpId = 'graph-help-' + (++graphSeq);
    const help = document.createElement('p');
    help.id = helpId;
    help.className = 'visually-hidden';
    help.textContent = 'Use the arrow keys to move between nodes and Enter to open details.';
    container.appendChild(help);
    svg.attr('aria-describedby', helpId);

    const g = svg.append('g').attr('class', 'graph-g');

    // Zoom to fit (Session 14.1): once the simulation settles, and again after a
    // layer toggle settles, the view is fitted to every node, unless the reader
    // has zoomed or panned themselves (zoom events with a sourceEvent: wheel,
    // drag, touch), in which case their view is left alone.
    let userTransformed = false;
    let fitPending = true;      // the final fit (alpha < 0.05, eased)
    let earlyFitPending = true; // load only: a first, un-eased fit at alpha < 0.3

    let lastPointerType = null; // pointerType of the last pointerdown on the SVG (mini-graph double-tap)

    const zoom = d3.zoom()
      .scaleExtent([fitMinScale(), 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        if (event.sourceEvent) userTransformed = true;
        // Small scales: hide most character labels (CSS keys off this class).
        svg.classed('is-zoomed-out', event.transform.k < labelMinScale());
      });
    if (focusId) {
      // Mini-graph scroll safety (Session 15b): the graph sits in the middle of a
      // scrolling page, so a plain wheel and a one-finger drag must scroll the
      // page. Wheel zooms only with Ctrl/⌘ (a macOS trackpad pinch arrives as
      // ctrl+wheel); touch zooms and pans only with two or more fingers; the
      // mouse is unchanged (d3's own default filter).
      zoom.filter((event) => {
        if (event.type === 'wheel') return event.ctrlKey || event.metaKey;
        if (event.type.startsWith('touch')) return event.touches.length >= 2;
        // A double-tap must not zoom a mini-graph (Session 16): dblclick zooms
        // only when the last pointerdown was a mouse's.
        if (event.type === 'dblclick') return lastPointerType === 'mouse' && !event.ctrlKey && !event.button;
        return !event.ctrlKey && !event.button;
      });
      svg.classed('is-mini', true); // CSS: touch-action: pan-y
    }
    svg.call(zoom);

    // Unreached dots sit under the edges and nodes. aria-hidden: they are
    // decoration, and the count is the only thing about them that is exposed.
    const dotLayer = g.append('g').attr('class', 'graph-dots').attr('aria-hidden', 'true');
    const linkLayer = g.append('g').attr('class', 'graph-links');
    const nodeLayer = g.append('g').attr('class', 'graph-nodes');
    let link = linkLayer.selectAll('line');
    let node = nodeLayer.selectAll('g');
    let hiddenCount = 0;   // entries past the bookmark, drawn as dots (set by update())
    let maxDegree = 1;     // the busiest character's degree: the radius scale
    const nodeR = d => radiusFor(d.degree, maxDegree, NODE_R_MIN, NODE_R_MAX);

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
      setCurrentNode(d.id);
      if (selectedEntityId === d.id) closePanel();
      else if (selectedEntityId) swapPanel(d.id);
      else openPanel(d.id);
    }

    // ── Force simulation ─────────────────────────────────────────────────────

    // Called once this graph's DOM is gone (from a tick, or from a resize).
    let resizeTimer = null; // the debounce timer of onResize (declared here for teardown)
    function teardown() {
      simulation.stop();
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
      liveInstances.delete(instance);
    }
    const instance = { container, teardown };
    liveInstances.add(instance);

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

    const collideRadius = d => d.kind === 'layer' ? LAYER_COLLIDE_R : nodeR(d) + 5;

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

    // Fit every node (with its radius, and a character's label to its right)
    // into the usable box, FIT_PAD all round. Never scales above FIT_MAX_SCALE;
    // clamped to the zoom's scaleExtent. 300ms ease, none under prefers-reduced-motion or
    // when `instant` (the early fit). The unreached dots are then scattered over
    // the view the fit produces, so they fill the canvas around the graph.
    function fitToView(instant) {
      if (!nodes.length) return;
      if (userTransformed) { placeDots(); return; }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const n of nodes) {
        const r = n.kind === 'layer' ? LAYER_COLLIDE_R : nodeR(n);
        const labelW = n.kind === 'layer' ? 0 : LABEL_GAP + n.name.length * labelCharW();
        x0 = Math.min(x0, n.x - r); x1 = Math.max(x1, n.x + r + labelW);
        y0 = Math.min(y0, n.y - r); y1 = Math.max(y1, n.y + r);
      }
      const w = layout.w, h = layout.h;
      const k = Math.max(fitMinScale(), Math.min(isNarrow() ? 1 : FIT_MAX_SCALE,
        (w - 2 * FIT_PAD) / Math.max(1, x1 - x0),
        (h - 2 * FIT_PAD) / Math.max(1, y1 - y0)));
      const t = d3.zoomIdentity
        .translate(w / 2 - k * (x0 + x1) / 2, h / 2 - k * (y0 + y1) / 2)
        .scale(k);
      dotView = { k, x: t.x, y: t.y, w, h };
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || instant) svg.call(zoom.transform, t);
      else svg.transition().duration(FIT_MS).call(zoom.transform, t);
      placeDots();
    }

    // ── Unreached dots ───────────────────────────────────────────────────────
    //
    // `hiddenCount` anonymous dots, positioned by scatterDots() from a constant
    // seed and the dot's index only (see its comment), over the world-space
    // rectangle the last fit made visible, away from the nodes. No identity is
    // attached: no id, name, title, class, link or tabindex, and no force acts
    // on them.
    let dotView = null; // the last fit: { k, x, y, w, h }
    function placeDots() {
      if (focusId) return;
      const v = dotView || { k: 1, x: 0, y: 0, w: layout.w, h: layout.h };
      const box = { x0: -v.x / v.k, y0: -v.y / v.k, x1: (v.w - v.x) / v.k, y1: (v.h - v.y) / v.k };
      const avoid = nodes.filter(n => n.x !== undefined).map(n => {
        const r = (n.kind === 'layer' ? LAYER_COLLIDE_R : nodeR(n)) + 10;
        const labelW = n.kind === 'layer' ? 0 : LABEL_GAP + n.name.length * labelCharW();
        return { x0: n.x - r, x1: n.x + r + labelW, y0: n.y - r, y1: n.y + r };
      });
      const pts = scatterDots(hiddenCount, box, avoid);
      dotLayer.selectAll('circle').data(pts)
        .join('circle')
        .attr('class', 'graph-dot')
        .attr('r', DOT_R / Math.max(0.5, v.k)) // about 3px on screen at the fit zoom
        .attr('cx', d => Math.round(d.x * 10) / 10)
        .attr('cy', d => Math.round(d.y * 10) / 10);
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
      hiddenCount = data.hiddenCount;
      maxDegree = Math.max(1, ...nodes.filter(n => n.kind === 'character').map(n => n.degree));

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
      // Spawn rule. The first update() leaves characters to d3's own initial
      // layout and places only layer nodes. Later updates (a layer toggle or a
      // reading-position change, Session 16) place a new node of any kind at the
      // centroid of its drawn neighbours that already have positions; failing
      // that, a ring node at its ring target and anything else at the centre.
      for (const n of nodes) {
        if (n.x !== undefined) continue;
        if (!hasRendered && n.kind !== 'layer') continue;
        const near = drawnAdj[n.id].map(id => nodeById[id]).filter(m => m && m.x !== undefined);
        if (near.length) {
          n.x = near.reduce((t, m) => t + m.x, 0) / near.length + (Math.random() - 0.5) * 4;
          n.y = near.reduce((t, m) => t + m.y, 0) / near.length + (Math.random() - 0.5) * 4;
        } else if (n.ring) {
          const t = ringTarget(n);
          n.x = t.x; n.y = t.y;
        } else if (hasRendered) {
          n.x = layout.cx + (Math.random() - 0.5) * 4;
          n.y = layout.cy + (Math.random() - 0.5) * 4;
        }
      }

      simulation.nodes(nodes);
      simulation.force('link').links(links);

      // ── Links ──────────────────────────────────────────────────────────────

      link = linkLayer.selectAll('line')
        .data(links, d => d.key)
        .join(enter => enter.append('line')
          .attr('class', d => d.layer ? 'graph-link graph-link-layer' : 'graph-link')
          .style('stroke', d => d.layer ? LAYER_CONFIG[d.layer].color : relColor(d.type))
          .attr('stroke-width', d => d.layer ? 1 : 1.5)
          .attr('stroke-opacity', d => d.layer ? 0.4 : 0.75)
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
                // Node drag is mouse-only in both modes (Session 15b, 16): a
                // finger that lands on a node scrolls (mini-graph) or pans (main
                // graph) like blank space, and a tap resolves to the nearest node.
                .filter((event) => !event.ctrlKey && !event.button
                  && !event.type.startsWith('touch'))
                .on('start', dragstarted)
                .on('drag',  dragged)
                .on('end',   dragended)
            );
          // d3-drag writes an inline touch-action: none on every node it can drag
          // (touch devices only), which beats the .is-mini class on the SVG. In a
          // mini-graph set it back, after the drag call, so a swipe that starts on
          // a node still scrolls the page (Session 15c). CSSOM via d3, which the
          // CSP allows. The main graph keeps d3's none: dragging is wanted there.
          if (focusId) n.style('touch-action', 'pan-y');

          // Selection ring (shown by CSS on .is-selected): a --bg gap, then an
          // accent ring, as the design's 0 0 0 3px bg, 0 0 0 5px accent. Radii
          // are set below on every update, since a node's size follows its degree.
          n.append('circle').attr('class', 'node-halo');
          n.append('circle').attr('class', 'node-ring');

          // Characters are circles sized by their visible connections; layer
          // nodes are fixed-size shapes (shape + colour, so colour is never the
          // only cue).
          n.filter(d => d.kind !== 'layer').append('circle')
            .attr('class', 'node-shape')
            .style('fill', d => nodeColor(d.role));

          n.filter(d => d.kind === 'layer').append('path')
            .attr('class', 'node-shape')
            .attr('d', d => d3.symbol().type(LAYER_CONFIG[d.layer].shape).size(LAYER_SYMBOL_AREA)())
            .style('fill', d => LAYER_CONFIG[d.layer].color);

          n.append('text')
            .attr('class', 'graph-label')
            .attr('dy', '0.35em')
            .attr('text-anchor', 'start')
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
            .on('focus', (event, d) => setCurrentNode(d.id))
            .on('keydown', (event, d) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activateNode(d);
              } else if (!event.altKey && !event.ctrlKey && !event.metaKey
                  && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); // keep the page from scrolling
                moveNodeFocus(d.id, event.key);
              }
            });

          return n;
        });

      // Sizes follow the current degrees on every update, not just on enter.
      const ringR = d => d.kind === 'layer' ? LAYER_RING_R : nodeR(d);
      node.select('circle.node-shape').attr('r', nodeR);
      node.select('.node-halo').attr('r', d => ringR(d) + 1.5);
      node.select('.node-ring').attr('r', d => ringR(d) + 4);
      node.select('.graph-label').attr('x', d => (d.kind === 'layer' ? LAYER_RING_R : nodeR(d)) + LABEL_GAP);

      hasRendered = true;
      syncRoving();
      markSelection();
      placeDots();
      reportStats();
      if (alpha !== undefined) simulation.alpha(alpha).restart();
    }

    // ── Roving tabindex (Session 16) ─────────────────────────────────────────
    //
    // One node at a time is a tab stop (tabindex 0, the rest -1); the arrow keys
    // move between them. The current node is the last one focused or activated,
    // initially the first in order. Main graph: characters by name, then layer
    // nodes in LAYER_ORDER and reading order. Ego mode: the centre, then the rest
    // by name.
    let navOrder = [];
    let currentNodeId = null;

    function computeNavOrder() {
      const byName = (a, b) => a.name.localeCompare(b.name);
      if (focusId) {
        const rest = nodes.filter(n => n.id !== focusId).sort(byName);
        return nodes.filter(n => n.id === focusId).concat(rest).map(n => n.id);
      }
      const chars = nodes.filter(n => n.kind === 'character').sort(byName);
      const layered = LAYER_ORDER.flatMap(l => nodes.filter(n => n.kind === 'layer' && n.layer === l).sort(byReadingOrder));
      return chars.concat(layered).map(n => n.id);
    }

    function setCurrentNode(id) {
      currentNodeId = id;
      node.attr('tabindex', d => d.id === id ? 0 : -1);
    }

    // After any update(): recompute the order; a vanished current node falls
    // back to the first.
    function syncRoving() {
      navOrder = computeNavOrder();
      setCurrentNode(navOrder.includes(currentNodeId) ? currentNodeId : (navOrder[0] || null));
    }

    function moveNodeFocus(fromId, key) {
      const n = navOrder.length;
      if (!n) return;
      const i = Math.max(0, navOrder.indexOf(fromId));
      const j = key === 'Home' ? 0 : key === 'End' ? n - 1
        : (key === 'ArrowRight' || key === 'ArrowDown') ? (i + 1) % n : (i - 1 + n) % n;
      focusNode(navOrder[j]);
    }

    // Labels on layer nodes are hidden by default (CSS); the selected node and
    // its drawn neighbours get these classes so theirs show.
    function markSelection() {
      const near = new Set(selectedEntityId && drawnAdj[selectedEntityId] ? drawnAdj[selectedEntityId] : []);
      node.classed('is-selected', d => d.id === selectedEntityId)
          .classed('is-neighbor', d => near.has(d.id));
    }

    // ── Info panel (Session 13) ──────────────────────────────────────────────

    const PANEL_W = 352; // the 320px panel plus its 16px inset each side
    // Read live rather than capturing at init: the panel switches between
    // right-dock and bottom-sheet at the same 760px breakpoint the CSS uses, so
    // a resize must change which layout the re-centring logic assumes.
    // Session 15: measure the viewport, as the CSS does, not the container (a
    // 740px mini-graph on a wide screen is a desktop layout).
    const isDesktopWidth = () => window.matchMedia('(min-width: 761px)').matches;

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

    // A "Connected to" row that swaps the panel to another node. The dash takes
    // its colour from data-rel (a relationship group) or data-layer (a layer)
    // via CSS.
    function linkRow(id, name, attr, detail) {
      return `<li><button class="panel-link" type="button" data-entity="${esc(id)}" ${attr}>`
           + `<span class="panel-dash" aria-hidden="true"></span>`
           + `<span class="panel-link-name">${esc(name)}</span>`
           + (detail ? `<span class="panel-link-type">${esc(detail)}</span>` : '')
           + `</button></li>`;
    }

    function panelHtml(entity, typeLabel, name, desc, connectedHtml, href) {
      const closeBtn = '<button class="panel-close" type="button" aria-label="Close panel">&times;</button>';
      const first = entity.first_mention
        ? `<p class="panel-first">First appears in ${esc(formatPosition(entity.first_mention, seriesId))}</p>` : '';
      return `
        ${closeBtn}
        <div class="panel-scroll">
          <p class="panel-type">${esc(typeLabel)}</p>
          <h2 class="panel-name">${esc(name)}</h2>
          ${first}
          <p class="panel-desc">${desc}</p>
          ${connectedHtml}
        </div>
        <a class="btn btn-primary panel-view-full" href="${href}">Open entry &rarr;</a>
      `;
    }

    function renderPanelContent(id) {
      const entity = LoreLoader.getById(id);
      const closeBtn = '<button class="panel-close" type="button" aria-label="Close panel">&times;</button>';
      if (!entity) return closeBtn + '<p class="panel-empty">Entity unavailable.</p>';
      if (nodeById[id] && nodeById[id].kind === 'layer') return renderLayerPanel(entity, nodeById[id].layer);

      const status = SpoilerGate.getRevealStatus(entity, seriesId);
      const bioText = proseText(entity, 'biography', seriesId).text;
      const desc = status === 'partial'
        ? redactedProse(entity)
        : (bioText
            ? esc(firstSentencesForMeta(bioText, 120))
            : '<span class="panel-empty">No description available.</span>');

      // Every relationship drawn at this node, once per partner, by name. The
      // list is complete: nothing is capped, so it matches what the canvas draws.
      const seen = new Set();
      const uniq = [];
      for (const x of (neighbors[id] || [])) {
        if (!seen.has(x.id)) { seen.add(x.id); uniq.push(x); }
      }
      uniq.sort((a, b) =>
        (nodeById[a.id]?.name || '').localeCompare(nodeById[b.id]?.name || ''));
      // Ego mode lists only the nodes in the view (a swap needs a node, and the
      // centre does nothing); the rest are counted below the list.
      let hiddenNote = '';
      if (focusId) {
        for (let i = uniq.length - 1; i >= 0; i--) if (uniq[i].id === focusId) uniq.splice(i, 1);
        const partners = new Set();
        for (const r of rels) {
          if (r.character_a === id) partners.add(r.character_b);
          else if (r.character_b === id) partners.add(r.character_a);
        }
        partners.delete(focusId);
        const more = partners.size - uniq.length;
        if (more > 0) hiddenNote = `<p class="panel-more">+${more} more in the full graph</p>`;
      }
      const rows = uniq.map(x => linkRow(x.id, nodeById[x.id]?.name || x.id,
        `data-rel="${esc(relTypeGroup(x.type))}"`, humanize(x.type))).join('');
      const connected = rows
        ? `<h3 class="panel-count">Connected to</h3><ul class="panel-links">${rows}</ul>${hiddenNote}`
        : '<p class="panel-empty">No connections at your reading position.</p>';

      return panelHtml(entity, 'Character', entity.name || id, desc,
        connected + renderLayerSections(id), entityPath(seriesId, 'characters', id));
    }

    // Character panel: one section per active layer, from the data's visible
    // links (not the drawn edges, which leave out the anchors), so Holmes's 60
    // cases show here even though none is drawn. First 5 in reading order, with
    // the total in the heading and "+N more" under the list.
    function renderLayerSections(charId) {
      return activeLayers.map(layer => {
        const ids = new Set(layerData[layer].links.filter(l => l.charId === charId).map(l => l.entityId));
        if (ids.size === 0) return '';
        const cfg = LAYER_CONFIG[layer];
        const ents = layerData[layer].entities.filter(e => ids.has(e.id)); // already reading order
        const rows = ents.slice(0, MAX_LAYER_CHIPS)
          .map(e => linkRow(e.id, layerEntityName(e), `data-layer="${esc(layer)}"`)).join('');
        const more = ents.length > MAX_LAYER_CHIPS
          ? `<p class="panel-more">+${ents.length - MAX_LAYER_CHIPS} more</p>` : '';
        return `<h3 class="panel-count">${esc(cfg.label)} (${ents.length})</h3>`
             + `<ul class="panel-links">${rows}</ul>${more}`;
      }).join('');
    }

    // Layer-node panel: title, type, first appearance, description, every
    // visible linked character (anchors included), entry link.
    function renderLayerPanel(entity, layer) {
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
      const rows = linked.map(c => linkRow(c.id, c.name, `data-layer="${esc(layer)}"`)).join('');
      const connected = rows
        ? `<h3 class="panel-count">Connected to</h3><ul class="panel-links">${rows}</ul>`
        : '<p class="panel-empty">No characters linked at your reading position.</p>';

      return panelHtml(entity, cfg.singular, layerEntityName(entity), desc, connected,
        entityPath(seriesId, layer, entity.id));
    }

    function bindPanelControls() {
      const closeBtn = panel.querySelector('.panel-close');
      if (closeBtn) closeBtn.addEventListener('click', closePanel);

      panel.querySelectorAll('.panel-link').forEach(btn => {
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
      if (restore) recenter(); // the first fit has not run yet: fit into the area the panel leaves
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
    // when a filter toggle closes the panel and focus should stay on the sidebar).
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
      setCurrentNode(id);
      const el = node.filter(d => d.id === id).node();
      if (el && el.focus) el.focus();
    }

    // One tap handler on Pointer Events (Session 16), replacing the old mouse and
    // touch handlers: d3-zoom's mousedown/touchstart call stopImmediatePropagation(),
    // so those never ran and background-click dismissal was dead. d3 never stops
    // Pointer Events. A tap is one pointer, moved < 6px (mouse) or < 10px (touch,
    // pen), pressed < 500ms, that did not land on a node (a node's own click
    // handles that). A touch or pen tap opens the nearest node within 22 screen px
    // (so small, crowded nodes are reachable); with none, it closes an open panel.
    // A mouse tap on the background closes an open panel.
    const pointers = new Map();
    let multi = false;
    svg.on('pointerdown', (event) => {
      lastPointerType = event.pointerType;
      // A mouse released outside the SVG never sends us a pointerup: forget it.
      if (event.pointerType === 'mouse') pointers.clear();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, t: event.timeStamp, type: event.pointerType });
      if (pointers.size > 1) multi = true;
    });
    svg.on('pointercancel', (event) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) multi = false;
    });
    svg.on('pointerup', (event) => {
      const start = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);
      const wasMulti = multi;
      if (!pointers.size) multi = false;
      if (!start || wasMulti) return;
      const mouse = start.type === 'mouse';
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= (mouse ? TAP_MOVE_MOUSE : TAP_MOVE_TOUCH)) return;
      if (event.timeStamp - start.t >= TAP_MAX_MS) return;
      if (event.target.closest && event.target.closest('.graph-node')) return;
      if (!mouse) {
        const t = d3.zoomTransform(svg.node());
        const [gx, gy] = t.invert(d3.pointer(event, svg.node()));
        const d = simulation.find(gx, gy, TAP_RADIUS_PX / t.k);
        if (d) { activateNode(d); return; }
      }
      if (selectedEntityId !== null) closePanel();
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
    function onResize() {
      if (!document.body.contains(container)) {
        window.removeEventListener('resize', onResize);
        return;
      }
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(relayout, 150);
    }
    window.addEventListener('resize', onResize);

    // Re-measure and re-fit for the current viewport: the body of the debounced
    // resize. Also called when the graph is shown again after being hidden (list
    // mode, Session 16), since a resize while it was hidden measured a width of 0.
    function relayout() {
      const w = container.clientWidth;
      if (!w) return;
      height = heightFor(w);
      svg.attr('height', height);
      zoom.scaleExtent([fitMinScale(), 5]);
      svg.classed('is-zoomed-out', d3.zoomTransform(svg.node()).k < labelMinScale());
      recenter();
      fitPending = true;
      simulation.alpha(0.3).restart();
    }

    // ── Stats for the page chrome ────────────────────────────────────────────
    //
    // The sidebar (views.js) draws the layer and relationship toggles, the fog
    // note and the outer-ring note. It gets what it needs from here after every
    // update(): counts only, no names of anything past the bookmark.
    function anchorsOnRing() {
      const who = anchorNames();
      return `Outer ring: linked only to ${who || 'no visible character'}${who ? ', or to no character' : ''}.`;
    }

    function reportStats() {
      if (!opts.onUpdate) return;
      const layerCounts = {};
      for (const layer of LAYER_ORDER) layerCounts[layer] = layerData[layer].entities.length;
      opts.onUpdate({
        hiddenCount,
        layerCounts,
        layers: activeLayers.slice(),
        relGroups: activeRel.slice(),
        ringNote: nodes.some(n => n.ring) ? anchorsOnRing() : '',
      });
    }

    // ── Layers and relationship filter ───────────────────────────────────────

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
      afterFilterChange();
    }

    // Which relationship groups are drawn between characters, in place. Writes
    // ?rel= (absent = all).
    function setRelGroups(list) {
      const next = canonicalRel(list);
      if (next.join(',') === activeRel.join(',')) return;
      activeRel = next;
      writeQuery({ rel: activeRel });
      afterFilterChange();
    }

    function afterFilterChange() {
      fitPending = true;
      update(0.5);
      if (selectedEntityId !== null) {
        if (nodeById[selectedEntityId]) {
          // Connections and sections change with the filters, so re-render in place.
          panel.innerHTML = renderPanelContent(selectedEntityId);
          bindPanelControls();
        } else {
          closePanel({ restoreFocus: false });
        }
      }
    }

    // Re-gate for the current reading position and update in place (Session 16),
    // keeping the SVG, zoom and pan, the layers and the open panel. Returns false
    // when nothing is visible any more, so the caller falls back to a full
    // re-render (which shows the empty state).
    function refresh() {
      computeGating();
      if (chars.length === 0) return false;
      fitPending = true; // the fit skips itself when the reader has zoomed or panned
      update(0.5);
      if (selectedEntityId !== null) {
        if (nodeById[selectedEntityId]) {
          panel.innerHTML = renderPanelContent(selectedEntityId);
          bindPanelControls();
        } else {
          closePanel({ restoreFocus: false });
        }
      }
      return true;
    }

    // ── Zoom controls ────────────────────────────────────────────────────────
    //
    // 40px +, - and Fit buttons at the canvas's bottom-left (main graph only).
    // Fit hands the view back to the automatic fit.
    function createZoomControls() {
      const bar = document.createElement('div');
      bar.className = 'graph-zoom';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Zoom');
      bar.innerHTML =
        '<button type="button" data-zoom="in" aria-label="Zoom in">+</button>'
        + '<button type="button" data-zoom="out" aria-label="Zoom out">&minus;</button>'
        + '<button type="button" data-zoom="fit" aria-label="Fit graph to view">Fit</button>';
      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.zoom === 'fit') { userTransformed = false; fitToView(); return; }
        userTransformed = true; // a manual zoom, like a wheel: the auto-fit leaves the view alone
        svg.transition().duration(180).call(zoom.scaleBy, btn.dataset.zoom === 'in' ? 1.4 : 1 / 1.4);
      });
      container.appendChild(bar);
    }
    if (!focusId) createZoomControls();

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
      setRelGroups,
      refresh,
      relayout,
      destroy: teardown,
      getLayers: () => activeLayers.slice(),
      getRelGroups: () => activeRel.slice(),
      getSelectedEntityId: () => selectedEntityId,
    };
  }

  return { init, egoNodeCount, buildData, layoutStatic, scatterDots, radiusFor, LAYER_CONFIG, LAYER_ORDER };

})();
