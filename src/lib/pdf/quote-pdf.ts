import { snapshotItems } from "../quotes/items";
import {
  quoteCommercialInfo,
  quoteCommercialInfoLabels,
} from "../../config/quote-commercial-info";
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from "pdf-lib";

import { hexToRgb, quotePdfBrand } from "./quote-pdf-brand";
import type { QuotePdfAddon, QuotePdfSnapshot } from "./quote-pdf-types";
import { calculateIncludedTaxBreakdown, grossToNet, netDiscount } from "../quotes/tax";
import { cacheMachineImage, loadMachineImageBytes } from "../offline/machine-image-cache";

const logoPath = "/brand/NAHUITECH%20LOGO.png";
const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 40;
const footerHeight = 26;
const contentBottom = margin + footerHeight;

type PdfKit = typeof import("pdf-lib");

type DrawingContext = {
  pdf: PdfKit;
  document: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  logo: PDFImage;
  machineImage: PDFImage | null;
  cursorY: number;
};

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function asMoney(value: number) {
  return `${moneyFormatter.format(value)} MXN`;
}

function rgbFromHex(pdf: PdfKit, hex: string) {
  const color = hexToRgb(hex);
  return pdf.rgb(color.red, color.green, color.blue);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

async function loadCroppedLogo(): Promise<Uint8Array> {
  const response = await cacheMachineImage(logoPath);
  if (!response.ok) throw new Error("No se pudo cargar el logotipo de Nahuitech.");
  // Preserve the complete source artwork; automatic alpha-bound cropping could clip the logo mark.
  return new Uint8Array(await (await response.blob()).arrayBuffer());

  const source = URL.createObjectURL(await response.blob());

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("No se pudo leer el logotipo de Nahuitech."));
      element.src = source;
    });
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true })!;
    if (!sourceContext) throw new Error("No se pudo procesar el logotipo de Nahuitech.");

    sourceContext.drawImage(image, 0, 0);
    const pixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
    let left = sourceCanvas.width;
    let top = sourceCanvas.height;
    let right = -1;
    let bottom = -1;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      const isVisibleMark = alpha > 15 && (red < 245 || green < 245 || blue < 245);

      if (!isVisibleMark) continue;

      const pixelIndex = index / 4;
      const x = pixelIndex % sourceCanvas.width;
      const y = Math.floor(pixelIndex / sourceCanvas.width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }

    if (right < left || bottom < top) {
      return new Uint8Array(await (await fetch(source)).arrayBuffer());
    }

    const padding = 12;
    const cropLeft = Math.max(0, left - padding);
    const cropTop = Math.max(0, top - padding);
    const cropWidth = Math.min(sourceCanvas.width - cropLeft, right - left + padding * 2 + 1);
    const cropHeight = Math.min(sourceCanvas.height - cropTop, bottom - top + padding * 2 + 1);
    const croppedCanvas = document.createElement("canvas");
    croppedCanvas.width = cropWidth;
    croppedCanvas.height = cropHeight;
    const croppedContext = croppedCanvas.getContext("2d")!;
    if (!croppedContext) throw new Error("No se pudo preparar el logotipo de Nahuitech.");

    croppedContext.drawImage(
      sourceCanvas,
      cropLeft,
      cropTop,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );
    const croppedBlob = await new Promise<Blob>((resolve, reject) => {
      croppedCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("No se pudo preparar el logotipo de Nahuitech."));
      }, "image/png");
    });

    return new Uint8Array(await croppedBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(source);
  }
}

async function embedMachineImage(
  document: PDFDocument,
  imageBytes: Uint8Array | undefined
): Promise<PDFImage | null> {
  if (!imageBytes) return null;

  try {
    return await document.embedPng(imageBytes);
  } catch {
    try {
      return await document.embedJpg(imageBytes);
    } catch {
      return null;
    }
  }
}

