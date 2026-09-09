// Public, immutable catalogue assets. Kept separately from authenticated documents.
export const MACHINE_IMAGE_CACHE = "nahuitech-machine-images-v1";

export async function cacheMachineImage(url: string, refresh = false): Promise<Response> {
  const cache = typeof caches !== "undefined" ? await caches.open(MACHINE_IMAGE_CACHE) : null;
  const cached = await cache?.match(url);
  if (cached && !refresh) return cached;
  try {
    const response = await fetch(url, { cache: "reload", signal: AbortSignal.timeout(15000) });
    if (!response.ok || response.type === "opaque") throw new Error("Imagen no disponible");
    if (cache) await cache.put(url, response.clone());
    return response;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

export async function loadMachineImageBytes(url: string | null): Promise<Uint8Array | undefined> {
  if (!url) return undefined;
  try {
    const response = await cacheMachineImage(url);
    const blob = await response.blob();
    if (blob.type !== "image/webp") return new Uint8Array(await blob.arrayBuffer());
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      return png ? new Uint8Array(await png.arrayBuffer()) : undefined;
    } finally { bitmap.close(); }
  } catch { return undefined; }
}
