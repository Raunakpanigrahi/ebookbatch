/**
 * preload.js - Secure Context Bridge
 * Exposes safe APIs to the renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Dialog ──────────────────────────────────────────────────────────
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFolder: () => ipcRenderer.invoke('dialog:saveFolder'),
  saveZipDialog: () => ipcRenderer.invoke('dialog:saveZip'),

  // ── File System ─────────────────────────────────────────────────────
  scanFolder: (folderPath) => ipcRenderer.invoke('fs:scanFolder', folderPath),
  readFileBase64: (filePath) => ipcRenderer.invoke('fs:readFileBase64', filePath),
  saveEpub: (opts) => ipcRenderer.invoke('fs:saveEpub', opts),
  exportZip: (opts) => ipcRenderer.invoke('fs:exportZip', opts),

  // ── Converter ───────────────────────────────────────────────────────
  convertFile: (filePath) => ipcRenderer.invoke('converter:convertFile', filePath),
  onProgress: (callback) => {
    ipcRenderer.on('converter:progress', (event, data) => callback(data));
  },
  removeProgressListener: () => {
    ipcRenderer.removeAllListeners('converter:progress');
  },

  // ── Shell ───────────────────────────────────────────────────────────
  openFile: (filePath) => ipcRenderer.invoke('shell:openFile', filePath),
  openOriginalFile: (filePath) => ipcRenderer.invoke('shell:openOriginalFile', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('shell:showInFolder', filePath),

  // ── App ─────────────────────────────────────────────────────────────
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  // ── Window Controls ─────────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  
  // ── Library ─────────────────────────────────────────────────────────
  library: {
    getBooks: () => ipcRenderer.invoke('library:getBooks'),
    addBook: (bookData) => ipcRenderer.invoke('library:addBook', bookData),
    updateBook: (id, updates) => ipcRenderer.invoke('library:updateBook', id, updates),
    removeBook: (id) => ipcRenderer.invoke('library:removeBook', id),
    saveCover: (bookId, base64Data) => ipcRenderer.invoke('library:saveCover', bookId, base64Data)
  }
});
