const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pulse', {
  getDashboard: () => ipcRenderer.invoke('pulse:get-dashboard'),
  refresh: () => ipcRenderer.invoke('pulse:refresh'),
  chooseSave: () => ipcRenderer.invoke('pulse:choose-save'),
  exportData: () => ipcRenderer.invoke('pulse:export-data'),
  getRunCaptures: () => ipcRenderer.invoke('pulse:get-run-captures'),
  getGameStatus: () => ipcRenderer.invoke('pulse:get-game-status'),
  deleteRun: (id) => ipcRenderer.invoke('pulse:delete-run', id),
  onUpdate: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('pulse:update', handler)
    return () => ipcRenderer.removeListener('pulse:update', handler)
  },
  onRunCaptured: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('pulse:run-captured', handler)
    return () => ipcRenderer.removeListener('pulse:run-captured', handler)
  },
  onCaptureProgress: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('pulse:capture-progress', handler)
    return () => ipcRenderer.removeListener('pulse:capture-progress', handler)
  },
  onGameStatus: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('pulse:game-status', handler)
    return () => ipcRenderer.removeListener('pulse:game-status', handler)
  },
})
