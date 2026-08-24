"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { prepareQuotePdfGenerator } from "@/lib/pdf/quote-pdf";
import {
  clearOfflineSellerSession,
  getOfflineCatalogTimestamp,
  getOfflineSellerProfile,
  getOfflineSellerSession,
  getOfflineSelectedSalesperson,
  setOfflineSelectedSalesperson,
  clearOfflineSelectedSalesperson,
  syncOfflineCatalog,
} from "@/lib/offline/offline-catalog";
import { getPendingOfflineQuoteCount } from "@/lib/offline/offline-quotes";
import { syncPendingOfflineQuotes } from "@/lib/offline/sync-queue";
import { offlineDb } from "@/lib/offline/offline-db";
import { createClient } from "@/lib/supabase/client";

type SellerOfflineState = {
  isOnline: boolean;
  sellerId: string | null;
  sellerName: string | null;
  accountRole: "seller" | "expo" | null;
  salespersonId: string | null;
  salespersonName: string | null;
  lastSyncedAt: string | null;
  pendingQuoteCount: number;
  syncError: string | null;
  refreshOfflineState: () => Promise<void>;
  syncNow: () => Promise<void>;
  selectSalesperson: (salespersonId: string, salespersonName: string) => Promise<void>;
  clearSalesperson: () => Promise<void>;
};

const SellerOfflineContext = createContext<SellerOfflineState | null>(null);
const sellerDocumentCache = "nahuitech-seller-documents-v3";
const staticCache = "nahuitech-static-v3";

