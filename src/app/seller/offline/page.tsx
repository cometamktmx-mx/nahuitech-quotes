import { OfflineQuoteList } from "@/components/offline-quote-list";
import { SellerOfflineProvider } from "@/components/seller-offline-provider";
import { SellerShellHeader } from "@/components/seller-shell-header";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export default async function SellerOfflinePage() {
  const profile = await requireRole("seller");
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const sellerId = typeof claimsData?.claims.sub === "string" ? claimsData.claims.sub : null;

  if (!sellerId) {
    throw new Error("No se pudo identificar al vendedor.");
  }

  return (
    <SellerOfflineProvider>
      <div className="min-h-screen bg-background">
        <SellerShellHeader userName={profile.full_name} />
        <OfflineQuoteList sellerId={sellerId} />
      </div>
    </SellerOfflineProvider>
  );
}
