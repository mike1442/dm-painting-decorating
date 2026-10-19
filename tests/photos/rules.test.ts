import assert from "node:assert/strict";
import test from "node:test";
import { categoryLabel, nameFromSlug, PHOTO_NAME, photoDetails, photoSlug } from "../../lib/photos.ts";

test("titles become descriptive, search-friendly file names", () => {
  assert.equal(photoSlug("Hallway repaint – Stockton Heath"), "hallway-repaint-stockton-heath");
  assert.equal(photoSlug("Mike’s van & ladders"), "mikes-van-and-ladders");
  assert.equal(photoSlug("Crème brûlée kitchen, Hale"), "creme-brulee-kitchen-hale");
  assert.equal(photoSlug("  ../../etc/passwd  "), "etc-passwd");
  assert.equal(photoSlug("IMG_2034.HEIC"), "img-2034-heic");
  assert.equal(photoSlug("!!!"), "photo");
  assert.equal(photoSlug("日本の家"), "photo");
  const long = photoSlug("Before and after photographs of a complete whole house redecoration project in Lymm village");
  assert.ok(long.length <= 60 && PHOTO_NAME.test(long), long);
  assert.equal(long, "before-and-after-photographs-of-a-complete-whole-house");
  assert.equal(photoSlug("x".repeat(90)).length, 60);
});

test("a renamed photo only moves when its title gives a different file name", () => {
  assert.equal(nameFromSlug("hallway", "hallway"), true);
  assert.equal(nameFromSlug("hallway-2", "hallway"), true);
  assert.equal(nameFromSlug("hallway-1a2b3c4d", "hallway"), true);
  assert.equal(nameFromSlug("hallway-stairs", "hallway"), false);
  assert.equal(nameFromSlug("kitchen", "hallway"), false);
});

test("photo details are plain, bounded text with a known category", () => {
  assert.deepEqual(photoDetails({ title: "  Hallway \n\t repaint\u0000 ", altText: " Freshly  painted hallway ", category: "interior" }),
    { ok: true, details: { title: "Hallway repaint", altText: "Freshly painted hallway", category: "interior" } });
  assert.deepEqual(photoDetails({ title: "Van" }), { ok: true, details: { title: "Van", altText: "", category: "other" } });
  assert.equal(photoDetails({ title: "   " }).ok, false);
  assert.equal(photoDetails({ title: "x".repeat(121) }).ok, false);
  assert.equal(photoDetails({ title: "x", altText: "y".repeat(251) }).ok, false);
  assert.equal(photoDetails({ title: "x", category: "admin" }).ok, false);
  assert.equal(photoDetails({ title: 42 }).ok, false);
  assert.equal(categoryLabel("before-after"), "Before & after");
  assert.equal(categoryLabel("unknown"), "Other");
});
