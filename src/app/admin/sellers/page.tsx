import { AdminNav } from "@/components/admin-nav";
import { requireRole } from "@/lib/auth/require-role";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminConfiguration,
} from "@/lib/supabase/admin.server";
import { createClient } from "@/lib/supabase/server";

import { SellerManager, type AdminSeller } from "./seller-manager";

export default async function AdminSellersPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();
  const { data: sellerProfiles, error: sellerProfilesError } = await supabase
    .from("profiles")
    .select("id, full_name, active, created_at")
    .eq("role", "seller")
    .order("created_at", { ascending: false });

  if (sellerProfilesError) {
    throw new Error("No se pudieron cargar los vendedores.");
  }

  const authAdministrationAvailable = hasSupabaseAdminConfiguration();
  const emailBySellerId = new Map<string, string>();

  if (authAdministrationAvailable && (sellerProfiles?.length ?? 0) > 0) {
    const { data: authUsers, error: authUsersError } =
      await createSupabaseAdminClient().auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

    if (!authUsersError) {
      for (const user of authUsers.users) {
        if (user.email) {
          emailBySellerId.set(user.id, user.email);
        }
      }
    }
  }

  const sellers: AdminSeller[] = (sellerProfiles ?? []).map((seller) => ({
    id: seller.id,
    fullName: seller.full_name,
    email: emailBySellerId.get(seller.id) ?? null,
    active: seller.active,
    createdAt: seller.created_at,
  }));

  return (
    <div className="min-h-screen bg-background">
      <AdminNav active="sellers" userName={profile.full_name} />
      <SellerManager
        authAdministrationAvailable={authAdministrationAvailable}
        sellers={sellers}
      />
    </div>
  );
}
