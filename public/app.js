import {
  prepare,
  matches,
  duplicates,
  markdown,
  defaultView,
  matchingTabs,
  windowNameSuggestions,
  mixedWindowNames,
  groupingFindings,
  revisitGrace,
  windowDates,
  sortedWindows,
} from "./model.js";
const $ = (id) => document.getElementById(id);
const settings = $("settings");
$("settings-open").onclick = () => settings.showModal();
$("settings-close").onclick = () => settings.close();
let bridgeStatus = "connecting";
function updateConnection() {
  const status = bridgeStatus === "online" ? (state.connected ? "connected" : "extension-offline") : bridgeStatus;
  const message = {
    connecting:"Checking the local Chrome connection…",
    connected:"Chrome connected. The extension is reporting to Sunshine Tabs.",
    "extension-offline":"Chrome disconnected. The local bridge is online, but the extension hasn’t checked in. Check that Chrome is open and Sunshine Tabs is enabled in your profile.",
    offline:"Local bridge unavailable. Reconnecting… If this persists, start Sunshine Tabs with Launch.command."
  }[status];
  $("connection").dataset.status = status;
  $("connection").setAttribute("aria-label", message);
  $("connection-tip").textContent = message;
  $("connection-detail").dataset.status = status;
  $("connection-detail").textContent = status === "connected" ? "Chrome connected" : message;
}
const siteColumn = $("show-site");
siteColumn.checked = localStorage.getItem("showSiteColumn") === "true";
siteColumn.onchange = () => {
  localStorage.setItem("showSiteColumn", String(siteColumn.checked));
  paint();
};
const themePicker = $("theme");
const savedTheme = localStorage.getItem("sunshine-tabs-theme");
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  for (const button of themePicker.children) button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
}
applyTheme(["light", "dark"].includes(savedTheme) ? savedTheme : "system");
themePicker.onclick = event => {
  const theme = event.target.closest("button")?.dataset.theme;
  if (!theme) return;
  applyTheme(theme);
  localStorage.setItem("sunshine-tabs-theme", theme);
};
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const btn = (label, fn) => {
  const b = el("button", label);
  b.onclick = () => safe(fn);
  return b;
};
const safe = async (fn) => {
  try {
    await fn();
  } catch (e) {
    say(e.message);
  }
};
const say = (text) => ($("status").textContent = text);
async function post(route, data = {}) {
  const r = await fetch("/" + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tab-Bridge": "1" },
    body: JSON.stringify(data),
  });
  const value = await r.json();
  if (!r.ok) throw Error(value.error || "Connection failed");
  return value;
}
let state = {
    tabs: [],
    groups: [],
    views: [],
    history: [],
    sets: [],
    version: 0,
  },
  v = { ...defaultView, windowOrder: localStorage.getItem("windowOrder") || "tabs", byWindow: localStorage.getItem("byWindow") === "true" },
  page = "Open tabs",
  rows = [],
  selected = new Set(),
  anchor,
  cursor = 0,
  preview = null;