function deliveryText(snapshot: QuotePdfSnapshot) {
  const defaultText = {
    SHIPPING: "Envío - Por cotizar",
    INSTALLATION: "Instalación - Por cotizar",
    LATER: "Entrega / instalación - Por definir",
  }[snapshot.delivery.type];
  const note = snapshot.delivery.note?.trim();

  if (!note || defaultText.toLowerCase().includes(note.toLowerCase())) {
    return defaultText;
  }

  const label = snapshot.delivery.type === "SHIPPING"
    ? "Envío"
    : snapshot.delivery.type === "INSTALLATION"
      ? "Instalación"
      : "Entrega / instalación";

  return `${label} - ${note}`;
}

function couponLabel(snapshot: QuotePdfSnapshot) {
  if (!snapshot.coupon) return "";
  return snapshot.coupon.discountType === "PERCENTAGE"
    ? `${snapshot.coupon.discountValue}% de descuento`
    : `${asMoney(netDiscount(snapshot.subtotal, snapshot.total))} de descuento`;
}

function addHeader(context: DrawingContext, snapshot: QuotePdfSnapshot, compact = false) {
  const { page, logo, pdf, regular, bold } = context;
  const top = pageHeight - margin;

  if (compact) {
    page.drawRectangle({
      x: margin,
      y: top - 26,
      width: pageWidth - margin * 2,
      height: 26,
      color: rgbFromHex(pdf, quotePdfBrand.graphite),
    });
    const label = `NAHUITECH | ${snapshot.folio} | COTIZACIÓN`;
    page.drawText(label, {
      x: margin + 11,
      y: top - 17,
      size: 8,
      font: bold,
      color: rgbFromHex(pdf, quotePdfBrand.white),
    });
    context.cursorY = top - 42;
    return;
  }

  const logoScale = Math.min(180 / logo.width, 42 / logo.height);
  const logoWidth = logo.width * logoScale;
  const logoHeight = logo.height * logoScale;

  page.drawRectangle({
    x: margin,
    y: top - 52,
    width: pageWidth - margin * 2,
    height: 52,
    color: rgbFromHex(pdf, quotePdfBrand.graphite),
  });
  page.drawImage(logo, {
    x: margin + 14,
    y: top - 26 - logoHeight / 2,
    width: logoWidth,
    height: logoHeight,
  });
  page.drawText("COTIZACIÓN", {
    x: pageWidth - margin - bold.widthOfTextAtSize("COTIZACIÓN", 15),
    y: top - 18,
    size: 15,
    font: bold,
    color: rgbFromHex(pdf, quotePdfBrand.white),
  });
  page.drawText(snapshot.folio, {
    x: pageWidth - margin - regular.widthOfTextAtSize(snapshot.folio, 9.5),
    y: top - 34,
    size: 9.5,
    font: regular,
    color: rgbFromHex(pdf, quotePdfBrand.logoPeach),
  });
  page.drawText(dateFormatter.format(new Date(snapshot.createdAt)), {
    x: pageWidth - margin - regular.widthOfTextAtSize(dateFormatter.format(new Date(snapshot.createdAt)), 8),
    y: top - 46,
    size: 8,
    font: regular,
    color: rgbFromHex(pdf, quotePdfBrand.neutral),
  });
  context.cursorY = top - 68;
}

function addPage(context: DrawingContext, snapshot: QuotePdfSnapshot) {
  context.page = context.document.addPage([pageWidth, pageHeight]);
  addHeader(context, snapshot, true);
}

function ensureSpace(context: DrawingContext, snapshot: QuotePdfSnapshot, height: number) {
  if (context.cursorY - height >= contentBottom) return;
  addPage(context, snapshot);
}

function drawSectionTitle(
  context: DrawingContext,
  snapshot: QuotePdfSnapshot,
  title: string,
  followingHeight = 0
) {
  ensureSpace(context, snapshot, 19 + followingHeight);
  context.page.drawText(title, {
    x: margin,
    y: context.cursorY,
    size: 7.6,
    font: context.bold,
    color: rgbFromHex(context.pdf, quotePdfBrand.logoViolet),
  });
  context.cursorY -= 14;
}

