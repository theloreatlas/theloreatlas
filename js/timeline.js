/**
 * timeline.js — The timeline page (replaces the events list)
 * Part of The Lore Atlas SPA (redesign Phase 6).
 *
 * Events are grouped by the book of their first mention, in story order. An
 * event the reader hasn't reached never reaches the markup as an object: in the
 * bookmark's own book it becomes a chapter label and a fog bar, in later books
 * it is only counted. Entry pages for events are still drawn by views.js.
 */

// ── Model ────────────────────────────────────────────────────────────────────

// { groups: [{ bookNum, book, rows: [{ entity?, chapter, reached }] }],
//   later: { count, bookCount }, reachedCount, total }
// Story order: the book's chronological_order, then chapter, then data order
// (Array.sort is stable). Events with no first mention are always visible and
// sort first, under no book.
function buildTimelineModel(seriesId) {
  const pos = SpoilerGate.getPosition(seriesId);
  const events = LoreLoader.getAll(seriesId, 'events').map(entity => ({
    entity,
    bookNum: entity.first_mention ? entity.first_mention.book : 0,
    chapter: entity.first_mention ? entity.first_mention.chapter : 0,
  })).sort((a, b) => a.bookNum - b.bookNum || a.chapter - b.chapter);

  const groups = [];
  const laterBooks = new Set();
  let later = 0, reachedCount = 0;

  for (const ev of events) {
    const status = SpoilerGate.getRevealStatus(ev.entity, seriesId);
    if (status === 'hidden' && pos && ev.bookNum > pos.book) {
      later++;
      laterBooks.add(ev.bookNum);
      continue;
    }
    let group = groups[groups.length - 1];
    if (!group || group.bookNum !== ev.bookNum) {
      group = { bookNum: ev.bookNum, book: bookByNumber(seriesId, ev.bookNum), rows: [] };
      groups.push(group);
    }
    const reached = status !== 'hidden';
    if (reached) reachedCount++;
    // A hidden event keeps only its chapter, never the entity.
    group.rows.push(reached ? { entity: ev.entity, chapter: ev.chapter, reached } : { chapter: ev.chapter, reached });
  }

  return {
    groups, pos, reachedCount, total: events.length,
    later: { count: later, bookCount: laterBooks.size },
  };
}

// ── Render ───────────────────────────────────────────────────────────────────

function timelineSummary(model) {
  const n = model.reachedCount;
  const hidden = model.total - n;
  if (!model.pos) return `${model.total} event${model.total === 1 ? '' : 's'}`;
  return `${n} event${n === 1 ? '' : 's'} so far${hidden ? ` · ${hidden} past your bookmark` : ''}`;
}

function timelineGroupHtml(group, model, seriesId) {
  const { book, bookNum } = group;
  const here = !!model.pos && model.pos.book === bookNum;
  const unit = book ? bookUnitWord(book) : 'Ch.';

  const meta = bookNum
    ? [String(bookNum).padStart(2, '0'), book && book.publication_year].filter(Boolean).join(' · ')
    : '';
  const title = bookNum ? (book ? book.title : `Book ${bookNum}`) : 'Throughout';

  const rows = group.rows.map(r => {
    const chapter = r.chapter ? `${unit} ${r.chapter}` : '';
    if (r.reached) {
      return `<li class="tl-row"><span class="tl-dot"></span><span class="tl-ch">${esc(chapter)}</span>`
        + `<a class="tl-title" href="${entityRowHref(r.entity)}">${esc(getEntityName(r.entity, 'events'))}</a></li>`;
    }
    return `<li class="tl-row tl-row-fog"><span class="tl-dot"></span><span class="tl-ch">${esc(chapter)}</span>`
      + `<span class="tl-fogbar">Past your bookmark</span></li>`;
  }).join('');

  return `<section class="tl-group">`
    + `<header class="tl-head-col">`
    +   (meta ? `<p class="tl-num">${esc(meta)}</p>` : '')
    +   `<h2 class="tl-book">${esc(title)}</h2>`
    +   (here ? '<span class="chip-sm" data-case="now">You are here</span>' : '')
    + `</header>`
    + `<ol class="tl-rail">${rows}</ol>`
    + `</section>`;
}

function renderTimeline(container, seriesId) {
  const model = buildTimelineModel(seriesId);

  let body = '';
  if (!model.total) {
    body = emptyState('No events yet', 'Events appear here as they are added to the atlas.');
  } else {
    if (!model.reachedCount) {
      body += emptyState('Your timeline starts here', 'Events appear as your bookmark moves through the books.', PICKER_ACTION);
    }
    body += model.groups.map(g => timelineGroupHtml(g, model, seriesId)).join('');
    if (model.later.count) {
      const n = model.later.count, k = model.later.bookCount;
      body += fogBlock(`${n} event${n === 1 ? '' : 's'} in ${k} later book${k === 1 ? '' : 's'}.`);
    }
  }

  container.innerHTML = `
    <div class="page-wide list-page timeline-page">
      ${crumbsHtml(seriesId, [{ label: 'Timeline' }])}
      <header class="list-head tl-page-head">
        <h1 class="list-title">Timeline</h1>
        <p class="list-summary">${esc(timelineSummary(model))}</p>
      </header>
      <div class="tl-body">${body}</div>
    </div>`;
}
