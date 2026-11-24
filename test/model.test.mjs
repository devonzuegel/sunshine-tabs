import test from "node:test";
import assert from "node:assert/strict";
import {
  prepare,
  matches,
  duplicates,
  markdown,
  defaultView,
} from "../public/model.js";
const now = Date.now(),
  day = 86400000;
const make = (id, opened, touched, url) =>
  prepare({
    id,
    opened,
    touched,
    url,
    title: "Report [" + id + "]",
    window: id % 2,
    index: id,
  });
const rows = [
  make(1, null, now - 40 * day, "https://a.test/?id=1"),
  make(2, now, now - 10 * day, "https://b.test/"),
  make(3, now - day, now, "https://b.test/"),
];
test("time sorts leave unknown opens last in both directions, chrome order is stable", () => {
  const ids = (v) =>
    matches(rows, { ...defaultView, ...v }, now).map((t) => t.id);
  assert.deepEqual(ids({ sort: "opened" }), [2, 3, 1]);
  assert.deepEqual(ids({ sort: "opened", dir: 1 }), [3, 2, 1]);
  assert.deepEqual(ids({}), [2, 1, 3]);
  assert.deepEqual(ids({ sort: "order" }), [2, 1, 3]);
  assert.deepEqual(
    rows.map((t) => t.id),
    [1, 2, 3],
  );
});
test("saved relative views are evaluated against the current tabs and time", () => {
  const v = { ...defaultView, sort: "touched", age: "today", q: "report" };
  assert.deepEqual(
    matches(rows, v, now).map((t) => t.id),
    [2],
  );
  const newTab = make(4, now, now, "https://example.test/");
  assert.deepEqual(
    matches([...rows, newTab], v, now).map((t) => t.id),
    [4, 2],
  );
  assert.equal(matches(rows, v, now + 2 * day).length, 0);
  assert.equal(
    matches(rows, { ...defaultView, age: "30", q: "id=1" }, now).length,
    1,
  );
});
test("duplicate groups use exact URLs and Markdown escapes title brackets", () => {
  assert.deepEqual(
    duplicates(rows).map((g) => g.map((t) => t.id)),
    [[2, 3]],
  );
  assert.equal(markdown([rows[0]]), "[Report \\[1\\]](<https://a.test/?id=1>)");
});

test("window dates sort independently of matching tabs, with unknown creation last", async () => {
  const {windowDates, sortedWindows} = await import("../public/model.js");
  const dates = windowDates([{window:1,touched:90}, {window:1,windowTouched:85,touched:4},
    {window:2,windowCreated:40,windowTouched:80}, {window:3,windowCreated:20,touched:60}]);
  const windows = new Map([[2,[]],[1,[]],[3,[]]]);
  const ids = mode => sortedWindows(windows,dates,mode).map(([id])=>id);
  assert.deepEqual(ids("created-oldest"),[3,2,1]);
  assert.deepEqual(ids("created-newest"),[2,3,1]);
  assert.deepEqual(ids("touched-oldest"),[3,2,1]);
  assert.deepEqual(ids("touched-newest"),[1,2,3]);
});

test("revisiting a stale tab preserves its 30-day rank for exactly 30 seconds", async () => {
  const {revisitGrace} = await import("../public/model.js");
  const old = make(1, null, now-40*day, "https://a.test");
  const current = {...old,touched:now};
  current.grace = revisitGrace(old,current,now);
  const other = make(2,null,now-35*day,"https://b.test");
  const view = {...defaultView,sort:"touched",age:"30",dir:1};
  assert.deepEqual(matches([other,current],view,now+29999).map(t=>t.id),[1,2]);
  assert.deepEqual(matches([other,current],view,now+30000).map(t=>t.id),[2]);
  assert.equal(matches([current],{...view,age:"7"},now).length,0);
  assert.equal(revisitGrace(current,{...current,touched:now+5000},now+5000),current.grace);
});
