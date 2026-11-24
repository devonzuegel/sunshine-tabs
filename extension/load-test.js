const marker = "about:blank#tab-desk-workload-",
  statusNode = document.querySelector("#status");
const create = document.querySelector("#create"),
  clear = document.querySelector("#clear");
async function run(fn) {
  create.disabled = clear.disabled = true;
  try {
    await fn();
  } catch (e) {
    statusNode.textContent = e.message;
  } finally {
    create.disabled = clear.disabled = false;
  }
}
const query = () => chrome.tabs.query({ windowType: "normal" });
create.onclick = () =>
  run(async () => {
    const initial = (await query()).filter((t) => !t.incognito).length;
    const runId = crypto.randomUUID(),
      needed = Math.max(0, 500 - initial);
    let w;
    for (let i = 0; i < needed; i++) {
      const url = marker + runId + "-" + i;
      if (i % 60 === 0) {
        w = await chrome.windows.create({ url, focused: false });
      } else {
        const t = await chrome.tabs.create({
          windowId: w.id,
          url,
          active: false,
        });
        await chrome.tabs.discard(t.id).catch(() => {});
      }
      if (i % 10 === 0)
        statusNode.textContent = "Created " + (i + 1) + " of " + needed;
    }
    statusNode.textContent =
      "Ready · " +
      (await query()).filter((t) => !t.incognito).length +
      " normal tabs";
  });
clear.onclick = () =>
  run(async () => {
    let n = 0;
    for (const t of await query()) {
      if ((t.pendingUrl || t.url || "").startsWith(marker)) {
        await chrome.tabs.remove(t.id);
        n++;
      }
    }
    statusNode.textContent = "Removed " + n + " disposable tabs";
  });
