/**
 * renderer/script.js
 * Main UI logic for Ebook Batch Converter
 * Built with passion by Raunak Panigrahi
 */

'use strict';

// ─── App State ────────────────────────────────────────────────────────────────
const state = {
  files: [],           // All loaded FileInfo objects
  filter: 'all',       // Current filter tab
  search: '',          // Current search query
  sort: { col: 'name', dir: 'asc' },
  isConverting: false,
  isCancelled: false,
  startTime: null,
  completedCount: 0,
  elapsedTimer: null,
  // Reader state
  settings: {
    // existing
    margins: true,
    textAlignmentOverride: false,
    autoSingleColumn: false,
    readAloudAutoScroll: true,
    searchEngine: 'google',
    dictionary: 'default',
    pageTransition: 'slide',
    // NEW
    fontFamily: 'Georgia, serif',
    fontSize: 100,
    lineHeight: 1.6,
    letterSpacing: 0,
    wordSpacing: 0,
    paragraphSpacing: 1,
    theme: 'light',
    brightness: 100,
    sepia: 0,
    scrollMode: false,
    pageTurnArea: 'right',
    animationSpeed: 300
  },
  reader: {
    active: false,
    initialized: false,
    file: null,
    type: null, // 'pdf' or 'epub'
    book: null, // epub object
    rendition: null, // epub rendition
    pdfDoc: null,
    pageNum: 1,
    pageCount: 0,
    zoom: 1.0,
    theme: 'light',
    fontSize: 100,
    fontFamily: 'Georgia',
    lineSpacing: '1.6',
    widthMode: 'medium',
  },
};

// ─── DOM References ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  dropZone: $('drop-zone'),
  uploadZoneInner: $('upload-zone-inner'),
  uploadTitle: $('drop-zone')?.querySelector('.upload-title'),
  toolbar: $('toolbar'),
  toolbarTitle: $('file-list-header-text'),
  tableWrapper: $('table-wrapper'),
  tableBody: $('file-table-body'),
  tableEmpty: $('table-empty'),
  libraryGrid: $('library-grid'),
  homeRecentCarousel: $('home-recent-carousel'),
  homeRecentSection: $('home-recent-section'),
  progressSection: $('progress-section'),
  progressFill: $('progress-fill'),
  progressGlow: $('progress-glow'),
  progressPct: $('progress-pct'),
  progressLabel: $('progress-label'),
  progressDetail: $('progress-detail'),
  progressSpeed: $('progress-speed'),
  warningBanner: $('warning-banner'),
  warningText: $('warning-text'),
  sessionStatus: $('session-status'),
  etaDisplay: $('eta-display'),
  elapsedDisplay: $('elapsed-display'),
  statTotal: $('stat-total'),
  statConverted: $('stat-converted'),
  statSkipped: $('stat-skipped'),
  statFailed: $('stat-failed'),
  appVersion: $('app-version'),
  themeLabel: $('theme-label'),
  fileInput: $('file-input'),
  toastContainer: $('toast-container'),

  // Reader DOM
  readerOverlay: $('reader-overlay'),
  btnReaderBack: $('btn-reader-back'),
  readerTitle: $('reader-title'),
  readerPageInfo: $('reader-page-info'),
  pdfControls: $('pdf-controls'),
  btnZoomIn: $('btn-zoom-in'),
  btnZoomOut: $('btn-zoom-out'),
  pdfZoomLevel: $('pdf-zoom-level'),
  btnReaderSettings: $('btn-reader-settings'),
  readerSettingsPanel: $('reader-settings-panel'),
  btnReaderPrev: $('btn-reader-prev'),
  btnReaderNext: $('btn-reader-next'),
  readerContent: $('reader-content'),
  btnFontDecrease: $('btn-font-decrease'),
  btnFontIncrease: $('btn-font-increase'),
  fontSizeDisplay: $('font-size-display'),
  readerWidthControl: $('reader-width-control'),

  // Home Empty State
  homeEmptyState: $('home-empty-state'),
  homeDashboard: $('home-dashboard'),
  btnHomeAddBooks: $('btn-home-add-books'),
  homeAddDropdown: $('home-add-dropdown'),
  btnHomeAddFiles: $('btn-home-add-files'),
  btnHomeAddFolder: $('btn-home-add-folder'),
};

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  // Set up pdf.js worker
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.min.js';
  }

  // Get app version
  try {
    const v = await window.electronAPI.getVersion();
    els.appVersion.textContent = `v${v}`;
  } catch (_) { }

  // Listen for per-file progress updates from main process
  window.electronAPI.onProgress(({ filePath, progress }) => {
    const file = state.files.find(f => f.path === filePath);
    if (file) {
      updateRowProgress(file.id, progress);
    }
  });

  const initializeUI = async () => {
    loadSettings();
    bindEvents();
    populateSettingsUI();
    restoreTheme();
    restoreReaderSettings();
    
    if (window.electronAPI && window.electronAPI.library) {
      try {
        const books = await window.electronAPI.library.getBooks();
        console.log('[Cover] Library loaded:', books?.length ?? 0, 'book(s)');
        if (books && books.length > 0) {
          const mapped = books.map(b => ({
            id: b.id,
            name: b.title !== 'Unknown Title' ? b.title : b.filePath.split(/[\\/]/).pop(),
            path: b.filePath,
            type: b.format,
            size: b.totalPages,
            sizeFormatted: b.totalPages > 0 ? `${b.totalPages} p.` : '—',
            status: b.format === 'epub' ? 'skipped' : 'pending',
            error: null,
            coverUrl: b.coverImage || null,
            coverLoading: false,
            _libraryData: b
          }));
          state.files = mapped;
          updateUploadZone();
          updateStats();
          renderTable();
          renderLibraryGrid();
          showUI();

          // ── CRITICAL: Trigger cover extraction for books missing or with broken covers ──
          // isValidCoverUrl checks for all known failure modes:
          //   1. null / empty / too short
          //   2. legacy 2-slash Windows path (file://C:/…) — Chromium rejects these
          //   3. literal strings "null" or "undefined" persisted by bugs
          //   4. very short base64/URLs that can't be a real image
          const needsCovers = mapped.filter(f => !isValidCoverUrl(f.coverUrl));
          console.log('[Cover] Books needing extraction at startup:', needsCovers.length,
            '| Sample urls:', mapped.slice(0,3).map(f => f.coverUrl));
          if (needsCovers.length > 0) {
            // Clear the broken URL so placeholder shows while loading
            needsCovers.forEach(f => { f.coverUrl = null; f.coverLoading = true; });
            renderLibraryGrid(); // refresh to show placeholders immediately
            loadCoversFor(needsCovers);
          }
        } // end if (books && books.length > 0)
      } catch (e) {
        console.error('Failed to load library:', e);
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUI);
  } else {
    initializeUI();
  }
})();

// ─── Event Binding ────────────────────────────────────────────────────────────
function bindEvents() {
  // Window controls
  $('btn-minimize')?.addEventListener('click', () => window.electronAPI.minimizeWindow());
  $('btn-maximize')?.addEventListener('click', () => window.electronAPI.maximizeWindow());
  $('btn-close')?.addEventListener('click', () => window.electronAPI.closeWindow());

  // Folder / file selection
  $('btn-select-folder')?.addEventListener('click', onSelectFolder);
  $('btn-select-files')?.addEventListener('click', onSelectFiles);
  $('btn-add-folder')?.addEventListener('click', onSelectFolder);
  $('btn-add-files')?.addEventListener('click', onSelectFiles);
  els.fileInput?.addEventListener('change', onFilesInputChange);

  // Drag and drop
  setupDragDrop();

  // Toolbar actions
  $('btn-start-conversion')?.addEventListener('click', onStartConversion);
  $('btn-cancel-conversion')?.addEventListener('click', onCancelConversion);

  // Export
  $('btn-save-folder')?.addEventListener('click', onSaveToFolder);
  $('btn-export-zip')?.addEventListener('click', onExportZip);

  // Warning dismiss
  $('btn-dismiss-warning')?.addEventListener('click', () => {
    els.warningBanner.classList.add('hidden');
  });

  // Sort columns
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sort.col === col) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.col = col;
        state.sort.dir = 'asc';
      }
      renderTable();
      updateSortIcons();
    });
  });

  // Library grid sort dropdown
  $('library-sort')?.addEventListener('change', (e) => {
    state.sort.col = e.target.value;
    state.sort.dir = (e.target.value === 'name' || e.target.value === 'author') ? 'asc' : 'desc';
    renderLibraryGrid();
  });



  // Theme toggle
  $('btn-theme')?.addEventListener('click', toggleTheme);

  // Reader controls
  if (els.btnReaderBack) els.btnReaderBack.addEventListener('click', closeReader);
  if ($('reader-nav-left')) $('reader-nav-left').addEventListener('click', onReaderPrev);
  if ($('reader-nav-right')) $('reader-nav-right').addEventListener('click', onReaderNext);
  if (els.btnZoomIn) els.btnZoomIn.addEventListener('click', onZoomIn);
  if (els.btnZoomOut) els.btnZoomOut.addEventListener('click', onZoomOut);
  
  if ($('btn-reader-settings')) {
    $('btn-reader-settings').addEventListener('click', () => {
      els.readerSettingsPanel.classList.toggle('hidden');
    });
  }
  
  // Fullscreen
  if ($('btn-reader-fullscreen')) {
    $('btn-reader-fullscreen').addEventListener('click', onToggleFullscreen);
  }

  // Reader Settings (Font, Line Spacing, Width)
  if ($('reader-font-family')) {
    $('reader-font-family').addEventListener('change', onReaderFormatChange);
  }
  if ($('reader-line-spacing')) {
    $('reader-line-spacing').addEventListener('change', onReaderFormatChange);
  }
  if (els.readerWidthControl) {
    els.readerWidthControl.addEventListener('change', onReaderFormatChange);
  }

  // Theme Toggle (Cycle through Light -> Sepia -> Dark)
  if ($('btn-reader-theme-toggle')) {
    $('btn-reader-theme-toggle').addEventListener('click', () => {
      const themes = ['light', 'sepia', 'dark'];
      const current = state.reader.theme;
      const nextIndex = (themes.indexOf(current) + 1) % themes.length;
      onReaderThemeChange(themes[nextIndex]);
    });
  }
  
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      onReaderThemeChange(e.target.dataset.theme);
    });
  });

  if (els.btnFontDecrease) els.btnFontDecrease.addEventListener('click', () => onReaderFontChange(-10));
  if (els.btnFontIncrease) els.btnFontIncrease.addEventListener('click', () => onReaderFontChange(10));

  document.addEventListener('keydown', (e) => {
    if (!state.reader.active) return;
    if (e.key === 'Escape') {
      if (els.readerOverlay?.classList.contains('is-fullscreen')) {
        onToggleFullscreen(); // Exit fullscreen
      } else {
        closeReader(); // Close reader
      }
    }
    if (e.key === 'ArrowLeft') onReaderPrev();
    if (e.key === 'ArrowRight') onReaderNext();
    if (e.key.toLowerCase() === 'b') toggleBookmark();
  });

  // Bookmark Button
  if ($('btn-reader-bookmark')) {
    $('btn-reader-bookmark').addEventListener('click', toggleBookmark);
  }

  // Highlight Popover Colors
  document.querySelectorAll('#highlight-popover .color-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const color = e.target.dataset.color;
      const target = state.reader.currentSelection;
      if (target && target.cfiRange && state.reader.rendition) {
        state.reader.rendition.annotations.highlight(target.cfiRange, {}, (e) => {
          console.log('highlight clicked', e);
        }, "", { "fill": color, "fill-opacity": "0.3" });
        
        // Save to DB
        const fileId = state.reader.file.id;
        const book = state.files.find(f => f.id === fileId);
        if (book && book._libraryData) {
          const highlights = book._libraryData.highlights || [];
          highlights.push({ cfi: target.cfiRange, color });
          await window.electronAPI.library.updateBook(fileId, { highlights });
          book._libraryData.highlights = highlights;
          renderAnnotationsList();
        }
        
        target.contents.window.getSelection().removeAllRanges();
      }
      hideHighlightPopover();
    });
  });


  // Home Empty State events (Event Delegation)
  document.addEventListener('click', async (e) => {
    // Add Files button
    if (e.target.closest('#btn-home-add-files')) {
      onSelectFiles();
    }
    // Add Folder button
    if (e.target.closest('#btn-home-add-folder')) {
      onSelectFolder();
    }
  });

  // Settings Panel Events
  const bindSettingToggle = (id, key, needsReflow = false) => {
    const el = $(id);
    if (el) {
      el.addEventListener('change', (e) => {
        state.settings[key] = e.target.checked;
        saveSettings();
        applySettings();
        populateSettingsUI();
        if (needsReflow) formatDebounceRefresh();
      });
    }
  };

  const bindSettingSelect = (id, key, needsReflow = false) => {
    const el = $(id);
    if (el) {
      el.addEventListener('change', (e) => {
        state.settings[key] = e.target.value;
        saveSettings();
        applySettings();
        populateSettingsUI();
        if (needsReflow) formatDebounceRefresh();
      });
    }
  };

  let sliderDebounce;
  const bindSettingSlider = (id, key, displayId, needsReflow = false) => {
    const el = $(id);
    const displayEl = $(displayId);
    if (el) {
      el.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (displayEl) displayEl.textContent = val;
        
        clearTimeout(sliderDebounce);
        sliderDebounce = setTimeout(() => {
          state.settings[key] = val;
          saveSettings();
          applySettings();
          populateSettingsUI();
          if (needsReflow) formatDebounceRefresh();
        }, 100);
      });
    }
  };

  bindSettingToggle('setting-margins', 'margins', true);
  bindSettingToggle('setting-text-alignment', 'textAlignmentOverride', true);
  bindSettingToggle('setting-auto-column', 'autoSingleColumn', true);
  bindSettingToggle('setting-read-aloud', 'readAloudAutoScroll');
  bindSettingToggle('setting-scroll-mode', 'scrollMode', true);
  
  bindSettingSelect('setting-search-engine', 'searchEngine');
  bindSettingSelect('setting-dictionary', 'dictionary');
  bindSettingSelect('setting-page-transition', 'pageTransition');
  bindSettingSelect('setting-font-family', 'fontFamily', true);
  bindSettingSelect('setting-page-turn-area', 'pageTurnArea');

  bindSettingSlider('setting-font-size', 'fontSize', 'setting-val-fontsize', true);
  bindSettingSlider('setting-line-height', 'lineHeight', 'setting-val-lineheight', true);
  bindSettingSlider('setting-letter-spacing', 'letterSpacing', 'setting-val-letterspacing', true);
  bindSettingSlider('setting-word-spacing', 'wordSpacing', 'setting-val-wordspacing', true);
  bindSettingSlider('setting-paragraph-spacing', 'paragraphSpacing', 'setting-val-paragraphspacing', true);
  bindSettingSlider('setting-brightness', 'brightness', 'setting-val-brightness');
  bindSettingSlider('setting-sepia', 'sepia', 'setting-val-sepia');
  bindSettingSlider('setting-animation-speed', 'animationSpeed', 'setting-val-animationspeed');

  document.querySelectorAll('.theme-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const themeName = e.currentTarget.dataset.val;
      state.settings.theme = themeName;
      saveSettings();
      applySettings();
      populateSettingsUI();
    });
  });
}