function isConnectivityError(error: unknown) {
  if (error instanceof TypeError) return true;

  if (typeof error !== "object" || !error) return false;

  const candidate = error as { message?: unknown; status?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message : "";

  return candidate.status === 0 || /network|fetch|offline|timeout/i.test(message);
}

async function cacheSellerShell() {
  if (typeof caches === "undefined") return;

  try {
    const response = await fetch("/seller", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return;

    const cache = await caches.open(sellerDocumentCache);
    await cache.put("/seller", response.clone());
  } catch {
    // The existing cached shell remains usable when a refresh fails.
  }
}

async function cacheLoadedAppAssets() {
  if (typeof caches === "undefined" || typeof performance === "undefined") return;

  const cache = await caches.open(staticCache);
  const resourceUrls = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((resourceUrl) => {
      const url = new URL(resourceUrl);
      return url.origin === window.location.origin && (
        url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/machines/")
      );
    });

  await Promise.all(resourceUrls.map(async (resourceUrl) => {
    try {
      const response = await fetch(resourceUrl);
      if (response.ok) await cache.put(resourceUrl, response.clone());
    } catch {
      // Keep previously cached assets if one resource cannot be refreshed.
    }
  }));
}

export function SellerOfflineProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [sellerName, setSellerName] = useState<string | null>(null);
  const [accountRole, setAccountRole] = useState<"seller" | "expo" | null>(null);
  const [salespersonId, setSalespersonId] = useState<string | null>(null);
  const [salespersonName, setSalespersonName] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pendingQuoteCount, setPendingQuoteCount] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const getBrowserClient = useCallback(() => {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }

    if (!unsubscribeRef.current) {
      const { data } = supabaseRef.current.auth.onAuthStateChange((event) => {
        if (event !== "SIGNED_OUT") return;

        void clearOfflineSellerSession().then(() => {
          setSellerId(null);
          setSellerName(null);
          setAccountRole(null);
          setSalespersonId(null);
          setSalespersonName(null);
          setLastSyncedAt(null);
          setPendingQuoteCount(0);
        });
      });
      unsubscribeRef.current = () => data.subscription.unsubscribe();
    }

    return supabaseRef.current;
  }, []);

  const refreshOfflineState = useCallback(async () => {
    const online = typeof navigator === "undefined" || navigator.onLine;
    let currentSellerId: string | null = null;

    if (!online) {
      currentSellerId = (await getOfflineSellerSession())?.sellerId ?? null;
    } else {
      try {
        const { data, error } = await getBrowserClient().auth.getClaims();
        currentSellerId =
          typeof data?.claims.sub === "string" ? data.claims.sub : null;

        if (!currentSellerId && !isConnectivityError(error)) {
          await clearOfflineSellerSession();
        }
      } catch (error) {
        if (isConnectivityError(error)) {
          currentSellerId = (await getOfflineSellerSession())?.sellerId ?? null;
        } else {
          await clearOfflineSellerSession();
        }
      }
    }

    setSellerId(currentSellerId);

    if (!currentSellerId) {
      setSellerName(null);
      setAccountRole(null);
      setSalespersonId(null);
      setSalespersonName(null);
      setLastSyncedAt(null);
      setPendingQuoteCount(0);
      return;
    }

    const [profile, syncedAt, pendingCount] = await Promise.all([
      getOfflineSellerProfile(currentSellerId),
      getOfflineCatalogTimestamp(currentSellerId),
      getPendingOfflineQuoteCount(currentSellerId),
    ]);
    setSellerName(profile?.fullName ?? null);
    const role = profile?.role ?? null;
    setAccountRole(role);
    if (role === "seller" && profile) {
      const linkedSalesperson = profile.salespersonId
        ? await offlineDb.salespeople.get(profile.salespersonId)
        : null;
      setSalespersonId(linkedSalesperson?.active ? linkedSalesperson.id : null);
      setSalespersonName(linkedSalesperson?.active ? linkedSalesperson.fullName : profile.fullName);
    } else if (role === "expo") {
      const selected = await getOfflineSelectedSalesperson(currentSellerId);
      if (selected) {
        const selectedSalesperson = await offlineDb.salespeople.get(selected.salespersonId);
        if (selectedSalesperson?.active) {
          setSalespersonId(selectedSalesperson.id);
          setSalespersonName(selectedSalesperson.fullName);
        } else {
          setSalespersonId(null);
          setSalespersonName(null);
        }
      } else {
        setSalespersonId(null);
        setSalespersonName(null);
      }
    } else {
      setSalespersonId(null);
      setSalespersonName(null);
    }
    setLastSyncedAt(syncedAt);
    setPendingQuoteCount(pendingCount);
  }, [getBrowserClient]);

  const selectSalesperson = useCallback(async (selectedId: string, selectedName: string) => {
    if (!sellerId || accountRole !== "expo") return;
    await setOfflineSelectedSalesperson(sellerId, selectedId, selectedName);
    setSalespersonId(selectedId);
    setSalespersonName(selectedName);
  }, [accountRole, sellerId]);

  const clearSalesperson = useCallback(async () => {
    if (!sellerId || accountRole !== "expo") return;
    await clearOfflineSelectedSalesperson(sellerId);
    setSalespersonId(null);
    setSalespersonName(null);
  }, [accountRole, sellerId]);

  const syncNow = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.onLine) {
      await refreshOfflineState();
      return;
    }

    setSyncError(null);

    try {
      getBrowserClient().auth.startAutoRefresh();
      const { sellerId: syncedSellerId } = await syncOfflineCatalog();
      await prepareQuotePdfGenerator();
      await Promise.all([cacheSellerShell(), cacheLoadedAppAssets()]);
      await syncPendingOfflineQuotes(syncedSellerId);
      await refreshOfflineState();
    } catch (error) {
      setSyncError(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el modo offline."
      );
      await refreshOfflineState();
    }
  }, [getBrowserClient, refreshOfflineState]);

  useEffect(() => {
    const online = typeof navigator === "undefined" ? true : navigator.onLine;
    const initialStateTimer = window.setTimeout(() => {
      setIsOnline(online);
      void refreshOfflineState();
      if (online) {
        getBrowserClient().auth.startAutoRefresh();
        void syncNow();
      }
    }, 0);

    const handleOnline = () => {
      setIsOnline(true);
      getBrowserClient().auth.startAutoRefresh();
      void syncNow();
    };
    const handleOffline = () => {
      setIsOnline(false);
      supabaseRef.current?.auth.stopAutoRefresh();
      void refreshOfflineState();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(() => navigator.serviceWorker.ready)
        .then(() => cacheLoadedAppAssets());
    }

    return () => {
      window.clearTimeout(initialStateTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [getBrowserClient, refreshOfflineState, syncNow]);

  const value = useMemo<SellerOfflineState>(
    () => ({
      isOnline,
      sellerId,
      sellerName,
      accountRole,
      salespersonId,
      salespersonName,
      lastSyncedAt,
      pendingQuoteCount,
      syncError,
      refreshOfflineState,
      syncNow,
      selectSalesperson,
      clearSalesperson,
    }),
    [accountRole, clearSalesperson, isOnline, lastSyncedAt, pendingQuoteCount, refreshOfflineState, salespersonId, salespersonName, selectSalesperson, sellerId, sellerName, syncError, syncNow]
  );

  return <SellerOfflineContext.Provider value={value}>{children}</SellerOfflineContext.Provider>;
}

export function useSellerOffline() {
  return useContext(SellerOfflineContext);
}
