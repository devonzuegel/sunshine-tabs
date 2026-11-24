import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
test("park persists before close, a partial result retries exactly the failed tab, and undo reopens successes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tab-desk-test-"));
  const server = spawn(
    process.execPath,
    [fileURLToPath(new URL("../server.mjs", import.meta.url))],
    {
      env: { ...process.env, TAB_DESK_DATA: dir, TAB_DESK_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    const [line] = await Promise.race([
      once(server.stdout, "data"),
      once(server, "exit").then(() => {
        throw Error("Test bridge failed to launch");
      }),
    ]);
    const origin = line.toString().trim().split(" ").at(-1);
    const ext = "chrome-extension://mopjfnfgfblcgbcohfepelmnjhflcagb";
    const session = "fixture",
      profile = "fixture";
    async function post(
      route,
      data,
      requestOrigin = route.startsWith("ext/") ? ext : origin,
    ) {
      const r = await fetch(origin + "/" + route, {
        method: "POST",
        headers: { Origin: requestOrigin, "X-Tab-Bridge": "1" },
        body: JSON.stringify({ session, profile, ...data }),
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error || String(r.status));
      return body;
    }
    const tabs = [1, 2].map((id) => ({
      id,
      url: "https://example.test/" + id,
      title: "Fixture",
      window: 3,
      group: -1,
      index: id - 1,
    }));
    await assert.rejects(
      () => post("state", {}, "https://example.test"),
      /403/,
    );
    await post("ext/state", { tabs, groups: [] });
    const first = await post("batch", {
      op: "park",
      items: tabs,
      target: { name: "Two" },
    });
    const stored = JSON.parse(
      await readFile(join(dir, "library.json"), "utf8"),
    );
    assert.equal(stored.sets[0].tabs.length, 2);
    async function result(id, op, value, error) {
      const c = await post("ext/poll", {});
      assert.equal(c.tab.id, id);
      assert.equal(c.op, op);
      await post("ext/result", { key: c.key, value, error });
    }
    await result(1, "close", {});
    await result(2, "close", undefined, "Chrome is busy");
    let h = await post("detail", first);
    assert.deepEqual(
      h.results.map((r) => r.ok),
      [true, false],
    );
    await assert.rejects(
      () => post("batch", { op: "retry", source: first.id, items: tabs }),
      /Review again/,
    );
    await post("batch", { op: "retry", source: first.id, items: [tabs[1]] });
    await result(2, "close", {});
    h = await post("detail", first);
    assert(h.results.every((r) => r.ok));
    await post("ext/state", { tabs: [], groups: [] });
    await post("batch", { op: "undo", source: first.id, items: tabs });
    await result(1, "reopen", { id: 4, window: 5, group: -1 });
    await result(2, "reopen", { id: 5, window: 5, group: -1 });
    assert((await post("detail", first)).results.every((r) => r.restored));
  } finally {
    if (server.exitCode === null) {
      const done = once(server, "exit");
      server.kill();
      await done;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
