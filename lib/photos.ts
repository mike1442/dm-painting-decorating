// Photo library rules shared by the admin page and the server. The database
// (supabase/site-photos.sql) enforces the same limits independently.

export const PHOTO_CATEGORIES = [
  ["interior", "Interior painting"],
  ["woodwork", "Woodwork & detailing"],
  ["exterior", "Exterior decorating"],
  ["whole-house", "Whole-house decorating"],
  ["before-after", "Before & after"],
  ["other", "Other"],
] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number][0];
export const categoryLabel = (category: string) => PHOTO_CATEGORIES.find(([value]) => value === category)?.[1] ?? "Other";

/** Main images are at most 1600 px wide (and three times as tall); thumbnails 480 px. */
export const MAIN_MAX_WIDTH = 1600;
export const MAIN_MAX_HEIGHT = 4800;
export const THUMB_MAX_WIDTH = 480;
export const THUMB_MAX_HEIGHT = 1440;
export const MAX_TITLE_LENGTH = 120;
export const MAX_ALT_LENGTH = 250;
// Vercel refuses request bodies over 4.5 MB. Larger photos are shrunk in the
// browser first (lib/admin/photo-prepare.ts), so every upload fits.
export const MAX_PHOTO_UPLOAD_BYTES = 4_000_000;
export const MAX_PHOTO_REQUEST_BYTES = 4_400_000;
export const PHOTO_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type Photo = {
  id: string;
  fileName: string;
  title: string;
  altText: string;
  category: PhotoCategory;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  bytes: number;
  thumbBytes: number;
  createdAt: string;
  updatedAt: string;
  /** Permanent public HTTPS address of the main image. */
  url: string;
  thumbUrl: string;
};

/** One line of plain text: no control characters, single spaces, trimmed. */
function plainText(value: unknown) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim() : "";
}

export type PhotoDetails = { title: string; altText: string; category: PhotoCategory };

export function photoDetails(input: { title?: unknown; altText?: unknown; category?: unknown }): { ok: true; details: PhotoDetails } | { ok: false; error: string } {
  const title = plainText(input.title);
  const altText = plainText(input.altText);
  const category = input.category === undefined || input.category === null || input.category === "" ? "other" : input.category;
  if (!title) return { ok: false, error: "Give the photo a short title, for example “Hallway repaint in Stockton Heath”." };
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, error: `Keep the title under ${MAX_TITLE_LENGTH} characters.` };
  if (altText.length > MAX_ALT_LENGTH) return { ok: false, error: `Keep the description under ${MAX_ALT_LENGTH} characters.` };
  if (!PHOTO_CATEGORIES.some(([value]) => value === category)) return { ok: false, error: "Choose a category from the list." };
  return { ok: true, details: { title, altText, category: category as PhotoCategory } };
}

/**
 * A descriptive, search-friendly file name from a title:
 * "Hallway repaint – Stockton Heath" becomes "hallway-repaint-stockton-heath".
 */
export function photoSlug(title: string) {
  const words = title
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let slug = words;
  // Leave room for a "-2" style suffix, and cut at a word boundary.
  if (slug.length > 60) {
    const cut = slug.slice(0, 61);
    const boundary = cut.lastIndexOf("-");
    slug = boundary > 0 ? cut.slice(0, boundary) : cut.slice(0, 60);
  }
  return PHOTO_NAME.test(slug) ? slug : "photo";
}

/** Whether a stored file name was made from this slug (itself, or with a numeric or random suffix). */
export function nameFromSlug(fileName: string, slug: string) {
  return fileName === slug || (fileName.startsWith(`${slug}-`) && /^(\d+|[0-9a-f]{8})$/.test(fileName.slice(slug.length + 1)));
}

export function formatBytes(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
