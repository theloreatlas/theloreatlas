/**
 * app.js — Orchestrator: route dispatch (onRouteChange) + bootstrap
 * Part of The Lore Atlas SPA (split from app.js, Session 13.5).
 */

// A static skeleton in the shape of an entry page, so the layout doesn't jump.
// ⚠️  KEEP IN SYNC with the markup inside <main> in index.html (the pre-rendered
//     shell shows the same blocks before any script has run).
const LOADING_HTML = '<div class="page-wide skeleton" aria-hidden="true">'
  + '<div class="skel-main"><span class="skel-bar skel-crumb"></span><span class="skel-block skel-title"></span>'
  + '<div class="skel-pills"><span class="skel-pill skel-pill-sm"></span><span class="skel-pill skel-pill-lg"></span></div>'
  + '<span class="skel-bar skel-w1"></span><span class="skel-bar skel-w2"></span><span class="skel-bar skel-w3"></span><span class="skel-bar skel-w4"></span></div>'
  + '<div class="skel-side"><span class="skel-block skel-card skel-card-tall"></span><span class="skel-block skel-card"></span></div>'
  + '</div><span class="visually-hidden">Loading</span>';

async function onRouteChange() {
  teardownGraphPage(); // the graph page's own listeners (Session 16)
  const parts = parseRoute();
  const content = document.getElementById('main-content');
  if (!content) return;

  // The search page has its own input, so CSS hides the header's field there.
  document.documentElement.dataset.page = parts[0] === 'search' ? 'search' : '';

  content.innerHTML = LOADING_HTML;
  content.setAttribute('aria-busy', 'true');
  content.classList.remove('page-enter');

  try {
    await LoreLoader.load();
  } catch (err) {
    console.error('Data load failed:', err);
    content.innerHTML = '<p class="state-error">Failed to load data. Please try refreshing the page.</p>';
    content.removeAttribute('aria-busy');
    return;
  }

  initBookmarkBar();
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
    if (_seriesObj) renderHome(content, parts[0]); else renderNotFound(content);
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

  content.removeAttribute('aria-busy');
  void content.offsetWidth; // force reflow for entrance animation
  content.classList.add('page-enter');
}


// ── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('popstate', onRouteChange);
window.addEventListener('DOMContentLoaded', () => {
  maybeRedirectLegacyHash();
  setupLinkInterception();
  initSiteSearch();
  onRouteChange();
});