// ─── Drag & Drop ──────────────────────────────────────────────────────────────
function setupDragDrop() {
  const zone = els.dropZone;
  if (!zone) return;

  ['dragenter', 'dragover'].forEach(ev => {
    document.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(ev => {
    document.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
    });
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const items = Array.from(e.dataTransfer.items || []);
    const files = Array.from(e.dataTransfer.files || []);

    // Check if a directory was dropped (Electron supports this)
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        // Get path from the file object
        const fileObjs = Array.from(e.dataTransfer.files);
        for (const f of fileObjs) {
          if (f.path) {
            const p = f.path;
            const dir = p.substring(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));
            await loadFolder(dir);
            return;
          }
        }
      }
    }

    // Handle individual files
    if (files.length > 0) {
      const electronFiles = files
        .filter(f => f.name.match(/\.(pdf|epub)$/i))
        .map(f => ({
          id: generateId(f.path || f.name),
          name: f.name,
          path: f.path || f.name,
          type: f.name.match(/\.epub$/i) ? 'epub' : 'pdf',
          size: f.size,
          sizeFormatted: formatBytes(f.size),
          status: f.name.match(/\.epub$/i) ? 'skipped' : 'pending',
          error: null,
          outputPath: null,
          selected: false,
        }));
      if (electronFiles.length > 0) {
        addFiles(electronFiles);
      }
    }
  });
}

// ─── Folder Selection ─────────────────────────────────────────────────────────
async function onSelectFolder() {
  const folderPath = await window.electronAPI.openFolder();
  if (!folderPath) return;
  await loadFolder(folderPath);
}

async function loadFolder(folderPath) {
  try {
    showToast(`Scanning folder…`, 'info', 1500);
    const result = await window.electronAPI.scanFolder(folderPath);

    if (result.warning) {
      els.warningText.textContent = result.warning;
      els.warningBanner.classList.remove('hidden');
    }

    if (result.files.length === 0) {
      showToast('No PDF or EPUB files found in this folder.', 'warn');
      return;
    }

    addFiles(result.files.map(f => ({ ...f, selected: false })));
    showToast(`Loaded ${result.files.length} files.`, 'success');
  } catch (err) {
    showToast(`Error scanning folder: ${err.message}`, 'error');
  }
}

// ─── File Selection ───────────────────────────────────────────────────────────
async function onSelectFiles() {
  if (window.electronAPI && window.electronAPI.openFiles) {
    const filePaths = await window.electronAPI.openFiles();
    if (filePaths && filePaths.length > 0) {
      addFiles(Array.from(filePaths).map(p => ({
        id: generateId(p),
        name: p.split(/[\\/]/).pop(),
        path: p,
        type: p.toLowerCase().endsWith('.epub') ? 'epub' : 'pdf',
        size: 0,
        sizeFormatted: '0 B',
        status: p.toLowerCase().endsWith('.epub') ? 'skipped' : 'pending',
        error: null,
        outputPath: null,
        selected: false,
      })));
    }
  } else {
    els.fileInput?.click();
  }
}

// ─── File Input Handler ───────────────────────────────────────────────────────
function onFilesInputChange(e) {
  const files = Array.from(e.target.files).filter(f =>
    f.name.match(/\.(pdf|epub)$/i)
  );

  const mapped = files.map(f => ({
    id: generateId(f.path || f.name),
    name: f.name,
    path: f.path || f.name,
    type: f.name.match(/\.epub$/i) ? 'epub' : 'pdf',
    size: f.size,
    sizeFormatted: formatBytes(f.size),
    status: f.name.match(/\.epub$/i) ? 'skipped' : 'pending',
    error: null,
    outputPath: null,
    selected: false,
  }));

  if (mapped.length > 0) addFiles(mapped);
  e.target.value = '';
}

// ─── Add Files to State ───────────────────────────────────────────────────────
async function addFiles(newFiles) {
  // Deduplicate by path safely across OS formats
  const norm = p => (p || '').replace(/\\/g, '/').toLowerCase();
  const existingPaths = new Set(state.files.map(f => norm(f.path)));
  const unique = newFiles.filter(f => !existingPaths.has(norm(f.path)));

  if (unique.length === 0) return;

  const addedBooks = [];
  for (const f of unique) {
    if (window.electronAPI && window.electronAPI.library) {
      try {
        const res = await window.electronAPI.library.addBook({
          id: f.id,
          title: f.name,
          filePath: f.path,
          format: f.type,
          totalPages: f.size
        });
        if (res.success) {
          // Brand new book — no existing cover
          f._libraryData = res.book;
          f.coverUrl = null;
          f.coverLoading = true;
          addedBooks.push(f);
        } else if (res.book) {
          // Already in library — validate stored cover before trusting it
          // (file may have been deleted/moved since last run)
          f._libraryData = res.book;
          const storedCover = res.book.coverImage || null;
          f.coverUrl = isValidCoverUrl(storedCover) ? storedCover : null;
          f.coverLoading = !f.coverUrl;
          if (!f.coverUrl) {
            // Stored cover is missing or invalid — schedule re-extraction
            addedBooks.push(f);
          }
        } else {
          console.error('[Library] Add failed:', res.error);
          showToast(`Save failed: ${res.error}`, 'error');
        }
      } catch (e) {
        console.error('Failed to add book to library:', e);
        showToast('System error adding book', 'error');
      }
    } else {
      f.coverUrl = null;
      f.coverLoading = true;
      addedBooks.push(f);
    }
  }

  state.files.push(...addedBooks);
  updateUploadZone();
  updateStats();
  renderTable();
  renderLibraryGrid();
  showUI();

  // Async cover extraction
  loadCoversFor(addedBooks);
}

// ─── Cover Extraction ─────────────────────────────────────────────────────────

// Minimum base64 length for a valid image (any real image is > 100 bytes → 136+ base64 chars)
const MIN_COVER_B64_LEN = 136;

/**
 * Validate that a cover URL string is usable before trusting or assigning it.
 * Catches: null/empty, too-short strings, legacy 2-slash Windows paths,
 * literal "null"/"undefined" stored by bugs.
 */
function isValidCoverUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url === 'null' || url === 'undefined') return false;
  if (url.length < 20) return false;
  // Legacy 2-slash Windows path: file://C:/ — Chromium treats "C:" as authority
  if (/^file:\/\/[a-zA-Z]:/.test(url)) return false;
  return true;
}

let isExtractingCovers = false;
const extractionQueue = [];

async function loadCoversFor(files) {
  console.log('[COVER DEBUG 1] loadCoversFor queued, books count:', files?.length);
  extractionQueue.push(...files);
  
  if (isExtractingCovers) return;
  isExtractingCovers = true;
  
  try {
    while (extractionQueue.length > 0) {
      const f = extractionQueue.shift();
      console.log('[COVER DEBUG 2] Extracting cover for:', f.id, f.path);
      try {
        const b64Data = await extractCoverBase64(f);

        // Guard: reject corrupted / micro-sized data that can't be a real image
        const isValid = (b64Data && b64Data.length >= MIN_COVER_B64_LEN);
        console.log('[COVER DEBUG 5] Validation result for:', f.id, 'valid:', !!isValid, 'src preview:', b64Data?.substring(0, 50));
        
        if (isValid) {
          if (window.electronAPI && window.electronAPI.library) {
            console.log('[COVER DEBUG 3] IPC cover request sent for:', f.id);
            const res = await window.electronAPI.library.saveCover(f.id, b64Data);
            console.log('[COVER DEBUG 4] IPC cover response for:', f.id, 'result type:', typeof res, 'length:', res?.coverUrl?.length ?? 'null');
            if (res.success) {
              f.coverUrl = res.coverUrl;
              console.log('[COVER DEBUG 6] Assigned coverUrl to:', f.id, 'url preview:', f.coverUrl?.substring(0, 50));
              if (f._libraryData) f._libraryData.coverImage = res.coverUrl;
            } else {
              // saveCover failed (book not found in DB yet) — use inline data URL as fallback
              console.warn('[Cover] saveCover failed for', f.name, '— using inline data URL');
              f.coverUrl = `data:image/jpeg;base64,${b64Data}`;
            }
          } else {
            // No library API — use inline data URL
            f.coverUrl = `data:image/jpeg;base64,${b64Data}`;
          }
        } else {
          if (b64Data) {
            console.warn('[Cover] Rejected suspiciously small cover data for', f.name,
              `(${b64Data.length} chars — likely corrupt)`);
          }
          // No valid cover found — placeholder will show
          f.coverUrl = null;
        }
      } catch (e) {
        console.warn('[Cover] Extraction failed for', f.name, e);
        f.coverUrl = null;
      } finally {
        f.coverLoading = false;
        // Surgical update: only repaint this book's card/row, not the whole grid
        updateRowCover(f.id);
        updateCardCover(f.id);
        console.log('[COVER FINAL]', f.id, 
          'coverUrl:', f.coverUrl?.substring(0, 60) ?? 'NULL',
          'coverLoading:', f.coverLoading);
      }
    }
  } finally {
    isExtractingCovers = false;
    // After all extractions are done, do a single full render to catch any
    // edge cases (e.g. items not yet in DOM when their cover finished)
    renderLibraryGrid();
  }
}

