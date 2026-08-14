const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browser', {
  go: (url) => ipcRenderer.invoke('nav-go', url),
  back: () => ipcRenderer.invoke('nav-back'),
  forward: () => ipcRenderer.invoke('nav-forward'),
  reload: (hard) => ipcRenderer.invoke('nav-reload', !!hard),
  home: () => ipcRenderer.invoke('nav-home'),
  newTab: (url) => ipcRenderer.invoke('tab-new', url),
  closeTab: (id) => ipcRenderer.invoke('tab-close', id),
  switchTab: (id) => ipcRenderer.invoke('tab-switch', id),
  pinTab: (id) => ipcRenderer.invoke('tab-pin', id),
  setTabGroup: (id, groupId) => ipcRenderer.invoke('tab-set-group', id, groupId),
  createGroup: (name) => ipcRenderer.invoke('group-create', name),
  renameGroup: (id, name) => ipcRenderer.invoke('group-rename', id, name),
  deleteGroup: (id) => ipcRenderer.invoke('group-delete', id),
  toggleMobile: () => ipcRenderer.invoke('toggle-mobile'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  panicToggle: () => ipcRenderer.invoke('panic-toggle'),
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setSettings: (partial) => ipcRenderer.invoke('settings-set', partial),
  setUiPanel: (open) => ipcRenderer.invoke('ui-panel', !!open),
  listFavorites: () => ipcRenderer.invoke('favorites-list'),
  addFavorite: (item) => ipcRenderer.invoke('favorites-add', item),
  removeFavorite: (url) => ipcRenderer.invoke('favorites-remove', url),
  onTabsUpdated: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('tabs-updated', listener);
    return () => ipcRenderer.removeListener('tabs-updated', listener);
  },
  onFavoritesUpdated: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('favorites-updated', listener);
    return () => ipcRenderer.removeListener('favorites-updated', listener);
  },
  onLayoutChrome: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('layout-chrome', listener);
    return () => ipcRenderer.removeListener('layout-chrome', listener);
  },
});
