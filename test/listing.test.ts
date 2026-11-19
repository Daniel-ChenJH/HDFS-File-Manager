import { test } from "node:test";
import assert from "node:assert/strict";
import { selectPage } from "../src/listing";
import { entry } from "./fixture";

test("sorts folders first with natural names and never mutates the source", () => {
  const items = [entry("/file10"), entry("/file2"), entry("/z-folder", true)];
  assert.deepEqual(
    selectPage(items, "", 0).items.map((x) => x.pathSuffix),
    ["z-folder", "file2", "file10"],
  );
  assert.equal(items[0].pathSuffix, "file10");
  assert.deepEqual(
    selectPage(items, "", 0, "name", true).items.map((x) => x.pathSuffix),
    ["z-folder", "file10", "file2"],
  );
});
test("filters only provided entries, clamps pages and sorts numeric columns", () => {
  const items = Array.from({ length: 601 }, (_, i) => ({
    ...entry("/file" + i),
    length: i,
    modificationTime: 601 - i,
  }));
  assert.equal(selectPage(items, "", 999).page, 12);
  assert.equal(selectPage(items, "", -1).page, 0);
  assert.equal(selectPage(items, "", NaN).page, 0);
  assert.equal(selectPage(items, "", 0, "size", true).items[0].length, 600);
  assert.equal(
    selectPage(items, "", 0, "modified").items[0].pathSuffix,
    "file600",
  );
  const filtered = selectPage(items, "FILE600", 4);
  assert.equal(filtered.count, 1);
  assert.equal(filtered.total, 601);
  assert.equal(filtered.page, 0);
  assert.deepEqual(selectPage(items, "missing", 1).items, []);
});
test("page sizes use the chosen count, clamp the final page and reject unsupported counts", () => {
  const items = Array.from({ length: 235 }, (_, i) => entry("/file" + i));
  for (const size of [10, 20, 50, 100, 200]) {
    const first = selectPage(items, "", 0, "name", false, size);
    const last = selectPage(items, "", 9999, "name", false, size);
    assert.equal(first.items.length, size);
    assert.equal(last.items.length, 235 % size);
    assert.equal(last.pageSize, size);
    assert.equal(last.page, Math.ceil(235 / size) - 1);
  }
  assert.equal(selectPage(items, "", 0, "name", false, 5000).items.length, 50);
  assert.equal(selectPage([], "", 5, "name", false, 10).page, 0);
});
