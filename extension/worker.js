const endpoint = "http://127.0.0.1:47381/ext/";
const api = chrome.tabs;
const post = async (route, data) => {
  const response = await fetch(endpoint + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tab-Bridge": "1" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw Error("Local bridge unavailable");
  return response.json();
};
let windowTimes = {};
let births = {},
  session,
  profile;
const ready = (async () => {
  const local = await chrome.storage.local.get("profile");
  profile = local.profile || crypto.randomUUID();
  await chrome.storage.local.set({ profile });
  const saved = await chrome.storage.session.get(["session", "births", "windowTimes"]);
  session = saved.session || crypto.randomUUID();
  births = saved.births || {};
  windowTimes = saved.windowTimes || {};
  await chrome.storage.session.set({ session });
})();
async function noteWindow(id, field, time) {
  if (id < 0) return;
  await ready;
  windowTimes[id] = {...windowTimes[id], [field]: time};
  await chrome.storage.session.set({windowTimes});
  dirty();
}
chrome.windows.onCreated.addListener(w => {
  if (w.type === "normal" && !w.incognito) noteWindow(w.id, "created", Date.now());
});
chrome.windows.onFocusChanged.addListener(id => noteWindow(id, "touched", Date.now()));
chrome.windows.onRemoved.addListener(async id => {
  await ready;
  delete windowTimes[id];
  await chrome.storage.session.set({windowTimes});
  dirty();
});
api.onActivated.addListener(({windowId}) => noteWindow(windowId, "touched", Date.now()));
api.onCreated.addListener(async (tab) => {
  const now = Date.now();
  await ready;
  births[tab.id] = now;
  await chrome.storage.session.set({ births });
  dirty();
});
api.onRemoved.addListener(async (id) => {
  await ready;
  delete births[id];
  await chrome.storage.session.set({ births });
  dirty();
});
let timer,
  pushing = false,
  changed = false;
function dirty() {
  changed = true;
  if (!timer)
    timer = setTimeout(() => {
      timer = null;
      sync();
    }, 60);
}
// Cache the small PNG Chrome already has for each distinct tab icon.
const iconCache = new Map();
async function getTabIcon(tab) {
  const key = tab.favIconUrl;
  if (!key || tab.pendingUrl) return "";
  if (!iconCache.has(key)) {
    const load = async () => {
      const url = new URL(chrome.runtime.getURL("/_favicon/"));
      url.searchParams.set("pageUrl", tab.url);
      url.searchParams.set("size", "32");
      const response = await fetch(url);
      if (!response.ok) throw Error("Icon unavailable");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 16384 || bytes[0] !== 137) throw Error("Invalid icon");
      return "data:image/png;base64," + btoa(String.fromCharCode(...bytes));
    };
    iconCache.set(key, load().catch(() => ""));
  }
  return iconCache.get(key);
}
async function sync() {
  await ready;
  if (pushing) {
    changed = true;
    return;
  }
  pushing = true;
  changed = false;
  try {
    const [tabs, groups, windows] = await Promise.all([
      api.query({}),
      chrome.tabGroups.query({}),
      chrome.windows.getAll({ windowTypes: ["normal"] }),
    ]);
    const allowed = new Map(
      windows.filter((w) => !w.incognito).map((w) => [w.id, w.state]),
    );
    const included = tabs.filter(t => allowed.has(t.windowId));
    const usedIcons = new Set(included.map(t => t.favIconUrl));
    for (const key of iconCache.keys()) if (!usedIcons.has(key)) iconCache.delete(key);
    const icons = [...new Set(await Promise.all(included.map(getTabIcon)))].filter(Boolean);
    const iconIndex = new Map(icons.map((icon, index) => [icon, index]));
    await post("state", {
      icons,
      profile,
      session,
      tabs: await Promise.all(included.map(async t => ({
          iconIndex: iconIndex.get(await getTabIcon(t)),
          id: t.id,
          window: t.windowId,
          windowState: allowed.get(t.windowId) ?? null,
          windowCreated: windowTimes[t.windowId]?.created ?? null,
          windowTouched: windowTimes[t.windowId]?.touched ?? null,
          index: t.index,
          group: t.groupId,
          pinned: t.pinned,
          url: t.pendingUrl || t.url || "",
          title: t.title || "",
          touched: t.lastAccessed || null,
          opened: births[t.id] || null,
        }))),
      groups: groups
        .filter((g) => allowed.has(g.windowId))
        .map((g) => ({
          id: g.id,
          window: g.windowId,
          title: g.title,
          color: g.color,
          collapsed: g.collapsed,
        })),
    });
  } catch {
  } finally {
    pushing = false;
    if (changed) dirty();
  }
}
for (const event of [
  chrome.windows.onBoundsChanged,
  api.onUpdated,
  api.onMoved,
  api.onAttached,
  api.onDetached,
  chrome.tabGroups.onUpdated,
  chrome.tabGroups.onRemoved,
  chrome.tabGroups.onCreated,
])
  event.addListener(dirty);
