import { MAX_PHOTO_REQUEST_BYTES, MAX_PHOTO_UPLOAD_BYTES, photoDetails } from "@/lib/photos";
import { PhotoError } from "@/lib/server/photo-error";
import { listPhotos, uploadPhoto } from "@/lib/server/photos";
import { json, photoFailure, requireAdmin } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Converting a large phone photo takes a few seconds; leave room for a slow upstream.
export const maxDuration = 60;

export async function GET() {
  try {
    return json({ photos: await listPhotos(await requireAdmin()) });
  } catch (error) { return photoFailure(error); }
}

/** One photo per request (multipart: photo, title, altText, category), converted to WebP on the server. */
export async function POST(request: Request) {
  try {
    const token = await requireAdmin(request);
    if (Number(request.headers.get("content-length") || 0) > MAX_PHOTO_REQUEST_BYTES) throw new PhotoError("This photo is too large to upload. Please choose a smaller photo.", 413);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new PhotoError("Please choose a photo to upload.");
    let form: FormData;
    try { form = await request.formData(); }
    catch { throw new PhotoError("The photo did not arrive in one piece. Please try again."); }
    const file = form.get("photo");
    if (!(file instanceof File) || !file.size) throw new PhotoError("Please choose a photo to upload.");
    if (file.size > MAX_PHOTO_UPLOAD_BYTES) throw new PhotoError("This photo is too large to upload. Please choose a smaller photo.", 413);
    const checked = photoDetails({ title: form.get("title"), altText: form.get("altText"), category: form.get("category") });
    if (!checked.ok) throw new PhotoError(checked.error);
    return json({ photo: await uploadPhoto(token, new Uint8Array(await file.arrayBuffer()), checked.details) }, 201);
  } catch (error) { return photoFailure(error); }
}