async function extractCoverBase64(file) {
  const result = await window.electronAPI.readFileBase64(file.path);
  if (!result.success) {
    console.warn('[Cover] readFileBase64 failed for', file.name, result.error);
    return null;
  }

  const binaryString = atob(result.base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  if (file.type === 'pdf') {
    if (!window.pdfjsLib) return null;
    try {
      const loadingTask = pdfjsLib.getDocument({ data: bytes });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 0.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      return dataUrl.split(',')[1];
    } catch (e) {
      console.warn('[Cover] PDF page render failed for', file.name, e);
      return null;
    }
  }

  if (file.type === 'epub') {
    if (!window.ePub) return null;
    let fallbackBase64 = null;
    let book = null;
    try {
      book = ePub(bytes.buffer);
      await book.ready;
      fallbackBase64 = await extractEpubCoverWithFallbacks(book, file.name);
    } catch (e) {
      console.warn('[Cover] EPUB initialization/extraction error for', file.name, e);
    } finally {
      try { if (book) book.destroy(); } catch (_) {}
    }
    
    // If ePub failed or returned null, fall through to Strategy 5
    if (fallbackBase64) return fallbackBase64;
    fallbackBase64 = await extractEpubCoverZipFallback(bytes);
    
    // Strategy 6: Inline base64 fallback for OceanofPDF and corrupt manifests
    if (!fallbackBase64) {
      fallbackBase64 = await extractEpubCoverInlineBase64(bytes);
    }
    
    if (fallbackBase64) return fallbackBase64;
  }

  return null;
}

async function extractEpubCoverZipFallback(bytes) {
  console.log('[Cover] S5: JSZip available:', typeof JSZip !== 'undefined' ? 'YES' : 'NO', typeof window !== 'undefined' && window.JSZip ? 'window.JSZip YES' : 'window.JSZip NO');
  console.log('[Cover] S5: bytes type:', typeof bytes, bytes instanceof ArrayBuffer ? 'ArrayBuffer' : bytes instanceof Uint8Array ? 'Uint8Array' : typeof Buffer !== 'undefined' && bytes instanceof Buffer ? 'Buffer' : typeof bytes === 'string' ? 'string len:' + bytes.length : 'unknown', 'byteLength:', bytes?.byteLength ?? bytes?.length);
  if (!window.JSZip) return null;
  console.log('[Cover] S5: Initiating raw ZIP scan fallback');
  try {
    const zip = await JSZip.loadAsync(bytes);
    const allEntries = Object.values(zip.files).filter(f => !f.dir).map(f => f.name);
    console.log('[Cover] S5: ALL zip entries:', JSON.stringify(allEntries));
    const imageRegex = /\.(jpe?g|png|gif|webp)$/i;
    
    // First pass: look specifically for obvious cover files
    const coverRegex = /(cover|images?\/).*\.(jpe?g|png|gif|webp)$/i;
    let targetEntry = Object.values(zip.files).find(f => !f.dir && coverRegex.test(f.name));
    
    // Second pass: grab literally any image in the ZIP
    if (!targetEntry) {
      targetEntry = Object.values(zip.files).find(f => !f.dir && imageRegex.test(f.name));
    }
    
    if (targetEntry) {
      console.log('[Cover] S5: zip scan found image at:', targetEntry.name);
      const b64 = await targetEntry.async('base64');
      return b64;
    }
    
    console.log('[Cover] S5: zip scan failed to find any image entries');
    return null;
  } catch (err) {
    console.warn('[Cover] S5: zip scan failed:', err.message);
    return null;
  }
}

async function extractEpubCoverInlineBase64(bytes) {
  if (!window.JSZip) return null;
  try {
    const zip = await JSZip.loadAsync(bytes);
    
    // Get and sort candidate XHTML/HTML files
    const entries = Object.values(zip.files)
      .filter(f => !f.dir && /\.(xhtml|html)$/i.test(f.name));
    
    entries.sort((a, b) => {
      const aLower = a.name.toLowerCase();
      const bLower = b.name.toLowerCase();
      
      const aCover = aLower.includes('cover');
      const bCover = bLower.includes('cover');
      if (aCover && !bCover) return -1;
      if (!aCover && bCover) return 1;
      
      const aChap = aLower.includes('chapter1') || aLower.includes('chapter01');
      const bChap = bLower.includes('chapter1') || bLower.includes('chapter01');
      if (aChap && !bChap) return -1;
      if (!aChap && bChap) return 1;
      
      return aLower.localeCompare(bLower);
    });
    
    // Limit to first 5
    const candidates = entries.slice(0, 5);
    
    for (const entry of candidates) {
      const htmlText = await entry.async('string');
      console.log('[Cover] S6 XHTML sample from', entry.name, ':', htmlText.substring(0, 800));
      
      // Pattern A - Standard img data URI
      let match = htmlText.match(/src=["']data:image\/(jpeg|jpg|png|gif|webp);base64,([A-Za-z0-9+/=]+)["']/i);
      if (match && match[2].length >= 500) {
        console.log('[Cover] S6: found inline base64 in:', entry.name, 'length:', match[2].length);
        return match[2];
      }
      
      // Pattern B - SVG/XHTML image element
      match = htmlText.match(/xlink:href=["']data:image\/(jpeg|jpg|png|gif|webp);base64,([A-Za-z0-9+/=]+)["']/i);
      if (match && match[2].length >= 500) {
        console.log('[Cover] S6: found inline base64 in:', entry.name, 'length:', match[2].length);
        return match[2];
      }
      
      // Pattern C - Any data URI without quotes
      match = htmlText.match(/data:image\/(jpeg|jpg|png|gif|webp);base64,([A-Za-z0-9+/=]{100,})/i);
      if (match && match[2].length >= 500) {
        console.log('[Cover] S6: found inline base64 in:', entry.name, 'length:', match[2].length);
        return match[2];
      }
    }
    
    console.log('[Cover] S6: no inline images found');
    return null;
  } catch (err) {
    console.warn('[Cover] S6 failed:', err.message);
    return null;
  }
}

/**
 * Multi-strategy EPUB cover extraction.
 * Tries 4 strategies in order, returning base64 on first success.
 *
 * KEY RULE: book.archive.createUrl() requires a RESOLVED path (absolute within
 * the zip, e.g. "OEBPS/images/cover.jpg"), NOT a raw manifest href.
 * Always call book.resolve(href) first.
 */
async function extractEpubCoverWithFallbacks(book, fileName) {
  // Helper: fetch a blob/object URL and return base64 string
  async function urlToBase64(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`fetch failed ${response.status} for ${url}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const r = reader.result;
        if (r && r.includes(',')) resolve(r.split(',')[1]);
        else reject(new Error('FileReader result invalid'));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Convert a manifest href → resolved archive path → blob URL → base64.
   * This is the correct epub.js contract:
   *   book.resolve(href)  → absolute path within zip (e.g. OEBPS/images/cover.jpg)
   *   book.archive.createUrl(resolved) → blob: URL
   */
  async function hrefToBase64(href) {
    if (!href || !book.archive) return null;
    try {
      const resolved = book.resolve(href);
      console.log(`[Cover] hrefToBase64: href="${href}" → resolved="${resolved}"`);
      const blobUrl = await book.archive.createUrl(resolved);
      if (!blobUrl) return null;
      return await urlToBase64(blobUrl);
    } catch (e) {
      console.warn(`[Cover] hrefToBase64 failed for href="${href}":`, e.message);
      return null;
    }
  }

  // ── Strategy 1: Standard epub.js coverUrl() ─────────────────────────────────
  // Works for well-formed EPUB2 (name="cover" meta) and EPUB3 (properties="cover-image")
  try {
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      console.log('[Cover] S1 (coverUrl) success for', fileName, '→', coverUrl.slice(0, 60));
      return await urlToBase64(coverUrl);
    }
    console.log('[Cover] S1 (coverUrl) returned null for', fileName);
  } catch (e) {
    console.warn('[Cover] S1 failed for', fileName, ':', e.message);
  }

  // ── Strategy 2: Manifest scan by properties / id / href ─────────────────────
  // Handles EPUBs where cover image exists in manifest but metadata is non-standard
  console.log('[Cover] manifest source check:', 'book.packaging?.manifest type:', typeof book.packaging?.manifest, 'book.resources?.assets length:', book.resources?.assets?.length, 'book.spine?.items length:', book.spine?.items?.length);
  try {
    const manifest = book.packaging?.manifest || {};
    const items = Object.values(manifest);
    console.log(`[Cover] S2: scanning ${items.length} manifest items for`, fileName);

    if (items && items.length > 0) {
      console.log('[Cover] S2: raw item[0] keys:', Object.keys(items[0]));
      console.log('[Cover] S2: raw item[0] full:', JSON.stringify(items[0]));
    }

    const imageItems = items.filter(item => {
      const mimeType = (item.mediaType || item['media-type'] || item.type || '').toLowerCase().trim();
      const href = (item.href || '').toLowerCase();
      const hasImageExt = /\.(jpe?g|png|gif|webp|svg|bmp)$/.test(href);
      return mimeType.startsWith('image/') || hasImageExt;
    });
    console.log(`[Cover] S2: found ${imageItems.length} image items`);

    const candidate =
      imageItems.find(i => i.properties && i.properties.includes('cover-image')) ||
      imageItems.find(i => i.id && /cover/i.test(i.id)) ||
      imageItems.find(i => i.href && /cover/i.test(i.href)) ||
      imageItems.find(i => i.id && /title/i.test(i.id)) ||
      imageItems.find(i => i.href && /title/i.test(i.href));

    if (candidate) {
      console.log('[Cover] S2: candidate found:', candidate.href, 'for', fileName);
      const b64 = await hrefToBase64(candidate.href);
      if (b64) { console.log('[Cover] S2 success for', fileName); return b64; }
      console.warn('[Cover] S2: candidate found but hrefToBase64 failed for', fileName);
    } else {
      console.log('[Cover] S2: no cover candidate in manifest for', fileName);
    }
  } catch (e) {
    console.warn('[Cover] S2 failed for', fileName, ':', e.message);
  }

  // ── Strategy 3: First image in the first spine document ─────────────────────
  // Handles EPUBs where the cover is a separate XHTML page with a full-page <img>
  try {
    const spineItem = book.spine?.get(0);
    if (spineItem) {
      console.log('[Cover] S3: loading spine item 0 for', fileName);
      await spineItem.load(book.load.bind(book));
      const doc = spineItem.document;
      if (doc) {
        const imgs = Array.from(doc.querySelectorAll('img[src], image[xlink\\:href]'));
        console.log(`[Cover] S3: found ${imgs.length} images in spine[0] for`, fileName);
        for (const img of imgs) {
          const src = img.getAttribute('src') || img.getAttribute('xlink:href') || '';
          if (!src) continue;
          // Pass raw src to hrefToBase64 — it calls book.resolve() internally.
          // Do NOT pre-resolve here; double-resolving corrupts the path.
          console.log('[Cover] S3: trying img src:', src);
          const b64 = await hrefToBase64(src);
          if (b64) {
            spineItem.unload();
            console.log('[Cover] S3 success for', fileName);
            return b64;
          }
        }
      }
      spineItem.unload();
    }
  } catch (e) {
    console.warn('[Cover] S3 failed for', fileName, ':', e.message);
  }

  // ── Strategy 4: First JPEG then any image in the manifest ───────────────────
  // Last resort: just grab the first image we can decode from this EPUB
  try {
    const manifest = book.packaging?.manifest || {};
    const items = Object.values(manifest);
    const imageItems = items.filter(i => {
      const mimeType = (i.mediaType || i['media-type'] || i.type || '').toLowerCase().trim();
      const href = (i.href || '').toLowerCase();
      const hasImageExt = /\.(jpe?g|png|gif|webp|svg|bmp)$/.test(href);
      return mimeType.startsWith('image/') || hasImageExt;
    });
    // Prefer JPEG (most covers are JPEG); fallback to PNG/etc
    const getMime = (i) => (i.mediaType || i['media-type'] || i.type || '').toLowerCase().trim();
    const isJpeg = (i) => getMime(i) === 'image/jpeg' || /\.(jpe?g)$/i.test(i.href || '');
    const sorted = [
      ...imageItems.filter(i => isJpeg(i)),
      ...imageItems.filter(i => !isJpeg(i)),
    ];
    console.log(`[Cover] S4: trying ${Math.min(sorted.length, 5)} image(s) for`, fileName);
    for (const item of sorted.slice(0, 5)) {
      console.log('[Cover] S4: trying:', item.href);
      const b64 = await hrefToBase64(item.href);
      if (b64) { console.log('[Cover] S4 success for', fileName); return b64; }
    }
  } catch (e) {
    console.warn('[Cover] S4 failed for', fileName, ':', e.message);
  }

  console.warn('[Cover] All 4 strategies exhausted for', fileName, '— no cover found');
  return null;
}

function updateRowCover(id) {
  const file = state.files.find(f => f.id === id);
  if (!file) return;
  const row = document.getElementById(`row-${id}`);
  if (!row) return;

  const coverCell = row.querySelector('.col-cover');
  if (coverCell) {
    if (file.coverUrl) {
      coverCell.innerHTML = `<img src="${file.coverUrl}" class="cover-image" alt="Cover" />`;
    } else {
      const hash = file.id.charCodeAt(0) % 5;
      const gradients = [
        'linear-gradient(135deg, #FF6B6B 0%, #FF8E8E 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)'
      ];
      coverCell.innerHTML = `
        <div class="cell-cover" style="background: ${gradients[hash]}">
          <span class="cover-placeholder">${file.type.toUpperCase()}</span>
        </div>`;
    }
  }
}

/**
 * Surgically update a single book card's cover in the library grid.
 * Called after each individual cover extraction completes so we avoid
 * rebuilding the entire grid (which resets scroll position and can cause
 * race conditions when multiple covers finish near-simultaneously).
 */
function updateCardCover(id) {
  const file = state.files.find(f => f.id === id);
  if (!file) return;

  const hash = file.id.charCodeAt(0) % 5;
  const gradients = [
    'linear-gradient(135deg, #FF6B6B 0%, #FF8E8E 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  ];

  // Find all cards in ALL views (Home, Library) that correspond to this file.
  // Cards have data-id on the root element.
  const cards = document.querySelectorAll(`.book-card[data-id="${id}"]`);
  if (!cards || cards.length === 0) return;

  for (const card of cards) {
    // The query selector `document.querySelectorAll('.book-card[data-id="..."]')` 
    // already guaranteed this card maps exactly to the file ID. We do not need 
    // a redundant internal child check.

    const container = card.querySelector('.book-cover-container');
    if (!container) continue;

    // Swap only the cover image / placeholder; leave overlay and progress intact
    const existingCover = container.querySelector('.book-cover, .book-cover-placeholder');
    if (existingCover) existingCover.remove();

    const newCover = document.createElement(file.coverUrl ? 'img' : 'div');
    if (file.coverUrl) {
      console.log('[COVER DEBUG 7] Setting img src for:', file.id, 'src preview:', file.coverUrl?.substring(0, 50));
      newCover.src = file.coverUrl;
      newCover.className = 'book-cover';
      newCover.alt = 'Cover';
      newCover.addEventListener('load', () =>
        console.log('[Cover] Card IMG OK:', file.name)
      );
      newCover.addEventListener('error', function() {
        console.error('[COVER DEBUG 8] IMG FAILED for:', file.id, 'src:', this.src?.substring(0, 80));
        // Replace broken image with gradient placeholder so card is never blank
        newCover.replaceWith(
          Object.assign(document.createElement('div'), {
            className: 'book-cover-placeholder',
            style: `background: ${gradients[hash]}`,
            textContent: file.type.toUpperCase(),
          })
        );
      });
    } else {
      newCover.className = 'book-cover-placeholder';
      newCover.style.background = gradients[hash];
      newCover.textContent = file.type.toUpperCase();
    }

    // Insert before the overlay (first child of container)
    container.insertBefore(newCover, container.firstChild);
    break; // each id is unique
  }
}


// ─── UI Visibility ────────────────────────────────────────────────────────────
function showUI() {
  els.toolbar.classList.remove('hidden');
  els.tableWrapper.classList.remove('hidden');
  $('upload-area').classList.add('hidden'); // hidden completely
  updateConvertButton();
}

function updateUploadZone() {
  const hasFiles = state.files.length > 0;

  if (hasFiles && els.toolbarTitle) {
    els.toolbarTitle.textContent =
      `${state.files.length} file${state.files.length !== 1 ? 's' : ''} loaded`;
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  const total = state.files.length;
  const converted = state.files.filter(f => f.status === 'completed').length;
  const skipped = state.files.filter(f => f.status === 'skipped').length;
  const failed = state.files.filter(f => f.status === 'failed').length;

  els.statTotal.textContent = total;
  els.statConverted.textContent = converted;
  els.statSkipped.textContent = skipped;
  els.statFailed.textContent = failed;

  // Enable export buttons if we have converted files
  const hasConverted = converted > 0;
  $('btn-save-folder').disabled = !hasConverted;
  $('btn-export-zip').disabled = !hasConverted;
}

function updateConvertButton() {
  const pending = state.files.filter(f => f.status === 'pending').length;
  const btn = $('btn-start-conversion');
  if (btn) {
    btn.disabled = pending === 0 || state.isConverting;
    btn.textContent = pending > 0 ? `Convert ${pending} Files` : 'Convert Files';
  }
}

// ─── Table Render ─────────────────────────────────────────────────────────────
function getFilteredFiles() {
  let files = [...state.files];

  // Search
  if (state.search) {
    files = files.filter(f => f.name.toLowerCase().includes(state.search));
  }

  // Filter tab
  switch (state.filter) {
    case 'pdf': files = files.filter(f => f.type === 'pdf'); break;
    case 'epub': files = files.filter(f => f.type === 'epub'); break;
    case 'pending': files = files.filter(f => f.status === 'pending'); break;
    case 'completed': files = files.filter(f => f.status === 'completed'); break;
  }

  // Sort
  files.sort((a, b) => {
    let aVal = a[state.sort.col];
    let bVal = b[state.sort.col];
    
    // Support library object props
    if (a._libraryData && b._libraryData) {
       if (state.sort.col === 'dateAdded') { aVal = a._libraryData.dateAdded; bVal = b._libraryData.dateAdded; }
       if (state.sort.col === 'lastOpened') { aVal = a._libraryData.lastOpened || 0; bVal = b._libraryData.lastOpened || 0; }
       if (state.sort.col === 'author') { aVal = a._libraryData.author; bVal = b._libraryData.author; }
    }

    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return state.sort.dir === 'asc' ? cmp : -cmp;
  });

  return files;
}

function renderLibraryGrid() {
  if (!els.libraryGrid) return;
  const files = getFilteredFiles();
  els.libraryGrid.innerHTML = '';
  
  if (files.length === 0) {
    els.libraryGrid.innerHTML = '<div style="color:var(--text-muted); padding: 20px;">No books found.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const file of files) {
    let coverHtml = '';
    if (file.coverUrl) {
      coverHtml = `<img src="${file.coverUrl}" class="book-cover" alt="Cover"
        onload="console.log('[Cover] IMG OK:', this.src.slice(0,60))"
        onerror="console.error('[Cover] IMG FAIL:', this.src); this.style.display='none'; this.parentElement.classList.add('cover-error')" />`;
    } else {
      const hash = file.id.charCodeAt(0) % 5;
      const gradients = [
        'linear-gradient(135deg, #FF6B6B 0%, #FF8E8E 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)'
      ];
      coverHtml = `<div class="book-cover-placeholder" style="background: ${gradients[hash]}">${file.type.toUpperCase()}</div>`;
    }

    const prog = file._libraryData?.readingProgress;
    let progressHtml = '';
    if (prog && prog.percentage > 0) {
       progressHtml = `<div class="progress-bar-small"><div class="progress-bar-fill" style="width: ${prog.percentage}%"></div></div>`;
    }

    const card = document.createElement('div');
    card.className = 'book-card';
    card.innerHTML = `
      <div class="book-badges"><span class="badge-format">${file.type.toUpperCase()}</span></div>
      <div class="book-cover-container">
        ${coverHtml}
        <div class="book-overlay">
          <button class="overlay-btn" data-action="read-original" data-path="${escapeHtml(file.path)}" title="Read">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </button>
          <button class="overlay-btn overlay-btn-remove" data-action="remove" data-id="${file.id}" title="Remove">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        ${progressHtml}
      </div>
      <div class="book-info">
        <div class="book-title" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
        <div class="book-author">${escapeHtml(file._libraryData?.author || 'Unknown Author')}</div>
      </div>
    `;

    card.querySelectorAll('button').forEach(btn => btn.addEventListener('click', onRowAction));
    card.addEventListener('dblclick', () => openReader(file));
    fragment.appendChild(card);
  }
  els.libraryGrid.appendChild(fragment);
  renderHomeRecent();
}

function renderHomeRecent() {
  if (!els.homeRecentCarousel || !els.homeRecentSection) return;
  const recentFiles = state.files
    .filter(f => f._libraryData?.lastOpened)
    .sort((a, b) => b._libraryData.lastOpened - a._libraryData.lastOpened)
    .slice(0, 10);

  if (recentFiles.length === 0) {
    els.homeRecentSection.style.display = 'none';
    return;
  }
  
  els.homeRecentSection.style.display = 'flex';
  els.homeRecentCarousel.innerHTML = '';
  
  for (const file of recentFiles) {
    // Re-use logic for card
    let coverHtml = file.coverUrl 
      ? `<img src="${file.coverUrl}" class="book-cover" alt="Cover" />`
      : `<div class="book-cover-placeholder">${file.type.toUpperCase()}</div>`;

    const prog = file._libraryData?.readingProgress;
    let progressHtml = prog && prog.percentage > 0 
      ? `<div class="progress-bar-small"><div class="progress-bar-fill" style="width: ${prog.percentage}%"></div></div>`
      : '';

    const card = document.createElement('div');
    card.className = 'book-card';
    card.style.width = '140px';
    card.innerHTML = `
      <div class="book-cover-container">
        ${coverHtml}
        <div class="book-overlay">
          <button class="overlay-btn" data-action="read-original" data-path="${escapeHtml(file.path)}" title="Read">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </button>
        </div>
        ${progressHtml}
      </div>
      <div class="book-info">
        <div class="book-title" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
      </div>
    `;
    card.querySelectorAll('button').forEach(btn => btn.addEventListener('click', onRowAction));
    card.addEventListener('dblclick', () => openReader(file));
    els.homeRecentCarousel.appendChild(card);
  }
}

function renderTable() {
  const files = getFilteredFiles();
  const tbody = els.tableBody;

  tbody.innerHTML = '';

  if (files.length === 0) {
    els.tableEmpty.classList.remove('hidden');
    return;
  }

  els.tableEmpty.classList.add('hidden');

  const fragment = document.createDocumentFragment();

  for (const file of files) {
    const tr = document.createElement('tr');
    tr.id = `row-${file.id}`;
    tr.dataset.id = file.id;
    if (file.status === 'converting') tr.classList.add('row--converting');

    // Pick initial cover HTML
    let coverHtml = '';
    if (file.coverUrl) {
      coverHtml = `<img src="${file.coverUrl}" class="cover-image" alt="Cover" />`;
    } else {
      const hash = file.id.charCodeAt(0) % 5;
      const gradients = [
        'linear-gradient(135deg, #FF6B6B 0%, #FF8E8E 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)'
      ];
      coverHtml = `
        <div class="cell-cover" style="background: ${gradients[hash]}">
          <span class="cover-placeholder">${file.type.toUpperCase()}</span>
        </div>`;
    }

    tr.innerHTML = `
      <td class="col-cover">
        ${coverHtml}
      </td>
      <td class="col-name">
        <div class="cell-name">
          <span class="file-name-text" title="${escapeHtml(file.name)}">${escapeHtml(truncate(file.name, 45))}</span>
        </div>
      </td>
      <td class="col-type">
        ${file.type.toUpperCase()}
      </td>
      <td class="col-size">
        <span class="cell-size">${file.sizeFormatted || '—'}</span>
      </td>
      <td class="col-status">
        ${renderStatusBadge(file)}
      </td>
      <td class="col-action">
        <div class="cell-action">
          <button class="action-btn" data-action="read-original" data-path="${escapeHtml(file.path)}" title="View Original">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          ${file.status === 'completed' ? `
            <button class="action-btn" data-action="open" data-path="${escapeHtml(file.path)}" title="Download converted file">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
          ` : ''}
          ${file.status === 'pending' || file.status === 'failed' ? `
             <button class="action-btn" data-action="convert-single" data-path="${escapeHtml(file.path)}" title="Convert" ${state.isConverting ? 'disabled' : ''}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </button>
          ` : ''}
          <button class="action-btn action-danger" data-action="remove" data-id="${file.id}" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </td>
    `;

    // Action buttons
    tr.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', onRowAction);
    });

    fragment.appendChild(tr);
  }

  tbody.appendChild(fragment);
}

function renderStatusBadge(file) {
  const labels = {
    pending: 'Pending',
    converting: 'Converting',
    completed: 'Completed',
    skipped: 'Already EPUB',
    failed: 'Failed',
  };
  const label = labels[file.status] || file.status;
  const title = file.error ? ` title="${escapeHtml(file.error)}"` : '';
  return `<span class="status-badge status--${file.status}"${title}>${label}</span>`;
}

function updateRowStatus(id, status, error = null) {
  const file = state.files.find(f => f.id === id);
  if (!file) return;
  file.status = status;
  file.error = error;

  const row = document.getElementById(`row-${id}`);
  if (row) {
    row.classList.toggle('row--converting', status === 'converting');
    const statusCell = row.querySelector('.col-status');
    if (statusCell) statusCell.innerHTML = renderStatusBadge(file);

    // Refresh action cell
    const actionCell = row.querySelector('.col-action');
    if (actionCell) {
      actionCell.innerHTML = `
        <div class="cell-action">
          <button class="action-btn" data-action="read-original" data-path="${escapeHtml(file.path)}" title="View Original">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          ${status === 'completed' ? `
            <button class="action-btn" data-action="open" data-path="${escapeHtml(file.path)}" title="Download converted file">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
          ` : ''}
          ${(status === 'pending' || status === 'failed') ? `
            <button class="action-btn" data-action="convert-single" data-path="${escapeHtml(file.path)}" title="Convert" ${state.isConverting ? 'disabled' : ''}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </button>
          ` : ''}
          <button class="action-btn action-danger" data-action="remove" data-id="${file.id}" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>`;
      actionCell.querySelectorAll('.action-btn').forEach(b => b.addEventListener('click', onRowAction));
    }
  }
}

function updateRowProgress(id, progress) {
  const row = document.getElementById(`row-${id}`);
  if (row) {
    const statusCell = row.querySelector('.col-status');
    if (statusCell && progress < 100) {
      statusCell.innerHTML = `
        <span class="status-badge status--converting">
          ${Math.round(progress)}%
        </span>`;
    }
  }
}

// ─── Row Actions ──────────────────────────────────────────────────────────────
async function onRowAction(e) {
  const btn = e.currentTarget;
  const action = btn.dataset.action;

  if (action === 'remove') {
    const id = btn.dataset.id;
    if (window.electronAPI && window.electronAPI.library) {
      window.electronAPI.library.removeBook(id);
    }
    state.files = state.files.filter(f => f.id !== id);
    updateUploadZone();
    updateStats();
    renderTable();
    renderLibraryGrid();
    updateConvertButton();
    if (state.files.length === 0) {
      els.toolbar.classList.add('hidden');
      els.tableWrapper.classList.add('hidden');
      els.progressSection.classList.add('hidden');
      $('upload-area').classList.remove('hidden');
    }
    return;
  }

  if (action === 'open') {
    const path = btn.dataset.path;
    await window.electronAPI.openFile(path);
    return;
  }

  if (action === 'read-original') {
    const filePath = btn.dataset.path;
    const file = state.files.find(f => f.path === filePath);
    if (file) {
      openReader(file);
    }
    return;
  }

  if (action === 'convert-single') {
    const filePath = btn.dataset.path;
    const file = state.files.find(f => f.path === filePath);
    if (file) {
      await convertFiles([file]);
    }
    return;
  }
}

// ─── Conversion ───────────────────────────────────────────────────────────────
async function onStartConversion() {
  const pending = state.files.filter(f => f.status === 'pending');
  if (pending.length === 0) {
    showToast('No pending PDF files to convert.', 'warn');
    return;
  }
  await convertFiles(pending);
}

async function convertFiles(filesToConvert) {
  state.isConverting = true;
  state.isCancelled = false;
  state.completedCount = 0;
  state.startTime = Date.now();

  // UI updates
  $('btn-start-conversion').classList.add('hidden');
  $('btn-cancel-conversion').classList.remove('hidden');
  $('btn-cancel-conversion').disabled = false;
  els.progressSection.classList.remove('hidden');
  setSessionStatus('running');
  updateConvertButton();
  startElapsedTimer();

  const total = filesToConvert.length;
  updateProgress(0, total, 0);

  // Process with limited concurrency (3 at a time)
  const CONCURRENCY = 3;
  let index = 0;
  let completed = 0;

  async function worker() {
    while (index < filesToConvert.length) {
      if (state.isCancelled) break;

      const currentIndex = index++;
      const file = filesToConvert[currentIndex];

      // Mark as converting
      updateRowStatus(file.id, 'converting');

      try {
        const result = await window.electronAPI.convertFile(file.path);

        if (state.isCancelled) break;

        if (result.success) {
          file.outputPath = result.outputPath;
          updateRowStatus(file.id, 'completed');
        } else {
          updateRowStatus(file.id, 'failed', result.error);
        }
      } catch (err) {
        updateRowStatus(file.id, 'failed', err.message);
      }

      completed++;
      state.completedCount = completed;
      updateProgress(completed, total, state.startTime);
      updateStats();
      updateETA(state.startTime, completed, total);
    }
  }

  // Launch concurrent workers
  const workers = Array.from({ length: Math.min(CONCURRENCY, filesToConvert.length) }, () => worker());
  await Promise.all(workers);

  // Done
  finishConversion();
}

function finishConversion() {
  state.isConverting = false;
  clearInterval(state.elapsedTimer);

  $('btn-start-conversion').classList.remove('hidden');
  $('btn-cancel-conversion').classList.add('hidden');
  updateConvertButton();

  const converted = state.files.filter(f => f.status === 'completed').length;
  const failed = state.files.filter(f => f.status === 'failed').length;

  if (state.isCancelled) {
    setSessionStatus('cancelled');
    showToast('Conversion cancelled.', 'warn');
  } else if (failed > 0 && converted === 0) {
    setSessionStatus('done');
    showToast(`All ${failed} conversion(s) failed.`, 'error');
  } else if (failed > 0) {
    setSessionStatus('done');
    showToast(`Converted ${converted} file(s). ${failed} failed.`, 'warn');
  } else {
    setSessionStatus('done');
    showToast(`Successfully converted ${converted} file(s)!`, 'success');
  }

  updateProgress(100, state.completedCount, state.startTime, true);
  updateStats();
}

function onCancelConversion() {
  state.isCancelled = true;
  $('btn-cancel-conversion').disabled = true;
  $('btn-cancel-conversion').textContent = 'Cancelling…';
}

// ─── Progress UI ──────────────────────────────────────────────────────────────
function updateProgress(completed, total, startTime, done = false) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const displayPct = done ? 100 : pct;

  els.progressFill.style.width = `${displayPct}%`;
  els.progressGlow.style.left = `${displayPct}%`;
  els.progressPct.textContent = `${displayPct}%`;
  els.progressDetail.textContent = `${completed} / ${total} files`;

  if (done) {
    els.progressLabel.textContent = 'Conversion complete';
    els.progressSpeed.textContent = startTime
      ? `Total time: ${formatDuration(Date.now() - startTime)}`
      : '';
  } else if (completed > 0 && startTime) {
    const elapsed = Date.now() - startTime;
    const rate = completed / (elapsed / 1000);
    els.progressSpeed.textContent = `${rate.toFixed(1)} files/s`;
  }
}

function updateETA(startTime, completed, total) {
  if (completed === 0 || !startTime) {
    els.etaDisplay.textContent = 'Calculating…';
    return;
  }
  const elapsed = Date.now() - startTime;
  const avgPerFile = elapsed / completed;
  const remaining = (total - completed) * avgPerFile;
  els.etaDisplay.textContent = formatDuration(Math.round(remaining));
}

function startElapsedTimer() {
  clearInterval(state.elapsedTimer);
  state.elapsedTimer = setInterval(() => {
    if (state.startTime) {
      els.elapsedDisplay.textContent = formatDuration(Date.now() - state.startTime);
    }
  }, 500);
}

function setSessionStatus(status) {
  const el = els.sessionStatus;
  el.className = 'badge';
  const map = {
    idle: ['badge--idle', 'Idle'],
    running: ['badge--running', 'Converting…'],
    done: ['badge--done', 'Done'],
    cancelled: ['badge--cancelled', 'Cancelled'],
  };
  const [cls, label] = map[status] || map.idle;
  el.classList.add(cls);
  el.textContent = label;
}

// ─── Export ───────────────────────────────────────────────────────────────────
async function onSaveToFolder() {
  const outputFolder = await window.electronAPI.saveFolder();
  if (!outputFolder) return;

  const converted = state.files.filter(f => f.status === 'completed');
  let savedCount = 0;
  let errCount = 0;

  for (const file of converted) {
    const result = await window.electronAPI.saveEpub({
      sourcePath: file.path,
      outputFolder,
    });
    if (result.success) savedCount++;
    else errCount++;
  }

  if (savedCount > 0) {
    showToast(`Saved ${savedCount} EPUB file(s) to folder.`, 'success');
  }
  if (errCount > 0) {
    showToast(`Failed to save ${errCount} file(s).`, 'error');
  }
}

async function onExportZip() {
  const zipPath = await window.electronAPI.saveZipDialog();
  if (!zipPath) return;

  const converted = state.files.filter(f => f.status === 'completed').map(f => f.path);
  const result = await window.electronAPI.exportZip({ filePaths: converted, zipPath });

  if (result.success) {
    showToast(`Exported ZIP archive (${formatBytes(result.size)}).`, 'success');
  } else {
    showToast(`ZIP export failed: ${result.error}`, 'error');
  }
}

// ─── Clear List ───────────────────────────────────────────────────────────────
function onClearList() {
  if (state.isConverting) {
    showToast('Cannot clear while conversion is running.', 'warn');
    return;
  }
  state.files = [];
  updateUploadZone();
  updateStats();
  renderTable();
  updateConvertButton();
  els.toolbar.classList.add('hidden');
  els.tableWrapper.classList.add('hidden');
  els.progressSection.classList.add('hidden');
  $('upload-area').classList.remove('hidden');
  setSessionStatus('idle');
  els.etaDisplay.textContent = '—';
  els.elapsedDisplay.textContent = '—';
  els.dropZone.classList.remove('has-files');
  if (els.uploadTitle) els.uploadTitle.textContent = 'Drop files or folder here';
}

// ─── Select All ───────────────────────────────────────────────────────────────
function updateSelectAll() {
  const visibleIds = new Set(getFilteredFiles().map(f => f.id));
  const visibleSelected = state.files.filter(f => visibleIds.has(f.id) && f.selected).length;
  const visibleTotal = visibleIds.size;

  els.selectAll.checked = visibleSelected === visibleTotal && visibleTotal > 0;
  els.selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visibleTotal;
}

// ─── Sort Icons ───────────────────────────────────────────────────────────────
function updateSortIcons() {
  document.querySelectorAll('th.sortable').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;
    icon.className = 'sort-icon';
    if (th.dataset.sort === state.sort.col) {
      icon.classList.add(state.sort.dir);
    }
  });
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  els.themeLabel.textContent = isDark ? 'Dark Mode' : 'Light Mode';
  localStorage.setItem('theme', next);
}

function restoreTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  els.themeLabel.textContent = saved === 'dark' ? 'Light Mode' : 'Dark Mode';
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <div class="toast-dot"></div>
    <span>${escapeHtml(message)}</span>
    <button class="toast-close">×</button>
  `;

  const close = () => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector('.toast-close').addEventListener('click', close);
  els.toastContainer.appendChild(toast);

  if (duration > 0) setTimeout(close, duration);
  return toast;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function truncate(str, max = 50) {
  return str.length <= max ? str : str.slice(0, max - 3) + '…';
}

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, m => map[m]);
}

function generateId(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(36) + Date.now().toString(36);
}

// ─── Reading Progress & Annotations ───────────────────────────────────────────────────
let progressDebounceTimer;
function updateReadingProgress(fileId, locationString, percentage) {
  clearTimeout(progressDebounceTimer);
  progressDebounceTimer = setTimeout(async () => {
    if (window.electronAPI && window.electronAPI.library) {
      try {
        const updates = { 
          readingProgress: { location: locationString, percentage: Math.min(percentage, 100) },
          lastOpened: Date.now()
        };
        await window.electronAPI.library.updateBook(fileId, updates);
        
        const file = state.files.find(f => f.id === fileId);
        if (file && file._libraryData) {
          file._libraryData.readingProgress = updates.readingProgress;
          file._libraryData.lastOpened = updates.lastOpened;
        }
      } catch(e) {}
    }
  }, 1000);
}

async function toggleBookmark() {
  if (!state.reader.active || !state.reader.file) return;
  
  const curLoc = state.reader.type === 'epub' && state.reader.rendition 
    ? state.reader.rendition.currentLocation() 
    : { start: { cfi: state.reader.pageNum.toString() } };
    
  if (!curLoc || !curLoc.start) return;
  const loc = state.reader.type === 'epub' ? curLoc.start.cfi : curLoc.start.cfi.toString();
  
  const fileId = state.reader.file.id;
  const book = state.files.find(f => f.id === fileId);
  if (book && book._libraryData) {
    let bookmarks = book._libraryData.bookmarks || [];
    if (bookmarks.includes(loc)) {
      bookmarks = bookmarks.filter(b => b !== loc);
      showToast('Bookmark removed', 'info');
    } else {
      bookmarks.push(loc);
      showToast(`Bookmark added at ${state.reader.type === 'epub' ? 'current exact location' : 'page ' + loc}`, 'success');
    }
    await window.electronAPI.library.updateBook(fileId, { bookmarks });
    book._libraryData.bookmarks = bookmarks;
    renderAnnotationsList();
  }
}

let highlightPopover;
function showHighlightPopover(rect, target) {
  if (!highlightPopover) highlightPopover = document.getElementById('highlight-popover');
  state.reader.currentSelection = target;
  
  const iframe = document.querySelector('.reader-pages iframe');
  const iframeRect = iframe ? iframe.getBoundingClientRect() : { left: 0, top: 0 };
  
  highlightPopover.style.left = `${iframeRect.left + rect.left + (rect.width/2) - 60}px`;
  highlightPopover.style.top = `${iframeRect.top + rect.bottom + 10}px`;
  highlightPopover.classList.remove('hidden');
}

function hideHighlightPopover() {
  if (!highlightPopover) highlightPopover = document.getElementById('highlight-popover');
  if (highlightPopover) highlightPopover.classList.add('hidden');
  state.reader.currentSelection = null;
}

function renderAnnotationsList() {
  const listEl = $('reader-annotations-list');
  if (!listEl || !state.reader.file) return;
  
  const book = state.files.find(f => f.id === state.reader.file.id);
  if (!book || !book._libraryData) return;
  
  const marks = book._libraryData.bookmarks || [];
  const hl = book._libraryData.highlights || [];
  
  if (marks.length === 0 && hl.length === 0) {
    listEl.innerHTML = '<div style="text-align:center; padding: 10px;">No annotations yet.</div>';
    return;
  }
  
  let html = '';
  if (marks.length > 0) {
    html += `<div style="font-weight:bold; margin: 8px 0 4px 0; color:var(--text);">Bookmarks (${marks.length})</div>`;
    marks.forEach((loc, i) => {
      html += `<div style="cursor:pointer; padding: 4px; border-radius: 4px; background: rgba(180,180,180,0.1); margin-bottom: 2px;" onclick="goToLocation('${loc}')">Bookmark ${i+1}</div>`;
    });
  }
  if (hl.length > 0) {
    html += `<div style="font-weight:bold; margin: 8px 0 4px 0; color:var(--text);">Highlights (${hl.length})</div>`;
    hl.forEach((h, i) => {
      html += `<div style="cursor:pointer; padding: 4px; border-radius: 4px; border-left: 3px solid ${h.color}; background: rgba(180,180,180,0.1); margin-bottom: 2px;" onclick="goToLocation('${h.cfi}')">Highlight ${i+1}</div>`;
    });
  }
  listEl.innerHTML = html;
}

window.goToLocation = (loc) => {
  if (state.reader.type === 'epub' && state.reader.rendition) {
    state.reader.rendition.display(loc);
  } else if (state.reader.type === 'pdf') {
    state.reader.pageNum = parseInt(loc, 10) || 1;
    renderPdfPage(state.reader.pageNum);
  }
};

// ─── Reader Implementation ────────────────────────────────────────────────────
async function openReader(file) {
  if (file.coverLoading === true) {
    showToast('Cover loading, please wait...', 'info', 2000);
    return;
  }

  state.reader.active = true;
  state.reader.file = file;
  state.reader.type = file.type;
  state.reader.pageNum = 1;
  state.reader.zoom = 1.0;
  
  // Buffer structure
  state.reader.buffer = {
    prev: $('page-prev'),
    current: $('page-current'),
    next: $('page-next'),
    pdfCache: new Map() // num -> Object{ canvasLeft, canvasRight }
  };
  
  // Reset transitions
  ['prev', 'current', 'next'].forEach(k => {
    if (state.reader.buffer[k]) {
      state.reader.buffer[k].className = `page-container page-${k}`;
      state.reader.buffer[k].innerHTML = '';
      state.reader.buffer[k].style.opacity = (k === 'current') ? '1' : '0';
    }
  });
  
  els.readerOverlay.classList.remove('hidden');
  els.readerTitle.textContent = file.name;
  els.readerSettingsPanel.classList.add('hidden');
  els.readerPageInfo.textContent = 'Loading...';

  showToast('Opening book...', 'info', 1500);

  console.log('openReader triggered for:', file.path);

  try {
    const result = await window.electronAPI.readFileBase64(file.path);
    console.log('readFileBase64 result:', result.success);
    if (!result.success) {
      console.error('readFileBase64 failed:', result.error);
      showToast('Failed to read file from disk.', 'error');
      closeReader();
      return;
    }

    const binaryString = atob(result.base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    console.log('Bytes array created, length:', bytes.length);

    if (file.type === 'epub') {
      console.log('Initializing EPUB reader...');
      els.pdfControls.classList.add('hidden');
      initEpubReader(bytes.buffer);
    } else if (file.type === 'pdf') {
      console.log('Initializing PDF reader...');
      els.pdfControls.classList.remove('hidden');
      initPdfReader(bytes);
    }
    applyReaderFormatting();
  } catch (err) {
    console.error('Error in openReader:', err, err.stack);
    showToast('Failed to open reader: ' + err.message, 'error');
    closeReader();
  }
}

function closeReader() {
  state.reader.active = false;
  state.reader.initialized = false;
  els.readerOverlay.classList.add('hidden');
  
  if (state.reader.book) {
    state.reader.book.destroy();
    state.reader.book = null;
  }
  state.reader.rendition = null;
  state.reader.pdfDoc = null;
  
  if (state.reader.buffer) {
    state.reader.buffer.pdfCache.clear();
    state.reader.buffer = null;
  }
  
  els.readerContent.innerHTML = `
    <div class="page-container page-prev" id="page-prev"></div>
    <div class="page-container page-current" id="page-current"></div>
    <div class="page-container page-next" id="page-next"></div>
  `;
}

// -- EPUB --
function initEpubReader(arrayBuffer) {
  if (!window.ePub) {
    showToast('EPUB engine not loaded.', 'error');
    closeReader();
    return;
  }
  
  const book = ePub(arrayBuffer);
  state.reader.book = book;
  
  const rendition = book.renderTo("page-current", {
    width: "100%",
    height: "100%",
    spread: "auto",
    manager: "continuous",
    flow: "paginated"
  });
  state.reader.rendition = rendition;
  
  // Restore layout formatting immediately
  applyReaderFormatting();

  const lastProgress = state.reader.file && state.reader.file._libraryData ? state.reader.file._libraryData.readingProgress : null;
  const displayPromise = (lastProgress && lastProgress.location) 
    ? rendition.display(lastProgress.location) 
    : rendition.display();

  displayPromise.then(() => {
    const bookData = state.files.find(f => f.id === state.reader.file.id)?._libraryData;
    if (bookData && bookData.highlights) {
      bookData.highlights.forEach(hl => {
        try { rendition.annotations.highlight(hl.cfi, {}, null, "", { "fill": hl.color, "fill-opacity": "0.3" }); } catch(e){}
      });
    }
    renderAnnotationsList();
  });

  rendition.on("relocated", (location) => {
    if (state.reader.file) {
      if (book.locations && book.locations.length() > 0 && location.start) {
         const pct = Math.round(book.locations.percentageFromCfi(location.start.cfi) * 100);
         state.reader.file.progress = pct;
         els.readerPageInfo.textContent = `EPUB Document (${pct}%)`;
         const barFill = document.getElementById('reader-progress-bar-fill');
         if (barFill) barFill.style.width = `${pct}%`;
         updateReadingProgress(state.reader.file.id, location.start.cfi, pct);
      } else {
         els.readerPageInfo.textContent = 'EPUB Document';
         if (location.start && location.start.cfi) {
           updateReadingProgress(state.reader.file.id, location.start.cfi, 1);
         }
      }
    }
  });

  rendition.on('selected', (cfiRange, contents) => {
    const sel = contents.window.getSelection();
    if (sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    showHighlightPopover(rect, { cfiRange, contents });
  });

  rendition.hooks.content.register((contents) => {
    contents.document.body.addEventListener('click', () => {
      const sel = contents.window.getSelection();
      if (sel.isCollapsed) hideHighlightPopover();
    });
  });

  book.ready.then(() => {
    // Generate epub.js accurate pagination map
    book.locations.generate(1600).then(() => {
       const curLoc = rendition.currentLocation();
       if (curLoc && curLoc.start) {
         const pct = Math.round(book.locations.percentageFromCfi(curLoc.start.cfi) * 100);
         if (state.reader.file) state.reader.file.progress = pct;
         $('reader-progress-pct').textContent = `${pct}%`;
         const barFill = document.getElementById('reader-progress-bar-fill');
         if (barFill) barFill.style.width = `${pct}%`;
       }
    }).catch(e => console.error("EPUB locations generation failed", e));
  });

  // Setup themes
  rendition.themes.register("light", { "body": { "background": "#ffffff", "color": "#1a1a28" }});
  rendition.themes.register("sepia", { "body": { "background": "#f4ecd8", "color": "#5b4636" }});
  rendition.themes.register("dark", { 
    "body": { "background": "#08080f", "color": "#e2e2ea" },
    "a": { "color": "#b886ff" }
  });
  
  rendition.themes.select(state.reader.theme);
  rendition.themes.fontSize(`${state.reader.fontSize}%`);
  
  state.reader.initialized = true;
  applySettings();
}

function onReaderThemeChange(themeName) {
  state.settings.theme = themeName;
  saveSettings();
  applySettings();
  populateSettingsUI();
}

function onReaderFontChange(delta) {
  state.settings.fontSize = Math.max(80, Math.min(250, state.settings.fontSize + delta));
  saveSettings();
  applySettings();
  populateSettingsUI();
  formatDebounceRefresh();
}

function onReaderFormatChange() {
  const familyEl = $('reader-font-family');
  const lineEl = $('reader-line-spacing');
  if (familyEl) state.settings.fontFamily = familyEl.value;
  if (lineEl) state.settings.lineHeight = parseFloat(lineEl.value);
  if (els.readerWidthControl) state.reader.widthMode = els.readerWidthControl.value;
  
  saveSettings();
  applySettings();
  populateSettingsUI();
  formatDebounceRefresh();
}

let formatDebounce;
function applyReaderFormatting() {
  const container = document.querySelector('.reader-content-wrapper');
  if (container) {
    container.setAttribute('data-width-mode', state.reader.widthMode || 'medium');
  }
  formatDebounceRefresh();
}

function restoreReaderSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('readerSettings'));
    if (saved) {
      if (saved.fontFamily) state.reader.fontFamily = saved.fontFamily;
      if (saved.lineSpacing) state.reader.lineSpacing = saved.lineSpacing;
      if (saved.widthMode) state.reader.widthMode = saved.widthMode;
      
      const familyEl = $('reader-font-family');
      const lineEl = $('reader-line-spacing');
      if (familyEl) familyEl.value = state.reader.fontFamily;
      if (lineEl) lineEl.value = state.reader.lineSpacing;
      if (els.readerWidthControl) els.readerWidthControl.value = state.reader.widthMode;
    }
  } catch(e) {}
}

function validateSettings(settings) {
  if (!settings) settings = {};
  return {
    margins: settings.margins !== undefined ? !!settings.margins : true,
    textAlignmentOverride: !!settings.textAlignmentOverride,
    autoSingleColumn: !!settings.autoSingleColumn,
    readAloudAutoScroll: settings.readAloudAutoScroll !== undefined ? !!settings.readAloudAutoScroll : true,
    searchEngine: settings.searchEngine || "google",
    dictionary: settings.dictionary || "default",
    pageTransition: ["none","slide","fade"].includes(settings.pageTransition) ? settings.pageTransition : "slide",

    fontFamily: settings.fontFamily || 'Georgia, serif',
    fontSize: typeof settings.fontSize === 'number' ? settings.fontSize : 100,
    lineHeight: typeof settings.lineHeight === 'number' ? settings.lineHeight : 1.6,
    letterSpacing: typeof settings.letterSpacing === 'number' ? settings.letterSpacing : 0,
    wordSpacing: typeof settings.wordSpacing === 'number' ? settings.wordSpacing : 0,
    paragraphSpacing: typeof settings.paragraphSpacing === 'number' ? settings.paragraphSpacing : 1,
    theme: ["light","dark","sepia"].includes(settings.theme) ? settings.theme : "light",
    brightness: typeof settings.brightness === 'number' ? settings.brightness : 100,
    sepia: typeof settings.sepia === 'number' ? settings.sepia : 0,
    scrollMode: !!settings.scrollMode,
    pageTurnArea: settings.pageTurnArea === 'both' ? 'both' : 'right',
    animationSpeed: typeof settings.animationSpeed === 'number' ? settings.animationSpeed : 300
  };
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('appSettings'));
    state.settings = validateSettings(saved);
  } catch(e) {
    state.settings = validateSettings({});
  }
}

function saveSettings() {
  localStorage.setItem('appSettings', JSON.stringify(state.settings));
}

function populateSettingsUI() {
  const toggle = (id, val) => { const el = $(id); if (el) el.checked = val; };
  const select = (id, val) => { const el = $(id); if (el) el.value = val; };
  const slider = (id, val) => { const el = $(id); if (el) el.value = val; };
  const text = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  
  toggle('setting-margins', state.settings.margins);
  toggle('setting-text-alignment', state.settings.textAlignmentOverride);
  toggle('setting-auto-column', state.settings.autoSingleColumn);
  toggle('setting-read-aloud', state.settings.readAloudAutoScroll);
  toggle('setting-scroll-mode', state.settings.scrollMode);
  
  select('setting-search-engine', state.settings.searchEngine);
  select('setting-dictionary', state.settings.dictionary);
  select('setting-page-transition', state.settings.pageTransition);
  select('setting-font-family', state.settings.fontFamily);
  select('setting-page-turn-area', state.settings.pageTurnArea);

  slider('setting-font-size', state.settings.fontSize); text('setting-val-fontsize', state.settings.fontSize);
  slider('setting-line-height', state.settings.lineHeight); text('setting-val-lineheight', state.settings.lineHeight);
  slider('setting-letter-spacing', state.settings.letterSpacing); text('setting-val-letterspacing', state.settings.letterSpacing);
  slider('setting-word-spacing', state.settings.wordSpacing); text('setting-val-wordspacing', state.settings.wordSpacing);
  slider('setting-paragraph-spacing', state.settings.paragraphSpacing); text('setting-val-paragraphspacing', state.settings.paragraphSpacing);
  slider('setting-brightness', state.settings.brightness); text('setting-val-brightness', state.settings.brightness);
  slider('setting-sepia', state.settings.sepia); text('setting-val-sepia', state.settings.sepia);
  slider('setting-animation-speed', state.settings.animationSpeed); text('setting-val-animationspeed', state.settings.animationSpeed);

  // Theme cards
  document.querySelectorAll('.theme-card').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === state.settings.theme);
  });
  
  // Also perform a live preview update immediately
  updateSettingsPreview();
}

