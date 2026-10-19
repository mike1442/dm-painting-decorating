import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { isWebp, photoFormat, PhotoError, processPhoto } from "../../lib/server/photo-processing.ts";

/** A landscape photo whose left half is red and right half blue, as a camera stores it. */
async function cameraPhoto({ width = 3000, height = 2000, orientation, format = "jpeg" }: { width?: number; height?: number; orientation?: number; format?: "jpeg" | "png" | "webp" } = {}) {
  const half = Math.round(width / 2);
  let image = sharp({ create: { width, height, channels: 3, background: "#0000ff" } })
    .composite([{ input: { create: { width: half, height, channels: 3, background: "#ff0000" } }, left: 0, top: 0 }]);
  if (orientation) {
    image = sharp(await image.png().toBuffer())
      .withMetadata({ orientation })
      .withExif({ IFD0: { Copyright: "PRIVATE-EXIF-MARKER" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "53/1 23/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "2/1 35/1 0/1" } });
  }
  return image.toFormat(format, { quality: 90 }).toBuffer();
}

const colourAt = async (webp: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(webp).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (Math.round(y * (info.height - 1)) * info.width + Math.round(x * (info.width - 1))) * info.channels;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
};

test("a sideways phone photo is turned upright, shrunk to 1600 px and stored as genuine WebP without metadata", async () => {
  const original = await cameraPhoto({ orientation: 6 });
  assert.equal((await sharp(original).metadata()).orientation, 6, "fixture carries the camera orientation tag");
  assert.match(original.toString("latin1"), /PRIVATE-EXIF-MARKER/);

  const { main, thumb } = await processPhoto(original);
  // Orientation 6 displays the stored 3000 × 2000 landscape as a 2000 × 3000 portrait.
  assert.deepEqual([main.width, main.height], [1600, 2400]);
  assert.deepEqual([thumb.width, thumb.height], [480, 720]);
  // The stored left (red) half becomes the top once the photo is upright.
  const top = await colourAt(main.data, 0.5, 0.05);
  const bottom = await colourAt(main.data, 0.5, 0.95);
  assert.ok(top.r > 200 && top.b < 60, "red half is at the top");
  assert.ok(bottom.b > 200 && bottom.r < 60, "blue half is at the bottom");

  for (const rendition of [main, thumb]) {
    assert.equal(isWebp(rendition.data), true);
    assert.equal(rendition.data.toString("ascii", 0, 4), "RIFF");
    assert.equal(rendition.data.toString("ascii", 8, 12), "WEBP");
    const metadata = await sharp(rendition.data).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined, "EXIF, including GPS location, is removed");
    assert.equal(metadata.orientation, undefined, "pixels are rotated rather than tagged");
    assert.equal(rendition.data.includes("PRIVATE-EXIF-MARKER"), false);
  }
  assert.ok(main.data.length < original.length, "the website image is much smaller than the camera file");
});

test("aspect ratios are kept and small photos are never enlarged", async () => {
  const wide = await processPhoto(await cameraPhoto({ width: 2400, height: 1600, format: "webp" }));
  assert.deepEqual([wide.main.width, wide.main.height], [1600, 1067]);
  assert.deepEqual([wide.thumb.width, wide.thumb.height], [480, 320]);

  const small = await processPhoto(await cameraPhoto({ width: 800, height: 600, format: "png" }));
  assert.deepEqual([small.main.width, small.main.height], [800, 600]);
  assert.deepEqual([small.thumb.width, small.thumb.height], [480, 360]);

  // A very tall image is also limited in height (three times the width limit).
  const tall = await processPhoto(await cameraPhoto({ width: 1000, height: 6000, format: "png" }));
  assert.deepEqual([tall.main.width, tall.main.height], [800, 4800]);
  assert.deepEqual([tall.thumb.width, tall.thumb.height], [240, 1440]);
});

test("transparent PNGs keep their transparency as WebP", async () => {
  const logo = await sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0 } } }).png().toBuffer();
  const { main } = await processPhoto(logo);
  const metadata = await sharp(main.data).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.hasAlpha, true);
});

test("files are identified by their bytes, and anything else is refused before decoding", async () => {
  const refuse = async (bytes: Buffer, message: RegExp, status = 415) => {
    await assert.rejects(processPhoto(bytes), (error: unknown) => error instanceof PhotoError && error.status === status && message.test(error.message));
  };
  assert.equal(photoFormat(await cameraPhoto({ width: 40, height: 30 })), "jpeg");
  assert.equal(photoFormat(await cameraPhoto({ width: 40, height: 30, format: "png" })), "png");
  assert.equal(photoFormat(await cameraPhoto({ width: 40, height: 30, format: "webp" })), "webp");
  await refuse(Buffer.from("<html><script>alert(1)</script></html>"), /not a photo we can use/);
  await refuse(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>'), /not a photo we can use/);
  await refuse(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer(), /not a photo we can use/);
  // Right signature, damaged content.
  await refuse(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]), /could not be read/);
  // An iPhone HEIC this server cannot decode gets advice instead of a failure.
  await refuse(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(2000, 1)]), /HEIC photo could not be converted/);
  assert.equal(isWebp(await cameraPhoto({ width: 40, height: 30 })), false, "a JPEG is not WebP whatever it is called");
  assert.equal(isWebp(Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBP")), false, "a header alone is not a WebP file");
});
