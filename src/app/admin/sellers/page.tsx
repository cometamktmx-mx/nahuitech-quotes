import { AdminNav } from "@/components/admin-nav";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

import { SellerManager, type AdminSalesperson } from "./seller-manager";

export default async function AdminSellersPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();
  const { data: salespeople, error } = await supabase
    .from("salespeople")
    .select("id, full_name, email, phone, active, sort_order, created_at")
    .order("sort_order")
    .order("full_name");

  if (error) {
    throw new Error("No se pudieron cargar los vendedores comerciales.");
  }

  const sellers: AdminSalesperson[] = (salespeople ?? []).map((salesperson) => ({
    id: salesperson.id,
    fullName: salesperson.full_name,
    email: salesperson.email,
    phone: salesperson.phone,
    active: salesperson.active,
    sortOrder: salesperson.sort_order,
    createdAt: salesperson.created_at,
  }));

  return (
    <div className="min-h-screen bg-background">
      <AdminNav active="sellers" userName={profile.full_name} />
      <SellerManager sellers={sellers} />
    </div>
  );
}
