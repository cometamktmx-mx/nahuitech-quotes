import type { QuotePdfSnapshot } from "@/lib/pdf/quote-pdf-types";
import type { SellerAddon, SellerMachine, SellerMachineVariant } from "@/lib/seller-catalog";

export type OfflineMachine = SellerMachine & {
  active: boolean;
};

export type OfflineAddon = SellerAddon & {
  active: boolean;
};

export type OfflineMachineAddon = {
  machineId: string;
  addonId: string;
  active: boolean;
  unitPriceOverride: number | null;
  descriptionOverride: string | null;
};

export type OfflineCoupon = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  discountType: "FIXED_AMOUNT" | "PERCENTAGE";
  discountValue: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  eventName: string | null;
  appliesToAllMachines: boolean;
};

export type OfflineCouponMachine = {
  couponId: string;
  machineId: string;
};

export type OfflineSellerProfile = {
  id: string;
  fullName: string;
  role: "seller" | "expo";
  active: boolean;
  salespersonId: string | null;
  syncedAt: string;
};

export type OfflineSalesperson = {
  id: string;
  fullName: string;
  active: boolean;
  sortOrder: number;
};

export type OfflineSelectedSalesperson = {
  accountId: string;
  salespersonId: string;
  salespersonName: string;
  updatedAt: string;
};

export type OfflineMachineVariant = SellerMachineVariant;

export type OfflineMetadata = {
  key: string;
  value: string;
  updatedAt: string;
};

export type OfflineCustomer = {
  localId: string;
  sellerId: string;
  name: string;
  company: string | null;
  whatsapp: string;
  email: string | null;
  createdAt: string;
};

export type OfflineQuoteSyncStatus = "PENDING" | "SYNCED" | "SYNC_CONFLICT";
export type OfflineWhatsAppStatus = "NONE" | "PENDING" | "SENT" | "FAILED";

export type OfflineQuote = {
  localId: string;
  clientGeneratedId: string;
  sellerId: string;
  customerLocalId: string;
  folio: string;
  machineId: string;
  salespersonId: string | null;
  salespersonNameSnapshot: string | null;
  /** Legacy Expo selector value kept so quotes saved before the migration can sync. */
  sellerResponsibleId?: string;
  machineVariantId: string | null;
  machineVariantTypeSnapshot: "AUTOMATIC" | "SEMI_AUTOMATIC" | null;
  machineVariantNameSnapshot: string | null;
  machineVariantPriceSnapshot: number | null;
  machineVariantDescriptionSnapshot: string | null;
  subtotalBeforeTaxSnapshot: number;
  taxRateSnapshot: number;
  taxAmountSnapshot: number;
  /** Legacy field retained so previously saved device quotes can still sync. */
  selectedAddonIds?: string[];
  selectedAddonQuantities: Record<string, number>;
  couponCode: string | null;
  deliveryType: "SHIPPING" | "INSTALLATION" | "LATER";
  syncStatus: OfflineQuoteSyncStatus;
  syncError: string | null;
  remoteId: string | null;
  whatsappStatus: OfflineWhatsAppStatus;
  whatsappError: string | null;
  createdAt: string;
  updatedAt: string;
  pdfSnapshot: QuotePdfSnapshot;
};

export type OfflineWhatsAppTask = {
  localId: string;
  quoteLocalId: string;
  sellerId: string;
  status: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncQueueEntry = {
  localId: string;
  quoteLocalId: string;
  sellerId: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