function updateSettingsPreview() {
  const block = $('settings-preview-block');
  if (!block) return;
  block.style.fontFamily = state.settings.fontFamily;
  block.style.fontSize = `${state.settings.fontSize}%`;
  block.style.lineHeight = state.settings.lineHeight;
  block.style.letterSpacing = `${state.settings.letterSpacing}px`;
  block.style.wordSpacing = `${state.settings.wordSpacing}px`;
  
  // Theme simulator
  if (state.settings.theme === 'dark') {
    block.style.background = '#12121e';
    block.style.color = '#fff';
  } else if (state.settings.theme === 'sepia') {
    block.style.background = '#f4ecd8';
    block.style.color = '#5b4636';
  } else {
    block.style.background = '#fff';
    block.style.color = '#000';
  }
}

let isApplyingSettings = false;
function applySettings() {
  if (isApplyingSettings) return;
  if (!state.reader || !state.reader.active || !state.reader.initialized) return;

  isApplyingSettings = true;

  try {
    // 1. Sync state.reader
    state.reader.fontFamily = state.settings.fontFamily;
    state.reader.fontSize = state.settings.fontSize;
    state.reader.lineHeight = state.settings.lineHeight;
    state.reader.theme = state.settings.theme;

    // 2. Apply theme
    document.body.dataset.theme = state.settings.theme;
    if (state.reader.type === 'epub' && state.reader.rendition) {
      state.reader.rendition.themes.select(state.settings.theme);
    }
    const overlay = document.querySelector(".reader-overlay");
    if (overlay) {
      overlay.style.filter = `brightness(${state.settings.brightness}%) sepia(${state.settings.sepia}%)`;
      overlay.setAttribute('data-reader-theme', state.settings.theme);
    }
    if (state.reader.type === 'pdf') {
      const isDark = state.settings.theme === 'dark';
      const isSepia = state.settings.theme === 'sepia';
      els.readerContent.style.filter = isDark ? 'invert(0.9) hue-rotate(180deg)' : 
                                      (isSepia ? 'sepia(0.5) contrast(0.9)' : 'none');
    }

    // 3. Apply Typography
    const wrapper = document.querySelector('.reader-content-wrapper');
    if (wrapper) {
      wrapper.style.fontFamily = state.settings.fontFamily;
      wrapper.style.lineHeight = state.settings.lineHeight;
      // Widthmode is still decoupled for now unless explicitly added to settings
      wrapper.setAttribute('data-width-mode', state.reader.widthMode || 'medium');
    }

    if (state.reader.type === 'epub' && state.reader.rendition) {
      state.reader.rendition.themes.default({
        body: {
          "font-family": state.settings.fontFamily,
          "font-size": state.settings.fontSize + "%",
          "line-height": state.settings.lineHeight,
          "letter-spacing": state.settings.letterSpacing + "px",
          "word-spacing": state.settings.wordSpacing + "px"
        },
        p: {
          "margin-bottom": state.settings.paragraphSpacing + "em"
        }
      });
      if (state.settings.textAlignmentOverride) {
        state.reader.rendition.themes.register("alignment-override", {
          "p, div": { "text-align": "justify !important" }
        });
        state.reader.rendition.themes.select("alignment-override");
      }
    } else if (state.reader.type === 'pdf') {
      state.reader.zoom = state.settings.fontSize / 100;
    }

    // 4. Apply Layout
    const readerStage = document.querySelector('.reader-stage');
    if (readerStage) {
      if (state.settings.margins) {
        readerStage.classList.remove('reader-no-margins');
      } else {
        readerStage.classList.add('reader-no-margins');
      }
    }

    if (state.reader.type === 'epub' && state.reader.rendition) {
      state.reader.rendition.flow(state.settings.scrollMode ? "scrolled" : "paginated");
      state.reader.rendition.spread(state.settings.autoSingleColumn ? "none" : "auto");
    } else if (state.reader.type === 'pdf') {
       if (wrapper) wrapper.style.overflowY = state.settings.scrollMode ? "auto" : "hidden";
    }

    // 5. Apply Motion
    const readerPages = document.getElementById('reader-content');
    if (readerPages) {
      readerPages.className = `reader-pages transition-${state.settings.pageTransition}`;
      document.body.style.setProperty('--animation-speed', `${state.settings.animationSpeed}ms`);
    }

  } catch (err) {
    console.error("Settings apply failed:", err);
  } finally {
    setTimeout(() => {
      isApplyingSettings = false;
    }, 200);
  }
}