function drawTextBlock(
  context: DrawingContext,
  snapshot: QuotePdfSnapshot,
  text: string,
  options: {
    size?: number;
    font?: PDFFont;
    color?: string;
    maxWidth?: number;
    lineHeight?: number;
    gapAfter?: number;
  } = {}
) {
  const size = options.size ?? 10;
  const font = options.font ?? context.regular;
  const maxWidth = options.maxWidth ?? pageWidth - margin * 2;
  const lineHeight = options.lineHeight ?? size * 1.45;
  const lines = wrapText(text, font, size, maxWidth);
  ensureSpace(context, snapshot, lines.length * lineHeight + (options.gapAfter ?? 0));

  for (const line of lines) {
    context.page.drawText(line, {
      x: margin,
      y: context.cursorY,
      size,
      font,
      color: rgbFromHex(context.pdf, options.color ?? quotePdfBrand.graphite),
    });
    context.cursorY -= lineHeight;
  }

  context.cursorY -= options.gapAfter ?? 0;
}

function drawContactRows(
  context: DrawingContext,
  snapshot: QuotePdfSnapshot,
  entries: Array<{ label: string; value: string | null | undefined }>
) {
  const activeEntries = entries.filter((entry) => entry.value?.trim());
  if (activeEntries.length === 0) return;

  const rowHeight = 15;
  ensureSpace(context, snapshot, activeEntries.length * rowHeight + 4);
  for (const entry of activeEntries) {
    context.page.drawText(entry.label.toUpperCase(), {
      x: margin,
      y: context.cursorY,
      size: 6.8,
      font: context.bold,
      color: rgbFromHex(context.pdf, quotePdfBrand.muted),
    });
    context.page.drawText(entry.value!.trim(), {
      x: margin + 82,
      y: context.cursorY - 0.5,
      size: 9.1,
      font: context.regular,
      color: rgbFromHex(context.pdf, quotePdfBrand.graphite),
    });
    context.cursorY -= rowHeight;
  }
  context.cursorY -= 3;
}

function drawClientAndAdvisor(context: DrawingContext, snapshot: QuotePdfSnapshot) {
  const customerDetails = [
    snapshot.customer.company ? `Empresa · ${snapshot.customer.company}` : null,
    `WhatsApp · ${snapshot.customer.whatsapp}`,
    snapshot.customer.email ? `Correo · ${snapshot.customer.email}` : null,
  ].filter((value): value is string => Boolean(value));
  const customerLines = [snapshot.customer.name, ...customerDetails];
  const advisorLines = snapshot.sellerName?.trim() ? [snapshot.sellerName.trim()] : [];
  const customerWidth = snapshot.sellerName?.trim() ? 244 : pageWidth - margin * 2;
  const wrappedCustomer = customerLines.flatMap((line, index) =>
    wrapText(line, index === 0 ? context.bold : context.regular, index === 0 ? 9.5 : 7.8, customerWidth)
  );
  const wrappedAdvisor = advisorLines.flatMap((line) =>
    wrapText(line, context.bold, 9.5, 190)
  );
  const detailRows = Math.max(wrappedCustomer.length, wrappedAdvisor.length, 1);
  const blockHeight = 18 + detailRows * 10.5 + 5;

  drawSectionTitle(context, snapshot, "CLIENTE Y ASESOR", blockHeight + 4);
  const top = context.cursorY;
  const advisorX = pageWidth - margin - 190;
  context.page.drawText("CLIENTE", {
    x: margin,
    y: top,
    size: 6.8,
    font: context.bold,
    color: rgbFromHex(context.pdf, quotePdfBrand.muted),
  });
  if (advisorLines.length > 0) {
    context.page.drawText("ASESOR", {
      x: advisorX,
      y: top,
      size: 6.8,
      font: context.bold,
      color: rgbFromHex(context.pdf, quotePdfBrand.muted),
    });
  }

  let customerY = top - 12;
  wrappedCustomer.forEach((line, index) => {
    context.page.drawText(line, {
      x: margin,
      y: customerY,
      size: index === 0 ? 9.5 : 7.8,
      font: index === 0 ? context.bold : context.regular,
      color: rgbFromHex(context.pdf, index === 0 ? quotePdfBrand.graphite : quotePdfBrand.muted),
    });
    customerY -= 10.5;
  });

  let advisorY = top - 12;
  wrappedAdvisor.forEach((line) => {
    context.page.drawText(line, {
      x: advisorX,
      y: advisorY,
      size: 9.5,
      font: context.bold,
      color: rgbFromHex(context.pdf, quotePdfBrand.graphite),
    });
    advisorY -= 10.5;
  });

  context.cursorY = top - blockHeight;
}

