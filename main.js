/**
 * main.js - Electron Main Process
 * Ebook Batch Converter
 * Built with passion by Raunak Panigrahi
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Keep a global reference to prevent garbage collection
let mainWindow;

/**
 * Creates the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    frame: process.platform !== 'darwin',
    backgroundColor: '#0f0f13',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show window once content is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

/**
 * Open folder selection dialog
 */
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Folder Containing Ebooks',
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

/**
 * Open file selection dialog
 */
ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Ebooks', extensions: ['pdf', 'epub', 'mobi'] }
    ],
    title: 'Select Ebooks to Import',
  });
  if (result.canceled) return null;
  return result.filePaths;
});

/**
 * Open save folder selection dialog
 */
ipcMain.handle('dialog:saveFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Output Folder',
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

/**
 * Save file dialog for ZIP export
 */
ipcMain.handle('dialog:saveZip', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Converted EPUBs as ZIP',
    defaultPath: path.join(os.homedir(), 'converted-epubs.zip'),
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });
  if (result.canceled) return null;
  return result.filePath;
});

/**
 * Scan folder and return list of PDF/EPUB files
 */
ipcMain.handle('fs:scanFolder', async (event, folderPath) => {
  const { scanFolder } = require('./utils/fileScanner');
  return await scanFolder(folderPath);
});

/**
 * Read file and return as base64 string
 */
ipcMain.handle('fs:readFileBase64', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    return { success: true, base64: data.toString('base64') };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Convert a single PDF file to EPUB
 */
ipcMain.handle('converter:convertFile', async (event, filePath) => {
  const { convertPdfToEpub } = require('./converter/pdfConverter');
  try {
    const result = await convertPdfToEpub(filePath, (progress) => {
      // Send progress updates back to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('converter:progress', {
          filePath,
          progress,
        });
      }
    });
    return { success: true, outputPath: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Save an EPUB buffer to a specified output folder
 */
ipcMain.handle('fs:saveEpub', async (event, { sourcePath, outputFolder }) => {
  try {
    const epubPath = sourcePath.replace(/\.pdf$/i, '.epub');
    const epubName = path.basename(epubPath);

    // Read the converted EPUB from temp location
    const tempPath = path.join(os.tmpdir(), 'ebook-converter', epubName);
    const destPath = path.join(outputFolder, epubName);

    if (!fs.existsSync(tempPath)) {
      throw new Error('Converted file not found in temp directory');
    }

    fs.copyFileSync(tempPath, destPath);
    return { success: true, destPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Export all converted EPUBs as a ZIP archive
 */
ipcMain.handle('fs:exportZip', async (event, { filePaths, zipPath }) => {
  const archiver = require('archiver');
  const os = require('os');

  return new Promise((resolve) => {
    try {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve({ success: true, size: archive.pointer() }));
      archive.on('error', (err) => resolve({ success: false, error: err.message }));

      archive.pipe(output);

      for (const filePath of filePaths) {
        const epubName = path.basename(filePath).replace(/\.pdf$/i, '.epub');
        const tempPath = path.join(os.tmpdir(), 'ebook-converter', epubName);
        if (fs.existsSync(tempPath)) {
          archive.file(tempPath, { name: epubName });
        }
      }

      archive.finalize();
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

/**
 * Open file in system default app
 */
ipcMain.handle('shell:openFile', async (event, filePath) => {
  const os = require('os');
  const epubName = path.basename(filePath).replace(/\.pdf$/i, '.epub');
  const tempPath = path.join(os.tmpdir(), 'ebook-converter', epubName);
  if (fs.existsSync(tempPath)) {
    await shell.openPath(tempPath);
    return { success: true };
  }
  return { success: false, error: 'File not found' };
});

/**
 * Open original file in system default app
 */
ipcMain.handle('shell:openOriginalFile', async (event, filePath) => {
  if (fs.existsSync(filePath)) {
    await shell.openPath(filePath);
    return { success: true };
  }
  return { success: false, error: 'File not found' };
});

/**
 * Reveal file in Finder/Explorer
 */
ipcMain.handle('shell:showInFolder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
  return { success: true };
});

/**
 * Get app version
 */
ipcMain.handle('app:getVersion', () => app.getVersion());

/**
 * Minimize window
 */
ipcMain.handle('window:minimize', () => mainWindow?.minimize());

/**
 * Maximize/restore window
 */
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

/**
 * Close window
 */
ipcMain.handle('window:close', () => mainWindow?.close());
