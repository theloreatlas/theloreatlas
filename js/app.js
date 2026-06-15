/**
 * app.js — Orchestrator: route dispatch (onRouteChange) + bootstrap
 * Part of The Lore Atlas SPA (split from app.js, Session 13.5).
 */

async function onRouteChange() {
  const parts = parseRoute();
  const content = document.getElementById('main-content');
  if (!content) return;

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
  setCanonical();

  // Route dispatch — compute shared vars, then render + set meta + set JSON-LD.
  let _entity = null, _entityType = null, _seriesObj = null;

  if (parts.length === 0) {
    setMetaTags(parts, null, null, '', false);
    renderHome(content);
  } else if (parts.length === 1 && parts[0] === 'series') {
    setMetaTags(parts, null, null, '', false);
    renderHome(content);
  } else if (parts.length >= 1 && parts[0] === 'search') {
    setMetaTags(parts, null, null, '', false);
    renderSearch(content);
  } else if (parts.length === 1) {
    _seriesObj = LoreLoader.getSeriesById(parts[0]);
    const seriesName = _seriesObj ? _seriesObj.name : '';
    setMetaTags(parts, null, null, seriesName, !_seriesObj);
    renderHome(content);
  } else if (parts.length === 2) {
    const [seriesId, entityType] = parts;
    _seriesObj = LoreLoader.getSeriesById(seriesId);
    _entityType = entityType;
    const seriesName = _seriesObj ? _seriesObj.name : '';
    if (entityType === 'graph') {
      setMetaTags(parts, null, null, seriesName, false);
      renderGraph(content, seriesId);
    } else {
      setMetaTags(parts, null, entityType, seriesName, false);
      renderEntityList(content, seriesId, entityType);
    }
  } else if (parts.length === 3) {
    const [seriesId, entityType, slug] = parts;
    const id = urlSlugToEntityId(entityType, slug);
    _entity = LoreLoader.getById(id);
    _entityType = entityType;
    _seriesObj = LoreLoader.getSeriesById(seriesId);
    const seriesName = _seriesObj ? _seriesObj.name : '';
    if (!_entity) {
      setMetaTags(parts, null, entityType, seriesName, true);
      renderNotFound(content);
    } else {
      setMetaTags(parts, _entity, entityType, seriesName, false);
      renderEntityDetail(content, seriesId, entityType, id);
    }
  } else {
    setMetaTags(parts, null, null, '', true);
    renderNotFound(content);
  }

  setJsonLd(parts, _entity, _entityType, _seriesObj);

  void content.offsetWidth; // force reflow for entrance animation
  content.classList.add('page-enter');
}


// ── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('popstate', onRouteChange);
window.addEventListener('DOMContentLoaded', () => {
  maybeRedirectLegacyHash();
  setupLinkInterception();
  onRouteChange();
});
