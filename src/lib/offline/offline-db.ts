import Dexie, { type Table } from "dexie";

import type {
  OfflineAddon,
  OfflineCoupon,
  OfflineCouponMachine,
  OfflineCustomer,
  OfflineMachine,
  OfflineMachineAddon,
  OfflineMachineVariant,
  OfflineMetadata,
  OfflineQuote,
  OfflineSalesperson,
  OfflineSellerProfile,
  OfflineWhatsAppTask,
  SyncQueueEntry,
} from "./offline-types";

class NahuitechOfflineDatabase extends Dexie {
  machines!: Table<OfflineMachine, string>;
  addons!: Table<OfflineAddon, string>;
  machineAddons!: Table<OfflineMachineAddon, [string, string]>;
  machineVariants!: Table<OfflineMachineVariant, string>;
  coupons!: Table<OfflineCoupon, string>;
  couponMachines!: Table<OfflineCouponMachine, [string, string]>;
  sellerProfiles!: Table<OfflineSellerProfile, string>;
  salespeople!: Table<OfflineSalesperson, string>;
  offlineCustomers!: Table<OfflineCustomer, string>;
  offlineQuotes!: Table<OfflineQuote, string>;
  syncQueue!: Table<SyncQueueEntry, string>;
  offlineWhatsAppTasks!: Table<OfflineWhatsAppTask, string>;
  metadata!: Table<OfflineMetadata, string>;

  constructor() {
    super("nahuitech-quotes-offline");

    this.version(1).stores({
      machines: "&id, slug, sortOrder",
      addons: "&id",
      machineAddons: "[machineId+addonId], machineId, addonId",
      coupons: "&id, &code",
      couponMachines: "[couponId+machineId], couponId, machineId",
      sellerProfiles: "&id",
      offlineCustomers: "&localId, sellerId, createdAt",
      offlineQuotes: "&localId, &clientGeneratedId, sellerId, syncStatus, createdAt, remoteId",
      syncQueue: "&localId, quoteLocalId, sellerId, updatedAt",
      metadata: "&key, updatedAt",
    });

    this.version(2).stores({
      machines: "&id, slug, sortOrder",
      addons: "&id",
      machineAddons: "[machineId+addonId], machineId, addonId",
      coupons: "&id, &code",
      couponMachines: "[couponId+machineId], couponId, machineId",
      sellerProfiles: "&id",
      offlineCustomers: "&localId, sellerId, createdAt",
      offlineQuotes: "&localId, &clientGeneratedId, sellerId, syncStatus, createdAt, remoteId",
      syncQueue: "&localId, quoteLocalId, sellerId, updatedAt",
      offlineWhatsAppTasks: "&localId, &quoteLocalId, sellerId, status, updatedAt",
      metadata: "&key, updatedAt",
    });

    // New records retain machine/add-on overrides and explicit quantities.
    // No index changes are needed, but this version lets existing device data upgrade safely.
    this.version(3).stores({
      machines: "&id, slug, sortOrder",
      addons: "&id",
      machineAddons: "[machineId+addonId], machineId, addonId",
      coupons: "&id, &code",
      couponMachines: "[couponId+machineId], couponId, machineId",
      sellerProfiles: "&id",
      offlineCustomers: "&localId, sellerId, createdAt",
      offlineQuotes: "&localId, &clientGeneratedId, sellerId, syncStatus, createdAt, remoteId",
      syncQueue: "&localId, quoteLocalId, sellerId, updatedAt",
      offlineWhatsAppTasks: "&localId, &quoteLocalId, sellerId, status, updatedAt",
      metadata: "&key, updatedAt",
    });

    this.version(4).stores({
      machines: "&id, slug, sortOrder",
      addons: "&id",
      machineAddons: "[machineId+addonId], machineId, addonId",
      machineVariants: "&id, machineId, active, sortOrder",
      coupons: "&id, &code",
      couponMachines: "[couponId+machineId], couponId, machineId",
      sellerProfiles: "&id",
      offlineCustomers: "&localId, sellerId, createdAt",
      offlineQuotes: "&localId, &clientGeneratedId, sellerId, sellerResponsibleId, syncStatus, createdAt, remoteId",
      syncQueue: "&localId, quoteLocalId, sellerId, updatedAt",
      offlineWhatsAppTasks: "&localId, &quoteLocalId, sellerId, status, updatedAt",
      metadata: "&key, updatedAt",
    });

    this.version(5).stores({
      machines: "&id, slug, sortOrder",
      addons: "&id",
      machineAddons: "[machineId+addonId], machineId, addonId",
      machineVariants: "&id, machineId, active, sortOrder",
      coupons: "&id, &code",
      couponMachines: "[couponId+machineId], couponId, machineId",
      sellerProfiles: "&id",
      salespeople: "&id, active, sortOrder",
      offlineCustomers: "&localId, sellerId, createdAt",
      offlineQuotes: "&localId, &clientGeneratedId, sellerId, salespersonId, syncStatus, createdAt, remoteId",
      syncQueue: "&localId, quoteLocalId, sellerId, updatedAt",
      offlineWhatsAppTasks: "&localId, &quoteLocalId, sellerId, status, updatedAt",
      metadata: "&key, updatedAt",
    });

    // Version 6 carries the explicit IVA and variant-description snapshots.
    // Indexed fields are unchanged, so existing local quotes remain intact.
    this.version(6).stores({
      machines: "&id, slug, sortOrder",
      addons: "&id",
      machineAddons: "[machineId+addonId], machineId, addonId",
      machineVariants: "&id, machineId, active, sortOrder",
      coupons: "&id, &code",
      couponMachines: "[couponId+machineId], couponId, machineId",
      sellerProfiles: "&id",
      salespeople: "&id, active, sortOrder",
      offlineCustomers: "&localId, sellerId, createdAt",
      offlineQuotes: "&localId, &clientGeneratedId, sellerId, salespersonId, syncStatus, createdAt, remoteId",
      syncQueue: "&localId, quoteLocalId, sellerId, updatedAt",
      offlineWhatsAppTasks: "&localId, &quoteLocalId, sellerId, status, updatedAt",
      metadata: "&key, updatedAt",
    });
  }
}

export const offlineDb = new NahuitechOfflineDatabase();

export function isOfflineStorageAvailable() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}
