const { contextBridge, ipcRenderer } = require('electron')

// One name per main.js handler; events the main side pushes get an on* listener.
const CALLS = ['list', 'projects', 'newProject', 'getSettings', 'setSettings', 'profiles', 'getCaption', 'setCaption', 'open',
  'lookup', 'lookupAll', 'pick', 'projectMenu', 'searchSites', 'search', 'tagMenu', 'menu', 'quoteSources', 'quote', 'getCreds', 'setCred', 'oauth',
  'checkUpdate', 'update', 'instruments', 'exportExtension', 'installGdl', 'export']
const EVENTS = ['saved', 'removed', 'projectRemoved', 'toast', 'search', 'openProject']
const api = { theme: t => ipcRenderer.send('theme', t) }
for (const n of CALLS) api[n] = (...a) => ipcRenderer.invoke(n, ...a)
for (const n of EVENTS) api['on' + n[0].toUpperCase() + n.slice(1)] = cb => ipcRenderer.on(n, (_, v) => cb(v))
contextBridge.exposeInMainWorld('api', api)