function formatDebounceRefresh() {
  clearTimeout(formatDebounce);
  formatDebounce = setTimeout(() => {
    if (!state.reader.active) return;
    if (state.reader.type === 'epub') {
      state.reader.rendition?.resize();
    } else if (state.reader.type === 'pdf') {
       if (state.reader.buffer) state.reader.buffer.pdfCache.clear();
       renderPdfPage(state.reader.pageNum);
    }
  }, 150);
}


async function onToggleFullscreen() {
  const isFS = await window.electronAPI.toggleFullscreen();
  if (isFS) {
    els.readerOverlay?.classList.add('is-fullscreen');
  } else {
    els.readerOverlay?.classList.remove('is-fullscreen');
  }
  // Allow UI reflow before kicking the engine
  setTimeout(() => {
    if (state.reader.type === 'pdf') {
       if (state.reader.buffer) state.reader.buffer.pdfCache.clear();
       renderPdfPage(state.reader.pageNum);
    } else {
       state.reader.rendition?.resize();
    }
  }, 200);
}

// -- PDF --
async function initPdfReader(bytes) {
  if (!window.pdfjsLib) {
    showToast('PDF engine not loaded.', 'error');
    closeReader();
    return;
  }
  
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  try {
    const pdfDoc = await loadingTask.promise;
    state.reader.pdfDoc = pdfDoc;
    state.reader.pageCount = pdfDoc.numPages;
    
    const lastProgress = state.reader.file && state.reader.file._libraryData ? state.reader.file._libraryData.readingProgress : null;
    let startPage = 1;
    if (lastProgress && lastProgress.location) {
      startPage = parseInt(lastProgress.location, 10) || 1;
      startPage = Math.min(Math.max(1, startPage), pdfDoc.numPages);
    }
    state.reader.pageNum = startPage;
    
    els.pdfZoomLevel.textContent = `${Math.round(state.reader.zoom * 100)}%`;
    renderPdfPage(state.reader.pageNum);
    renderAnnotationsList();
    
    state.reader.initialized = true;
    applySettings();
  } catch (err) {
    showToast('Failed to load PDF.', 'error');
    closeReader();
  }
}

