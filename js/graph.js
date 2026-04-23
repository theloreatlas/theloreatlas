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

  function init(container, seriesId) {
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

    // Degree count for node sizing
    const degree = {};
    for (const c of chars) degree[c.id] = 0;
    for (const r of rels) {
      degree[r.character_a] = (degree[r.character_a] || 0) + 1;
      degree[r.character_b] = (degree[r.character_b] || 0) + 1;
    }

    const nodes = chars.map(c => ({
      id:     c.id,
      name:   c.name,
      role:   c.role || '',
      degree: degree[c.id] || 0,
    }));

    const links = rels.map(r => ({
      source: r.character_a,
      target: r.character_b,
      type:   r.relationship_type || 'other',
      relId:  r.id,
    }));

    const width  = container.clientWidth || 800;
    const height = Math.max(600, Math.round(width * 0.65));

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

    // ── Links ────────────────────────────────────────────────────────────────

    const link = g.append('g').attr('class', 'graph-links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('class', 'graph-link')
      .attr('stroke', d => relColor(d.type))
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.55);

    // ── Nodes ────────────────────────────────────────────────────────────────

    const node = g.append('g').attr('class', 'graph-nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', 'graph-node')
      .call(
        d3.drag()
          .on('start', dragstarted)
          .on('drag',  dragged)
          .on('end',   dragended)
      );

    node.append('circle')
      .attr('r', d => nodeRadius(d.degree))
      .attr('fill', d => nodeColor(d.role))
      .attr('stroke', '#1a1510')
      .attr('stroke-width', 1);

    node.append('text')
      .attr('class', 'graph-label')
      .attr('dy', d => nodeRadius(d.degree) + 13)
      .attr('text-anchor', 'middle')
      .text(d => d.name);

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

    node
      .on('mouseover', (event, d) => {
        const roleLabel = d.role ? `<br><span class="tt-role">${d.role.replace(/_/g, ' ')}</span>` : '';
        const degLabel  = `<br><span class="tt-degree">${d.degree} connection${d.degree !== 1 ? 's' : ''}</span>`;
        showTooltip(event, `<strong>${d.name}</strong>${roleLabel}${degLabel}`);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip)
      .on('click', (event, d) => {
        window.location.hash = `#/${encodeURIComponent(seriesId)}/characters/${encodeURIComponent(d.id)}`;
      });

    link
      .on('mouseover', (event, d) => {
        const srcName = typeof d.source === 'object' ? d.source.name : d.source;
        const tgtName = typeof d.target === 'object' ? d.target.name : d.target;
        showTooltip(event,
          `<span class="tt-role">${d.type}</span><br>${srcName} ↔ ${tgtName}`
        );
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip);

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

    // ── Legend ───────────────────────────────────────────────────────────────

    const presentTypes = [...new Set(links.map(l => l.type))].sort();

    if (presentTypes.length > 0) {
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
  }

  return { init };

})();