function drawMachine(context: DrawingContext, snapshot: QuotePdfSnapshot) {
  const hasImage = context.machineImage !== null;
  const imageBoxWidth = 112;
  const imageBoxHeight = 70;
  const textStart = hasImage ? margin + 18 + imageBoxWidth : margin + 12;
  const textWidth = hasImage ? 228 : 330;
  const machineNameLines = wrapText(snapshot.machine.name, context.bold, hasImage ? 13.5 : 15.5, textWidth);
  const metadata = [
    snapshot.machine.variant ? `Versión: ${snapshot.machine.variant.name}` : null,
    snapshot.machine.numberOfBases !== null ? `${snapshot.machine.numberOfBases} bases` : null,
  ].filter((value): value is string => Boolean(value)).join(" · ");
  const descriptionLines = snapshot.machine.variant?.description
    ? wrapText(snapshot.machine.variant.description, context.regular, 7.4, textWidth)
    : [];
  const nameHeight = machineNameLines.length * (hasImage ? 15 : 17);
  const descriptionHeight = descriptionLines.length * 8.5;
  const blockHeight = Math.max(hasImage ? 82 : 58, nameHeight + descriptionHeight + (metadata ? 32 : 23));
  drawSectionTitle(context, snapshot, "MÁQUINA", blockHeight + 7);
  const boxBottom = context.cursorY - blockHeight;

  context.page.drawRectangle({
    x: margin,
    y: boxBottom,
    width: pageWidth - margin * 2,
    height: blockHeight,
    color: rgbFromHex(context.pdf, quotePdfBrand.neutral),
  });
  if (context.machineImage) {
    const scale = Math.min(
      imageBoxWidth / context.machineImage.width,
      imageBoxHeight / context.machineImage.height
    );
    const width = context.machineImage.width * scale;
    const height = context.machineImage.height * scale;
    context.page.drawImage(context.machineImage, {
      x: margin + 12 + (imageBoxWidth - width) / 2,
      y: boxBottom + (blockHeight - height) / 2,
      width,
      height,
    });
  }

  let nameY = context.cursorY - (hasImage ? 17 : 18);
  for (const line of machineNameLines) {
    context.page.drawText(line, {
      x: textStart,
      y: nameY,
      size: hasImage ? 13.5 : 15.5,
      font: context.bold,
      color: rgbFromHex(context.pdf, quotePdfBrand.black),
    });
    nameY -= hasImage ? 15 : 17;
  }
  if (metadata) {
    context.page.drawText(metadata, {
      x: textStart,
      y: nameY - 1,
      size: 7.5,
      font: context.regular,
      color: rgbFromHex(context.pdf, quotePdfBrand.muted),
    });
    nameY -= 12;
  }
  for (const line of descriptionLines) {
    context.page.drawText(line, {
      x: textStart,
      y: nameY,
      size: 7.4,
      font: context.regular,
      color: rgbFromHex(context.pdf, quotePdfBrand.muted),
    });
    nameY -= 8.5;
  }
  const price = asMoney(grossToNet(snapshot.machine.basePrice));
  context.page.drawText(price, {
    x: pageWidth - margin - 12 - context.bold.widthOfTextAtSize(price, 12),
    y: boxBottom + 16,
    size: 12,
    font: context.bold,
    color: rgbFromHex(context.pdf, quotePdfBrand.black),
  });
  context.cursorY = boxBottom - 7;
}