async function renderPdfPage(num) {
  if (!state.reader.pdfDoc || !state.reader.buffer) return;
  
  // Clear only current container
  state.reader.buffer.current.innerHTML = ''; 
  
  const isLandscape = window.innerWidth > 1100 && (state.reader.widthMode === 'wide' || state.reader.widthMode === 'full') && !state.settings.autoSingleColumn;
  const shift = isLandscape ? 2 : 1;
  
  els.readerPageInfo.textContent = isLandscape ? `Page ${num}-${Math.min(num + 1, state.reader.pageCount)} of ${state.reader.pageCount}` : `Page ${num} of ${state.reader.pageCount}`;
  
  if (state.reader.file) {
    const progressPct = Math.round((num / state.reader.pageCount) * 100);
    state.reader.file.progress = progressPct;
    $('reader-progress-pct').textContent = `${progressPct}%`;
    const barFill = document.getElementById('reader-progress-bar-fill');
    if (barFill) barFill.style.width = `${progressPct}%`;
    updateReadingProgress(state.reader.file.id, num.toString(), progressPct);
  }

  // Pre-render core logic
  const renderSinglePage = async (pageContextNum) => {
    if (pageContextNum > state.reader.pageCount) return null;
    const page = await state.reader.pdfDoc.getPage(pageContextNum);
    const viewport = page.getViewport({ scale: state.reader.zoom * 1.5 });
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    canvas.style.objectFit = "contain";
    
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  };

  const getCachedPages = async (targetNum) => {
    if (targetNum < 1 || targetNum > state.reader.pageCount) return null;
    if (state.reader.buffer.pdfCache.has(targetNum)) return state.reader.buffer.pdfCache.get(targetNum);
    
    const nodeData = {
      left: await renderSinglePage(targetNum),
      right: isLandscape ? await renderSinglePage(targetNum + 1) : null
    };
    
    // Garbage collection (keep max 3 blocks)
    if (state.reader.buffer.pdfCache.size >= 3) {
      const keys = Array.from(state.reader.buffer.pdfCache.keys());
      const furthest = keys.reduce((a, b) => Math.abs(a - targetNum) > Math.abs(b - targetNum) ? a : b);
      state.reader.buffer.pdfCache.delete(furthest);
    }
    
    state.reader.buffer.pdfCache.set(targetNum, nodeData);
    return nodeData;
  };
  
  try {
    // 1. Render Current
    const currentNodes = await getCachedPages(num);
    if (currentNodes) {
      if (currentNodes.left) state.reader.buffer.current.appendChild(currentNodes.left);
      if (currentNodes.right) state.reader.buffer.current.appendChild(currentNodes.right);
    }
    
    // 2. Pre-render Async Boundaries
    setTimeout(async () => {
      const prevNum = num - shift;
      const nextNum = num + shift;
      
      if (prevNum >= 1) {
        state.reader.buffer.prev.innerHTML = '';
        const prevNodes = await getCachedPages(prevNum);
        if (prevNodes && prevNodes.left) state.reader.buffer.prev.appendChild(prevNodes.left.cloneNode(true));
        if (prevNodes && prevNodes.right) state.reader.buffer.prev.appendChild(prevNodes.right.cloneNode(true));
      }
      
      if (nextNum <= state.reader.pageCount) {
        state.reader.buffer.next.innerHTML = '';
        const nextNodes = await getCachedPages(nextNum);
        if (nextNodes && nextNodes.left) state.reader.buffer.next.appendChild(nextNodes.left.cloneNode(true));
        if (nextNodes && nextNodes.right) state.reader.buffer.next.appendChild(nextNodes.right.cloneNode(true));
      }
    }, 50); // small delay to release main thread for animations

  } catch(e) { console.error('Render PDF page error:', e); }
}

