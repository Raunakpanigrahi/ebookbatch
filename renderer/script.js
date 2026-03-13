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

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    restoreTheme();
  });
})();

// ─── Event Binding ────────────────────────────────────────────────────────────
function bindEvents() {
  // Window controls
  $('btn-minimize')?.addEventListener('click', () => window.electronAPI.minimizeWindow());
  $('btn-maximize')?.addEventListener('click', () => window.electronAPI.maximizeWindow());
  $('btn-close')?.addEventListener('click', () => window.electronAPI.closeWindow());

  // Folder / file selection
  $('btn-select-folder')?.addEventListener('click', onSelectFolder);
  $('btn-select-files')?.addEventListener('click', () => els.fileInput.click());
  $('btn-add-folder')?.addEventListener('click', onSelectFolder);
  $('btn-add-files')?.addEventListener('click', () => els.fileInput.click());
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



  // Theme toggle
  $('btn-theme')?.addEventListener('click', toggleTheme);

  // Reader controls
  if (els.btnReaderBack) els.btnReaderBack.addEventListener('click', closeReader);
  if (els.btnReaderPrev) els.btnReaderPrev.addEventListener('click', onReaderPrev);
  if (els.btnReaderNext) els.btnReaderNext.addEventListener('click', onReaderNext);
  if (els.btnZoomIn) els.btnZoomIn.addEventListener('click', onZoomIn);
  if (els.btnZoomOut) els.btnZoomOut.addEventListener('click', onZoomOut);
  if (els.btnReaderSettings) {
    els.btnReaderSettings.addEventListener('click', () => {
      els.readerSettingsPanel.classList.toggle('hidden');
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
    if (e.key === 'Escape') closeReader();
    if (e.key === 'ArrowLeft') onReaderPrev();
    if (e.key === 'ArrowRight') onReaderNext();
  });

  // Home Empty State events (Event Delegation)
  document.addEventListener('click', async (e) => {
    // Add Files button
    if (e.target.closest('#btn-home-add-files')) {
      if (window.electronAPI && window.electronAPI.openFiles) {
        const filePaths = await window.electronAPI.openFiles();
        if (filePaths && filePaths.length > 0) {
          addFiles(Array.from(filePaths).map(p => ({
            name: p.split(/[\\/]/).pop(),
            path: p,
            type: p.toLowerCase().endsWith('.epub') ? 'application/epub+zip' : 'application/pdf',
            size: 0 // Size might not be strictly needed initially, or can be fetched
          })));
        }
      } else {
        // Fallback
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.click();
      }
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
            await loadFolder(require('path').dirname(f.path + '/x'));
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
function addFiles(newFiles) {
  // Deduplicate by path
  const existingPaths = new Set(state.files.map(f => f.path));
  const unique = newFiles.filter(f => !existingPaths.has(f.path));

  // Init cover state
  unique.forEach(f => {
    f.coverUrl = null;
    f.coverLoading = true;
  });

  state.files.push(...unique);
  updateUploadZone();
  updateStats();
  renderTable();
  showUI();

  // Async cover extraction
  loadCoversFor(unique);
}

// ─── Cover Extraction ─────────────────────────────────────────────────────────
async function loadCoversFor(files) {
  for (const f of files) {
    try {
      const url = await extractCoverUrl(f);
      f.coverUrl = url;
    } catch (e) {
      console.warn('Cover extraction failed for', f.name, e);
    } finally {
      f.coverLoading = false;
      updateRowCover(f.id);
    }
  }
}

async function extractCoverUrl(file) {
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
    return canvas.toDataURL('image/jpeg', 0.8);
  } else if (file.type === 'epub') {
    if (!window.ePub) return null;
    const book = ePub(bytes.buffer);
    return await book.coverUrl();
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
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return state.sort.dir === 'asc' ? cmp : -cmp;
  });

  return files;
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
    state.files = state.files.filter(f => f.id !== id);
    updateUploadZone();
    updateStats();
    renderTable();
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

// ─── Reader Implementation ────────────────────────────────────────────────────
async function openReader(file) {
  state.reader.active = true;
  state.reader.file = file;
  state.reader.type = file.type;
  state.reader.pageNum = 1;
  state.reader.zoom = 1.0;
  
  els.readerOverlay.classList.remove('hidden');
  els.readerTitle.textContent = file.name;
  els.readerContent.innerHTML = '';
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
  els.readerContent.innerHTML = '';
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
  
  const rendition = book.renderTo("reader-content", {
    width: "100%",
    height: "100%",
    spread: "none",
    manager: "continuous",
    flow: "paginated"
  });
  state.reader.rendition = rendition;
  
  rendition.display();

  rendition.on("relocated", (location) => {
    // Show rough percentage or just "EPUB Reader"
    els.readerPageInfo.textContent = 'EPUB Document';
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
  if (state.reader.type === 'epub' && state.reader.rendition) {
    state.reader.rendition.themes.select(themeName);
  }
  
  // also adjust pdf background if dark mode
  if (state.reader.type === 'pdf' && themeName === 'dark') {
    els.readerContent.style.filter = 'invert(0.9) hue-rotate(180deg)';
  } else if (state.reader.type === 'pdf') {
    els.readerContent.style.filter = 'none';
  }
}

function onReaderFontChange(delta) {
  state.reader.fontSize = Math.max(50, Math.min(300, state.reader.fontSize + delta));
  els.fontSizeDisplay.textContent = `${state.reader.fontSize}%`;
  
  if (state.reader.type === 'epub' && state.reader.rendition) {
    state.reader.rendition.themes.fontSize(`${state.reader.fontSize}%`);
  }
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
    state.reader.pageNum = 1;
    els.pdfZoomLevel.textContent = `${Math.round(state.reader.zoom * 100)}%`;
    renderPdfPage(state.reader.pageNum);
  } catch (err) {
    showToast('Failed to load PDF.', 'error');
    closeReader();
  }
}

async function renderPdfPage(num) {
  if (!state.reader.pdfDoc) return;
  els.readerPageInfo.textContent = `Page ${num} of ${state.reader.pageCount}`;
  
  try {
    const page = await state.reader.pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: state.reader.zoom * 1.5 }); // Base scale
    
    els.readerContent.innerHTML = ''; // clear previous
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Fit canvas nicely in CSS
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    canvas.style.objectFit = "contain";
    
    els.readerContent.appendChild(canvas);
    
    await page.render({ canvasContext: ctx, viewport }).promise;
  } catch (err) {
    console.error(err);
  }
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

// -- Navigation --
function onReaderPrev() {
  if (state.reader.type === 'epub') {
    state.reader.rendition?.prev();
  } else if (state.reader.type === 'pdf') {
    if (state.reader.pageNum <= 1) return;
    state.reader.pageNum--;
    renderPdfPage(state.reader.pageNum);
  }
}

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
    // dummy progress update since we don't have true pagination calculation hooked up everywhere yet
    if (!state.reader.file.progress) state.reader.file.progress = 5; 
    state.reader.file.progress = Math.min(100, state.reader.file.progress + 15);
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
document.getElementById('btn-add-books')?.addEventListener('click', () => {
  document.getElementById('file-input')?.click();
});

// Initialize with home
setTimeout(() => {
  navigateTo('home');
}, 500);
