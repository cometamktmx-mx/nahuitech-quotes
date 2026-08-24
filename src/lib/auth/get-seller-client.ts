import { createClient } from "@/lib/supabase/server";

export async function getSellerClient() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims.sub === "string" ? claimsData.claims.sub : null;

  if (claimsError || !userId) {
    throw new Error("No autorizado.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", userId)
    .maybeSingle();

  if (
    profileError ||
    !profile ||
    !profile.active ||
    (profile.role !== "seller" && profile.role !== "expo")
  ) {
    throw new Error("No autorizado.");
  }

  return supabase;
}
