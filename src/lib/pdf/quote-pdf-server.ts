import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { snapshotItems } from "../quotes/items";
import { generateQuotePdf } from "./quote-pdf";
import type { QuotePdfSnapshot } from "./quote-pdf-types";

const logoFilePath = path.join(
  process.cwd(),
  "public",
  "brand",
  "NAHUITECH LOGO.png"
);
const machinesDirectory = path.join(process.cwd(), "public", "machines");

/**
 * Uses the same browser-ready PDF composition code with the local brand asset.
 * The quote snapshot is supplied by the caller; this module never queries Supabase.
 */
async function loadCroppedLogo() {
  const source = await readFile(logoFilePath);
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3] ?? 255;
    const isVisibleMark = alpha > 15 && (red < 245 || green < 245 || blue < 245);
    if (!isVisibleMark) continue;

    const pixelIndex = index / info.channels;
    const x = pixelIndex % info.width;
    const y = Math.floor(pixelIndex / info.width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }

  if (right < left || bottom < top) return new Uint8Array(source);

  const padding = 12;
  const cropLeft = Math.max(0, left - padding);
  const cropTop = Math.max(0, top - padding);
  const cropWidth = Math.min(info.width - cropLeft, right - left + padding * 2 + 1);
  const cropHeight = Math.min(info.height - cropTop, bottom - top + padding * 2 + 1);
  return new Uint8Array(
    await sharp(source)
      .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
      .png()
      .toBuffer()
  );
}

async function loadLocalMachineImage(imageUrl: string | null): Promise<Uint8Array | undefined> {
  if (!imageUrl) return undefined;
  if (!imageUrl.startsWith("/machines/")) {
    try {
      const url = new URL(imageUrl);
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!base || url.origin !== new URL(base).origin ||
        !url.pathname.startsWith("/storage/v1/object/public/machine-images/")) return undefined;
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) return undefined;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 8 * 1024 * 1024) return undefined;
      return new Uint8Array(await sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000 }).png().toBuffer());
    } catch { return undefined; }
  }

  const filename = imageUrl.slice("/machines/".length);
  if (!/^[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(filename)) return undefined;

  try {
    const bytes = await readFile(path.join(machinesDirectory, filename));
    return new Uint8Array(await sharp(bytes).png().toBuffer());
  } catch {
    return undefined;
  }
}

export async function generateQuotePdfOnServer(snapshot: QuotePdfSnapshot) {
  const [logoBytes, machineImageBytes] = await Promise.all([
    loadCroppedLogo(),
    loadLocalMachineImage(snapshot.machine.imageUrl),
  ]);
  const itemImageBytes = await Promise.all(snapshotItems(snapshot).map(async (item) => (await loadLocalMachineImage(item.machine.imageUrl)) ?? new Uint8Array()));
  return generateQuotePdf(snapshot, { logoBytes, machineImageBytes: machineImageBytes ?? new Uint8Array(), itemImageBytes });
}
