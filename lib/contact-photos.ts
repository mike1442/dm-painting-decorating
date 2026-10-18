import { MAX_CONTACT_PHOTO_BYTES } from "./contact.ts";

async function resizePhoto(photo: File, budget: number): Promise<File> {
  if (photo.size <= budget) return photo;
  const url = URL.createObjectURL(photo);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This photo cannot be resized in your browser. Please choose a smaller photo or email it directly."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photos cannot be resized in this browser. Please email your photos directly.");
    for (const longestSide of [2000, 1500, 1100, 800]) {
      const scale = Math.min(1, longestSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
      if (blob && blob.size <= budget) return new File([blob], photo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }
    throw new Error("A photo is too large to send. Please choose a smaller photo or email it directly.");
  } finally { URL.revokeObjectURL(url); }
}

export async function prepareContactPhotos(photos: File[]) {
  const budget = Math.floor(MAX_CONTACT_PHOTO_BYTES / Math.max(1, photos.length));
  // Resize one at a time to keep memory use reasonable on phones.
  const prepared: File[] = [];
  for (const photo of photos) prepared.push(await resizePhoto(photo, budget));
  return prepared;
}
