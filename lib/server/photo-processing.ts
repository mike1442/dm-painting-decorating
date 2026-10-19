import sharp from "sharp";
import { MAIN_MAX_HEIGHT, MAIN_MAX_WIDTH, THUMB_MAX_HEIGHT, THUMB_MAX_WIDTH } from "../photos.ts";
import { PhotoError } from "./photo-error.ts";

export { PhotoError };

export type Rendition = { data: Buffer; width: number; height: number };

/** Largest image decoded (10,000 × 10,000). Phone cameras stay well below it. */
const MAX_INPUT_PIXELS = 100_000_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const UNREADABLE = "This photo could not be read. It may be damaged or in an unusual format. Please choose a JPG, PNG, WEBP or HEIC photo.";
const HEIC_UNSUPPORTED = "This HEIC photo could not be converted here. Upload it from Safari on an iPhone or Mac, or choose a JPG copy of it.";

/**
 * Identify a photo by its bytes, never its name or declared type. Only these
 * formats reach the decoder, so SVG, HTML or other active content cannot.
 */
export function photoFormat(bytes: Uint8Array): "jpeg" | "png" | "webp" | "heif" | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (isWebp(buffer)) return "webp";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp"
    && ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif"].includes(buffer.toString("ascii", 8, 12))) return "heif";
  return null;
}

/** A real WebP file starts with a RIFF header whose form type is WEBP. */
export function isWebp(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return buffer.length >= 16 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP"
    && buffer.readUInt32LE(4) + 8 === buffer.length;
}

/**
 * Turn an uploaded photo into a website main image (at most 1600 px wide) and
 * a thumbnail (at most 480 px wide), both genuinely encoded as WebP:
 * - turned the right way up from the camera's orientation tag;
 * - converted to sRGB with all metadata removed, including GPS location;
 * - scaled down only, never up, keeping the original aspect ratio.
 */
export async function processPhoto(bytes: Uint8Array): Promise<{ main: Rendition; thumb: Rendition }> {
  const format = photoFormat(bytes);
  if (!format) throw new PhotoError("This file is not a photo we can use. Please choose a JPG, PNG, WEBP or HEIC photo.", 415);
  // Lenient about the minor warnings some phone cameras write, strict about real errors.
  const source = () => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).autoOrient();
  const render = async (width: number, height: number, quality: number): Promise<Rendition> => {
    const { data, info } = await source()
      .resize({ width, height, fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 5 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  };
  let main: Rendition;
  let thumb: Rendition;
  try {
    const metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (metadata.format !== format) throw new PhotoError(UNREADABLE, 415);
    main = await render(MAIN_MAX_WIDTH, MAIN_MAX_HEIGHT, 80);
    thumb = await render(THUMB_MAX_WIDTH, THUMB_MAX_HEIGHT, 72);
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit/i.test(message)) throw new PhotoError("This photo is too large to process. Please choose one under 100 megapixels.", 413);
    throw new PhotoError(format === "heif" ? HEIC_UNSUPPORTED : UNREADABLE, 415);
  }
  // Prove the result is really WebP, within limits, before anything is stored.
  for (const [rendition, maxWidth, maxHeight] of [[main, MAIN_MAX_WIDTH, MAIN_MAX_HEIGHT], [thumb, THUMB_MAX_WIDTH, THUMB_MAX_HEIGHT]] as const) {
    const check = await sharp(rendition.data).metadata();
    if (!isWebp(rendition.data) || check.format !== "webp" || check.width !== rendition.width || check.height !== rendition.height
      || rendition.width > maxWidth || rendition.height > maxHeight) {
      throw new PhotoError("The photo could not be converted. Please try again.", 500);
    }
  }
  if (main.data.length > MAX_OUTPUT_BYTES) throw new PhotoError("This photo is too detailed to store. Please choose a smaller photo.", 413);
  return { main, thumb };
}
