import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  addMonths,
  daysBetween,
  formatLongDate,
  isIsoDate,
  monthGrid,
  startOfWeek,
  todayIso,
  weekDays,
} from "../../lib/admin/dates.ts";

test("validates ISO calendar dates", () => {
  assert.ok(isIsoDate("2026-10-17"));
  assert.ok(isIsoDate("2028-02-29"));
  assert.ok(!isIsoDate("2026-02-29"));
  assert.ok(!isIsoDate("2026-13-01"));
  assert.ok(!isIsoDate("17/10/2026"));
});

test("date arithmetic is unaffected by clock changes", () => {
  assert.equal(addDays("2026-10-24", 2), "2026-10-26");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(daysBetween("2026-10-01", "2026-10-31"), 30);
  assert.equal(addMonths("2026-01-31", 1), "2026-02-01");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-01");
});

test("weeks start on Monday", () => {
  assert.equal(startOfWeek("2026-10-17"), "2026-10-12");
  assert.equal(startOfWeek("2026-10-12"), "2026-10-12");
  assert.equal(startOfWeek("2026-10-18"), "2026-10-12");
  assert.deepEqual(weekDays("2026-10-17"), [
    "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18",
  ]);
});

test("month grid covers whole weeks", () => {
  const october = monthGrid("2026-10-17");
  assert.equal(october[0], "2026-09-28");
  assert.equal(october.length, 35);
  assert.equal(october.at(-1), "2026-11-01");
  const february = monthGrid("2027-02-10");
  assert.equal(february[0], "2027-02-01");
  assert.equal(february.length, 28);
  const august = monthGrid("2026-08-01");
  assert.equal(august.length, 42);
});

test("formats dates in British style", () => {
  assert.equal(formatLongDate("2026-10-17"), "17 October 2026");
  assert.equal(formatLongDate("not-a-date"), "");
  assert.equal(todayIso(new Date(2026, 9, 17, 23, 59)), "2026-10-17");
});
