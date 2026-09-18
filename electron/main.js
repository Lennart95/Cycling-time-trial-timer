const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged
let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0f1216',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (isDev && devUrl) {
    win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Native "Save As" dialog used for CSV / JSON exports.
ipcMain.handle('save-file', async (_event, { defaultName, contents }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName || 'export.csv',
    filters: [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (canceled || !filePath) return { ok: false }
  fs.writeFileSync(filePath, contents, 'utf8')
  return { ok: true, filePath }
})

// Native "Open" dialog used for importing a race JSON or participant CSV.
ipcMain.handle('open-file', async (_event, { extensions }) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Data', extensions: extensions || ['json', 'csv'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (canceled || !filePaths || !filePaths[0]) return { ok: false }
  const contents = fs.readFileSync(filePaths[0], 'utf8')
  return { ok: true, filePath: filePaths[0], contents }
})
