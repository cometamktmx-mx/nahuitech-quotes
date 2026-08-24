import { AdminNav } from "@/components/admin-nav";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

import { CouponManager, type AdminCoupon, type CouponMachine } from "./coupon-manager";

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export default async function AdminCouponsPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();
  const [couponsResult, machinesResult, relationsResult] = await Promise.all([
    supabase
      .from("coupons")
      .select("id, name, code, description, discount_type, discount_value, active, starts_at, ends_at, event_name, applies_to_all_machines")
      .order("created_at", { ascending: false }),
    supabase.from("machines").select("id, name, slug").eq("active", true).order("sort_order").order("name"),
    supabase.from("coupon_machines").select("coupon_id, machine_id"),
  ]);

  if (couponsResult.error || machinesResult.error || relationsResult.error) {
    throw new Error("No se pudieron cargar los cupones.");
  }

  const machineIdsByCoupon = new Map<string, string[]>();
  for (const relation of relationsResult.data ?? []) {
    const ids = machineIdsByCoupon.get(relation.coupon_id) ?? [];
    ids.push(relation.machine_id);
    machineIdsByCoupon.set(relation.coupon_id, ids);
  }

  const coupons: AdminCoupon[] = (couponsResult.data ?? []).map((coupon) => ({
    id: coupon.id,
    name: coupon.name,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discount_type,
    discountValue: asNumber(coupon.discount_value),
    active: coupon.active,
    startsAt: coupon.starts_at,
    endsAt: coupon.ends_at,
    eventName: coupon.event_name,
    appliesToAllMachines: coupon.applies_to_all_machines,
    machineIds: machineIdsByCoupon.get(coupon.id) ?? [],
  }));
  const machines: CouponMachine[] = (machinesResult.data ?? []).map((machine) => ({
    id: machine.id,
    name: machine.name,
    slug: machine.slug,
  }));

  return <div className="min-h-screen bg-background"><AdminNav active="coupons" userName={profile.full_name} /><CouponManager coupons={coupons} machines={machines} /></div>;
}
