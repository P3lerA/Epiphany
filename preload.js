const { contextBridge, ipcRenderer } = require('electron')

// One name per main.js handler; events the main side pushes get an on* listener.
const CALLS = ['list', 'projects', 'newProject', 'getSettings', 'setSettings', 'profiles', 'getCaption', 'setCaption', 'setField', 'open', 'capybara', 'editTemplate', 'templateInfo', 'resetTemplate',
  'lookup', 'lookupAll', 'pick', 'projectMenu', 'searchSites', 'search', 'tagMenu', 'menu', 'quoteSources', 'quote', 'getCreds', 'setCred', 'stopTask', 'paste', 'share', 'oauth',
  'checkUpdate', 'update', 'instruments', 'instrumentList', 'exportExtension', 'installGdl', 'export', 'tagWiki', 'safe', 'tag', 'installTagger', 'removeTagger', 'devtools', 'restart']
const EVENTS = ['saved', 'removed', 'projectRemoved', 'tasks', 'note', 'search', 'openProject', 'edit']
const api = { theme: (t, bar) => ipcRenderer.send('theme', t, bar) }
for (const n of CALLS) api[n] = (...a) => ipcRenderer.invoke(n, ...a)
for (const n of EVENTS) api['on' + n[0].toUpperCase() + n.slice(1)] = cb => ipcRenderer.on(n, (_, v) => cb(v))
contextBridge.exposeInMainWorld('api', api)
