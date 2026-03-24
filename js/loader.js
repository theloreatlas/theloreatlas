/**
 * loader.js — The Lore Atlas data loader
 *
 * Fetches manifest.json, then all entity _index.json files for every series.
 * Builds an in-memory store and lookup map (id → entity object).
 *
 * Usage:
 *   await LoreLoader.load();
 *   const holmes = LoreLoader.getById('char_sherlock-holmes');
 *   const allChars = LoreLoader.getAll('sherlock_holmes', 'characters');
 */

const LoreLoader = (() => {

  // ── Internal state ──────────────────────────────────────────────────────────

  // store[seriesId][entityType] = array of entity objects
  const store = {};

  // lookup[id] = entity object  (for fast cross-reference resolution)
  const lookup = {};

  // The parsed manifest
  let manifest = null;

  // Track load state
  let loaded = false;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Fetch a JSON file. Returns parsed object or throws on failure.
   */
  async function fetchJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
    return res.json();
  }

  /**
   * Index all entities from an array into the lookup map.
   */
  function indexEntities(entities) {
    for (const entity of entities) {
      if (entity.id) {
        lookup[entity.id] = entity;
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Load all data. Safe to call multiple times — resolves immediately if
   * already loaded.
   */
  async function load() {
    if (loaded) return;

    // Determine base path — works both on GitHub Pages (/theloreatlas/)
    // and locally (file:// or localhost root)
    const base = getBasePath();

    // 1. Fetch manifest
    manifest = await fetchJSON(`${base}data/manifest.json`);

    // 2. For each series, fetch all entity type indexes in parallel
    for (const series of manifest.series) {
      store[series.id] = {};

      const fetches = Object.entries(series.entity_indexes).map(
        async ([entityType, indexPath]) => {
          const entities = await fetchJSON(`${base}${indexPath}`);
          store[series.id][entityType] = entities;
          indexEntities(entities);
        }
      );

      await Promise.all(fetches);
    }

    loaded = true;
  }

  /**
   * Returns the base path for fetching data files.
   * Handles GitHub Pages subdirectory and local development.
   */
  function getBasePath() {
    const path = window.location.pathname;
    // GitHub Pages: site lives at /theloreatlas/
    // Match anything ending in /theloreatlas/ or /theloreatlas/index.html etc.
    const match = path.match(/^(\/[^/]+\/)/);
    if (match && window.location.hostname.includes('github.io')) {
      return match[1];
    }
    return '/';
  }

  /**
   * Look up any entity by its prefixed ID.
   * Returns the entity object, or null if not found.
   */
  function getById(id) {
    return lookup[id] || null;
  }

  /**
   * Get all entities of a given type within a series.
   * e.g. getAll('sherlock_holmes', 'characters')
   */
  function getAll(seriesId, entityType) {
    if (!store[seriesId]) return [];
    return store[seriesId][entityType] || [];
  }

  /**
   * Get all series from the manifest.
   */
  function getSeries() {
    if (!manifest) return [];
    return manifest.series;
  }

  /**
   * Get a single series object by id.
   */
  function getSeriesById(id) {
    if (!manifest) return null;
    return manifest.series.find(s => s.id === id) || null;
  }

  /**
   * Resolve an array of IDs to entity objects.
   * IDs that can't be resolved are silently skipped.
   */
  function resolveIds(ids) {
    if (!Array.isArray(ids)) return [];
    return ids.map(id => lookup[id]).filter(Boolean);
  }

  /**
   * Returns true if data has been loaded.
   */
  function isLoaded() {
    return loaded;
  }

  return { load, getById, getAll, getSeries, getSeriesById, resolveIds, isLoaded };

})();
