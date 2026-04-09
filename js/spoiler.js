/**
 * spoiler.js — Spoiler gating for The Lore Atlas
 *
 * Reading position: { book: int, chapter: int }
 * where `book` is the chronological_order of the source book (1–9 for Holmes).
 *
 * Gating rules (applied to each entity's first_mention / full_reveal thresholds):
 *   position < first_mention              → 'hidden'  (entity not yet encountered)
 *   first_mention ≤ position < full_reveal → 'partial' (name visible, prose redacted)
 *   position ≥ full_reveal                → 'full'    (all content visible)
 *   No position set                       → 'full'    (ungated — default)
 */

const SpoilerGate = (() => {

  const STORAGE_PREFIX = 'loreAtlas_readerPosition_';

  // Chapter counts for Holmes novels.
  // Collections derive their count from stories_contained.length.
  const NOVEL_CHAPTER_COUNTS = {
    'book_a-study-in-scarlet':            14,
    'book_the-sign-of-the-four':          12,
    'book_the-hound-of-the-baskervilles': 15,
    'book_the-valley-of-fear':            14,
  };

  // ── Position comparison ─────────────────────────────────────────────────────

  /**
   * Compare two reading positions { book, chapter }.
   * Returns negative if a < b, 0 if equal, positive if a > b.
   */
  function comparePositions(a, b) {
    if (a.book !== b.book) return a.book - b.book;
    return a.chapter - b.chapter;
  }

  // ── localStorage I/O ────────────────────────────────────────────────────────

  /**
   * Returns the stored reading position for a series, or null if none set.
   */
  function getPosition(seriesId) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + seriesId);
      if (!raw) return null;
      const pos = JSON.parse(raw);
      if (typeof pos.book === 'number' && typeof pos.chapter === 'number') return pos;
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Save a reading position for a series.
   */
  function setPosition(seriesId, book, chapter) {
    localStorage.setItem(STORAGE_PREFIX + seriesId, JSON.stringify({ book, chapter }));
  }

  /**
   * Clear the reading position (revert to ungated).
   */
  function clearPosition(seriesId) {
    localStorage.removeItem(STORAGE_PREFIX + seriesId);
  }

  // ── Reveal status ───────────────────────────────────────────────────────────

  /**
   * Returns the reveal status of an entity relative to the current reading
   * position for the given series.
   *
   * Return values:
   *   'hidden'  — entity's first_mention is past the reading position
   *   'partial' — first_mention reached but full_reveal is not yet
   *   'full'    — full_reveal reached, or no position set, or no threshold data
   */
  function getRevealStatus(entity, seriesId) {
    const pos = getPosition(seriesId);
    if (!pos) return 'full';

    const first = entity.first_mention;
    const full  = entity.full_reveal;

    if (!first) return 'full'; // no threshold data → always visible

    if (comparePositions(pos, first) < 0) return 'hidden';
    if (!full || comparePositions(pos, full) >= 0) return 'full';
    return 'partial';
  }

  /**
   * Convenience wrapper. Returns true if the entity has been at least partially
   * revealed (first_mention ≤ position), false if still hidden.
   */
  function isRevealed(entity, seriesId) {
    return getRevealStatus(entity, seriesId) !== 'hidden';
  }

  // ── Book/chapter metadata ───────────────────────────────────────────────────

  /**
   * Returns the chapter count for a book entity object.
   * Uses NOVEL_CHAPTER_COUNTS for novels; derives from stories_contained for
   * collections.
   */
  function getChapterCount(bookEntity) {
    if (NOVEL_CHAPTER_COUNTS[bookEntity.id] !== undefined) {
      return NOVEL_CHAPTER_COUNTS[bookEntity.id];
    }
    if (Array.isArray(bookEntity.stories_contained)) {
      return bookEntity.stories_contained.length;
    }
    return 20; // safe fallback
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  return {
    comparePositions,
    getPosition,
    setPosition,
    clearPosition,
    getRevealStatus,
    isRevealed,
    getChapterCount,
  };

})();
