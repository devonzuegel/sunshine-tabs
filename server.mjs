import { assess, cycle, contentKey, reviewKey } from "./suggestions.mjs";
import { execFile } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const root = path.dirname(fileURLToPath(import.meta.url)),
  port = Number(process.env.TAB_DESK_PORT ?? 47381);
let host = "127.0.0.1:" + port;
let origin = "http://" + host;
const extension = "chrome-extension://mopjfnfgfblcgbcohfepelmnjhflcagb";
const dir = process.env.TAB_DESK_DATA || path.join(root, "data");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, "library.json");
const db = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file))
  : { views: [], sets: [], history: [] };
const save = () => {
  fs.writeFileSync(file + ".tmp", JSON.stringify(db), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
};
let live = { tabs: [], groups: [], session: null },
  last = 0,
  version = Date.now(),
  job = null,
  queued,
  waiting;
const clients = new Set(),
  pending = new Map();
function changed() {
  version++;
  for (const wake of [...clients]) wake();
}
function delay(ms, register, cleanup) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      cleanup(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    register(done);
  });
}
function command(c) {
  if (Date.now() - last > 35000 || !live.session)
    throw Error("Chrome is disconnected");
  if (queued) throw Error("Chrome is busy");
  const key = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (queued?.key === key) queued = null;
      pending.delete(key);
      reject(Error("Outcome unconfirmed. Inspect Chrome before repeating."));
    }, 25000);
    pending.set(key, (r) => {
      clearTimeout(timer);
      r.error ? reject(Error(r.error)) : resolve(r.value);
    });
    queued = { ...c, key, session: live.session };
    waiting?.();
  });
}
let candidates = [];
function refreshSuggestions() {
  if (!live.session || Date.now()-last>35000) throw Error("Waiting for a fresh Chrome snapshot");
  const fresh = assess(live, db.sets);
  const today = cycle(Date.now());
  if (db.daily?.cycle !== today || db.daily.session !== live.session) {
    db.daily = {cycle:today, session:live.session, updated:Date.now(), windows:fresh.map(c=>c.key)};
    save();
  }
  const keys = new Set(db.daily.windows);
  candidates = fresh.filter(c=>keys.has(c.key));
}
function validateSuggestions(request) {
  if (request.session !== live.session || !live.session || Date.now()-last>35000)
    throw Error("Reconnect and review the windows again");
  const choices=request.target.suggestions;
  if(!Array.isArray(choices) || !choices.length)throw Error("Select a suggested window");
  const eligible=new Map(candidates.map(c=>[c.window,c.key]));
  const windows=new Set();
  for(const choice of choices) {
    if(!eligible.has(choice.window) || eligible.get(choice.window)!==choice.key || windows.has(choice.window))
      throw Error("A suggested window changed. Review again.");
    windows.add(choice.window);
  }
  const tabs=live.tabs.filter(t=>windows.has(t.window));
  if(!Array.isArray(request.items) || reviewKey(tabs)!==reviewKey(request.items))
    throw Error("The tabs in this window changed. Review again.");
  return currentTabs(request.items);
}
const cachedIcons = new Map();
let readingIcons = false;
function fillMissingIcons() {
  if (readingIcons || process.platform !== "darwin") return;
  const urls = new Set(live.tabs.map(tab => tab.url));
  for (const url of cachedIcons.keys()) if (!urls.has(url)) cachedIcons.delete(url);
  const missing = [...new Set(live.tabs.filter(tab => !live.icons?.[tab.iconIndex] &&
    !(cachedIcons.get(tab.url)?.until > Date.now())).map(tab => tab.url))];
  if (!missing.length) return;
  readingIcons = true;
  const reader = execFile("python3", [path.join(root,"cached-icons.py")], {maxBuffer:32*1024*1024, timeout:10000}, (err, output) => {
    readingIcons = false;
    let found = {};
    if (!err) { try { found = JSON.parse(output); } catch {} }
    for (const url of missing) cachedIcons.set(url,{image:found[url], until:Date.now()+ (found[url] ? 3600000 : 60000)});
    if (Object.keys(found).length) changed();
  });
  reader.stdin.on("error", () => {});
  reader.stdin.end(JSON.stringify(missing));
}
function view() {
  const icons = [...(live.icons || [])];
  const indexes = new Map(icons.map((icon,i) => [icon,i]));
  const tabs = live.tabs.map(tab => {
    const icon = cachedIcons.get(tab.url)?.image;
    if (icons[tab.iconIndex] || !icon) return tab;
    if (!indexes.has(icon)) { indexes.set(icon,icons.length); icons.push(icon); }
    return {...tab,iconIndex:indexes.get(icon)};
  });
  return {
    version,
    ...live, icons, tabs,
    connected: !!live.session && Date.now() - last < 35000,
    views: db.views,
    sets: db.sets.map((s) => ({
      id: s.id,
      name: s.name,
      count: s.tabs.length,
    })),
    history: db.history.slice(0, 30).map((h) => ({
      id: h.id,
      op: h.op,
      time: h.time,
      total: h.tabs.length,
      done: h.results.length,
      ok: h.results.filter((r) => r.ok).length,
      running: h.running,
      interrupted: h.interrupted,
    })),
    busy: !!job,
    suggestions: {updated:db.daily?.updated, windows:candidates},
  };
}
function currentTabs(items) {
  if (!Array.isArray(items) || !items.length)
    throw Error("Select at least one tab");
  const map = new Map(live.tabs.map((t) => [t.id, t]));
  return [
    ...new Map(
      items.map((i) => {
        const t = map.get(i.id);
        if (!t || t.url !== i.url)
          throw Error("Selection changed. Review again.");
        return [
          t.id,
          { ...t, groupInfo: live.groups.find((g) => g.id === t.group) },
        ];
      }),
    ).values(),
  ];
}
function start(b) {
  if (job) throw Error("A batch is already running");
  if (!live.session || Date.now() - last > 35000 || b.session !== live.session)
    throw Error("Reconnect and review again");
  if (b.op === "close" && b.target?.suggestions) validateSuggestions(b);
  const { op } = b,
    source = db.history.find((h) => h.id === b.source),
    set = db.sets.find((s) => s.id === b.source);
  let tabs,
    mode = op,
    target = b.target || {},
    originalSession = live.session;
  if (op === "reopen") {
    if (!set) throw Error("Missing set");
    tabs = set.tabs;
    originalSession = set.session;
  } else if (op === "undo") {
    if (!source || !["move", "group", "park", "close"].includes(source.op))
      throw Error("Cannot undo");
    tabs = source.results
      .filter((r) => (r.ok || r.partial) && !r.restored)
      .map((r) => source.tabs.find((t) => t.id === r.id));
    mode = ["close", "park"].includes(source.op) ? "reopen" : "restore";
    originalSession = source.session;
    if (mode === "restore" && source.session !== live.session)
      throw Error("Original Chrome session ended");
  } else if (op === "retry") {
    if (
      !source ||
      source.session !== live.session ||
      !["move", "group", "park", "close"].includes(source.op)
    )
      throw Error("Cannot retry");
    tabs = currentTabs(
      source.results
        .filter((r) => !r.ok && !r.uncertain && !r.retried)
        .map((r) => source.tabs.find((t) => t.id === r.id)),
    );
    mode = source.op;
    target = { ...source.target, ...source.resolved };
  } else {
    if (!["move", "group", "park", "close"].includes(op))
      throw Error("Unknown action");
    tabs = currentTabs(b.items);
  }
  if (!tabs.length) throw Error("No eligible tabs");
  if (["undo", "retry", "reopen"].includes(op)) {
    const reviewed = new Map((b.items || []).map((t) => [t.id, t.url]));
    if (
      reviewed.size !== tabs.length ||
      tabs.some((t) => reviewed.get(t.id) !== t.url)
    )
      throw Error("Eligible tabs changed. Review again.");
  }
  if (["reopen", "restore"].includes(mode))
    tabs = [...tabs].sort((a, b) => a.window - b.window || a.index - b.index);
  if (op === "park") {
    if (!target.name?.trim()) throw Error("Name the parked set");
    if (tabs.some((t) => !/^(https?:|file:|chrome:|about:blank$)/i.test(t.url)))
      throw Error("Selection includes a URL Chrome cannot reopen");
    db.sets.unshift({
      id: randomUUID(),
      name: target.name.trim(),
      tabs,
      session: live.session,
    });
  }
  const h = {
    id: randomUUID(),
    op,
    source: b.source,
    session: live.session,
    time: Date.now(),
    target,
    tabs,
    results: [],
    running: true,
    resolved: {},
  };
  db.history.unshift(h);
  save();
  job = h;
  changed();
  run().finally(() => {
    job = null;
    h.running = false;
    save();
    changed();
  });
  async function run() {
    const windows = new Map(),
      groups = new Map();
    for (const tab of tabs) {
      try {
        if (live.session !== h.session) throw Error("Chrome session changed");
        const c = { op: mode, tab };
        if (mode === "move")
          c.window = h.resolved.window ?? target.window ?? null;
        if (mode === "group") {
          c.group = h.resolved.group ?? target.group ?? null;
          c.window = h.resolved.window ?? target.window ?? tabs[0].window;
          c.label = { title: target.name || "Selected tabs" };
        }
        if (mode === "park") c.op = "close";
        if (mode === "restore" || mode === "reopen") {
          const same = originalSession === live.session;
          c.window =
            windows.get(tab.window) ??
            (same && live.tabs.some((t) => t.window === tab.window)
              ? tab.window
              : null);
          c.index = tab.index;
          c.pinned = tab.pinned;
          c.group =
            tab.group === -1
              ? -1
              : (groups.get(tab.group) ??
                (same &&
                live.groups.some(
                  (g) => g.id === tab.group && g.window === c.window,
                )
                  ? tab.group
                  : null));
          if (tab.groupInfo) {
            const { title, color, collapsed } = tab.groupInfo;
            c.label = { title, color, collapsed };
          }
        }
        const value = await command(c);
        if (mode === "group" && value.group >= 0)
          h.resolved.group = value.group;
        if (["group", "move"].includes(mode)) h.resolved.window = value.window;
        if (value.window != null) windows.set(tab.window, value.window);
        if (tab.group >= 0 && value.group >= 0)
          groups.set(tab.group, value.group);
        h.results.push({
          id: tab.id,
          ok: !value.warning,
          partial: !!value.warning,
          value,
        });
        if (op === "undo")
          source.results.find((r) => r.id === tab.id).restored = true;
        if (op === "retry") {
          const entry = source.results.find((r) => r.id === tab.id);
          Object.assign(entry, {
            ok: !value.warning,
            partial: !!value.warning,
            value,
            retried: !value.warning,
            error: undefined,
          });
        }
      } catch (e) {
        h.results.push({
          id: tab.id,
          ok: false,
          error: e.message,
          uncertain: e.message.startsWith("Outcome unconfirmed"),
        });
      }
      save();
      changed();
    }
  }
  return { id: h.id };
}
const server = http.createServer(async (req, res) => {
  function json(x, status = 200) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(x));
  }
  try {
    if (req.headers.host !== host) return json({}, 403);
    const url = new URL(req.url, origin),
      route = url.pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (
      req.method === "GET" &&
      ["/", "/app.js", "/model.js", "/style.css", "/inter.woff2"].includes(route)
    ) {
      const name = route === "/" ? "index.html" : route.slice(1);
      res.setHeader(
        "Content-Type",
        name.endsWith("js")
          ? "text/javascript"
          : name.endsWith("css")
            ? "text/css"
            : name.endsWith(".woff2") ? "font/woff2" : "text/html",
      );
      return res.end(fs.readFileSync(path.join(root, "public", name)));
    }
    const ext = route.startsWith("/ext/");
    if (
      req.method !== "POST" ||
      req.headers["x-tab-bridge"] !== "1" ||
      (ext ? req.headers.origin !== extension : req.headers.origin !== origin)
    )
      return json({}, 403);
    let raw = "";
    for await (const part of req) {
      raw += part;
      if (raw.length > 16e6) throw Error("Request too large");
    }
    const b = JSON.parse(raw || "{}");
    if (ext) {
      if (!b.profile || !b.session) throw Error("Missing session");
      if (db.profile && db.profile !== b.profile)
        throw Error("Another Chrome profile is paired");
      if (!db.profile) {
        db.profile = b.profile;
        save();
      }
      last = Date.now();
      if (route === "/ext/state") {
        live = { tabs: b.tabs, groups: b.groups, session: b.session, icons: b.icons || [] };
        fillMissingIcons();
        refreshSuggestions();
        changed();
        return json({});
      }
      if (b.session !== live.session)
        throw Error("Waiting for profile inventory");
      if (route === "/ext/result") {
        pending.get(b.key)?.(b);
        pending.delete(b.key);
        return json({});
      }
      if (route === "/ext/poll") {
        if (!queued)
          await delay(
            12000,
            (f) => (waiting = f),
            (f) => {
              if (waiting === f) waiting = null;
            },
          );
        const c = queued;
        queued = null;
        return json(c || {});
      }
    }
    if (route === "/state") {
      if (b.version === version)
        await delay(
          12000,
          (f) => clients.add(f),
          (f) => clients.delete(f),
        );
      return json(view());
    }
    if (route === "/suggestions/refresh") {
      refreshSuggestions();changed();
      return json({updated:db.daily.updated,windows:candidates.length});
    }
    if (route === "/suggestions/keep") {
      const tabs=validateSuggestions(b);
      for(const choice of b.target.suggestions) {
        const saved=tabs.filter(t=>t.window===choice.window);
        db.sets.unshift({id:randomUUID(),name:choice.name || "Kept window",tabs:saved,session:live.session,
          kept:{window:choice.window,content:contentKey(saved)}});
      }
      save();refreshSuggestions();changed();
      return json({saved:b.target.suggestions.length});
    }
    if (route === "/views") {
      if (!b.name?.trim()) throw Error("Name the view");
      db.views = db.views.filter((v) => v.name !== b.name);
      db.views.push({ name: b.name, view: b.view });
      save();
      changed();
      return json({});
    }
    if (route === "/detail")
      return json(
        db.history.find((h) => h.id === b.id) ||
          db.sets.find((s) => s.id === b.id) ||
          {},
      );
    if (route === "/batch") return json(start(b));
    if (route === "/preview") {
      if (job || b.session !== live.session) throw Error("Preview temporarily unavailable.");
      const tab = currentTabs([b.tab])[0];
      const result = await command({op:"preview", tab:{id:tab.id,url:tab.url}});
      if (!result?.image?.startsWith("data:image/jpeg;base64,")) throw Error("Reload the Sunshine Tabs extension to enable previews.");
      res.setHeader("Cache-Control","no-store");
      return json(result);
    }
    if (route === "/rename-group") {
      if (job) throw Error("Wait for the current batch to finish");
      if (b.session !== live.session) throw Error("Chrome session changed");
      const group = live.groups.find(g => g.id === b.id && g.window === b.window);
      if (!group || typeof b.title !== "string") throw Error("Invalid tab group or name");
      return json(await command({op:"rename-group", id:group.id, window:group.window, title:b.title}));
    }
    if (route === "/focus") {
      if (job) throw Error("Wait for the batch to finish to switch tabs");
      if (b.session !== live.session) throw Error("Chrome session changed");
      return json(await command({ op: "focus", tab: currentTabs([b.tab])[0] }));
    }
    json({}, 404);
  } catch (e) {
    json({ error: e.message }, 400);
  }
});
server.listen(port, "127.0.0.1", () => {
  host = "127.0.0.1:" + server.address().port;
  origin = "http://" + host;
  for (const h of db.history)
    if (h.running) {
      h.running = false;
      h.interrupted = true;
      save();
    }
  console.log("Tab Dashboard • " + origin);
});