function onZoomIn() {
  if (state.reader.type !== 'pdf') return;
  state.reader.zoom = Math.min(3.0, state.reader.zoom + 0.25);
  updatePdfZoom();
}

function onZoomOut() {
  if (state.reader.type !== 'pdf') return;
  state.reader.zoom = Math.max(0.5, state.reader.zoom - 0.25);
  updatePdfZoom();
}

function updatePdfZoom() {
  els.pdfZoomLevel.textContent = `${Math.round(state.reader.zoom * 100)}%`;
  renderPdfPage(state.reader.pageNum);
}

// -- Navigation & Shifting --
async function performPageShift(direction) {
  if (state.reader.isShifting || !state.reader.buffer) return false;
  
  const { prev, current, next } = state.reader.buffer;
  
  // Abort if no preloaded content exists in target buffer
  if (direction === 'next' && next.childElementCount === 0) return false;
  if (direction === 'prev' && prev.childElementCount === 0) return false;
  
  state.reader.isShifting = true;
  
  if (direction === 'next') {
    current.classList.add('shifting-left');
    next.classList.remove('page-next');
    next.classList.add('page-current');
    
    // Wait for CSS transition (0.3s matching styles.css)
    await new Promise(r => setTimeout(r, 300));
    
    // Array reassignment
    current.className = 'page-container page-prev';
    prev.className = 'page-container page-next';
    prev.innerHTML = ''; // clear old boundary
    
    state.reader.buffer = { prev: current, current: next, next: prev, pdfCache: state.reader.buffer.pdfCache };
  } else {
    current.classList.add('shifting-right');
    prev.classList.remove('page-prev');
    prev.classList.add('page-current');
    
    await new Promise(r => setTimeout(r, 300));
    
    current.className = 'page-container page-next';
    next.className = 'page-container page-prev';
    next.innerHTML = '';
    
    state.reader.buffer = { prev: next, current: prev, next: current, pdfCache: state.reader.buffer.pdfCache };
  }
  
  state.reader.isShifting = false;
  return true;
}

