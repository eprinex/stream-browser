const tabsTop = document.getElementById('tabsTop');
const tabsSide = document.getElementById('tabsSide');
const sideTabs = document.getElementById('sideTabs');
const sideGroups = document.getElementById('sideGroups');
const urlBar = document.getElementById('urlBar');
const navForm = document.getElementById('navForm');
const favPanel = document.getElementById('favPanel');
const favList = document.getElementById('favList');
const settingsPanel = document.getElementById('settingsPanel');
const settingsBody = document.getElementById('settingsBody');
const btnBack = document.getElementById('btnBack');
const btnForward = document.getElementById('btnForward');
const btnReload = document.getElementById('btnReload');
const btnHome = document.getElementById('btnHome');
const btnNewTab = document.getElementById('btnNewTab');
const btnNewTabSide = document.getElementById('btnNewTabSide');
const btnMobile = document.getElementById('btnMobile');
const btnFav = document.getElementById('btnFav');
const btnFavPanel = document.getElementById('btnFavPanel');
const btnCloseFav = document.getElementById('btnCloseFav');
const btnPinWin = document.getElementById('btnPinWin');
const btnPanic = document.getElementById('btnPanic');
const btnSettings = document.getElementById('btnSettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');

let state = {
  tabs: [],
  groups: [],
  activeTabId: null,
  alwaysOnTop: false,
  panicHidden: false,
  settings: {},
};
let favorites = [];
let settingsDraft = null;
let ctxEl = null;

const SETTING_DEFS = [
  {
    section: 'Panic / gizlilik',
    items: [
      {
        key: 'panicEnabled',
        label: 'Panic tuşu',
        desc: 'Atanan tuşla sesi kapatıp uygulamayı tepsiye gizler; video oynar.',
      },
      {
        key: 'panicMute',
        label: 'Panic’te sesi kapat',
        desc: 'Gizlerken tüm sekmeleri sessize alır.',
      },
      {
        key: 'showTray',
        label: 'Sistem tepsisi',
        desc: 'Gizli simgeler alanında ikon; kapatınca tepsiye iner.',
      },
    ],
  },
  {
    section: 'Sekmeler',
    items: [
      {
        key: 'verticalTabs',
        label: 'Dikey sekme şeridi',
        desc: 'Sekmeleri solda alt alta gösterir.',
      },
      {
        key: 'pinTabs',
        label: 'Sekme sabitleme',
        desc: 'Sağ tık → Sabitle. Sabit sekmeler kapanmaz.',
      },
      {
        key: 'tabGroups',
        label: 'Sekme grupları',
        desc: 'Sağ tık ile gruba ekle / yeni grup oluştur.',
      },
      {
        key: 'muteInactiveTabs',
        label: 'Pasif sekmeleri sessizleştir',
        desc: 'Sadece aktif sekmenin sesi duyulur.',
      },
    ],
  },
  {
    section: 'Chaturbate',
    items: [
      {
        key: 'cbVideoOnly',
        label: 'Sadece video (oda)',
        desc: 'Oda URL’sinde chat, bio ve yan panelleri gizler; yalnızca yayın.',
      },
    ],
  },
];

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || null;
}

function shortUrl(url) {
  try {
    if (!url || url.startsWith('file:') || url === 'about:blank') return 'Yeni sekme';
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    if (path) return path.split('/')[0];
    return host;
  } catch {
    return 'Sekme';
  }
}

function hideCtx() {
  if (ctxEl) {
    ctxEl.remove();
    ctxEl = null;
  }
}