const rowHeight = 48;
const headerHeight = () => v.byWindow ? 0 : 32;
let displayRows = [], visibleRows = [];
let windowPrefs = {}, windowNames = new Map();
const groupingAlerts = new Map();
const windowName = id => windowNames.get(id) || "Window " + id;
function updateWindowNames() {
  const windows = new Map();
  for (const t of state.tabs) {
    if (!windows.has(t.window)) windows.set(t.window, []);
    windows.get(t.window).push(t);
  }
  windowNames = new Map();
  groupingAlerts.clear();
  const normalize = name => name.trim().toLowerCase();
  const used = new Set([...windows.keys()].map(id=>windowPrefs[id]?.name).filter(Boolean).map(normalize));
  for (const id of [...windows.keys()].sort((a,b)=>a-b)) {
    let name = windowPrefs[id]?.name;
    if (name) {
      const dismissed = new Set(windowPrefs[id]?.dismissedFindings || []);
      const findings = groupingFindings(name, windows.get(id)).filter(f => !dismissed.has(f.key));
      if (findings.length) groupingAlerts.set(id, findings);
    }
    if (!name) {
      const choices = windowNameSuggestions(windows.get(id));
      const base = choices[0] || "Window";
      name = choices.find(choice => !used.has(normalize(choice))) || base;
      for(let n=2;used.has(normalize(name));n++) name = base + " (" + n + ")";
    }
    used.add(normalize(name));
    windowNames.set(id,name);
  }
  for(const tab of state.tabs) tab.windowLabel=windowName(tab.window);
}
function animateWindowFold(update) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const positions = new Map();
  const expanded = new Map();
  for (const row of list.querySelectorAll("[data-fold-row]")) {
    positions.set(row.dataset.foldRow, row.getBoundingClientRect().top);
    const toggle = row.querySelector("[data-fold]");
    if (toggle) expanded.set(toggle.dataset.fold, toggle.getAttribute("aria-expanded"));
  }
  update();
  const timing = {duration: 150, easing: "ease-out"};
  for (const row of list.querySelectorAll("[data-fold-row]")) {
    const before = positions.get(row.dataset.foldRow);
    const offset = before === undefined ? -7 : Math.max(-14, Math.min(14, before - row.getBoundingClientRect().top));
    if (offset || before === undefined) {
      row.animate([
        {transform: "translateY(" + offset + "px)", opacity: before === undefined ? 0.35 : 0.85},
        {transform: "translateY(0)", opacity: 1}
      ], timing);
    }
    const toggle = row.querySelector("[data-fold]");
    if (toggle && expanded.has(toggle.dataset.fold) && expanded.get(toggle.dataset.fold) !== toggle.getAttribute("aria-expanded")) {
      const opening = toggle.getAttribute("aria-expanded") === "true";
      toggle.querySelector(".fold-arrow").animate([
        {transform: opening ? "rotate(0deg)" : "rotate(90deg)"},
        {transform: opening ? "rotate(90deg)" : "rotate(0deg)"}
      ], timing);
    }
  }
}
function saveWindowPref(id, updates) {
  if (updates.name && [...windowNames].some(([other,name]) => other !== id && name.toLowerCase() === updates.name.toLowerCase())) {
    say("Another window already uses that name.");
    return false;
  }
  windowPrefs[id] = {...windowPrefs[id], ...updates};
  if ("collapsed" in updates) animateWindowFold(persistWindowPrefs);
  else persistWindowPrefs();
  return true;
}
function persistWindowPrefs() {
  localStorage.setItem("windowPrefs", JSON.stringify({session:state.session, windows:windowPrefs}));
  updateWindowNames();
  render();
}
function allWindowsCollapsed() {
  return windowNames.size > 0 && [...windowNames.keys()].every(id => windowPrefs[id]?.collapsed);
}
let windowEditor = null;
function startWindowEdit(id, key) {
  windowEditor = {id, key, draft:windowName(id)};
  paint();
  const input = list.querySelector(".window-name-input");
  input?.focus({preventScroll:true});
  input?.select();
}
function windowNameField(editor, label) {
  const wrap = el("span", null, "window-name-editor");
  const input = el("input", null, "window-name-input");
  input.value = editor.draft;
  input.placeholder = "Automatic name";
  input.title = "Clear to use the automatic name";
  input.setAttribute("aria-label", "Window name");
  input.oninput = () => { editor.draft = input.value; };
  function finish(save) {
    windowEditor = null;
    if (save && !saveWindowPref(editor.id, {name:editor.draft.trim()})) {
      windowEditor = editor;
      input.focus();
      return;
    }
    if (!save) paint();
    list.querySelector('[data-rename-key="'+editor.key+'"] .name-pencil')?.focus({preventScroll:true});
  }
  input.onkeydown = event => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      finish(event.key === "Enter");
    }
  };
  const save = btn("✓", () => finish(true)), cancel = btn("×", () => finish(false));
  save.title = save.ariaLabel = "Save window name";
  cancel.title = cancel.ariaLabel = "Cancel rename";
  wrap.onclick = event => event.stopPropagation();
  if (label.hasAttribute("data-fold")) {
    label.replaceChildren(label.querySelector(".fold-arrow"));
    label.setAttribute("aria-label", label.title);
    wrap.append(label);
  }
  wrap.append(input,save,cancel);
  return wrap;
}
let nameMenu;
function positionNameMenu() {
  if (!nameMenu) return;
  const {options,key} = nameMenu;
  const anchor = list.querySelector('[data-rename-key="'+key+'"]');
  if (!anchor || !options.matches(":popover-open")) { options.hidePopover(); return; }
  const rect = anchor.getBoundingClientRect();
  const bounds = list.getBoundingClientRect();
  if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) { options.hidePopover(); return; }
  const below = innerHeight - rect.bottom - 8;
  const above = rect.top - 8;
  const up = below < options.scrollHeight && above > below;
  options.style.maxHeight = Math.max(36, up ? above : below) + "px";
  options.style.left = Math.max(6, Math.min(rect.left, innerWidth-options.offsetWidth-6)) + "px";
  options.style.top = (up ? rect.top-options.offsetHeight-3 : rect.bottom+3) + "px";
}
window.addEventListener("resize", positionNameMenu);
function suggestWindowNames(id, key) {
  const tabs = state.tabs.filter(tab => tab.window === id);
  if (!tabs.length) throw Error("This window has closed.");
  const session = state.session;
  const ranked = windowNameSuggestions(tabs);
  const topic = ranked[0] || "Untitled";
  const site = tabs.find(tab => tab.site)?.site || topic;
  const mixed = mixedWindowNames(tabs);
  const candidates = mixed.length ? mixed : [...ranked, topic + " collection", "Pages from " + site,
    topic + " workspace", "Browsing " + site, "Tabs from " + site];
  const used = new Set([...windowNames.values()].map(name => name.toLowerCase()));
  const choices = [];
  for (const candidate of candidates) {
    if (!used.has(candidate.toLowerCase())) {
      choices.push(candidate);
      used.add(candidate.toLowerCase());
    }
    if (choices.length === 4) break;
  }
  for (let n = 2; choices.length < 4; n++) {
    const base = candidates[(n - 2) % candidates.length];
    const name = base + " (" + n + ")";
    if (!used.has(name.toLowerCase())) choices.push(name);
  }
  nameMenu?.options.hidePopover();
  const options = el("div", null, "name-options");
  options.popover = "auto";
  options.setAttribute("role","group");
  options.setAttribute("aria-label","Suggested window names");
  document.body.append(options);
  nameMenu = {key, options};
  const refocus = () => list.querySelector('[data-rename-key="'+key+'"] [data-suggest]')?.focus({preventScroll:true});
  options.addEventListener("toggle", () => {
    if (!options.matches(":popover-open")) {
      if (nameMenu?.options === options) nameMenu = null;
      options.remove();
    }
  });
  choices.forEach((name, i) => options.append(btn((i + 1) + ". " + name, () => {
    if (state.session !== session || !windowNames.has(id)) throw Error("This window has closed.");
    if (saveWindowPref(id, {name})) { options.hidePopover(); refocus(); }
  })));
  options.onkeydown = event => {
    event.stopPropagation();
    const buttons = [...options.children];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "Escape") {event.preventDefault(); options.hidePopover(); refocus();}
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      buttons[(index + (event.key === "ArrowDown" ? 1 : 3)) % 4].focus();
    }
  };
  options.showPopover();
  positionNameMenu();
  options.firstElementChild.focus({preventScroll:true});
}
function editableName(label, kind, openEditor, windowId, key) {
  if (key && windowEditor?.key === key && windowEditor.id === windowId) return windowNameField(windowEditor, label);
  const wrap = el("span", null, "editable-name");
  if (key) wrap.dataset.renameKey = key;
  wrap.append(label);
  function addIcon(symbol, action, run) {
    const button = el("button", null, "name-pencil");
    button.append(symbol);
    button.type = "button";
    button.title = button.ariaLabel = action + ": " + label.textContent;
    button.onclick = event => {
      event.stopPropagation();
      safe(run);
    };
    wrap.append(button);
    return button;
  }
  addIcon("✎", "Rename " + kind, key ? () => startWindowEdit(windowId, key) : openEditor);
  if (windowId != null) {
    const bulb = addIcon(headerIcon("bulb"), "Suggest window names", () => suggestWindowNames(windowId, key));
    bulb.dataset.suggest = "";
  }
  return wrap;
}
function showGroupingFindings(id, movedId) {
  const findings = (groupingAlerts.get(id) || []).filter(f => f.id !== movedId);
  if (!findings.length) { dismiss(); return; }
  const body = panel("Check grouping");
  const summary = el("p", windowName(id) + " · " + findings.length + (findings.length === 1 ? " tab" : " tabs"));
  const explanation = el("p", "These tab titles and sites may be unrelated to this window’s name.", "review-note");
  const scroll = el("div", null, "group-review-scroll");
  const table = el("table", null, "group-review");
  table.setAttribute("aria-label", "Possible grouping mismatches");
  const head = table.createTHead().insertRow();
  const labels = ["Title / URL", ...(siteColumn.checked ? ["Site"] : []), "Last touched", "Opened at", "Tab group", "Action"];
  for (const label of labels) {
    const th = el("th", label);
    th.scope = "col";
    head.append(th);
  }
  const rows = table.createTBody();
  for (const f of findings) {
    const tab = state.tabs.find(t => t.id === f.id);
    if (!tab) continue;
    const row = rows.insertRow();
    const name = row.insertCell();
    name.className = "name";
    name.append(tabIdentity(tab));
    if (siteColumn.checked) row.insertCell().textContent = f.site;
    for (const stamp of [tab.touched,tab.opened]) row.insertCell().append(relativeTime(stamp));
    const groupCell = row.insertCell();
    if (tab.pinned) {
      const pin = el("span", null, "chrome-tab-pin");
      pin.title = pin.ariaLabel = "Pinned tab";
      pin.append(headerIcon("pin"));
      groupCell.append(pin);
    }
    if (!tab.pinned || tab.group >= 0) groupCell.append(el("span", group(tab), tab.group >= 0 ? undefined : "missing-value"));
    row.title = f.reason;
    const actions = el("div", null, "finding-actions");
    row.insertCell().append(actions);
    const returnToReview = moved => {
      const offset = scroll.scrollTop;
      showGroupingFindings(id, moved ? tab.id : undefined);
      const next = body.querySelector(".group-review-scroll");
      if (next) next.scrollTop = offset;
    };
    actions.append(btn("Move to window…", () => {
      const current = state.tabs.find(t => t.id === tab.id && t.url === tab.url && t.window === id);
      if (!current) { showGroupingFindings(id); return; }
      movePicker([current], returnToReview);
    }), btn("This belongs here", () => {
      const offset = scroll.scrollTop;
      saveWindowPref(id, {dismissedFindings:[...new Set([...(windowPrefs[id]?.dismissedFindings || []), f.key])]});
      showGroupingFindings(id);
      const next = body.querySelector(".group-review-scroll");
      if (next) next.scrollTop = offset;
    }));
  }
  scroll.append(table);
  body.append(summary,explanation,scroll);
}
function renameGroup(id) {
  const group = state.groups.find(g => g.id === id);
  if (!group) throw Error("This group is no longer open.");
  const session = state.session;
  const body = panel("Rename tab group");
  const input = el("input");
  input.value = group.title || "";
  input.setAttribute("aria-label", "Tab group name");
  const save = btn("Save name", async () => {
    if (save.disabled) return;
    save.disabled = true;
    try {
      await post("rename-group", {session, id, window:group.window, title:input.value.trim()});
      if (input.isConnected) dismiss();
      say("Tab group renamed.");
    } finally { save.disabled = false; }
  });
  input.onkeydown = e => { if (e.key === "Enter") save.click(); };
  body.append(input, save);
  input.focus();
  input.select();
}
const columns = [
  [null, "Select"], ["title", "Title / URL"], ["site", "Site"], ["window", "Window"],
  ["touched", "Last touched"], ["opened", "Opened at"], ["group", "Tab group"], [null, "Close"],
];
const sectionIcons = {"Open tabs":"window", Duplicates:"copies", "Parked sets":"archive", History:"touched"};
const headerPaths = {
  expandAll: "M4.5 5.5 8 2l3.5 3.5 M4.5 10.5 8 14l3.5-3.5",
  collapseAll: "M4.5 2 8 5.5 11.5 2 M4.5 14 8 10.5l3.5 3.5",
  bookmark: "M4 2.5h8v11l-4-2.8-4 2.8z",
  actions: "M5.5 4h8 M5.5 8h8 M5.5 12h8 M2.5 4h.2 M2.5 8h.2 M2.5 12h.2",
  copies: "M5.5 5.5h8v8h-8z M10.5 3V2.5h-8v8H3",
  archive: "M2 3h12v3H2z M3 6v7h10V6 M6.5 8.5h3",
  minimize: "M3 3h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M5.5 10h5",
  bulb: "M6 11c0-1.8-2.5-2.5-2.5-5a4.5 4.5 0 0 1 9 0c0 2.5-2.5 3.2-2.5 5z M6.5 13h3 M7.5 15h1",
  pin: "M5 2h6l-1 2v3l2 2v1H4V9l2-2V4z M8 10v4",
  title: "M4 2.5h6l3 3v8H4z M10 2.5v3h3 M6 8h5 M6 10.5h4",
  site: "M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z M2 8h12 M8 2c-3.5 3-3.5 9 0 12 3.5-3 3.5-9 0-12z",
  window: "M2 3h12v10H2z M2 6h12",
  group: "M2 5V3h5l2 2h5v8H2z",
  touched: "M2.5 6.5A5.7 5.7 0 1 1 3 11 M2 3.5v3.5h3.5 M8 4.5V8l2.5 1.5",
  opened: "M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z M8 4.5V8l3 1.5"
};
function headerIcon(key) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "header-icon");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", headerPaths[key]);
  svg.append(path);
  return svg;
}
const isDateSort = key => key === "opened" || key === "touched";
const initialDirection = key => isDateSort(key) ? -1 : 1;
function setSort(key, reverse) {
  const dir = reverse && v.sort === key ? -v.dir : initialDirection(key);
  changeView({ ...v, sort: key, dir });
}
function appendWindowBadge(container, state) {
  if (state !== "minimized") return;
  const badge = el("span", "Minimized", "window-badge minimized");
  badge.prepend(headerIcon("minimize"));
  badge.title = "Window is minimized to the Dock";
  container.append(badge);
}
const selectedWindows = new Set();
function reorderWindow(source, target, after) {
  const visible = displayRows.filter(row => row.section != null).map(row => row.section);
  if (source === target || !visible.includes(source) || !visible.includes(target)) return;
  const moving = selectedWindows.has(source) ? selectedWindows : new Set([source]);
  if (moving.has(target)) return;
  const moved = visible.filter(id => !moving.has(id));
  moved.splice(moved.indexOf(target) + Number(after), 0, ...visible.filter(id => moving.has(id)));
  // Keep filtered-out windows in their saved slots.
  const all = [...windowNames.keys()].sort((a,b) =>
    (windowPrefs[a]?.rank ?? Infinity) - (windowPrefs[b]?.rank ?? Infinity));
  const shown = new Set(visible);
  let next = 0;
  all.forEach((id, rank) => {
    const key = shown.has(id) ? moved[next++] : id;
    windowPrefs[key] = {...windowPrefs[key], rank};
  });
  v = {...v, windowOrder:"custom"};
  localStorage.setItem("windowOrder", "custom");
  persistWindowPrefs();
}
let windowDrag, dragFrame;
function updateDropTarget() {
  if (!windowDrag) return;
  const {x,y} = windowDrag;
  const bounds = list.getBoundingClientRect();
  const inside = x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  if (inside) {
    if (y < bounds.top + 45) list.scrollTop -= 8;
    else if (y > bounds.bottom - 35) list.scrollTop += 8;
  }
  const row = inside && document.elementFromPoint(x,y)?.closest("tr[data-fold-row]");
  const key = row?.dataset?.foldRow;
  const id = key?.startsWith("window-") ? Number(key.slice(7)) :
    key ? state.tabs.find(t => "tab-" + t.id === key)?.window : null;
  list.querySelector(".window-drop-target")?.classList.remove("window-drop-target","drop-after");
  windowDrag.target = id;
  if (id != null && id !== windowDrag.source && !(selectedWindows.has(windowDrag.source) && selectedWindows.has(id))) {
    const rect = (row.querySelector(".pinned-window") || row).getBoundingClientRect();
    windowDrag.after = key.startsWith("tab-") || y > rect.top + rect.height / 2;
    row.classList.add("window-drop-target");
    row.classList.toggle("drop-after", windowDrag.after);
  }
  dragFrame = requestAnimationFrame(updateDropTarget);
}
function finishWindowDrag(apply) {
  if (!windowDrag) return;
  const drag = windowDrag;
  windowDrag = null;
  cancelAnimationFrame(dragFrame);
  list.classList.remove("dragging-windows");
  list.querySelector(".window-drop-target")?.classList.remove("window-drop-target","drop-after");
  if (list.hasPointerCapture(drag.pointer)) list.releasePointerCapture(drag.pointer);
  if (apply && drag.session === state.session) reorderWindow(drag.source, drag.target, drag.after);
}
function startWindowDrag(e, id) {
  if (e.button !== 0 || windowDrag) return;
  e.preventDefault();
  clearHoverPreview();
  windowDrag = {source:id, session:state.session, pointer:e.pointerId, x:e.clientX, y:e.clientY};
  list.setPointerCapture(e.pointerId);
  list.classList.add("dragging-windows");
  updateDropTarget();
}
function windowGrip(id) {
  const grip = el("button", "⠿", "window-grip");
  grip.title = grip.ariaLabel = "Reorder " + windowName(id) + " (drag or use up/down arrows)";
  grip.onpointerdown = e => startWindowDrag(e, id);
  grip.onkeydown = e => {
    if (!["ArrowUp","ArrowDown"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const ids = displayRows.filter(row => row.section != null).map(row => row.section);
    const down = e.key === "ArrowDown";
    reorderWindow(id, ids[ids.indexOf(id) + (down ? 1 : -1)], down);
    list.querySelector('[data-fold-row="window-'+id+'"] .window-grip')?.focus();
  };
  return grip;
}
function arrangeRows() {
  rows = matches(state.tabs, v);
  if (!v.byWindow) { displayRows = visibleRows = rows; return; }
  const windows = new Map();
  for (const tab of rows) {
    if (!windows.has(tab.window)) windows.set(tab.window, []);
    windows.get(tab.window).push(tab);
  }
  rows = [];
  for (const id of selectedWindows) if (!windows.has(id)) selectedWindows.delete(id);
  displayRows = [];
  visibleRows = [];
  const dates = windowDates(state.tabs);
  const ordered = v.windowOrder === "custom" ? [...windows].sort(([a],[b]) =>
    (windowPrefs[a]?.rank ?? Infinity) - (windowPrefs[b]?.rank ?? Infinity) || a-b) : sortedWindows(windows, dates, v.windowOrder);
  for (const [id, tabs] of ordered) {
    displayRows.push({ section: id, dates: dates.get(id), count: tabs.length, windowState: tabs[0].windowState });
    if (!windowPrefs[id]?.collapsed) { displayRows.push(...tabs); visibleRows.push(...tabs); }
    rows.push(...tabs);
  }
}
const keptDuplicates = new Map();
const suggestedView = "Suggested to close";
const pickedSuggestions = new Map();
const expandedSuggestions = new Set();

function decideSuggestions(op, choices) {
  if (!choices.length) return;
  const windows = new Set(choices.map(c => c.window));
  const tabs = state.tabs.filter(t => windows.has(t.window));
  const target = {suggestions: choices.map(c => ({window:c.window,key:c.key,name:windowName(c.window)}))};
  if (op === "close") return review("close", tabs, target);
  const request = {session:state.session,target,items:tabs.map(({id,url})=>({id,url}))};
  return post("suggestions/keep", request).then(result => say("Saved "+result.saved+" window(s) to Parked sets and kept them open."));
}
function renderSuggestions() {
  const report = state.suggestions;
  const choices = report?.windows || [];
  for(const [id,key] of pickedSuggestions) {
    if(!choices.some(c=>c.window===id && c.key===key))pickedSuggestions.delete(id);
  }
  const selectedChoices = choices.filter(c=>pickedSuggestions.has(c.window));
  const all = el("input"); all.type="checkbox";all.checked=!!choices.length && selectedChoices.length===choices.length;
  all.indeterminate=selectedChoices.length>0 && !all.checked;
  all.onchange=()=>{pickedSuggestions.clear();if(all.checked)for(const c of choices)pickedSuggestions.set(c.window,c.key);render()};
  const label=el("label");label.append(all," Select all");
  const toolbar=el("div",null,"suggestion-tools");
  const close=btn("Review close selected",()=>decideSuggestions("close",selectedChoices));
  const keep=btn("Keep & save selected",()=>decideSuggestions("keep",selectedChoices));
  keep.disabled=close.disabled=!selectedChoices.length || !state.connected || state.busy;
  toolbar.append(label,el("span",selectedChoices.length+" selected"),close,keep);
  list.append(el("p","Minimized windows untouched for at least 14 days. Windows with pinned tabs, missing activity dates, or recognized drafts and edit pages are excluded."),el("p",report?.updated?"Updated "+when(report.updated)+" · Daily at 9 AM Eastern":"Waiting for the first daily review.","sub"));
  if(!choices.length){empty(state.connected?"No windows qualify for review today.":"Connect Chrome to review windows.");return}
  list.append(toolbar);
  for(const c of choices){
    const entry=el("div",null,"entry"), box=el("input"), name=windowName(c.window);
    box.type="checkbox";box.checked=pickedSuggestions.has(c.window);box.setAttribute("aria-label","Select "+name);
    box.onchange=()=>{if(box.checked)pickedSuggestions.set(c.window,c.key);else pickedSuggestions.delete(c.window);render()};
    const row=el("div",null,"suggestion-tools");
    const toggle=btn(name,()=>{if(expandedSuggestions.has(c.key))expandedSuggestions.delete(c.key);else expandedSuggestions.add(c.key);render()});
    toggle.setAttribute("aria-expanded",String(expandedSuggestions.has(c.key)));
    const closeOne=btn("Review close",()=>decideSuggestions("close",[c]));
    const keepOne=btn("Keep & save",()=>decideSuggestions("keep",[c]));
    closeOne.disabled=keepOne.disabled=!state.connected||state.busy;
    row.append(box,toggle,closeOne,keepOne);entry.append(row,el("div",c.count+" tabs · Minimized · Last touched "+c.days+" days ago","sub"));
    if(expandedSuggestions.has(c.key))entry.append(itemList(state.tabs.filter(t=>t.window===c.window)));
    list.append(entry);
  }
}

const sections = ["Open tabs", "Duplicates", "Parked sets", "History"],
  list = $("list");
const builtins = [
  ["Opened today", { age: "today", sort: "opened" }],
  ["Untouched for 30 days", { age: "30", sort: "touched", dir: 1 }],
  ["Esmeralda research", { q: "Esmeralda", sort: "touched" }],
];
const exactTime = new Intl.DateTimeFormat(undefined, {dateStyle:"full", timeStyle:"long"});
function elapsed(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (!minutes) return "just now";
  const [count, unit] = minutes < 60 ? [minutes, "min"]
    : minutes < 1440 ? [Math.floor(minutes / 60), "hour"]
    : [Math.floor(minutes / 1440), "day"];
  return count + " " + unit + (count === 1 ? "" : "s") + " ago";
}
function relativeTime(timestamp, prefix = "") {
  if (!timestamp) return el("span", prefix + "Unknown", "missing-value");
  const node = el("time", prefix + elapsed(timestamp));
  node.dateTime = new Date(timestamp).toISOString();
  node.title = exactTime.format(timestamp);
  node.dataset.prefix = prefix;
  return node;
}
setInterval(() => {
  for (const node of list.querySelectorAll("time[datetime]")) {
    node.textContent = node.dataset.prefix + elapsed(Date.parse(node.dateTime));
  }
}, 30000);
const when = (n) =>
  n
    ? new Date(n).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Unknown";
const group = (t) =>
  state.groups.find((g) => g.id === t.group)?.title ||
  (t.group >= 0 ? "Unnamed group" : "n/a");
const label = (t) => windowName(t.window) + " · " + group(t);
const chosen = () => state.tabs.filter((t) => selected.has(t.id));
function navigate(name) {
  nameMenu?.options.hidePopover();
    windowEditor = null;
  page = name;
  list.scrollTop = 0;
  render();
}
let activeSavedView = null;
function changeView(next, savedView = null) {
  activeSavedView = savedView;
    windowEditor = null;
  v = { ...defaultView, byWindow: v.byWindow, windowOrder: v.windowOrder, ...next };
  localStorage.setItem("windowOrder", v.windowOrder);
  localStorage.setItem("byWindow", String(!!v.byWindow));
  page = "Open tabs";
  cursor = 0;
  list.scrollTop = 0;
  render();
}
function addReviewCount(button, count, unit) {
  if (!count) return;
  const description = count + " " + unit + (count === 1 ? "" : "s") + " to review";
  const badge = el("span", String(count), "review-count");
  badge.setAttribute("aria-hidden", "true");
  button.title = description;
  button.setAttribute("aria-label", button.textContent + ", " + description);
  button.append(badge);
}
function markCurrent(button, current) {
  if (current) {
    button.classList.add("active");
    button.setAttribute("aria-current", "page");
  }
  return button;
}
function render() {
  const sets = duplicates(state.tabs);
  $("heading").hidden = page === "Open tabs";
  $("heading").textContent = page;
  $("nav").replaceChildren(
    ...sections.map((n) => {
      const b = btn(n, () => navigate(n));
      b.prepend(headerIcon(sectionIcons[n]));
      if (n === "Duplicates") addReviewCount(b, sets.length, "duplicate URL group");
      return markCurrent(b, page === n);
    }),
  );
  const dailyButton = btn(suggestedView, () => navigate(suggestedView));
  addReviewCount(dailyButton, state.suggestions?.windows?.length, "window");
  if (!state.suggestions?.windows?.length) {
    dailyButton.append(el("span", "0", "view-count"));
    dailyButton.setAttribute("aria-label", suggestedView + ", 0 windows to review");
  }
  markCurrent(dailyButton, page === suggestedView);
  $("views").replaceChildren(
    dailyButton,
    ...[
      ...builtins.map(([name, view]) => ({ name, view })),
      ...state.views,
    ].map((s, index) => {
      const key = (index < builtins.length ? "builtin:" : "saved:") + s.name;
      const button = btn(s.name, () => changeView(s.view, key));
      const count = matchingTabs(state.tabs, {...defaultView, ...s.view}).length;
      button.append(el("span", String(count), "view-count"));
      button.setAttribute("aria-label", s.name + ", " + count + (count === 1 ? " matching tab" : " matching tabs"));
      return markCurrent(button, page === "Open tabs" && activeSavedView === key);
    }),
  );
  $("controls").hidden = page !== "Open tabs";
  $("bar").hidden = page !== "Open tabs";
  updateConnection();
  $("search").value = v.q;
  $("search-toggle").toggleAttribute("data-filtered", Boolean(v.q));
  $("search-toggle").title = v.q ? "Search tabs: " + v.q + " (/)" : "Search tabs (/)";
  if (v.age && !Array.from($("age").children).some(button => button.dataset.value === String(v.age))) {
    const button = el("button", "Untouched " + v.age + " days");
    button.dataset.value = v.age;
    $("age").append(button);
  }
  const directions = $("direction").children;
  directions[0].textContent = isDateSort(v.sort) ? "Newest first" : "Z → A";
  directions[1].textContent = isDateSort(v.sort) ? "Oldest first" : "A → Z";
  $("direction-field").inert = v.sort === "order";
  for (const [id, value] of [["age", v.age], ["sort", v.sort], ["direction", v.dir], ["windowOrder", v.byWindow ? v.windowOrder : null]]) {
    for (const button of $(id).children) button.setAttribute("aria-pressed", String(button.dataset.value === String(value)));
  }
  if (page === "Open tabs") {
    $("foldAll").inert = !v.byWindow;
    $("foldAll").disabled = !windowNames.size;
    const expand = allWindowsCollapsed();
    $("foldAll").replaceChildren(headerIcon(expand ? "expandAll" : "collapseAll"), expand ? "Expand all" : "Collapse all");
    $("byWindow").setAttribute("aria-checked", String(!!v.byWindow));
    $("group-state").textContent = v.byWindow ? "On" : "Off";
    $("windowOrderLabel").inert = !v.byWindow;
    arrangeRows();
    cursor = Math.min(cursor, Math.max(0, visibleRows.length - 1));
    paint();
    return;
  }
  list.replaceChildren();
  if (page === suggestedView) return renderSuggestions();
  if (page === "Duplicates") {
    for (const copies of sets) {
      const d = el("div", null, "entry");
      const url = copies[0].url;
      const titles = copies.map(t => t.title?.trim()).filter(Boolean);
      const bare = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
      const title = titles.find(text => text !== url && text !== bare && text !== copies[0].site);
      d.append(tabIdentity(copies[0], title || titles.find(text => text !== url) || "Page title unavailable"));
      const select = el("select");
      for (const t of copies)
        select.add(
          new Option(
            "Keep " + label(t) + " · " + when(t.touched) + " · #" + t.id,
            t.id,
          ),
        );
      const kept = keptDuplicates.get(copies[0].url);
      if (copies.some((t) => t.id === kept)) select.value = String(kept);
      select.onchange = () =>
        keptDuplicates.set(copies[0].url, Number(select.value));
      d.append(
        el("p", copies.length + " identical URLs"),
        select,
        btn("Review other copies", () =>
          review(
            "close",
            copies.filter((t) => t.id !== Number(select.value)),
          ),
        ),
      );
      d.append(btn("Close all "+copies.length+" copies…", () => review("close", copies)));
      list.append(d);
    }
    if (!sets.length) empty("No duplicate URLs.");
  } else {
    const entries = page === "History" ? state.history : state.sets;
    for (const s of entries) {
      const d = el("div", null, "entry");
      d.append(
        el("strong", s.name || s.op),
        el(
          "div",
          s.name
            ? s.count + " tabs"
            : when(s.time) +
                " · " +
                s.ok +
                "/" +
                s.total +
                " successful" +
                (s.running
                  ? " · running"
                  : s.interrupted
                    ? " · interrupted"
                    : ""),
          "sub",
        ),
        btn(s.name ? "Review set" : "Details", () => details(s.id)),
      );
      list.append(d);
    }
    if (!entries.length)
      empty(page === "History" ? "No batches yet." : "No parked sets yet.");
  }
}
function empty(text) {
  list.append(el("div", text, "empty"));
}
function tabFavicon(t) {
  const badge = el("div", "◎", "tab-favicon");
  badge.setAttribute("aria-hidden", "true");
  const source = state.icons?.[t.iconIndex];
  if (source?.startsWith("data:image/png;base64,")) {
    const image = el("img");
    image.alt = "";
    image.onerror = () => image.remove();
    image.src = source;
    badge.append(image);
  }
  return badge;
}
function tabIdentity(tab, title = tab.title || tab.url, iconTab = tab) {
  const line = el("div", null, "title-with-icon");
  const text = el("div", null, "tab-title-text");
  text.append(el("strong", title), el("span", tab.url));
  text.title = title + "\n" + tab.url;
  line.append(tabFavicon(iconTab), text);
  return line;
}
const graphemes = new Intl.Segmenter(undefined, {granularity:"grapheme"});
function emphasizeLeadingEmoji(label, name) {
  const first = graphemes.segment(name).containing(0)?.segment;
  if (first && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(first)) {
    label.replaceChildren(el("span", first, "window-emoji"), name.slice(first.length));
  }
}
function paint() {
  if (page !== "Open tabs") return;
  const matchingSelected = rows.reduce((n, t) => n + selected.has(t.id), 0);
  const visible = visibleRows.reduce((n,t)=>n+selected.has(t.id),0);
  $("all").checked = !!rows.length && matchingSelected === rows.length;
  $("all").indeterminate = matchingSelected > 0 && matchingSelected < rows.length;
  $("count").textContent =
    rows.length +
    " matching · " +
    selected.size +
    " selected" +
    (selected.size > visible
      ? " · " + (selected.size - visible) + " hidden"
      : "");
  $("actions").disabled = !selected.size;
  $("move-selected").hidden = !selected.size;
  $("move-selected").disabled = state.busy || !state.connected;
  const start = Math.max(0, Math.floor(list.scrollTop / rowHeight) - 3);
  const end = Math.min(displayRows.length, start + Math.ceil(list.clientHeight / rowHeight) + 8);
  const table = el("table", null, "tab-table");
  table.setAttribute("aria-label", "Open Chrome tabs");
  const colgroup = document.createElement("colgroup");
  table.append(colgroup);
  const head = v.byWindow ? null : table.createTHead().insertRow();
  const focusedKey = document.activeElement?.dataset.sortKey;
  const shownColumns = columns.filter(([key]) =>
    (key !== "window" || !v.byWindow) && (key !== "site" || siteColumn.checked));
  table.classList.toggle("by-window", v.byWindow);
  table.classList.toggle("without-site", !siteColumn.checked);
  for (const [key, label] of shownColumns) {
    const col = document.createElement("col");
    col.dataset.column = key || label.toLowerCase();
    colgroup.append(col);
    if (!head) continue;
    const th = el("th");
    th.scope = "col";
    th.dataset.column = key || label.toLowerCase();
    if (key) {
      const button = btn(label, () => setSort(key, true));
      button.prepend(headerIcon(key));
      button.dataset.sortKey = key;
      button.title = key === "opened" ? "Sort by the date and time the tab was opened" : key === "touched" ? "Sort by the last time the tab was active" : "Sort by " + label;
      const active = v.sort === key;
      if (active) th.setAttribute("aria-sort", v.dir === 1 ? "ascending" : "descending");
      const arrow = el("span", active ? (v.dir === 1 ? "↑" : "↓") : "↕", "sort-arrow");
      arrow.setAttribute("aria-hidden", "true");
      button.append(arrow);
      th.append(button);
    } else th.setAttribute("aria-label", label);
    head.append(th);
  }
  const body = table.createTBody();
  function spacer(count) {
    if (count <= 0) return;
    const row = body.insertRow();
    row.setAttribute("aria-hidden", "true");
    const cell = row.insertCell();
    cell.colSpan = shownColumns.length;
    cell.style.height = count * rowHeight + "px";
  }
  const viewportRow = Math.min(displayRows.length - 1, Math.floor(list.scrollTop / rowHeight));
  let pinned = v.byWindow ? viewportRow : -1;
  while (pinned >= 0 && displayRows[pinned].section == null) pinned--;
  const first = pinned >= 0 ? Math.min(start, pinned) : start;
  spacer(first);
  let i = visibleRows.indexOf(displayRows.slice(start, end).find(t => t.id != null));
  for (let index = first; index < end; index++) {
    if (index < start && index !== pinned) {
      spacer(start - index);
      index = start - 1;
      continue;
    }
    const t = displayRows[index];
    if (t.section != null) {
      const id = t.section, collapsed = !!windowPrefs[id]?.collapsed;
      const heading = el("th", null, "window-section");
      if (index > 0) heading.classList.add("window-boundary");
      const controls = el("div",null,"window-controls");
      const toggle = btn(windowName(id), () => {
        saveWindowPref(id, {collapsed: !collapsed});
        list.querySelector('[data-fold="'+id+'"]')?.focus({preventScroll:true});
      });
      const arrow = el("span", null, "fold-arrow");
      arrow.setAttribute("aria-hidden", "true");
      emphasizeLeadingEmoji(toggle, windowName(id));
      toggle.prepend(arrow);
      toggle.dataset.fold = id;
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.title = (collapsed ? "Expand " : "Collapse ") + windowName(id);
      const count = t.count + (t.count === 1 ? " tab" : " tabs");
      const countSlot = el("span", count, "window-count");
      controls.append(windowGrip(id), editableName(toggle, "window", null, id, "window-"+id), countSlot);
      appendWindowBadge(controls, t.windowState);
      const findings = groupingAlerts.get(id);
      if (findings) {
        const alert = btn("⚠", () => showGroupingFindings(id));
        alert.className = "grouping-alert";
        alert.title = findings.slice(0,3).map(f => f.title + " — " + f.reason).join("\n") +
          (findings.length > 3 ? "\n+" + (findings.length-3) + " more" : "") + "\nClick to review or dismiss.";
        alert.ariaLabel = "Review possible grouping mismatch: " + windowName(id);
        countSlot.append(alert);
      }
      if (v.windowOrder !== "tabs" && v.windowOrder !== "custom") {
        const field = v.windowOrder.split("-")[0];
        const stamp = relativeTime(t.dates[field], field === "created" ? "Created " : "Touched ");
        stamp.classList.add("window-time");
        controls.append(stamp);
      }
      if (index === pinned) {
        heading.classList.add("pinned-window");
        if (list.scrollTop > index * rowHeight) {
          heading.classList.add("is-stuck");
          const nameSlot = el("div", null, "pinned-name-slot");
          const name = controls.children[1];
          name.replaceWith(nameSlot);
          const badge = el("span", "Pinned", "pin-badge");
          badge.title = "This window heading stays visible while you scroll its tabs";
          nameSlot.append(badge, name);
        }
        // Slide this heading out as the next window reaches the sticky header.
        const next = displayRows.findIndex((entry, n) => n > index && entry.section != null);
        const offset = next < 0 ? 0 : Math.min(0, (next - 1) * rowHeight - list.scrollTop);
        heading.style.top = (headerHeight() + offset) + "px";
      }
      const starred = !!windowPrefs[id]?.starred;
      const star = btn(starred ? "★" : "☆", () => {
        saveWindowPref(id, {starred: !starred});
        list.querySelector('[data-star-window="'+id+'"]')?.focus({preventScroll:true});
      });
      star.className = "window-star";
      star.dataset.starWindow = id;
      star.title = (starred ? "Unstar " : "Star ") + windowName(id);
      star.setAttribute("aria-label", "Star window: " + windowName(id));
      star.setAttribute("aria-pressed", String(starred));
      controls.append(star);
      heading.append(controls);
      heading.colSpan = shownColumns.length;
      const row = body.insertRow();
      row.dataset.foldRow = "window-" + id;
      row.onclick = event => {
        if (!event.target.closest("button")) toggle.click();
      };
      heading.classList.toggle("selected-window", selectedWindows.has(id));
      row.addEventListener("click", event => {
        if (!(event.metaKey || event.ctrlKey) || event.target.closest("input,button:not([data-fold]):not(.window-grip)")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!selectedWindows.delete(id)) selectedWindows.add(id);
        paint();
      }, true);
      row.onpointermove = event => {
        if (event.buttons === 1 && selectedWindows.has(id) && !windowDrag &&
            row.dragOrigin && Math.hypot(event.clientX-row.dragOrigin.x,event.clientY-row.dragOrigin.y) >= 4)
          startWindowDrag(event,id);
      };
      row.onpointerdown = event => {
        row.dragOrigin = event.button === 0 && !event.target.closest("input,button:not([data-fold])")
          ? {x:event.clientX,y:event.clientY} : null;
      };
      row.onpointerleave = row.onpointerup = () => { row.dragOrigin = null; };
      row.append(heading);
      continue;
    }
    const rowIndex = i++;
    const r = body.insertRow();
    r.dataset.foldRow = "tab-" + t.id;
    r.className = "row";
    r.classList.toggle("selected", selected.has(t.id));
    r.classList.toggle(
      "cursor",
      rowIndex === cursor && document.activeElement === list,
    );
    const check = el("input");
    check.type = "checkbox";
    check.checked = selected.has(t.id);
    check.setAttribute("aria-label", "Select " + t.title);
    check.onclick = (e) => {
      e.stopPropagation();
      cursor = rowIndex;
      toggle(t, e.shiftKey, check.checked);
    };
    const checkTarget = el("label", null, "tab-check-target");
    checkTarget.onclick = event => event.stopPropagation();
    checkTarget.append(check);
    r.insertCell().append(checkTarget);
    const title = r.insertCell();
    title.className = "name";
    title.append(tabIdentity(t));
    if (siteColumn.checked) {
      const site = r.insertCell();
      site.title = t.site;
      const siteLine = el("div", null, "title-with-icon");
      siteLine.append(tabFavicon(t), el("span", t.site, "site-domain"));
      site.append(siteLine);
    }
    if (!v.byWindow) {
      const windowCell = r.insertCell();
      windowCell.title = windowName(t.window);
      windowCell.className = "window-cell";
      windowCell.append(editableName(el("span", windowName(t.window), "window-id"), "window", null, t.window, "tab-"+t.id));
      appendWindowBadge(windowCell, t.windowState);
    }
    for (const timestamp of [t.touched, t.opened]) {
      const cell = r.insertCell();
      cell.className = "tab-time";
      const time = relativeTime(timestamp);
      cell.title = time.title || "Unknown";
      cell.append(time);
    }
    const groupCell = r.insertCell();
    groupCell.title = t.pinned && !(t.group >= 0) ? "Pinned tab" : group(t);
    const groupLabel = el("span", group(t), t.group >= 0 ? undefined : "missing-value");
    const groupLine = el("div", null, "tab-group-line");
    if (t.pinned) {
      const pin = el("span", null, "chrome-tab-pin");
      pin.setAttribute("role", "img");
      pin.setAttribute("aria-label", "Pinned tab");
      pin.append(headerIcon("pin"));
      pin.title = "This tab is pinned in Chrome";
      groupLine.append(pin);
    }
    if (t.group >= 0) groupLine.append(editableName(groupLabel, "tab group", () => renameGroup(t.group)));
    else if (!t.pinned) groupLine.append(groupLabel);
    groupCell.append(groupLine);
    const close = el("button", "×", "row-close");
    close.type = "button";
    close.title = close.ariaLabel = "Close " + (t.title || t.url);
    close.disabled = state.busy || !state.connected;
    close.onclick = event => {
      event.stopPropagation();
      close.disabled = true;
      safe(async () => {
        try {
          await submitBatch({op:"close", session:state.session, items:[{id:t.id, url:t.url}]});
        } finally {
          close.disabled = state.busy || !state.connected;
        }
      });
    };
    r.insertCell().append(close);
    r.title = t.url;
    r.onclick = (e) => {
      cursor = rowIndex;
      if (e.shiftKey) toggle(t, true, true);
      else safe(() => focusTab(t));
    };

  }
  spacer(displayRows.length - end);
  const focused = document.activeElement;
  const caret = focused?.classList.contains("window-name-input") ? [focused.selectionStart,focused.selectionEnd,focused.selectionDirection] : null;
  list.replaceChildren(table);
  positionNameMenu();
  if (caret) {
    const input = table.querySelector(".window-name-input");
    input?.focus({preventScroll:true});
    input?.setSelectionRange(...caret);
  }
  if (focusedKey) table.querySelector('[data-sort-key="' + focusedKey + '"]')?.focus({preventScroll:true});
  if (!rows.length)
    empty(
      state.connected
        ? "No matching tabs."
        : "Waiting for the Chrome extension…",
    );
}
let pendingReorder, movingRow, reorderFrame;
function stopReorder() {
  pendingReorder = null;
  cancelAnimationFrame(reorderFrame);
  movingRow?.remove();
  movingRow = null;
  list.querySelectorAll(".reorder-destination").forEach(row => row.classList.remove("reorder-destination"));
}
async function focusTab(t) {
  stopReorder();
  const row = list.querySelector('[data-fold-row="tab-'+t.id+'"]');
  const intent = row && {id:t.id, window:t.window, view:v, session:state.session,
    tabIndex:displayRows.findIndex(r => r.id === t.id),
    windowIndex:displayRows.filter(r => r.section != null).findIndex(r => r.section === t.window),
    startY:row.getBoundingClientRect().top, expires:Date.now()+15000};
  pendingReorder = intent;
  try { await post("focus", {tab:t, session:state.session}); }
  catch (error) { if (pendingReorder === intent) stopReorder(); throw error; }
}
function followSortedRow() {
  const intent = pendingReorder;
  if (!intent) return;
  if (intent.view !== v || intent.session !== state.session || page !== "Open tabs" || Date.now() > intent.expires) {
    stopReorder();
    return;
  }
  const tabIndex = displayRows.findIndex(r => r.id === intent.id);
  const windowIndex = displayRows.filter(r => r.section != null).findIndex(r => r.section === intent.window);
  const groupMoved = v.byWindow && windowIndex !== intent.windowIndex;
  if (tabIndex < 0 || (!groupMoved && tabIndex === intent.tabIndex)) return;
  const index = groupMoved ? displayRows.findIndex(r => r.section === intent.window) : tabIndex;
  const key = (groupMoved ? "window-" + intent.window : "tab-" + intent.id);
  const selector = '[data-fold-row="'+key+'"]';
  pendingReorder = null;
  const bounds = list.getBoundingClientRect();
  const inset = headerHeight() + (v.byWindow && !groupMoved ? rowHeight : 0);
  const startScroll = list.scrollTop;
  const rowTop = headerHeight() + index * rowHeight;
  const targetScroll = Math.max(0, Math.min(list.scrollHeight-list.clientHeight,
    rowTop-startScroll < inset ? rowTop-inset :
    rowTop-startScroll+rowHeight > list.clientHeight ? rowTop+rowHeight-list.clientHeight : startScroll));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    list.scrollTop = targetScroll;
    paint();
    return;
  }
  const card = el("div", groupMoved ? windowName(intent.window) : displayRows[index].title, "reorder-flight");
  card.setAttribute("aria-hidden","true");
  movingRow = card;
  const startY = Math.max(bounds.top+headerHeight(), Math.min(intent.startY,bounds.bottom-rowHeight));
  const endY = bounds.top+rowTop-targetScroll;
  Object.assign(card.style,{left:bounds.left+"px",width:list.clientWidth+"px",top:startY+"px"});
  document.body.append(card);
  const started = performance.now();
  function frame(now) {
    if (intent.view !== v || page !== "Open tabs" || state.session !== intent.session) return stopReorder();
    const progress = Math.min(1,(now-started)/500);
    const eased = progress * progress * (3-2*progress);
    list.scrollTop = startScroll+(targetScroll-startScroll)*eased;
    card.style.transform = "translateY("+((endY-startY)*eased)+"px)";
    list.querySelector(selector)?.classList.add("reorder-destination");
    if (progress < 1) reorderFrame = requestAnimationFrame(frame);
    else {
      stopReorder();
      list.querySelector(selector)?.animate([{backgroundColor:"light-dark(#cfdfc7,#405c42)"},{backgroundColor:"transparent"}],{duration:650});
    }
  }
  reorderFrame = requestAnimationFrame(frame);
}
list.addEventListener("wheel", stopReorder, {passive:true});
list.addEventListener("pointerdown", stopReorder);
function toggle(t, range, on) {
  const a = visibleRows.findIndex((x) => x.id === anchor),
    b = visibleRows.indexOf(t);
  for (const x of range && a >= 0
    ? visibleRows.slice(Math.min(a, b), Math.max(a, b) + 1)
    : [t]) {
    if (on) selected.add(x.id);
    else selected.delete(x.id);
  }
  anchor = t.id;
  paint();
}
function selectAll(on) {
  for (const t of rows) {
    if (on) selected.add(t.id);
    else selected.delete(t.id);
  }
  paint();
}
const hoverCard = el("aside", null, "hover-preview");
hoverCard.hidden = true;
document.body.append(hoverCard);
let hoverKey, hoverTimer, hoverGeneration = 0;
function clearHoverPreview() {
  clearTimeout(hoverTimer);
  hoverKey = null;
  hoverGeneration++;
  hoverCard.hidden = true;
  hoverCard.replaceChildren();
}
function placeHoverCard(x, y) {
  const margin = 8;
  hoverCard.style.left = Math.min(x + 16, innerWidth - hoverCard.offsetWidth - margin) + "px";
  const below = y + 20;
  hoverCard.style.top = (below + hoverCard.offsetHeight <= innerHeight - margin
    ? below : Math.max(margin, y - hoverCard.offsetHeight - 12)) + "px";
}
list.addEventListener("pointermove", event => {
  const row = event.target.closest("tr.row");
  if (!row || event.pointerType === "touch" || event.target.closest("button,input") || !$("panel").hidden) {
    if (hoverKey) clearHoverPreview();
    return;
  }
  const key = row.dataset.foldRow;
  if (hoverKey === key) return;
  clearHoverPreview();
  hoverKey = key;
  const generation = hoverGeneration;
  const x = event.clientX, y = event.clientY;
  const tab = state.tabs.find(t => "tab-" + t.id === key);
  if (!tab) return;
  const valid = () => generation === hoverGeneration && $("panel").hidden &&
    document.elementFromPoint(x,y)?.closest("tr.row")?.dataset.foldRow === key &&
    state.tabs.some(t => t.id === tab.id && t.url === tab.url);
  hoverTimer = setTimeout(async () => {
    if (!valid()) return;
    const note = el("small", "Loading preview…");
    hoverCard.replaceChildren(el("strong", tab.title || tab.site), note);
    hoverCard.hidden = false;
    placeHoverCard(x,y);
    try {
      const result = await post("preview", {session:state.session, tab:{id:tab.id,url:tab.url}});
      if (!valid()) return;
      const img = el("img");
      img.alt = "Page preview";
      img.src = result.image;
      await img.decode();
      if (valid()) note.replaceWith(img);
    } catch (error) {
      if (valid()) note.textContent = error.message || "Preview unavailable.";
    } finally {
      if (generation === hoverGeneration) {
        if (valid()) placeHoverCard(x,y);
        else clearHoverPreview();
      }
    }
  }, 700);
});
list.addEventListener("pointerleave", clearHoverPreview);
document.addEventListener("pointerdown", clearHoverPreview, true);
document.addEventListener("keydown", clearHoverPreview, true);
window.addEventListener("blur", clearHoverPreview);
list.addEventListener("pointermove", e => {
  if (windowDrag?.pointer === e.pointerId) Object.assign(windowDrag, {x:e.clientX,y:e.clientY});
});
list.addEventListener("pointerup", e => {
  if (windowDrag?.pointer !== e.pointerId) return;
  Object.assign(windowDrag, {x:e.clientX,y:e.clientY});
  cancelAnimationFrame(dragFrame);
  updateDropTarget();
  finishWindowDrag(true);
});
list.addEventListener("lostpointercapture", () => finishWindowDrag(false));
list.onscroll = () => { clearHoverPreview(); paint(); };
new ResizeObserver(() => paint()).observe(list);
$("all").onchange = (e) => selectAll(e.target.checked);
function setSearchExpanded(open) {
  $("search-toggle").setAttribute("aria-expanded", String(open));
  $("search").inert = !open;
  (open ? $("search") : $("search-toggle")).focus({preventScroll:true});
}
$("search-toggle").onclick = () => setSearchExpanded($("search").inert);
$("search").onkeydown = event => {
  if (event.key === "Escape" && !event.isComposing) {
    event.preventDefault();
    event.stopPropagation();
    if (v.q) changeView({...v, q:""});
    setSearchExpanded(false);
  }
};
$("search").oninput = (e) => changeView({ ...v, q: e.target.value });
function bindChoices(id, choose) {
  $(id).onclick = event => {
    const option = event.target.closest("button[data-value]");
    if (option) choose(option.dataset.value);
  };
}
bindChoices("age", age => changeView({...v, age}));
bindChoices("sort", sort => setSort(sort, false));
bindChoices("direction", dir => changeView({...v, dir:Number(dir)}));
bindChoices("windowOrder", windowOrder => changeView({...v, byWindow:true, windowOrder}));
function foldAllWindows(collapsed) {
  for (const id of windowNames.keys()) {
    windowPrefs[id] = {...windowPrefs[id], collapsed};
  }
  animateWindowFold(() => {
    list.scrollTop = 0;
    persistWindowPrefs();
  });
}
$("save").prepend(headerIcon("bookmark"));
$("actions").prepend(headerIcon("actions"));
$("foldAll").onclick = () => foldAllWindows(!allWindowsCollapsed());
$("byWindow").onclick = () => changeView({ ...v, byWindow: !v.byWindow });
function panel(title) {
  preview = null;
  $("pt").textContent = title;
  $("panel").hidden = false;
  $("body").replaceChildren();
  return $("body");
}
function dismiss() {
  preview = null;
  $("panel").hidden = true;
}
$("dismiss").onclick = dismiss;
function inputBox(title, action, callback) {
  const b = panel(title),
    input = el("input");
  input.placeholder = "Name";
  b.append(
    input,
    btn(action, () => {
      if (!input.value.trim()) throw Error("Enter a name");
      return callback(input.value.trim());
    }),
  );
  input.focus();
}
$("save").onclick = () =>
  inputBox("Save this view", "Save", async (name) => {
    await post("views", { name, view: v });
    dismiss();
    say("View saved");
  });
function itemList(tabs, resultCell) {
  const scroll = el("div", null, "tab-summary-scroll");
  const table = el("table", null, "tab-summary");
  table.setAttribute("aria-label", "Tabs");
  const head = table.createTHead().insertRow();
  for (const label of ["Title / URL", "Window", "Tab group", ...(resultCell ? ["Result"] : [])]) {
    const th = el("th",label);
    th.scope = "col";
    head.append(th);
  }
  const body = table.createTBody();
  const liveByUrl = new Map(state.tabs.map(t => [t.url,t]));
  for (const t of tabs) {
    const row = body.insertRow();
    row.insertCell().append(tabIdentity(t, t.title || t.url, liveByUrl.get(t.url) || {}));
    const win = row.insertCell();
    win.textContent = win.title = t.windowLabel || windowName(t.window);
    const groupCell = row.insertCell();
    if (t.pinned) {
      const pin = el("span",null,"chrome-tab-pin");
      pin.title = pin.ariaLabel = "Pinned tab";
      pin.append(headerIcon("pin"));
      groupCell.append(pin);
    }
    if (t.group >= 0 || !t.pinned) {
      const name = t.groupInfo?.title || group(t);
      groupCell.append(el("span",name,t.group >= 0 ? undefined : "missing-value"));
      groupCell.title = name;
    }
    if (resultCell) resultCell(row.insertCell(), t);
  }
  scroll.append(table);
  return scroll;
}
function review(op, tabs, target = {}, source) {
  if (!tabs.length) throw Error("No eligible tabs");
  const b = panel("Review " + op + " · " + tabs.length + " tabs");
  const dest =
    op === "move"
      ? target.window
        ? windowName(target.window)
        : "New window"
      : op === "group"
        ? (target.group != null
            ? "Existing group #" + target.group
            : "New group “" + target.name + "”") +
          " in window " +
          windowName(target.window || tabs[0].window)
        : op === "park"
          ? target.name
          : op === "close"
            ? target.suggestions ? "Close "+target.suggestions.length+" reviewed window(s) in Chrome. You can reopen these URLs from History." : "Close these tabs in Chrome"
            : "Restore recorded layout where available";
  b.append(el("p", dest), itemList(tabs));
  const request = {
    op,
    items: tabs.map(({ id, url }) => ({ id, url })),
    target,
    source,
    session: state.session,
  };
  preview = request;
  const apply = btn("Apply " + op, async () => {
    if (preview !== request) return;
    apply.disabled = true;
    try {
      await submitBatch(request);
      dismiss();
      say("Batch started");
    } finally {
      apply.disabled = false;
    }
  });
  apply.className = "primary";
  b.append(apply);
}
function suggestedMoveWindow(tabs) {
  const ids = new Set(tabs.map(t => t.id));
  const skip = new Set("the and for with from this google docs slides sheets document presentation search www com new tab".split(" "));
  function terms(text) {
    return new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(word => !skip.has(word)));
  }
  const candidates = new Map();
  for (const t of state.tabs) {
    if (ids.has(t.id)) continue;
    if (!candidates.has(t.window)) candidates.set(t.window, []);
    candidates.get(t.window).push({site:t.site, words:terms(t.title || "")});
  }
  const selectedTerms = tabs.map(t => ({site:t.site, words:terms(t.title || "")}));
  let best = null, bestScore = 0;
  for (const [id, others] of candidates) {
    if (tabs.every(t => t.window === id)) continue;
    const label = terms(windowPrefs[id]?.name || "");
    let score = 0;
    for (const t of selectedTerms) {
      const overlap = words => [...t.words].filter(w => words.has(w)).length;
      const scores = others.map(other => {
        const topic = overlap(other.words) / Math.sqrt(Math.max(1,t.words.size * other.words.size));
        const site = t.site === other.site && !/^(docs|drive|www)\.google\.com$/.test(t.site) ? 1 : 0;
        return 4 * topic + site;
      });
      score += Math.max(...scores) + scores.reduce((a,b) => a+b, 0)/scores.length + overlap(label);
    }
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}
function moveSelected() { movePicker(chosen()); }
function movePicker(tabs, returnToReview) {
  if (!tabs.length) return;
  const session = state.session;
  const count = tabs.length + (tabs.length === 1 ? " tab" : " tabs");
  const body = panel("Move " + count);
  const select = el("div", null, "move-destinations");
  select.id = "move-listbox";
  select.setAttribute("role","listbox");
  select.setAttribute("aria-label", "Destination window");
  const suggested = suggestedMoveWindow(tabs);
  const windows = [...windowNames.entries()].sort((a,b) => a[1].localeCompare(b[1]));
  const destinations = [[null, "New window"], ...windows];
  destinations.sort((a,b) => Number(b[0] === suggested) - Number(a[0] === suggested));
  const search = el("input");
  search.placeholder = "Find a window…";
  search.setAttribute("aria-label", "Find a destination window");
  search.autocomplete = "off";
  search.setAttribute("role","combobox");
  search.setAttribute("aria-controls",select.id);
  search.setAttribute("aria-autocomplete","list");
  const noMatch = el("p", "No matching windows");
  noMatch.setAttribute("role", "status");
  let submitting = false;
  let active;
  function choose(option) {
    active?.setAttribute("aria-selected","false");
    active = option;
    if (active) {
      active.setAttribute("aria-selected","true");
      search.setAttribute("aria-activedescendant",active.id);
      active.scrollIntoView({block:"nearest"});
    } else search.removeAttribute("aria-activedescendant");
    apply.disabled = submitting || !active;
  }
  function filterWindows() {
    const query = search.value.trim().toLowerCase();
    select.replaceChildren();
    for (const [id, name] of destinations) {
      if (!name.toLowerCase().includes(query)) continue;
      const option = el("div",null,"move-option");
      option.append(el("span",name));
      if (id === suggested) option.append(el("span","Suggested","suggested-badge"));
      option.id = "destination-" + (id ?? "new");
      option.dataset.value = id ?? "";
      option.setAttribute("role","option");
      option.setAttribute("aria-selected","false");
      option.setAttribute("aria-disabled",String(id !== null && tabs.every(t => t.window === id)));
      option.onclick = () => {
        if (option.getAttribute("aria-disabled") === "true" || submitting) return;
        choose(option);
        search.focus({preventScroll:true});
      };
      select.append(option);
    }
    noMatch.hidden = !!select.childElementCount;
    select.hidden = !noMatch.hidden;
    search.setAttribute("aria-expanded",String(!select.hidden));
    choose(select.querySelector('[aria-disabled="false"]'));
  }
  const apply = btn("Move " + count, async () => {
    if (apply.disabled) return;
    submitting = apply.disabled = true;
    try {
      const accepted = await submitBatch({op:"move", session, items:tabs.map(({id,url}) => ({id,url})),
        target:{window:active.dataset.value === "" ? null : Number(active.dataset.value)}});
      if (returnToReview) {
        const batch = await finishedBatch(accepted.id);
        const result = batch.results.find(r => r.id === tabs[0].id);
        if (!result?.ok) throw Error(result?.error || "Move not confirmed. Check batch history.");
        if (apply.isConnected && !$("panel").hidden) returnToReview(true);
      } else {
        if (apply.isConnected) dismiss();
        say("Move started");
      }
    } finally {submitting = false; apply.disabled = !active;}
  });
  apply.className = "primary";
  search.oninput = filterWindows;
  search.onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === "Enter") {event.preventDefault();apply.click();}
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const options = [...select.querySelectorAll('[aria-disabled="false"]')];
      const next = options[options.indexOf(active)+step];
      if (next) choose(next);
    }
  };
  body.append(itemList(tabs), search, select, noMatch, apply);
  if (returnToReview) body.append(btn("Back to grouping", () => { if (!submitting) returnToReview(false); }));
  filterWindows();
  search.focus();
}
$("move-selected").onclick = moveSelected;
function groupSelected() {
  const tabs = chosen(), body = panel("Add to group"), select = el("select"), input = el("input");
  select.add(new Option("New group", ""));
  for (const g of state.groups)
    select.add(new Option((g.title || "Unnamed group") + " · " + windowName(g.window), g.id));
  input.placeholder = "New group name";
  select.onchange = () => (input.hidden = !!select.value);
  body.append(select, input, btn("Review", () => {
    const id = select.value === "" ? null : Number(select.value);
    review("group", tabs, {group:id, window:state.groups.find(g => g.id === id)?.window || tabs[0].window, name:input.value || "Selected tabs"});
  }));
}
function actions() {
  const b = panel(selected.size + " selected");
  b.append(
    btn("Move…", moveSelected),
    btn("Group…", groupSelected),
    btn("Close…", () => review("close", chosen())),
    btn("Park…", () =>
      inputBox("Park selected tabs", "Review", (name) =>
        review("park", chosen(), { name }),
      ),
    ),
    btn("Copy Markdown", copy),
  );
}
async function copy() {
  await navigator.clipboard.writeText(markdown(chosen()));
  dismiss();
  say("Copied " + selected.size + " Markdown links");
}
$("actions").onclick = actions;
async function details(id) {
  const d = await post("detail", { id }),
    b = panel(d.name || d.op);
  if (d.name) {
    b.append(
      itemList(d.tabs),
      btn("Review reopen", () => review("reopen", d.tabs, {}, id)),
    );
    return;
  }
  const results = new Map(d.results.map((r) => [r.id, r]));
  b.append(itemList(d.tabs, (row,t) => {
    const r = results.get(t.id);
    const result = !r
      ? "Unconfirmed / pending"
      : r.error || r.value?.warning || (r.restored ? "Restored" : "Successful");
    row.textContent = result;
    if (r?.value?.window != null)
      row.append(
        el(
          "div",
          "Window " +
            r.value.window +
            " · " +
            (r.value.group >= 0 ? "Group #" + r.value.group : "n/a"),
          "sub",
        ),
      );
  }));
  if (!d.running && ["move", "group", "park", "close"].includes(d.op)) {
    const undo = d.tabs.filter((t) => {
      const r = results.get(t.id);
      return (r?.ok || r?.partial) && !r.restored;
    });
    const retry = d.tabs.filter((t) => {
      const r = results.get(t.id);
      return r && !r.ok && !r.uncertain && !r.retried;
    });
    if (undo.length)
      b.append(btn("Review undo", () => review("undo", undo, {}, id)));
    if (retry.length)
      b.append(btn("Review retry", () => review("retry", retry, d.target, id)));
  }
}
let submittingUndoable = null;
let undoInProgress = false;
async function finishedBatch(id) {
  let batch = await post("detail", {id});
  while (batch.running) {
    await new Promise(resolve => setTimeout(resolve, 250));
    batch = await post("detail", {id});
  }
  return batch;
}
async function submitBatch(request) {
  const result = post("batch", request);
  if (request.op === "close" || request.op === "move") submittingUndoable = result;
  try {
    const accepted = await result;
    const moved = request.op === "move" || (request.op === "retry" &&
      state.history.some(h => h.id === request.source && h.op === "move"));
    if (moved) safe(async () => {
      const batch = await finishedBatch(accepted.id);
      if (request.session !== state.session) return;
      for (const r of batch.results) if (r.ok) {
        selected.delete(r.id);
        if (anchor === r.id) anchor = null;
      }
      paint();
    });
    return accepted;
  } finally {
    if (submittingUndoable === result) submittingUndoable = null;
  }
}
async function undoLastMoveOrClose() {
  if (undoInProgress) return;
  undoInProgress = true;
  try {
    if (submittingUndoable) await submittingUndoable;
    const snapshot = await post("state");
    for (const h of snapshot.history) {
      if (h.op !== "move" && h.op !== "close") continue;
      const batch = await finishedBatch(h.id);
      if (batch.op === "move" && batch.session !== snapshot.session) continue;
      const restore = new Map(batch.results.filter(r => (r.ok || r.partial) && !r.restored).map(r => [r.id,r]));
      if (!restore.size) continue;
      const items = batch.tabs.filter(t => restore.has(t.id)).map(({id,url}) => ({id,url}));
      // Let the extension publish the final window layout before restoring it.
      const stale = () => state.session === batch.session && state.tabs.some(t => restore.has(t.id) &&
        (batch.op === "close" || t.window !== restore.get(t.id).value?.window));
      for (let n=0; n<20 && stale(); n++) await new Promise(resolve=>setTimeout(resolve,100));
      const undo = await post("batch",{op:"undo",source:h.id,items,session:snapshot.session});
      say(batch.op === "move" ? "Restoring moved tabs…" : "Reopening closed tabs…");
      await finishedBatch(undo.id);
      return;
    }
    say("No dashboard move or close to undo.");
  } finally {
    undoInProgress = false;
  }
}
let shortcutOpener;
function shortcutsOpen() {
  return !$("panel").hidden && !!$("body").querySelector(".shortcut-guide");
}
$("help").onclick = () => {
  if (settings.open) settings.close();
  if (shortcutsOpen()) {
    dismiss();
    (shortcutOpener?.isConnected ? shortcutOpener : $("help")).focus();
    return;
  }
  shortcutOpener = document.activeElement;
  const body = panel("Keyboard shortcuts");
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  const groups = [
    ["Navigate", [
      ["Toggle keyboard shortcuts", "?"], ["Search tabs", "/"], ["Previous or next tab", "↑ / ↓"],
      ["Switch to tab", "Enter"], ["Dismiss panel", "Esc"],
    ]],
    ["Select tabs", [
      ["Clear selection", "Esc"], ["Toggle selection", "Space"], ["Select a range", "Shift + Space"],
      ["Select all matching", modifier + " + A"],
    ]],
    ["Act on selected tabs", [
      ["Move to window", "M"], ["Add to group", "G"], ["Park tabs", "P"],
      ["Review tabs to close", "X"], ["Copy Markdown links", "C"],
    ]],
    ["Window groups", [
      ["Collapse window", "←"], ["Expand window", "→"],
      ["Collapse all windows", "Shift + ←"], ["Expand all windows", "Shift + →"],
    ]],
    ["Undo", [["Undo last move or close", modifier + " + Z"]]],
  ];
  const guide = el("div", null, "shortcut-guide");
  for (const [heading, entries] of groups) {
    const section = el("section");
    const rows = el("dl");
    section.append(el("h3", heading), rows);
    for (const [action, shortcut] of entries) {
      const row = el("div");
      const keys = el("dd");
      for (const token of shortcut.split(" ")) {
        keys.append(el(token === "+" || (token === "/" && shortcut !== "/") ? "span" : "kbd", token));
      }
      row.append(el("dt", action), keys);
      rows.append(row);
    }
    guide.append(section);
  }
  body.append(guide, el("p", "Use Tab to move between controls and Enter to activate them.", "shortcut-note"));
  $("dismiss").focus();
};
document.addEventListener("keydown", (e) => {
  if (settings.open && e.key !== "?") return;
  if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing &&
      !e.target.isContentEditable && !e.target.closest?.("input, textarea, select") &&
      ($("panel").hidden || shortcutsOpen())) {
    e.preventDefault();
    if (!e.repeat) $("help").click();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z") {
    if (e.target.isContentEditable || e.target.closest?.('textarea,input:not([type="checkbox"]):not([type="button"])')) return;
    e.preventDefault();
    if (!e.repeat) safe(undoLastMoveOrClose);
    return;
  }
  if (e.key === "Escape") {
    if (e.repeat || e.isComposing || e.defaultPrevented) return;
    if (windowDrag) finishWindowDrag(false);
    else if (!$("panel").hidden) dismiss();
    else if (nameMenu?.options.matches(":popover-open")) nameMenu.options.hidePopover();
    else if (page === "Open tabs" && (selected.size || selectedWindows.size)) {
      selectedWindows.clear();
      selected.clear();
      anchor = null;
      paint();
    }
    list.focus();
    return;
  }
  if (page === "Open tabs" && v.byWindow && $("panel").hidden &&
      ["ArrowLeft", "ArrowRight"].includes(e.key) && !e.metaKey && !e.altKey && !e.ctrlKey &&
      !e.target.isContentEditable && !e.target.closest("input, textarea, select")) {
    const collapsed = e.key === "ArrowLeft";
    const focused = e.target.closest("[data-fold]");
    if (e.shiftKey) {
      e.preventDefault();
      foldAllWindows(collapsed);
      list.focus();
    } else if (focused || e.target === list || e.target === document.body) {
      const id = focused ? Number(focused.dataset.fold) : visibleRows[cursor]?.window ?? displayRows[0]?.section;
      if (id != null) {
        e.preventDefault();
        saveWindowPref(id, {collapsed});
        list.querySelector('[data-fold="'+id+'"]')?.focus({preventScroll:true});
      }
    }
    return;
  }
  if (e.key === "/" && page === "Open tabs" && $("panel").hidden &&
      !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey &&
      !e.target.isContentEditable && !e.target.closest("input,select,textarea")) {
    e.preventDefault();
    setSearchExpanded(true);
    return;
  }
  if (
    ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(e.target.tagName) ||
    !$("panel").hidden ||
    page !== "Open tabs"
  )
    return;
  if ((e.metaKey || e.ctrlKey) && e.key === "a") {
    e.preventDefault();
    selectAll(true);
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (["ArrowUp", "ArrowDown"].includes(e.key) && visibleRows.length) {
    e.preventDefault();
    list.focus();
    cursor = Math.max(
      0,
      Math.min(visibleRows.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1)),
    );
    const pos = displayRows.indexOf(visibleRows[cursor]) * rowHeight;
    if (pos < list.scrollTop) list.scrollTop = pos;
    if (pos + rowHeight + headerHeight() > list.scrollTop + list.clientHeight)
      list.scrollTop = pos + rowHeight + headerHeight() - list.clientHeight;
    paint();
    return;
  }
  if (visibleRows[cursor] && [" ", "Enter"].includes(e.key)) {
    e.preventDefault();
    const t = visibleRows[cursor];
    if (e.key === " ") toggle(t, e.shiftKey, !selected.has(t.id));
    else safe(() => focusTab(t));
    return;
  }
  if (selected.size) {
    const action = {
      m: moveSelected,
      g: groupSelected,
      p: () => inputBox("Park selected tabs", "Review", name =>
        review("park", chosen(), { name })),
      x: () => review("close", chosen()),
      c: copy,
    }[e.key];
    if (action) {
      e.preventDefault();
      safe(action);
    }
  }
});
let graceTimer;
function scheduleGraceExpiry() {
  clearTimeout(graceTimer);
  const now = Date.now();
  const deadlines = state.tabs.map(t => t.grace?.until).filter(until => until > now);
  if (deadlines.length) graceTimer = setTimeout(() => {
    if (page === "Open tabs" && Number(v.age) === 30) render();
    scheduleGraceExpiry();
  }, Math.min(...deadlines) - now);
}
function adopt(s) {
  const top =
      page === "Open tabs" && list.scrollTop > 0
        ? displayRows[Math.floor(list.scrollTop / rowHeight)]
        : null,
    offset = list.scrollTop % rowHeight;
  if (state.session !== s.session) {
    windowEditor = null;
    const saved = JSON.parse(localStorage.getItem("windowPrefs") || "{}");
    windowPrefs = saved.session === s.session ? saved.windows || {} : {};
    selected.clear();
    selectedWindows.clear();
    pickedSuggestions.clear();
    expandedSuggestions.clear();
    dismiss();
  }
  const previous = new Map((state.session === s.session ? state.tabs : []).map(t => [t.id,t]));
  const now = Date.now();
  state = { ...s, tabs: s.tabs.map(t => ({...prepare(t), grace:revisitGrace(previous.get(t.id), t, now)})) };
  scheduleGraceExpiry();
  for (const tab of state.tabs) tab.groupLabel = group(tab);
  updateWindowNames();
  const ids = new Set(state.tabs.map((t) => t.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  render();
  if (top && !movingRow) {
    const i = displayRows.findIndex(t => top.id != null ? t.id === top.id : t.section === top.section);
    if (i >= 0) {
      list.scrollTop = i * rowHeight + offset;
      paint();
    }
  }
  followSortedRow();
  const h = state.history[0];
  if (h)
    say(
      h.op +
        " · " +
        h.done +
        "/" +
        h.total +
        " processed · " +
        h.ok +
        " successful" +
        (h.ok < h.done ? " · See History for details" : ""),
    );
  if (!s.connected) say("Chrome disconnected · waiting for extension");
}
function register(name, description, properties, execute, required = []) {
  (document.modelContext || navigator.modelContext)?.registerTool({
    name,
    description,
    annotations: {
      readOnlyHint: ["dashboard_status", "inspect_candidates"].includes(name),
      untrustedContentHint: name === "inspect_candidates",
    },
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    execute: async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await execute(args)) }],
    }),
  });
}
const str = { type: "string" },
  integer = { type: "integer" };
