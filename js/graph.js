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

  // opts.layerControls (default true): whether the layer toolbar is shown.
  // Session 15 mini-graphs pass false and drive layers through the controller.
  function init(container, seriesId, opts = {}) {
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

    // Canonicalise ?layers= up front (dedupe, drop unknowns, fix the order) and
    // rewrite the URL if that changed it.
    let activeLayers = readLayersParam();
    const rawLayers = new URLSearchParams(location.search).get('layers');
    if (rawLayers !== null && rawLayers !== activeLayers.join(',')) {
      writeGraphQuery({ layers: activeLayers });
    }

    // Everything the graph shows at the current reading position and layer
    // selection. Pure: returns fresh spec objects, so update() can merge them
    // into the live nodes without losing their positions.
    function buildGraphData(layers) { // eslint-disable-line no-unused-vars
      // Degree count for node sizing
      const degree = {};
      for (const c of chars) degree[c.id] = 0;
      for (const r of rels) {
        degree[r.character_a] = (degree[r.character_a] || 0) + 1;
        degree[r.character_b] = (degree[r.character_b] || 0) + 1;
      }

      return {
        nodes: chars.map(c => ({
          id:     c.id,
          name:   c.name,
          role:   c.role || '',
          degree: degree[c.id] || 0,
        })),
        links: rels.map(r => ({
          source: r.character_a,
          target: r.character_b,
          type:   r.relationship_type || 'other',
          relId:  r.id,
          key:    'rel:' + r.id,
        })),
      };
    }

    let nodes = [];
    let links = [];
    let nodeById = {};   // node-by-id lookup, rebuilt by update()
    let neighbors = {};  // neighbour adjacency built from links, rebuilt by update()

    const width  = container.clientWidth || 800;
    let   height = Math.max(600, Math.round(width * 0.65)); // recomputed on resize

    // ── SVG + zoom layer ─────────────────────────────────────────────────────

    const svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', height)
      .attr('class', 'graph-svg')
      .attr('aria-label', 'Relationship graph');

    const g = svg.append('g').attr('class', 'graph-g');

    svg.call(
      d3.zoom()
        .scaleExtent([0.25, 5])
        .on('zoom', (event) => g.attr('transform', event.transform))
    );

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
      lastFocusedNodeId = d.id;
      if (selectedEntityId === d.id) closePanel();
      else if (selectedEntityId) swapPanel(d.id);
      else openPanel(d.id);
    }

    // ── Force simulation ─────────────────────────────────────────────────────

    const simulation = d3.forceSimulation(nodes)
      .force('link',      d3.forceLink(links).id(d => d.id).distance(90))
      .force('charge',    d3.forceManyBody().strength(-220))
      .force('center',    d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => nodeRadius(d.degree) + 5))
      .on('tick', () => {
        link
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);

        node.attr('transform', d => `translate(${d.x},${d.y})`);
      });

    // Rebuild the graph for the current reading position and layers, in place:
    // keyed joins, and existing node objects are kept so their x/y carry over.
    // `alpha` (optional) reheats the simulation; the first call leaves it at 1.
    function update(alpha) {
      const data = buildGraphData(activeLayers);

      const prev = new Map(nodes.map(n => [n.id, n]));
      nodes = data.nodes.map(spec => {
        const old = prev.get(spec.id);
        return old ? Object.assign(old, spec) : spec;
      });
      links = data.links;

      nodeById = {};
      for (const n of nodes) nodeById[n.id] = n;
      neighbors = {};
      for (const n of nodes) neighbors[n.id] = [];
      for (const l of links) {
        neighbors[l.source].push({ id: l.target, type: l.type });
        neighbors[l.target].push({ id: l.source, type: l.type });
      }

      simulation.nodes(nodes);
      simulation.force('link').links(links);

      // ── Links ──────────────────────────────────────────────────────────────

      link = linkLayer.selectAll('line')
        .data(links, d => d.key)
        .join(enter => enter.append('line')
          .attr('class', 'graph-link')
          .attr('stroke', d => relColor(d.type))
          .attr('stroke-width', 1.5)
          .attr('stroke-opacity', 0.55)
          .on('mouseover', (event, d) => {
            const srcName = typeof d.source === 'object' ? d.source.name : d.source;
            const tgtName = typeof d.target === 'object' ? d.target.name : d.target;
            showTooltip(event,
              `<span class="tt-role">${esc(d.type)}</span><br>${esc(srcName)} ↔ ${esc(tgtName)}`
            );
          })
          .on('mousemove', moveTooltip)
          .on('mouseleave', hideTooltip));

      // ── Nodes ──────────────────────────────────────────────────────────────

      node = nodeLayer.selectAll('g.graph-node')
        .data(nodes, d => d.id)
        .join(enter => {
          const n = enter.append('g')
            .attr('class', 'graph-node')
            .attr('tabindex', 0)
            .attr('role', 'button')
            .attr('aria-label', d => d.name)
            .call(
              d3.drag()
                .on('start', dragstarted)
                .on('drag',  dragged)
                .on('end',   dragended)
            );

          n.append('circle')
            .attr('r', d => nodeRadius(d.degree))
            .attr('fill', d => nodeColor(d.role))
            .attr('stroke', '#1a1510')
            .attr('stroke-width', 1);

          n.append('text')
            .attr('class', 'graph-label')
            .attr('dy', d => nodeRadius(d.degree) + 13)
            .attr('text-anchor', 'middle')
            .text(d => d.name);

          n.on('mouseover', (event, d) => {
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

      renderLegend();
      if (alpha !== undefined) simulation.alpha(alpha).restart();
    }

    // ── Info panel (Session 13) ──────────────────────────────────────────────

    const PANEL_W = 320;
    // Read live rather than capturing at init: the panel switches between
    // right-dock and bottom-sheet at the same 768px breakpoint the CSS uses, so
    // a resize must change which layout the re-centring logic assumes.
    const isDesktopWidth = () => (container.clientWidth || width) >= 768;

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

      const count = uniq.length;
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
        ${chips ? `<div class="panel-chips">${chips}</div>` : ''}
        <a class="panel-view-full" href="${entityPath(seriesId, 'characters', id)}">View full page &rarr;</a>
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
      simulation.force('center', d3.forceCenter(usable / 2, height / 2));
    }

    function openPanel(id, opts) {
      const restore = opts && opts.restore;
      selectedEntityId = id;
      panel.innerHTML = renderPanelContent(id);
      bindPanelControls();
      panel.hidden = false;
      requestAnimationFrame(() => panel.classList.add('open'));
      if (!restore) {
        recenter();
        simulation.alpha(0.3).restart();
        writeGraphQuery({ selected: id });
        panel.focus();
      }
    }

    function swapPanel(id) {
      // No slide, no re-centre (viewport width unchanged) — just swap content + URL.
      selectedEntityId = id;
      panel.innerHTML = renderPanelContent(id);
      bindPanelControls();
      writeGraphQuery({ selected: id });
    }

    function closePanel() {
      if (selectedEntityId === null) return;
      selectedEntityId = null;
      panel.classList.remove('open');
      writeGraphQuery({ selected: null });
      recenter();
      simulation.alpha(0.3).restart();

      const finish = () => {
        if (selectedEntityId === null) panel.hidden = true;
        panel.removeEventListener('transitionend', finish);
      };
      panel.addEventListener('transitionend', finish);
      setTimeout(finish, 260); // fallback if transitionend doesn't fire

      focusNode(lastFocusedNodeId);
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
    update();

    const requested = new URLSearchParams(location.search).get('selected');
    if (requested) {
      if (nodeById[requested]) {
        lastFocusedNodeId = requested;
        openPanel(requested, { restore: true });
      } else {
        writeGraphQuery({ selected: null });
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
        height = Math.max(600, Math.round(w * 0.65));
        svg.attr('height', height);
        recenter();
        simulation.alpha(0.3).restart();
      }, 150);
    }
    window.addEventListener('resize', onResize);

    // ── Legend ───────────────────────────────────────────────────────────────

    function renderLegend() {
      d3.select(container).select('.graph-legend').remove();

      const presentTypes = [...new Set(links.map(l => l.type))].sort();
      if (presentTypes.length === 0) return;

      const legend = d3.select(container)
        .append('div')
        .attr('class', 'graph-legend');

      legend.append('p').attr('class', 'graph-legend-title').text('Relationship types');

      for (const type of presentTypes) {
        const item = legend.append('div').attr('class', 'graph-legend-item');
        item.append('span')
          .attr('class', 'graph-legend-swatch')
          .style('background', relColor(type));
        item.append('span').text(type);
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
      getSelectedEntityId: () => selectedEntityId,
    };
  }

  return { init };

})();
