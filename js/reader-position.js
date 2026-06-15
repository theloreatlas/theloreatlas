/**
 * reader-position.js — Reading-position picker (book/chapter selectors, spoiler gating UI)
 * Part of The Lore Atlas SPA (split from app.js, Session 13.5).
 */

// ── Reader Position Picker ────────────────────────────────────────────────────

let readerPickerInitialized = false;

function initReaderPositionPicker() {
  if (readerPickerInitialized) return;

  const series = LoreLoader.getSeries();
  if (!series.length) return;

  // Single-series for now; multi-series support can be added later.
  const seriesId = series[0].id;
  const books = LoreLoader.getAll(seriesId, 'books')
    .slice()
    .sort((a, b) => (a.chronological_order || 0) - (b.chronological_order || 0));

  if (!books.length) return;

  const bar         = document.getElementById('reader-position-bar');
  const bookSelect  = document.getElementById('rp-book');
  const chapSelect  = document.getElementById('rp-chapter');
  const clearBtn    = document.getElementById('rp-clear');
  const statusEl    = document.getElementById('rp-status');

  if (!bar || !bookSelect || !chapSelect || !clearBtn || !statusEl) return;

  // Populate book dropdown
  bookSelect.innerHTML = '<option value="">— Select a book —</option>';
  for (const book of books) {
    const opt = document.createElement('option');
    opt.value = String(book.chronological_order);
    opt.textContent = `${book.chronological_order}. ${book.title}`;
    bookSelect.appendChild(opt);
  }

  // Restore saved position
  const saved = SpoilerGate.getPosition(seriesId);
  if (saved) {
    bookSelect.value = String(saved.book);
    populateChapters(saved.book, books, chapSelect);
    chapSelect.disabled = false;
    chapSelect.value = String(saved.chapter);
    rpUpdateStatus(saved, books, statusEl);
  }

  // Book change → repopulate chapters, auto-set ch. 1, save
  bookSelect.addEventListener('change', () => {
    const bookNum = parseInt(bookSelect.value, 10);
    if (isNaN(bookNum)) {
      chapSelect.innerHTML = '<option value="">Ch. —</option>';
      chapSelect.disabled = true;
      SpoilerGate.clearPosition(seriesId);
      statusEl.textContent = '';
      return;
    }
    populateChapters(bookNum, books, chapSelect);
    chapSelect.disabled = false;
    chapSelect.value = '1';
    SpoilerGate.setPosition(seriesId, bookNum, 1);
    rpUpdateStatus({ book: bookNum, chapter: 1 }, books, statusEl);
  });

  // Chapter change → save
  chapSelect.addEventListener('change', () => {
    const bookNum    = parseInt(bookSelect.value, 10);
    const chapterNum = parseInt(chapSelect.value, 10);
    if (isNaN(bookNum) || isNaN(chapterNum)) return;
    SpoilerGate.setPosition(seriesId, bookNum, chapterNum);
    rpUpdateStatus({ book: bookNum, chapter: chapterNum }, books, statusEl);
  });

  // Clear → reset to ungated
  clearBtn.addEventListener('click', () => {
    SpoilerGate.clearPosition(seriesId);
    bookSelect.value = '';
    chapSelect.innerHTML = '<option value="">Ch. —</option>';
    chapSelect.disabled = true;
    statusEl.textContent = '';
  });

  bar.hidden = false;
  readerPickerInitialized = true;
}

function populateChapters(bookNum, books, chapSelect) {
  const book  = books.find(b => b.chronological_order === bookNum);
  const count = book ? SpoilerGate.getChapterCount(book) : 20;
  chapSelect.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Ch. ${i}`;
    chapSelect.appendChild(opt);
  }
}

function rpUpdateStatus(pos, books, statusEl) {
  const book = books.find(b => b.chronological_order === pos.book);
  const title = book ? book.title : `Book ${pos.book}`;
  statusEl.textContent = `Gating: ${title}, Ch. ${pos.chapter}`;
}

