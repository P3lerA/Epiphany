const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  list: () => ipcRenderer.invoke('list'),
  onSaved: cb => ipcRenderer.on('saved', (_, item) => cb(item)),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  setSettings: s => ipcRenderer.invoke('setSettings', s),
  instruments: () => ipcRenderer.invoke('instruments'),
  profiles: () => ipcRenderer.invoke('profiles'),
  getCaption: file => ipcRenderer.invoke('getCaption', file),
  setCaption: (file, text) => ipcRenderer.invoke('setCaption', file, text),
  open: url => ipcRenderer.invoke('open', url),
  projects: () => ipcRenderer.invoke('projects'),
  newProject: name => ipcRenderer.invoke('newProject', name),
  quote: () => ipcRenderer.invoke('quote'),
  quoteSources: () => ipcRenderer.invoke('quoteSources'),
  menu: item => ipcRenderer.invoke('menu', item),
  remove: item => ipcRenderer.invoke('remove', item),
  onOpenProject: cb => ipcRenderer.on('openProject', (_, p) => cb(p)),
  onRemoved: cb => ipcRenderer.on('removed', (_, f) => cb(f)),
  tagMenu: tag => ipcRenderer.invoke('tagMenu', tag),
  onSearch: cb => ipcRenderer.on('search', (_, t) => cb(t))
})
