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
  reader: {
    active: false,
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
    bindEvents();
    restoreTheme();
    restoreReaderSettings();
    
    if (window.electronAPI && window.electronAPI.library) {
      try {
        const books = await window.electronAPI.library.getBooks();
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
            coverUrl: b.coverImage,
            coverLoading: false,
            _libraryData: b
          }));
          state.files = mapped;
          updateUploadZone();
          updateStats();
          renderTable();
          renderLibraryGrid();
          showUI();
        }
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
  // Deduplicate by path
  const existingPaths = new Set(state.files.map(f => f.path));
  const unique = newFiles.filter(f => !existingPaths.has(f.path));

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
          f._libraryData = res.book;
          addedBooks.push(f);
        }
      } catch (e) {
        console.error('Failed to add book to library:', e);
      }
    } else {
      addedBooks.push(f);
    }
    f.coverUrl = null;
    f.coverLoading = true;
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
async function loadCoversFor(files) {
  for (const f of files) {
    try {
      const b64Data = await extractCoverBase64(f);
      if (b64Data && window.electronAPI && window.electronAPI.library) {
        const res = await window.electronAPI.library.saveCover(f.id, b64Data);
        if (res.success) {
          f.coverUrl = res.coverUrl;
          if (f._libraryData) f._libraryData.coverImage = res.coverUrl;
        } else {
          f.coverUrl = null;
        }
      }
    } catch (e) {
      console.warn('Cover extraction failed for', f.name, e);
    } finally {
      f.coverLoading = false;
      updateRowCover(f.id);
      renderLibraryGrid();
    }
  }
}

async function extractCoverBase64(file) {
  const result = await window.electronAPI.readFileBase64(file.path);
  if (!result.success) return null;

  const binaryString = atob(result.base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  if (file.type === 'pdf') {
    if (!window.pdfjsLib) return null;
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
  } else if (file.type === 'epub') {
    if (!window.ePub) return null;
    const book = ePub(bytes.buffer);
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      // It's a blob url from epub.js, convert to base64
      const response = await fetch(coverUrl);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result.split(',')[1]);
        };
        reader.readAsDataURL(blob);
      });
    }
  }
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
      coverHtml = `<img src="${file.coverUrl}" class="book-cover" alt="Cover" />`;
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
}

function onReaderThemeChange(themeName) {
  state.reader.theme = themeName;
  $('reader-overlay').setAttribute('data-reader-theme', themeName);
  
  if (state.reader.type === 'epub' && state.reader.rendition) {
    state.reader.rendition.themes.select(themeName);
  }
  
  // also adjust pdf background if dark mode
  if (state.reader.type === 'pdf') {
    if (themeName === 'dark') {
      els.readerContent.style.filter = 'invert(0.9) hue-rotate(180deg)';
    } else if (themeName === 'sepia') {
      els.readerContent.style.filter = 'sepia(0.5) contrast(0.9)';
    } else {
      els.readerContent.style.filter = 'none';
    }
  }
}

function onReaderFontChange(delta) {
  state.reader.fontSize = Math.max(50, Math.min(300, state.reader.fontSize + delta));
  els.fontSizeDisplay.textContent = `${state.reader.fontSize}%`;
  
  if (state.reader.type === 'epub' && state.reader.rendition) {
    state.reader.rendition.themes.fontSize(`${state.reader.fontSize}%`);
  } else if (state.reader.type === 'pdf') {
    if (state.reader.buffer) state.reader.buffer.pdfCache.clear();
    renderPdfPage(state.reader.pageNum);
  }
}

function onReaderFormatChange() {
  const familyEl = $('reader-font-family');
  const lineEl = $('reader-line-spacing');
  if (familyEl) state.reader.fontFamily = familyEl.value;
  if (lineEl) state.reader.lineSpacing = lineEl.value;
  if (els.readerWidthControl) state.reader.widthMode = els.readerWidthControl.value;
  
  localStorage.setItem('readerSettings', JSON.stringify({
    fontFamily: state.reader.fontFamily,
    lineSpacing: state.reader.lineSpacing,
    widthMode: state.reader.widthMode
  }));
  
  applyReaderFormatting();
}

let formatDebounce;
function applyReaderFormatting() {
  const container = document.querySelector('.reader-content-wrapper');
  if (container) {
    container.style.fontFamily = state.reader.fontFamily;
    container.style.lineHeight = state.reader.lineSpacing;
    container.setAttribute('data-width-mode', state.reader.widthMode);
  }
  
  if (state.reader.type === 'epub' && state.reader.rendition) {
    state.reader.rendition.themes.font(state.reader.fontFamily);
  }

  // Debounce reflowing the content
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
  } catch (err) {
    showToast('Failed to load PDF.', 'error');
    closeReader();
  }
}

async function renderPdfPage(num) {
  if (!state.reader.pdfDoc || !state.reader.buffer) return;
  
  // Clear only current container
  state.reader.buffer.current.innerHTML = ''; 
  
  const isLandscape = window.innerWidth > 1100 && (state.reader.widthMode === 'wide' || state.reader.widthMode === 'full');
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
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
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

  // Set info
  card.querySelector('.book-title').textContent = truncate(file.name.replace(/\.[^/.]+$/, ""), 40);
  card.querySelector('.book-author').textContent = file.author || 'Unknown Author';
  
  // Format badge
  card.querySelector('.badge-format').textContent = file.type.toUpperCase();
  
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
  
  card.querySelector('.overlay-btn-remove')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.files = state.files.filter(f => f.id !== file.id);
    renderCurrentView();
    updateStats();
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
  renderCurrentView();
};

// Ensure updates happen when table normally renders
const originalRenderTable = renderTable;
renderTable = function() {
  originalRenderTable();
  if (state.currentView === 'library') renderLibrary();
};

const originalUpdateRowCover = updateRowCover;
updateRowCover = function(id) {
  originalUpdateRowCover(id);
  renderCurrentView();
};

// Bind new nav listeners
document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
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

// Initialize with home
setTimeout(() => {
  navigateTo('home');
}, 500);
