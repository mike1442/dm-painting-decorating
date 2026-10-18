// Leave room for multipart headers and text below Vercel's 4.5 MB request limit.
export const MAX_CONTACT_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_CONTACT_REQUEST_BYTES = 4_400_000;
export const CONTACT_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