function addonHeight(addon: QuotePdfAddon, context: DrawingContext) {
  const nameLines = wrapText(addon.name, context.bold, 10, 310);
  const descriptionLines = addon.description
    ? wrapText(addon.description, context.regular, 8, 310)
    : [];
  const calculationHeight = addon.calculationType === "FIXED" ? 11 : 21;
  return nameLines.length * 12 + descriptionLines.length * 9.5 + calculationHeight + 9;
}

function drawAddons(context: DrawingContext, snapshot: QuotePdfSnapshot) {
  if (snapshot.addons.length === 0) return;
  drawSectionTitle(context, snapshot, "CONFIGURACIÓN", addonHeight(snapshot.addons[0], context));

  for (const addon of snapshot.addons) {
    const height = addonHeight(addon, context);
    ensureSpace(context, snapshot, height);
    const lines = wrapText(addon.name, context.bold, 10, 310);
    let lineY = context.cursorY;
    for (const line of lines) {
      context.page.drawText(line, {
        x: margin,
        y: lineY,
        size: 10,
        font: context.bold,
        color: rgbFromHex(context.pdf, quotePdfBrand.graphite),
      });
      lineY -= 12;
    }
    if (addon.description) {
      for (const line of wrapText(addon.description, context.regular, 8, 310)) {
        context.page.drawText(line, {
          x: margin,
          y: lineY - 1,
          size: 8,
          font: context.regular,
          color: rgbFromHex(context.pdf, quotePdfBrand.muted),
        });
        lineY -= 9.5;
      }
    }
    if (addon.calculationType === "PER_BASE" || addon.calculationType === "QUANTITY") {
      const quantityLabel = addon.calculationType === "PER_BASE"
        ? `${addon.quantity} bases`
        : `${addon.quantity} ${addon.quantity === 1 ? "unidad" : "unidades"}`;
      context.page.drawText(`${quantityLabel} × ${asMoney(grossToNet(addon.unitPrice))}`, {
        x: margin,
        y: lineY - 1,
        size: 8.5,
        font: context.regular,
        color: rgbFromHex(context.pdf, quotePdfBrand.muted),
      });
      lineY -= 12;
    }
    const total = asMoney(grossToNet(addon.lineTotal));
    context.page.drawText(total, {
      x: pageWidth - margin - context.bold.widthOfTextAtSize(total, 10),
      y: context.cursorY,
      size: 10,
      font: context.bold,
      color: rgbFromHex(context.pdf, quotePdfBrand.graphite),
    });
    context.page.drawLine({
      start: { x: margin, y: lineY - 4 },
      end: { x: pageWidth - margin, y: lineY - 4 },
      thickness: 0.55,
      color: rgbFromHex(context.pdf, quotePdfBrand.border),
    });
    context.cursorY = lineY - 9;
  }
  context.cursorY -= 2;
}

function drawCoupon(context: DrawingContext, snapshot: QuotePdfSnapshot) {
  if (!snapshot.coupon || snapshot.discountAmount <= 0) return;
  const boxHeight = 58;
  drawSectionTitle(context, snapshot, "BENEFICIO EXCLUSIVO DE EXPO", boxHeight + 8);
  const boxBottom = context.cursorY - boxHeight;
  context.page.drawRectangle({
    x: margin,
    y: boxBottom,
    width: pageWidth - margin * 2,
    height: boxHeight,
    color: rgbFromHex(context.pdf, quotePdfBrand.logoPeach),
  });
  context.page.drawRectangle({
    x: margin,
    y: boxBottom,
    width: 4,
    height: boxHeight,
    color: rgbFromHex(context.pdf, quotePdfBrand.logoRed),
  });
  context.page.drawText(snapshot.coupon.name, {
    x: margin + 18,
    y: context.cursorY - 18,
    size: 10.5,
    font: context.bold,
    color: rgbFromHex(context.pdf, quotePdfBrand.black),
  });
  context.page.drawText(`Código: ${snapshot.coupon.code}`, {
    x: margin + 18,
    y: context.cursorY - 33,
    size: 8,
    font: context.regular,
    color: rgbFromHex(context.pdf, quotePdfBrand.graphite),
  });
  context.page.drawText(couponLabel(snapshot), {
    x: margin + 18,
    y: context.cursorY - 46,
    size: 8,
    font: context.regular,
    color: rgbFromHex(context.pdf, quotePdfBrand.graphite),
  });
  const benefit = `- ${asMoney(netDiscount(snapshot.subtotal, snapshot.total))}`;
  context.page.drawText(benefit, {
    x: pageWidth - margin - 14 - context.bold.widthOfTextAtSize(benefit, 12),
    y: context.cursorY - 29,
    size: 12,
    font: context.bold,
    color: rgbFromHex(context.pdf, quotePdfBrand.black),
  });
  context.cursorY = boxBottom - 8;
}