async function onReaderPrev() {
  if (state.reader.type === 'epub') {
    state.reader.rendition?.prev();
  } else if (state.reader.type === 'pdf') {
    if (state.reader.pageNum <= 1) return;
    const isLandscape = window.innerWidth > 1100 && (state.reader.widthMode === 'wide' || state.reader.widthMode === 'full');
    const shift = isLandscape ? 2 : 1;
    
    const targetPage = Math.max(1, state.reader.pageNum - shift);
    
    const animatedBuffer = await performPageShift('prev');
    state.reader.pageNum = targetPage;
    
    if (animatedBuffer) {
      // Background async boundary refill
      renderPdfPage(state.reader.pageNum); 
    } else {
      // Fallback synchronous render if buffer failed to preload
      renderPdfPage(state.reader.pageNum);
    }
  }
}

async function onReaderNext() {
  if (state.reader.type === 'epub') {
    state.reader.rendition?.next();
  } else if (state.reader.type === 'pdf') {
    const isLandscape = window.innerWidth > 1100 && (state.reader.widthMode === 'wide' || state.reader.widthMode === 'full');
    const shift = isLandscape ? 2 : 1;
    if (state.reader.pageNum >= state.reader.pageCount) return;
    
    const targetPage = Math.min(state.reader.pageCount, state.reader.pageNum + shift);
    
    const animatedBuffer = await performPageShift('next');
    state.reader.pageNum = targetPage;
    
    if (animatedBuffer) {
      renderPdfPage(state.reader.pageNum);
    } else {
      renderPdfPage(state.reader.pageNum);
    }
  }
}

// Re-evaluate layouts on resize without full app re-renders
let resizeTimer;
window.addEventListener('resize', () => {
  if (!state.reader.active) return;
  
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.reader.type === 'pdf') {
      if (state.reader.buffer) state.reader.buffer.pdfCache.clear();
      renderPdfPage(state.reader.pageNum);
    } else if (state.reader.type === 'epub') {
      state.reader.rendition?.resize();
    }
  }, 200);
});



/* ══════════════════════════════════════════════════════════════
   PHASE 2 & 3: NEW LAYOUT, NAVIGATION & RENDERING LOGIC
══════════════════════════════════════════════════════════════ */

state.currentView = 'home';
state.collections = [];

function navigateTo(viewName) {
  state.currentView = viewName;
  
  // Hide all views
  document.querySelectorAll('.page-view').forEach(el => el.classList.add('hidden'));
  
  // Show target
  const target = document.getElementById(`page-${viewName}`);
  if (target) {
    target.classList.remove('hidden');
    // slight delay for opacity transition to trigger
    requestAnimationFrame(() => {
      target.style.opacity = '1';
    });
  }

  // Update nav active states
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    if (el.dataset.view === viewName) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  renderCurrentView();
}

function renderCurrentView() {
  switch (state.currentView) {
    case 'home': renderHome(); break;
    case 'library': renderLibrary(); break;
    case 'recent': renderRecentReads(); break;
    case 'favorites': renderFavorites(); break;
    case 'collections': renderCollections(); break;
  }
}

function renderHome() {
  const recentGrid = document.getElementById('home-recent-grid');
  const favRow = document.getElementById('home-favorites-row');
  const recentAddedRow = document.getElementById('home-recent-added-row');

  if (state.files.length === 0) {
    if (els.homeEmptyState) els.homeEmptyState.classList.remove('hidden');
    if (els.homeDashboard) els.homeDashboard.classList.add('hidden');
  } else {
    if (els.homeEmptyState) els.homeEmptyState.classList.add('hidden');
    if (els.homeDashboard) els.homeDashboard.classList.remove('hidden');
  }

  if (recentGrid) {
    const recent = [...state.files].filter(f => f.lastOpened > 0).sort((a,b) => b.lastOpened - a.lastOpened).slice(0, 5);
    recentGrid.innerHTML = '';
    if (recent.length === 0) recentGrid.innerHTML = '<div class="text-muted" style="font-size:13px;">No recently read books.</div>';
    recent.forEach(f => recentGrid.appendChild(createBookCardElement(f, 'recent')));
  }

  if (favRow) {
    const favs = [...state.files].filter(f => f.favorite).slice(0, 10);
    favRow.innerHTML = '';
    if (favs.length === 0) favRow.innerHTML = '<div class="text-muted" style="font-size:13px;">No favorite books yet.</div>';
    favs.forEach(f => favRow.appendChild(createBookCardElement(f, 'favorite')));
  }

  if (recentAddedRow) {
    const added = [...state.files].sort((a,b) => (b.dateAdded || 0) - (a.dateAdded || 0)).slice(0, 10);
    recentAddedRow.innerHTML = '';
    if (added.length === 0) recentAddedRow.innerHTML = '<div class="text-muted" style="font-size:13px;">No books imported. Library is empty.</div>';
    added.forEach(f => recentAddedRow.appendChild(createBookCardElement(f, 'home')));
  }
}

function renderLibrary() {
  const grid = document.getElementById('library-grid');
  if (!grid) return;
  
  // Reuse existing filtered list logic (which checks state.filter, state.search)
  const files = getFilteredFiles(); 
  
  grid.innerHTML = '';
  if (files.length === 0) {
    grid.innerHTML = '<div class="text-muted" style="font-size:14px; grid-column: 1 / -1;">No matching books found in library.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  files.forEach(f => {
    frag.appendChild(createBookCardElement(f, 'library'));
  });
  grid.appendChild(frag);
}

function renderRecentReads() {
  const grid = document.getElementById('recent-grid');
  if (!grid) return;
  const recent = [...state.files].filter(f => f.lastOpened > 0).sort((a,b) => b.lastOpened - a.lastOpened);
  grid.innerHTML = '';
  if (recent.length === 0) grid.innerHTML = '<div class="text-muted" style="font-size:14px; grid-column: 1 / -1;">No recently read books.</div>';
  recent.forEach(f => grid.appendChild(createBookCardElement(f, 'recent')));
}

function renderFavorites() {
  const grid = document.getElementById('favorites-grid');
  if (!grid) return;
  const favs = [...state.files].filter(f => f.favorite);
  grid.innerHTML = '';
  if (favs.length === 0) grid.innerHTML = '<div class="text-muted" style="font-size:14px; grid-column: 1 / -1;">No favorite books found. Click the heart icon on a book to add one.</div>';
  favs.forEach(f => grid.appendChild(createBookCardElement(f, 'favorite')));
}

function renderCollections() {
  const grid = document.getElementById('collections-grid');
  if (grid && !grid.hasChildNodes()) {
    grid.innerHTML = '<div class="text-muted" style="font-size:14px;">Collections feature coming soon!</div>';
  }
}

function createBookCardElement(file, mode) {
  const template = document.getElementById('template-book-card');
  if (!template) return document.createElement('div');
  const clone = template.content.cloneNode(true);
  const card = clone.querySelector('.book-card');
  
  card.dataset.id = file.id;

  // Set info safely with fallbacks to prevent TypeErrors on corrupted library cache
  const safeName = file.name || file.title || 'Unknown Title';
  const safeFormat = (file.type || 'unknown').toUpperCase();
  
  card.querySelector('.book-title').textContent = truncate(safeName.replace(/\.[^/.]+$/, ""), 40);
  card.querySelector('.book-author').textContent = file.author || 'Unknown Author';
  
  // Format badge
  card.querySelector('.badge-format').textContent = safeFormat;
  
  // Fav status
  const favBtn = card.querySelector('.overlay-btn-fav');
  if (file.favorite) {
    card.classList.add('is-favorite');
    favBtn?.classList.add('active');
  }

  // Cover
  const img = card.querySelector('.book-cover');
  const placeholder = card.querySelector('.book-cover-placeholder');
  if (file.coverUrl) {
    img.src = file.coverUrl;
    placeholder.style.display = 'none';
  } else {
    img.style.display = 'none';
    placeholder.textContent = file.type.toUpperCase();
  }

  // Progress
  const pct = file.progress || 0;
  if (pct > 0) {
    card.querySelector('.progress-bar-fill').style.width = `${pct}%`;
  } else {
    card.querySelector('.progress-bar-small').style.display = 'none';
  }

  // Events
  card.querySelector('.overlay-btn-read')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openReader(file);
  });
  
  favBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    file.favorite = !file.favorite;
    renderCurrentView();
  });
  
  card.querySelector('.overlay-btn-remove')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      if (window.electronAPI && window.electronAPI.library) {
        await window.electronAPI.library.removeBook(file.id);
      }
      state.files = state.files.filter(f => f.id !== file.id);
      
      // Surgical DOM removal - NO SCROLL JUMP
      document.querySelectorAll(`.book-card[data-id="${file.id}"]`).forEach(el => el.remove());
      const row = document.getElementById(`row-${file.id}`);
      if (row) row.remove();
      
      updateStats();
      if (state.files.length === 0) renderCurrentView();
    } catch (err) {
      showToast('Error removing book', 'error');
    }
  });
  
  // Clicking the card itself
  card.addEventListener('click', () => {
    openReader(file);
  });

  return card;
}

// ─── HOOKS INTO EXISTING LOGIC ────────────────────────────────────────────────

// Intercept window close or reader close to update lastOpened
const originalCloseReader = closeReader;
closeReader = function() {
  if (state.reader.active && state.reader.file) {
    state.reader.file.lastOpened = Date.now();
  }
  originalCloseReader();
  renderCurrentView();
};

// Hook into addFiles to update the current view and add metadata
const originalAddFiles = addFiles;
addFiles = function(newFiles) {
  // inject metadata
  newFiles.forEach(f => {
    f.dateAdded = f.dateAdded || Date.now();
    f.lastOpened = f.lastOpened || 0;
    f.progress = f.progress || 0;
    f.favorite = f.favorite || false;
    f.author = f.author || 'Unknown Author';
  });
  originalAddFiles(newFiles);
  
  // Only re-render if NOT on library view (Library handles its own table, but Home recent needs an update)
  if (state.currentView !== 'library') {
    renderCurrentView();
  }
};

// Ensure updates happen when table normally renders
const originalRenderTable = renderTable;
renderTable = function() {
  originalRenderTable();
  if (state.currentView === 'library') renderLibrary();
};

// Removed toxic `updateRowCover` monkey patch that was rebuilding the entire DOM
// on every single async cover extraction, causing race conditions and reset scrolls.

// Bind new nav listeners
document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const view = e.currentTarget.dataset.view;
    if (view) navigateTo(view);
  });
});

document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const view = e.currentTarget.dataset.goto;
    if (view) navigateTo(view);
  });
});

// Bind Library search/sort
document.getElementById('library-search')?.addEventListener('input', (e) => {
  state.search = e.target.value.toLowerCase();
  if (state.currentView === 'library') renderLibrary();
});

document.getElementById('library-sort')?.addEventListener('change', (e) => {
  state.sort.col = e.target.value;
  if (state.currentView === 'library') renderLibrary();
});

document.querySelectorAll('.library-toolbar .filter-tab').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.library-toolbar .filter-tab').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    state.filter = e.currentTarget.dataset.filter;
    if (state.currentView === 'library') renderLibrary();
  });
});

// Open file dialog from library "Add Books" button
document.getElementById('btn-add-books')?.addEventListener('click', onSelectFiles);

  // Settings listeners
  ['setting-margins', 'setting-text-alignment', 'setting-auto-column', 'setting-read-aloud'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        const key = id === 'setting-margins' ? 'margins' :
                    id === 'setting-text-alignment' ? 'textAlignmentOverride' :
                    id === 'setting-auto-column' ? 'autoSingleColumn' : 'readAloudAutoScroll';
        state.settings[key] = e.target.checked;
        saveSettings();
        applySettings();
        if (id !== 'setting-read-aloud') {
           formatDebounceRefresh();
        }
      });
    }
  });

  ['setting-search-engine', 'setting-dictionary', 'setting-page-transition'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        const key = id === 'setting-search-engine' ? 'searchEngine' :
                    id === 'setting-dictionary' ? 'dictionary' : 'pageTransition';
        state.settings[key] = e.target.value;
        saveSettings();
        applySettings();
      });
    }
  });


// Initialize with home
setTimeout(() => {
  navigateTo('home');
}, 500);
