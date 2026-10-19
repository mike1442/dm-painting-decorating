import { photoDetails } from "@/lib/photos";
import { PhotoError } from "@/lib/server/photo-error";
import { deletePhoto, updatePhoto } from "@/lib/server/photos";
import { json, photoFailure, readBody, requireAdmin } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function photoId(context: Context) {
  const { id } = await context.params;
  if (!UUID.test(id)) throw new PhotoError("This photo no longer exists. Reload the page.", 404);
  return id;
}

/** Rename, describe or recategorise a photo; `renameFile` also gives it a new web address. */
export async function PATCH(request: Request, context: Context) {
  try {
    const token = await requireAdmin(request);
    const id = await photoId(context);
    const body = await readBody(request, 4000);
    const checked = photoDetails({ title: body?.title, altText: body?.altText, category: body?.category });
    if (!checked.ok) throw new PhotoError(checked.error);
    return json({ photo: await updatePhoto(token, id, checked.details, body?.renameFile === true) });
  } catch (error) { return photoFailure(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const token = await requireAdmin(request);
    await deletePhoto(token, await photoId(context));
    return json({});
  } catch (error) { return photoFailure(error); }
}