async function execute(c) {
  if (c.session !== session) throw Error("Chrome session changed");
  if (c.op === "rename-group") {
    const group = await chrome.tabGroups.get(c.id);
    if (group.windowId !== c.window) throw Error("Tab group moved since review");
    await chrome.tabGroups.update(c.id, {title:c.title});
    return {};
  }
  let t;
  if (c.op !== "reopen") {
    t = await api.get(c.tab.id);
    if (t.incognito || (t.pendingUrl || t.url || "") !== c.tab.url)
      throw Error("Tab changed since review");
  }
  if (c.op === "preview") {
    if (t.discarded || !/^https?:/i.test(t.url)) throw Error("No preview available for this page.");
    const target = {tabId:t.id};
    await chrome.debugger.attach(target, "1.3");
    try {
      const shot = await chrome.debugger.sendCommand(target, "Page.captureScreenshot",
        {format:"jpeg", quality:45, captureBeyondViewport:false});
      const current = await api.get(t.id);
      if ((current.pendingUrl || current.url) !== c.tab.url) throw Error("Page changed during preview.");
      return {image:"data:image/jpeg;base64," + shot.data};
    } finally {
      await chrome.debugger.detach(target).catch(() => {});
    }
  }
  if (c.op === "focus") {
    await api.update(t.id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    return {};
  }
  if (c.op === "close") {
    await api.remove(t.id);
    return {};
  }
  if (c.op === "reopen") {
    if (!/^(https?:|file:|chrome:|about:blank$)/i.test(c.tab.url))
      throw Error("URL cannot be safely reopened");
    if (c.window == null) {
      const w = await chrome.windows.create({ url: c.tab.url, focused: false });
      t = w.tabs[0];
    } else
      t = await api.create({
        url: c.tab.url,
        active: false,
        windowId: c.window,
        index: c.index,
      });
  } else if (c.window === null) {
    await chrome.windows.create({ tabId: t.id, focused: false });
  } else if (
    c.window !== undefined &&
    (c.window !== t.windowId || c.index !== undefined)
  ) {
    await api.move(t.id, { windowId: c.window, index: c.index ?? -1 });
  }
  // Include the resulting identity even if a later layout step fails.
  try {
    if (c.group !== undefined) {
      if (c.group === -1) {
        if ((await api.get(t.id)).groupId !== -1) await api.ungroup(t.id);
      } else {
        const gid = await api.group(
          c.group === null
            ? { tabIds: t.id }
            : { tabIds: t.id, groupId: c.group },
        );
        if (c.group === null && c.label)
          await chrome.tabGroups.update(gid, c.label);
      }
    }
    if (c.pinned !== undefined) await api.update(t.id, { pinned: c.pinned });
  } catch (e) {
    const actual = await api.get(t.id);
    return {
      id: t.id,
      window: actual.windowId,
      group: actual.groupId,
      warning: e.message,
    };
  }
  const actual = await api.get(t.id);
  return { id: t.id, window: actual.windowId, group: actual.groupId };
}
let running = false;
async function connect() {
  if (running) return;
  running = true;
  try {
    await ready;
    await sync();
    while (true) {
      const c = await post("poll", { profile, session });
      if (!c.op) {
        // Refresh even when macOS changes window state without a bounds event.
        await sync();
        continue;
      }
      let result;
      try {
        result = { value: await execute(c) };
      } catch (e) {
        result = { error: e.message };
      }
      await post("result", { profile, session, key: c.key, ...result });
      dirty();
    }
  } catch {
  } finally {
    running = false;
    setTimeout(connect, 2500);
  }
}
chrome.alarms.create("connect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
connect();
