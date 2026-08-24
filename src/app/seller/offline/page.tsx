import { OfflineQuoteList } from "@/components/offline-quote-list";
import { SellerOfflineProvider } from "@/components/seller-offline-provider";
import { SellerShellHeader } from "@/components/seller-shell-header";
import { requireSellerFlowRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export default async function SellerOfflinePage() {
  const profile = await requireSellerFlowRole();
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const sellerId = typeof claimsData?.claims.sub === "string" ? claimsData.claims.sub : null;

  if (!sellerId) {
    throw new Error("No se pudo identificar al vendedor.");
  }

  return (
    <SellerOfflineProvider initialAccountRole={profile.role}>
      <div className="min-h-screen bg-background">
        <SellerShellHeader accountRole={profile.role} userName={profile.full_name} />
        <OfflineQuoteList sellerId={sellerId} />
      </div>
    </SellerOfflineProvider>
  );
}
