import { nameFromSlug, PHOTO_NAME, photoSlug, type Photo, type PhotoDetails } from "../photos.ts";
import { processPhoto } from "./photo-processing.ts";
import { adminRpc, BackendError, publicObjectUrl, supabaseRequest } from "./supabase.ts";

// Files go to Supabase Storage and metadata to the guarded photo functions,
// always with Mike's own access token: Storage and database policies check his
// live admin session on every call. No service-role key exists in this app.
export const PHOTO_BUCKET = "site-photos";
const mainFile = (name: string) => `${name}.webp`;
const thumbFile = (name: string) => `thumbs/${name}.webp`;
// File names are never reused (see supabase/site-photos.sql), so browsers and
// the CDN may keep a photo for a year.
const CACHE_CONTROL = "max-age=31536000";

type PhotoRecord = Omit<Photo, "url" | "thumbUrl">;

function withUrls(record: PhotoRecord): Photo {
  if (!record || typeof record !== "object" || typeof record.fileName !== "string" || !PHOTO_NAME.test(record.fileName)) throw new BackendError(502, "response");
  return { ...record, url: publicObjectUrl(PHOTO_BUCKET, mainFile(record.fileName)), thumbUrl: publicObjectUrl(PHOTO_BUCKET, thumbFile(record.fileName)) };
}

export async function listPhotos(token: string): Promise<Photo[]> {
  const records: unknown = await adminRpc(token, "dm_list_photos");
  if (!Array.isArray(records)) throw new BackendError(502, "response");
  return records.map(withUrls);
}

async function reserveName(token: string, title: string) {
  const name: unknown = await adminRpc(token, "dm_reserve_photo_name", { p_base: photoSlug(title) });
  if (typeof name !== "string" || !PHOTO_NAME.test(name)) throw new BackendError(502, "response");
  return name;
}

async function putFile(token: string, path: string, data: Buffer) {
  await supabaseRequest(`/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
    token, method: "POST", body: new Uint8Array(data),
    headers: { "Content-Type": "image/webp", "Cache-Control": CACHE_CONTROL, "x-upsert": "true" },
  });
}

async function moveFile(token: string, from: string, to: string) {
  await supabaseRequest("/storage/v1/object/move", { token, method: "POST", body: { bucketId: PHOTO_BUCKET, sourceKey: from, destinationKey: to } });
}

/** Removing files that are already gone succeeds, so a repeated delete is harmless. */
async function removeFiles(token: string, name: string) {
  await supabaseRequest(`/storage/v1/object/${PHOTO_BUCKET}`, { token, method: "DELETE", body: { prefixes: [mainFile(name), thumbFile(name)] } });
}

export async function uploadPhoto(token: string, bytes: Uint8Array, details: PhotoDetails): Promise<Photo> {
  // Convert first: an unusable photo is refused before anything is stored.
  const { main, thumb } = await processPhoto(bytes);
  const name = await reserveName(token, details.title);
  try {
    await putFile(token, thumbFile(name), thumb.data);
    await putFile(token, mainFile(name), main.data);
    return withUrls(await adminRpc(token, "dm_add_photo", { p_photo: {
      fileName: name, title: details.title, altText: details.altText, category: details.category,
      width: main.width, height: main.height, thumbWidth: thumb.width, thumbHeight: thumb.height, bytes: main.data.length, thumbBytes: thumb.data.length,
    } }));
  } catch (error) {
    // A lost answer may hide a saved photo; otherwise leave no unlisted public file behind.
    const saved = await listPhotos(token).then(photos => photos.find(photo => photo.fileName === name)).catch(() => undefined);
    if (saved) return saved;
    await removeFiles(token, name).catch(() => {});
    throw error;
  }
}

/**
 * Change a photo's title, description and category. Its web address stays the
 * same unless `renameFile` asks for a file name made from the new title; the
 * old address then stops working.
 */
export async function updatePhoto(token: string, id: string, details: PhotoDetails, renameFile: boolean): Promise<Photo> {
  const current = (await listPhotos(token)).find(photo => photo.id === id);
  if (!current) throw new BackendError(404, "P0002");
  let moved: string | null = null;
  if (renameFile && !nameFromSlug(current.fileName, photoSlug(details.title))) {
    const name = await reserveName(token, details.title);
    await moveFile(token, mainFile(current.fileName), mainFile(name));
    try { await moveFile(token, thumbFile(current.fileName), thumbFile(name)); }
    catch (error) {
      await moveFile(token, mainFile(name), mainFile(current.fileName)).catch(() => {});
      throw error;
    }
    moved = name;
  }
  try {
    return withUrls(await adminRpc(token, "dm_update_photo", { p_id: id, p_title: details.title, p_alt_text: details.altText, p_category: details.category, p_file_name: moved }));
  } catch (error) {
    if (moved) {
      await moveFile(token, mainFile(moved), mainFile(current.fileName)).catch(() => {});
      await moveFile(token, thumbFile(moved), thumbFile(current.fileName)).catch(() => {});
    }
    throw error;
  }
}

/** Files leave the public bucket first, so a failure never leaves an unlisted photo online. */
export async function deletePhoto(token: string, id: string) {
  const current = (await listPhotos(token)).find(photo => photo.id === id);
  if (!current) return;
  await removeFiles(token, current.fileName);
  await adminRpc(token, "dm_delete_photo", { p_id: id });
}
