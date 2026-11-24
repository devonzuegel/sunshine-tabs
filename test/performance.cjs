const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path");
const origin = "http://127.0.0.1:47381",
  mode = process.argv[2] || "live";
async function main() {
  const res = await fetch(origin + "/state", {
    method: "POST",
    headers: { Origin: origin, "X-Tab-Bridge": "1" },
    body: "{}",
  });
  const snapshot = await res.json();
  if (!snapshot.connected) throw Error("Connect regular Chrome first");
  let server,
    base = origin,
    requests = 0;
  if (mode !== "live") {
    const original = snapshot.tabs.slice(),
      count = mode === "255" ? 255 : 500;
    snapshot.tabs = snapshot.tabs.slice(0, count);
    while (snapshot.tabs.length < count) {
      const i = snapshot.tabs.length,
        t = original[i % original.length];
      snapshot.tabs.push({
        ...t,
        id: -i - 1,
        window: -1 - (i % 4),
        title: t.title + " " + i,
        index: Math.floor(i / 4),
      });
    }
    const root =
      process.env.TAB_DESK_PUBLIC || path.join(__dirname, "../public");
    server = http.createServer(async (req, res) => {
      if (req.url === "/state") {
        let payload = "";
        for await (const part of req) payload += part;
        if (JSON.parse(payload).version) {
          await new Promise((r) => setTimeout(r, mode === "load" ? 90 : 12000));
          if (res.destroyed) return;
        }
        if (mode === "load") {
          snapshot.version++;
          snapshot.history = [
            {
              id: "sample",
              op: "move",
              time: Date.now(),
              total: 500,
              done: snapshot.version % 500,
              ok: snapshot.version % 500,
              running: true,
            },
          ];
        }
        requests++;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(snapshot));
        return;
      }
      const name = {
        "/": "index.html",
        "/app.js": "app.js",
        "/model.js": "model.js",
        "/style.css": "style.css",
      }[req.url];
      if (!name) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader(
        "Content-Type",
        name.endsWith("js")
          ? "text/javascript"
          : name.endsWith("css")
            ? "text/css"
            : "text/html",
      );
      res.end(fs.readFileSync(path.join(root, name)));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = "http://127.0.0.1:" + server.address().port;
  }
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1080, height: 820 },
    });
    await ctx.addInitScript((load) => {
      window.reads = 0;
      if (load)
        Object.defineProperty(document, "modelContext", {
          value: {
            registerTool(t) {
              if (t.name === "inspect_candidates")
                setInterval(async () => {
                  await t.execute({ offset: 0, limit: 20 });
                  window.reads++;
                }, 110);
            },
          },
        });
      window.painted = new Promise((resolve) => {
        const mo = new MutationObserver(() => {
          if (document.querySelector(".row")) {
            mo.disconnect();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now())),
            );
          }
        });
        mo.observe(document, { subtree: true, childList: true });
      });
    }, mode === "load");
    const page = await ctx.newPage(),
      warm = [];
    await page.goto(base);
    const cold = await page.evaluate(() => window.painted);
    for (let i = 0; i < 35; i++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      warm.push(await page.evaluate(() => window.painted));
    }
    const result = await page.evaluate(async () => {
      const times = { sort: [], filter: [], selection: [] },
        q = document.querySelector("#search");
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      for (let i = 0; i < 50; i++)
        for (const what of Object.keys(times)) {
          await frame();
          const start = performance.now();
          if (what === "sort") document.querySelector("#direction").click();
          if (what === "filter") {
            q.value = i % 2 ? "" : "a";
            q.dispatchEvent(new Event("input"));
          }
          if (what === "selection") document.querySelector("#all").click();
          await frame();
          await frame();
          times[what].push(performance.now() - start);
        }
      return { times, reads: window.reads };
    });
    const p95 = Object.fromEntries(
      Object.entries({ warm, ...result.times }).map(([k, v]) => [
        k,
        Number(
          v.sort((a, b) => a - b)[Math.ceil(0.95 * v.length) - 1].toFixed(1),
        ),
      ]),
    );
    console.log(
      JSON.stringify({
        mode,
        rows: snapshot.tabs.length,
        windows: new Set(snapshot.tabs.map((t) => t.window)).size,
        coldMs: Math.round(cold),
        p95,
        simulatedChatReads: result.reads,
        fixtureResponses: requests,
      }),
    );
  } finally {
    await browser.close();
    server?.closeAllConnections();
    server?.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
