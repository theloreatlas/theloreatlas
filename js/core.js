/**
 * core.js — Entity-type config, HTML escaping, routing/URL helpers, canonical link
 * Part of The Lore Atlas SPA (split from app.js, Session 13.5).
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

// Entity type → ID prefix. Used to round-trip clean URL slugs back into
// prefixed entity IDs at lookup time.
const ENTITY_TYPE_TO_PREFIX = {
  characters:    'char',
  cases:         'case',
  factions:      'faction',
  books:         'book',
  locations:     'loc',
  artifacts:     'artifact',
  events:        'event',
  relationships: 'rel',
};

const KNOWN_PREFIXES = /^(char|case|faction|book|loc|artifact|event|rel)_/;

// 'char_sherlock-holmes' → 'sherlock-holmes'
function entityIdToUrlSlug(id) {
  const idx = id.indexOf('_');
  return idx === -1 ? id : id.substring(idx + 1);
}

// 'sherlock-holmes' (under entityType 'characters') → 'char_sherlock-holmes'
// Backwards-compat: if slug already has a known prefix, pass through unchanged.
function urlSlugToEntityId(entityType, slug) {
  if (KNOWN_PREFIXES.test(slug)) return slug;
  const prefix = ENTITY_TYPE_TO_PREFIX[entityType];
  return prefix ? `${prefix}_${slug}` : null;
}

// URL builders — use these everywhere instead of string-templating paths.
// Trailing slashes match GitHub Pages's directory-index behavior (301 without → with).
function entityPath(seriesId, entityType, id) {
  return `/${encodeURIComponent(seriesId)}/${encodeURIComponent(entityType)}/${encodeURIComponent(entityIdToUrlSlug(id))}/`;
}
function entityListPath(seriesId, entityType) {
  return `/${encodeURIComponent(seriesId)}/${encodeURIComponent(entityType)}/`;
}
function graphPath(seriesId) {
  return `/${encodeURIComponent(seriesId)}/graph/`;
}
function searchPath(query) {
  return query ? `/search?q=${encodeURIComponent(query)}` : '/search';
}

function parseRoute() {
  const path = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  return path ? path.split('/').map(decodeURIComponent) : [];
}

function navigate(path) {
  const current = window.location.pathname + window.location.search;
  if (path === current) return;
  history.pushState(null, '', path);
  onRouteChange();
}

// Convert any pre-existing #/... URL to the new path shape and replaceState.
// Runs once on DOMContentLoaded, before route dispatch.
function maybeRedirectLegacyHash() {
  const hash = window.location.hash;
  if (!hash || hash === '#' || !hash.startsWith('#/')) return;

  const stripped = hash.substring(2); // strip '#/'
  const [pathPart, queryPart] = stripped.split('?');
  const parts = pathPart.split('/').filter(Boolean);

  // Entity-detail URLs (3 segments): strip the entity ID prefix.
  if (parts.length === 3) {
    parts[2] = entityIdToUrlSlug(parts[2]);
  }

  // Append trailing slash for non-root entity paths to match canonical form.
  let newPath = parts.length ? '/' + parts.join('/') : '/';
  if (newPath !== '/' && !newPath.endsWith('/')) newPath += '/';
  const newUrl = queryPart ? newPath + '?' + queryPart : newPath;
  history.replaceState(null, '', newUrl);
}

// Intercept clicks on internal <a href="/..."> links and route via pushState.
// Honors modifier keys, target="_blank", and an opt-out via data-external.
function setupLinkInterception() {
  document.addEventListener('click', function (e) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/')) return;
    if (a.target && a.target !== '_self') return;
    if (a.dataset.external !== undefined) return;
    e.preventDefault();
    navigate(href);
  });
}

// Set <link rel="canonical"> based on current path. Excludes query strings.
// Appends trailing slash for non-root paths to match pre-rendered file layout
// and GitHub Pages's directory-index redirect behavior.
function setCanonical() {
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  let p = window.location.pathname;
  if (p !== '/' && !p.endsWith('/')) p += '/';
  link.setAttribute('href', 'https://theloreatlas.com' + p);
}

