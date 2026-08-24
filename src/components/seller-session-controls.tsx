"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { clearOfflineSellerSession } from "@/lib/offline/offline-catalog";

export function SellerSessionControls() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);

    try {
      const supabase = createClient();
      await supabase.auth.signOut({ scope: "local" });
      await clearOfflineSellerSession();
      router.replace("/login");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <button className="inline-flex min-h-11 items-center justify-center rounded-xl border border-on-graphite/20 px-4 text-sm font-bold text-on-graphite transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60" disabled={isSigningOut} onClick={signOut} type="button">
      {isSigningOut ? "Saliendo..." : "Cerrar sesión"}
    </button>
  );
}