function drawDelivery(context: DrawingContext, snapshot: QuotePdfSnapshot) {
  drawSectionTitle(context, snapshot, "ENTREGA", 18);
  drawTextBlock(context, snapshot, deliveryText(snapshot), {
    size: 9.5,
    font: context.regular,
    gapAfter: 6,
  });
}

function drawFinancialSummary(context: DrawingContext, snapshot: QuotePdfSnapshot) {
  const hasCoupon = Boolean(snapshot.coupon && snapshot.discountAmount > 0);
  const tax = snapshot.tax ?? calculateIncludedTaxBreakdown(snapshot.total);
  const height = hasCoupon ? 104 : 76;
  ensureSpace(context, snapshot, height + 10);
  const boxBottom = context.cursorY - height;
  context.page.drawRectangle({
    x: margin,
    y: boxBottom,
    width: pageWidth - margin * 2,
    height,
    color: rgbFromHex(context.pdf, quotePdfBrand.black),
  });
  let rowY = context.cursorY - 16;
  const drawRow = (label: string, value: string, emphasized = false) => {
    const size = emphasized ? 14 : 8.8;
    const font = emphasized ? context.bold : context.regular;
    const color = emphasized ? quotePdfBrand.white : quotePdfBrand.neutral;
    context.page.drawText(label, {
      x: margin + 14,
      y: rowY,
      size,
      font,
      color: rgbFromHex(context.pdf, color),
    });
    context.page.drawText(value, {
      x: pageWidth - margin - 14 - font.widthOfTextAtSize(value, size),
      y: rowY,
      size,
      font,
      color: rgbFromHex(context.pdf, color),
    });
    rowY -= emphasized ? 19 : 14;
  };

  if (hasCoupon) {
    drawRow("Precio configuración", asMoney(grossToNet(snapshot.subtotal)));
    drawRow("Beneficio Expo", `- ${asMoney(netDiscount(snapshot.subtotal, snapshot.total))}`);
  }
  drawRow("Subtotal", asMoney(tax.subtotalBeforeTax));
  drawRow(`IVA ${Math.round(tax.taxRate * 100)}%`, asMoney(tax.taxAmount));
  drawRow(hasCoupon ? "PRECIO FINAL" : "TOTAL", asMoney(snapshot.total), true);
  context.cursorY = boxBottom - 9;
}

function drawPromotionAndFinancialSummary(context: DrawingContext, snapshot: QuotePdfSnapshot) {
  const hasCoupon = Boolean(snapshot.coupon && snapshot.discountAmount > 0);
  const requiredHeight = hasCoupon ? 194 : 86;
  ensureSpace(context, snapshot, requiredHeight);
  drawCoupon(context, snapshot);
  drawFinancialSummary(context, snapshot);
}

function drawCommercialInfo(context: DrawingContext, snapshot: QuotePdfSnapshot) {
  const entries = Object.entries(quoteCommercialInfo)
    .map(([key, value]) => ({
      label: quoteCommercialInfoLabels[key as keyof typeof quoteCommercialInfoLabels],
      value,
    }))
    .filter((entry) => entry.value.trim());

  if (entries.length === 0 && !snapshot.notes?.trim()) return;
  drawSectionTitle(context, snapshot, "VIGENCIA Y CONDICIONES");
  drawContactRows(context, snapshot, [
    ...entries,
    { label: "Notas de cotización", value: snapshot.notes },
  ]);
}