register(
  "dashboard_status",
  "Read current view, counts, and connection status without tab metadata.",
  {},
  () => ({
    connected: state.connected,
    matching: rows.length,
    selected: selected.size,
    view: v,
  }),
);
register(
  "show_tabs",
  "Apply search, relative age and time sort to the visible dashboard.",
  {
    query: str,
    untouched_days: { type: "integer", minimum: 1 },
    opened_today: { type: "boolean" },
    sort: { enum: ["title", "site", "window", "group", "opened", "touched", "order"], type: "string" },
    oldest_first: { type: "boolean" },
    ascending: { type: "boolean" },
    window_order: {type:"string", enum:["tabs","custom","created-oldest","created-newest","touched-oldest","touched-newest"]},
    group_by_window: { type: "boolean" },
  },
  (a) => {
    const sort = a.sort || (a.oldest_first !== undefined ? "touched" : defaultView.sort);
    changeView({
      byWindow: a.group_by_window ?? (a.window_order ? true : v.byWindow),
      windowOrder: a.window_order ?? v.windowOrder,
      q: a.query || "",
      age: a.opened_today ? "today" : String(a.untouched_days || ""),
      sort,
      dir: a.ascending !== undefined ? (a.ascending ? 1 : -1) : isDateSort(sort) ? (a.oldest_first ? 1 : -1) : 1,
    });
    return { matching: rows.length };
  },
);
register(
  "suggest_tabs",
  "Highlight an editable suggestion within the current view. Supply topical keywords including synonyms, e.g. investor, funding, venture, capital, fundraising. Matching runs locally.",
  { keywords: { type: "array", items: str, minItems: 1 } },
  (a) => {
    const terms = a.keywords.map((x) => x.trim().toLowerCase()).filter(Boolean);
    selected = new Set(
      rows
        .filter((t) => terms.some((term) => t.search.includes(term)))
        .map((t) => t.id),
    );
    paint();
    return { suggested: selected.size };
  },
  ["keywords"],
);
register(
  "inspect_candidates",
  "For a requested semantic review, read only the displayed candidate titles and sites. Start with a narrowed view. Results exclude URL paths and are paginated.",
  {
    offset: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1, maximum: 25 },
  },
  (args) => {
    const offset = Math.max(0, args.offset || 0),
      limit = Math.max(1, Math.min(25, args.limit || 10));
    return {
      total: rows.length,
      candidates: rows
        .slice(offset, offset + limit)
        .map(({ id, title, site }) => ({ id, title, site })),
    };
  },
);
register(
  "highlight_candidates",
  "Highlight specific tab IDs from the current displayed view as an editable suggestion.",
  { ids: { type: "array", items: integer } },
  (args) => {
    const wanted = new Set(args.ids);
    selected = new Set(rows.filter((t) => wanted.has(t.id)).map((t) => t.id));
    paint();
    return { selected: selected.size };
  },
  ["ids"],
);
register(
  "select_matching",
  "Select all tabs matching the displayed filter.",
  {},
  () => {
    selectAll(true);
    return { selected: selected.size };
  },
);
register(
  "preview_tab_action",
  "Show an exact review on the dashboard for the current selection. User applies there. Omit window for a new window or group_id for a new group.",
  {
    action: { type: "string", enum: ["move", "group", "close", "park"] },
    window: integer,
    group_id: integer,
    name: str,
  },
  (a) => {
    if (a.action === "park" && !a.name)
      throw Error("A parked set needs a name");
    review(a.action, chosen(), {
      window: state.groups.find((g) => g.id === a.group_id)?.window ?? a.window,
      group: a.group_id,
      name: a.name || "Selected tabs",
    });
    return { previewed: selected.size, action: a.action };
  },
  ["action"],
);
register(
  "preview_last_undo",
  "Review reversing the most recent eligible batch on the same dashboard.",
  {},
  async () => {
    for (const h of state.history.filter(
      (x) => !x.running && ["move", "group", "close", "park"].includes(x.op),
    )) {
      const d = await post("detail", { id: h.id }),
        ids = new Set(
          d.results
            .filter((r) => (r.ok || r.partial) && !r.restored)
            .map((r) => r.id),
        );
      if (ids.size) {
        review(
          "undo",
          d.tabs.filter((t) => ids.has(t.id)),
          {},
          h.id,
        );
        return { previewed: ids.size };
      }
    }
    throw Error("No eligible batch");
  },
);
render();
async function watch() {
  while (true) {
    try {
      const snapshot = await post("state", { version: state.version });
      bridgeStatus = "online";
      adopt(snapshot);
    } catch {
      bridgeStatus = "offline";
      updateConnection();
      say("Bridge offline · reconnecting…");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
watch();
