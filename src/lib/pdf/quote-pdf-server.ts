import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

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
  if (!imageUrl?.startsWith("/machines/")) return undefined;

  const filename = imageUrl.slice("/machines/".length);
  if (!/^[a-z0-9-]+\.(?:png|jpe?g)$/i.test(filename)) return undefined;

  try {
    return new Uint8Array(await readFile(path.join(machinesDirectory, filename)));
  } catch {
    return undefined;
  }
}

export async function generateQuotePdfOnServer(snapshot: QuotePdfSnapshot) {
  const [logoBytes, machineImageBytes] = await Promise.all([
    loadCroppedLogo(),
    loadLocalMachineImage(snapshot.machine.imageUrl),
  ]);
  return generateQuotePdf(snapshot, { logoBytes, machineImageBytes });
}