function drawFooter(context: DrawingContext, snapshot: QuotePdfSnapshot, index: number, total: number) {
  const footer = `NAHUITECH | ${snapshot.folio} | Página ${index} de ${total}`;
  context.page.drawLine({
    start: { x: margin, y: margin + 13 },
    end: { x: pageWidth - margin, y: margin + 13 },
    thickness: 0.55,
    color: rgbFromHex(context.pdf, quotePdfBrand.border),
  });
  context.page.drawText(footer, {
    x: margin,
    y: margin + 3,
    size: 7,
    font: context.regular,
    color: rgbFromHex(context.pdf, quotePdfBrand.muted),
  });
}

export async function prepareQuotePdfGenerator() {
  if (typeof window === "undefined") return;
  await import("pdf-lib");
}

export async function generateQuotePdf(
  snapshot: QuotePdfSnapshot,
  options: { logoBytes?: Uint8Array; machineImageBytes?: Uint8Array; itemImageBytes?: (Uint8Array | undefined)[] } = {}
) {
  if (typeof window === "undefined" && !options.logoBytes) {
    throw new Error("La generación PDF solo está disponible en el navegador.");
  }

  const pdf = await import("pdf-lib");
  const document = await pdf.PDFDocument.create();
  const [regular, bold] = await Promise.all([
    document.embedFont(pdf.StandardFonts.Helvetica),
    document.embedFont(pdf.StandardFonts.HelveticaBold),
  ]);
  const logoBytes = options.logoBytes ?? await loadCroppedLogo();
  const logo = await document.embedPng(logoBytes);
  const machineImageBytes = options.machineImageBytes ?? await loadMachineImageBytes(snapshot.machine.imageUrl);
  const machineImage = await embedMachineImage(document, machineImageBytes);
  const firstPage = document.addPage([pageWidth, pageHeight]);
  const context: DrawingContext = {
    pdf,
    document,
    page: firstPage,
    regular,
    bold,
    logo,
    machineImage,
    cursorY: 0,
  };

  addHeader(context, snapshot);
  drawClientAndAdvisor(context, snapshot);
  for (const [index, item] of snapshotItems(snapshot).entries()) {
    const bytes = options.itemImageBytes?.[index] ?? (index === 0 && options.machineImageBytes ? options.machineImageBytes : await loadMachineImageBytes(item.machine.imageUrl));
    context.machineImage = await embedMachineImage(document, bytes);
    const itemSnapshot = { ...snapshot, machine: { ...item.machine, name: `${index + 1}. ${item.machine.name}`, basePrice: Math.round(item.machine.basePrice * item.quantity * 100) / 100 }, addons: item.addons };
    drawMachine(context, itemSnapshot);
    drawTextBlock(context, snapshot, `Cantidad: ${item.quantity} | Precio unitario: ${asMoney(grossToNet(item.machine.basePrice))}`, { size: 8, gapAfter: 8 });
    drawAddons(context, itemSnapshot);
    drawTextBlock(context, snapshot, `Importe equipo: ${asMoney(grossToNet(item.lineGrossTotal))}`, { size: 9, gapAfter: 8 });
    if (snapshot.items?.length) drawTextBlock(context, snapshot, `Entrega: ${item.delivery.type === "INSTALLATION" ? "Instalación" : item.delivery.type === "SHIPPING" ? "Envío" : "Por definir"} - ${item.delivery.note ?? "Por cotizar"}`, { size: 8, gapAfter: 10 });
  }
  drawDelivery(context, snapshot);
  drawPromotionAndFinancialSummary(context, snapshot);
  drawCommercialInfo(context, snapshot);

  const pages = document.getPages();
  pages.forEach((page, index) => {
    context.page = page;
    drawFooter(context, snapshot, index + 1, pages.length);
  });

  return document.save();
}
