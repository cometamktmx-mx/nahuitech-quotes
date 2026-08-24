export type SellerMachine = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string;
  basePrice: number;
  numberOfBases: number | null;
  supportsAddons: boolean;
  deliveryPolicy: "FLEXIBLE" | "INSTALLATION_REQUIRED" | "SHIPPING_ONLY";
  imageUrl: string | null;
  sortOrder: number;
};

export type SellerAddon = {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number;
  calculationType: "FIXED" | "PER_BASE" | "QUANTITY";
  required: boolean;
};

export function asCatalogNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
