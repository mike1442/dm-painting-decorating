import { MAX_PHOTO_UPLOAD_BYTES } from "../photos.ts";

// Runs in the browser before an upload. Photos that already fit are sent
// untouched and converted on the server. Larger photos, and HEIC photos (which
// the server cannot decode), are redrawn here first: the browser applies the
// camera's orientation while drawing, and the server does the final WebP
// conversion either way.

export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;
const HEIC_UNSUPPORTED = "This browser cannot open HEIC photos. Use Safari on an iPhone or Mac, or choose a JPG copy of the photo.";

export function photoKind(file: { type: string; name: string }): "jpeg" | "png" | "webp" | "heic" | null {
  const type = file.type.toLowerCase();
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (type === "image/jpeg" || type === "image/jpg") return "jpeg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic" || type === "image/heif" || type === "image/heic-sequence" || type === "image/heif-sequence") return "heic";
  // Some browsers report no type for HEIC files; fall back to the extension then.
  if (type && type !== "application/octet-stream") return null;
  return ({ jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", heic: "heic", heif: "heic" } as const)[extension as "jpg"] ?? null;
}

/** Returns the file to upload: the original, or a high-quality JPEG small enough to send. */
export async function preparePhoto(file: File): Promise<File> {
  const kind = photoKind(file);
  if (!kind) throw new Error("Please choose a JPG, PNG, WEBP or HEIC photo.");
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error("This photo is over 50 MB. Please choose a smaller photo.");
  if (kind !== "heic" && file.size <= MAX_PHOTO_UPLOAD_BYTES) return file;

  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(kind === "heic" ? HEIC_UNSUPPORTED : "This photo could not be opened in this browser. Please choose a JPG copy of it."));
      image.src = url;
    });
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photos cannot be resized in this browser. Please choose a smaller photo.");
    // 1.5 times the website size leaves the server room for a sharp final resize.
    for (const [width, quality] of [[2400, 0.9], [2000, 0.86], [1600, 0.82]] as const) {
      const scale = Math.min(1, width / image.naturalWidth, (width * 3) / image.naturalHeight);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      // JPEG has no transparency: transparent areas of a large PNG become white.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_PHOTO_UPLOAD_BYTES) return new File([blob], file.name.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" });
    }
    throw new Error("This photo is too large to upload. Please choose a smaller photo.");
  } finally {
    URL.revokeObjectURL(url);
    // Release the canvas memory straight away; phones have little to spare.
    canvas.width = 0;
    canvas.height = 0;
  }
}
