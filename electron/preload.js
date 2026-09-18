const { contextBridge, ipcRenderer } = require('electron')

// Minimal, explicit bridge. The renderer stays sandboxed; it can only
// call these two functions, both of which go through native dialogs.
contextBridge.exposeInMainWorld('api', {
  isElectron: true,
  saveFile: (defaultName, contents) =>
    ipcRenderer.invoke('save-file', { defaultName, contents }),
  openFile: (extensions) => ipcRenderer.invoke('open-file', { extensions }),
})