function showTabContext(e, tab) {
  e.preventDefault();
  hideCtx();
  const s = state.settings || {};
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - 160)}px`;

  const add = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      hideCtx();
      fn();
    });
    menu.appendChild(b);
  };

  if (s.pinTabs) {
    add(tab.pinned ? 'Sabitlemeyi kaldır' : 'Sekmeyi sabitle', () => window.browser.pinTab(tab.id));
  }

  if (s.tabGroups) {
    add('Yeni grup…', async () => {
      const name = prompt('Grup adı', 'İzleme');
      if (name == null) return;
      const g = await window.browser.createGroup(name.trim() || 'Grup');
      if (g) window.browser.setTabGroup(tab.id, g.id);
    });
    for (const g of state.groups || []) {
      add(`→ ${g.name}`, () => window.browser.setTabGroup(tab.id, g.id));
    }
    if (tab.groupId) add('Gruptan çıkar', () => window.browser.setTabGroup(tab.id, null));
  }

  if (!menu.childNodes.length) {
    add('Ayarlardan pin / grup aç', () => setSettingsPanel(true));
  }

  document.body.appendChild(menu);
  ctxEl = menu;
}

function makeTabEl(tab) {
  const el = document.createElement('div');
  el.className =
    'tab' +
    (tab.id === state.activeTabId ? ' active' : '') +
    (tab.loading ? ' loading' : '') +
    (tab.pinned ? ' pinned' : '');
  el.role = 'tab';
  el.title = tab.title || shortUrl(tab.url);

  if (tab.pinned) {
    const pin = document.createElement('span');
    pin.className = 'pin-mark';
    pin.textContent = '📌';
    el.appendChild(pin);
  }

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = tab.title || shortUrl(tab.url);

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.title = tab.pinned ? 'Sabit sekme' : 'Kapat';
  close.textContent = '×';
  close.hidden = !!tab.pinned && !!state.settings?.pinTabs;
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    window.browser.closeTab(tab.id);
  });

  el.append(title, close);
  el.addEventListener('click', () => window.browser.switchTab(tab.id));
  el.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      window.browser.closeTab(tab.id);
    }
  });
  el.addEventListener('contextmenu', (e) => showTabContext(e, tab));
  return el;
}

function applyLayoutMode() {
  const vertical = !!state.settings?.verticalTabs;
  document.body.classList.toggle('vertical-tabs', vertical);
  sideTabs.hidden = !vertical;
  document.getElementById('tabstrip').hidden = vertical;
}

function renderTabs() {
  applyLayoutMode();
  const vertical = !!state.settings?.verticalTabs;
  const host = vertical ? tabsSide : tabsTop;
  const other = vertical ? tabsTop : tabsSide;
  other.innerHTML = '';
  host.innerHTML = '';
  sideGroups.innerHTML = '';

  const groups = state.groups || [];
  const useGroups = !!state.settings?.tabGroups && groups.length;

  if (vertical && state.settings?.tabGroups) {
    for (const g of groups) {
      const chip = document.createElement('div');
      chip.className = 'group-chip';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = g.color || 'var(--accent)';
      const name = document.createElement('span');
      name.textContent = g.name;
      const del = document.createElement('button');
      del.type = 'button';
      del.title = 'Grubu sil';
      del.textContent = '×';
      del.addEventListener('click', () => window.browser.deleteGroup(g.id));
      chip.append(dot, name, del);
      sideGroups.appendChild(chip);
    }
    const addG = document.createElement('button');
    addG.className = 'btn-soft';
    addG.type = 'button';
    addG.textContent = '+ Grup';
    addG.style.margin = '0 8px 4px';
    addG.addEventListener('click', async () => {
      const name = prompt('Grup adı', 'İzleme');
      if (name == null) return;
      await window.browser.createGroup(name.trim() || 'Grup');
    });
    if (vertical) sideGroups.appendChild(addG);
  }

  const tabs = state.tabs || [];
  if (useGroups && vertical) {
    const byGroup = new Map();
    for (const g of groups) byGroup.set(g.id, []);
    const ungrouped = [];
    for (const t of tabs) {
      if (t.groupId && byGroup.has(t.groupId)) byGroup.get(t.groupId).push(t);
      else ungrouped.push(t);
    }
    for (const g of groups) {
      const label = document.createElement('div');
      label.className = 'group-label';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = g.color || 'var(--accent)';
      label.append(dot, document.createTextNode(g.name));
      host.appendChild(label);
      for (const t of byGroup.get(g.id) || []) host.appendChild(makeTabEl(t));
    }
    if (ungrouped.length) {
      const label = document.createElement('div');
      label.className = 'group-label';
      label.textContent = 'Diğer';
      host.appendChild(label);
      for (const t of ungrouped) host.appendChild(makeTabEl(t));
    }
  } else {
    for (const tab of tabs) host.appendChild(makeTabEl(tab));
  }

  const tab = activeTab();
  if (tab && document.activeElement !== urlBar) {
    const u = tab.url || '';
    urlBar.value = !u || u.startsWith('file:') || u === 'about:blank' ? '' : u;
  }
  btnBack.disabled = !tab?.canGoBack;
  btnForward.disabled = !tab?.canGoForward;
  btnPinWin.classList.toggle('active', !!state.alwaysOnTop);
  btnPanic.classList.toggle('active', !!state.panicHidden);
  btnMobile.classList.toggle('active', !!tab?.mobile);
  btnMobile.title = tab?.mobile ? 'Masaüstü site' : 'Mobil site';
  updateFavButton();
}

function updateFavButton() {
  const tab = activeTab();
  const isFav = tab && favorites.some((f) => f.url === tab.url);
  btnFav.classList.toggle('active', !!isFav);
  btnFav.title = isFav ? 'Favorilerden çıkar' : 'Favorilere ekle';
}

function renderFavorites() {
  favList.innerHTML = '';
  if (!favorites.length) {
    const p = document.createElement('p');
    p.className = 'fav-empty';
    p.textContent = 'Favori yok. ★ ile ekle.';
    favList.appendChild(p);
    return;
  }
  for (const fav of favorites) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'open';
    open.type = 'button';
    open.textContent = fav.title || shortUrl(fav.url);
    open.title = fav.title || 'Favori';
    open.addEventListener('click', () => {
      window.browser.go(fav.url);
      setFavPanel(false);
    });
    open.addEventListener('dblclick', () => {
      window.browser.newTab(fav.url);
    });

    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.type = 'button';
    rm.title = 'Kaldır';
    rm.textContent = '×';
    rm.addEventListener('click', () => window.browser.removeFavorite(fav.url));

    li.append(open, rm);
    favList.appendChild(li);
  }
}

function renderSettings() {
  const s = settingsDraft || state.settings || {};
  settingsBody.innerHTML = '';

  for (const sec of SETTING_DEFS) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-section';
    const h = document.createElement('h3');
    h.textContent = sec.section;
    wrap.appendChild(h);

    for (const item of sec.items) {
      const row = document.createElement('div');
      row.className = 'setting-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `set-${item.key}`;
      cb.checked = !!s[item.key];
      cb.addEventListener('change', async () => {
        settingsDraft = await window.browser.setSettings({ [item.key]: cb.checked });
        state.settings = settingsDraft;
        renderTabs();
        renderSettings();
      });
      const lab = document.createElement('label');
      lab.htmlFor = cb.id;
      lab.innerHTML = `${item.label}<span class="desc">${item.desc}</span>`;
      row.append(cb, lab);
      wrap.appendChild(row);
    }
    settingsBody.appendChild(wrap);
  }

  const hotkeySec = document.createElement('div');
  hotkeySec.className = 'settings-section';
  hotkeySec.innerHTML = '<h3>Panic kısayolu</h3>';
  const row = document.createElement('div');
  row.className = 'setting-row';
  const lab = document.createElement('label');
  lab.innerHTML =
    'Electron formatı (örn. CommandOrControl+Shift+Space)<span class="desc">Kaydetmek için Enter.</span>';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = s.panicHotkey || 'CommandOrControl+Shift+Space';
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    settingsDraft = await window.browser.setSettings({ panicHotkey: input.value.trim() });
    state.settings = settingsDraft;
  });
  lab.appendChild(input);
  row.appendChild(lab);
  hotkeySec.appendChild(row);

  const actions = document.createElement('div');
  actions.className = 'btn-row';
  const testPanic = document.createElement('button');
  testPanic.className = 'btn-soft';
  testPanic.type = 'button';
  testPanic.textContent = 'Panic’i dene';
  testPanic.addEventListener('click', () => window.browser.panicToggle());
  actions.appendChild(testPanic);
  hotkeySec.appendChild(actions);
  settingsBody.appendChild(hotkeySec);
}

function syncUiPanel() {
  const open = !favPanel.hidden || !settingsPanel.hidden;
  window.browser.setUiPanel(open);
}

function setFavPanel(open) {
  favPanel.hidden = !open;
  if (open) {
    settingsPanel.hidden = true;
    btnSettings.classList.remove('active');
  }
  btnFavPanel.classList.toggle('active', open);
  syncUiPanel();
}

function setSettingsPanel(open) {
  settingsPanel.hidden = !open;
  if (open) {
    favPanel.hidden = true;
    btnFavPanel.classList.remove('active');
    settingsDraft = state.settings || {};
    renderSettings();
  }
  btnSettings.classList.toggle('active', open);
  syncUiPanel();
}

navForm.addEventListener('submit', (e) => {
  e.preventDefault();
  window.browser.go(urlBar.value);
  urlBar.blur();
});

btnBack.addEventListener('click', () => window.browser.back());
btnForward.addEventListener('click', () => window.browser.forward());
btnReload.addEventListener('click', (e) => window.browser.reload(e.shiftKey));
btnHome.addEventListener('click', () => window.browser.home());
btnNewTab.addEventListener('click', () => window.browser.newTab());
btnNewTabSide.addEventListener('click', () => window.browser.newTab());
btnMobile.addEventListener('click', () => window.browser.toggleMobile());
btnPinWin.addEventListener('click', () => window.browser.toggleAlwaysOnTop());
btnPanic.addEventListener('click', () => window.browser.panicToggle());
btnFavPanel.addEventListener('click', () => setFavPanel(favPanel.hidden));
btnCloseFav.addEventListener('click', () => setFavPanel(false));
btnSettings.addEventListener('click', () => setSettingsPanel(settingsPanel.hidden));
btnCloseSettings.addEventListener('click', () => setSettingsPanel(false));

btnFav.addEventListener('click', async () => {
  const tab = activeTab();
  if (!tab) return;
  const exists = favorites.some((f) => f.url === tab.url);
  if (exists) await window.browser.removeFavorite(tab.url);
  else await window.browser.addFavorite({ url: tab.url, title: tab.title });
});

urlBar.addEventListener('focus', () => {
  urlBar.select();
});

urlBar.addEventListener('paste', () => {
  setTimeout(() => {
    const v = (urlBar.value || '').trim();
    if (!v) return;
    const looksUrl =
      /^https?:\/\//i.test(v) ||
      /^[\w.-]+\.[a-z]{2,}/i.test(v) ||
      /chaturbate\.com/i.test(v);
    if (!looksUrl) return;
    window.browser.go(v);
    urlBar.blur();
  }, 0);
});

urlBar.addEventListener('mousedown', (e) => {
  if (document.activeElement === urlBar) return;
  e.preventDefault();
  urlBar.focus();
  urlBar.select();
});

document.addEventListener('click', (e) => {
  if (ctxEl && !ctxEl.contains(e.target)) hideCtx();
});

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    urlBar.focus();
    urlBar.select();
  } else if (mod && e.key.toLowerCase() === 't') {
    e.preventDefault();
    window.browser.newTab();
  } else if (mod && e.key.toLowerCase() === 'w') {
    e.preventDefault();
    window.browser.closeTab();
  } else if (mod && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    window.browser.reload(e.shiftKey);
  } else if (mod && e.key === ',') {
    e.preventDefault();
    setSettingsPanel(settingsPanel.hidden);
  } else if (mod && e.key === 'Tab') {
    e.preventDefault();
    if (!state.tabs.length) return;
    const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
    const next = state.tabs[(idx + (e.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length];
    window.browser.switchTab(next.id);
  } else if (mod && e.key.toLowerCase() === 'm') {
    e.preventDefault();
    window.browser.toggleMobile();
  } else if (e.key === 'F5') {
    e.preventDefault();
    window.browser.reload(e.ctrlKey || e.shiftKey);
  } else if (e.key === 'Escape') {
    hideCtx();
    if (!favPanel.hidden) setFavPanel(false);
    if (!settingsPanel.hidden) setSettingsPanel(false);
  }
});

window.browser.onTabsUpdated((data) => {
  state = {
    tabs: data.tabs || [],
    groups: data.groups || [],
    activeTabId: data.activeTabId,
    alwaysOnTop: !!data.alwaysOnTop,
    panicHidden: !!data.panicHidden,
    settings: data.settings || state.settings || {},
  };
  settingsDraft = state.settings;
  renderTabs();
  if (!settingsPanel.hidden) renderSettings();
});

window.browser.onFavoritesUpdated((data) => {
  favorites = data || [];
  renderFavorites();
  updateFavButton();
});

window.browser.onLayoutChrome((layout) => {
  if (layout?.sideWidth) {
    document.documentElement.style.setProperty('--side-w', `${layout.sideWidth}px`);
  }
});

window.browser.getSettings().then((s) => {
  state.settings = s || {};
  settingsDraft = state.settings;
  renderTabs();
});

window.browser.listFavorites().then((data) => {
  favorites = data || [];
  renderFavorites();
});
