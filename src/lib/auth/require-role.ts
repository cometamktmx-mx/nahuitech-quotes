import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type ProfileRole = "admin" | "seller" | "expo";

export async function requireRole(requiredRole: ProfileRole) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims.sub === "string" ? claimsData.claims.sub : null;

  if (claimsError || !userId) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, role, active")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile || !profile.active) {
    redirect("/login");
  }

  if (profile.role !== requiredRole) {
    redirect(profile.role === "admin" ? "/admin" : "/seller");
  }

  return profile;
}

export async function requireSellerFlowRole() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims.sub === "string" ? claimsData.claims.sub : null;

  if (claimsError || !userId) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, active, salesperson_id")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile || !profile.active) redirect("/login");
  if (profile.role === "admin") redirect("/admin");
  if (profile.role !== "seller" && profile.role !== "expo") redirect("/login");

  return profile;
}
