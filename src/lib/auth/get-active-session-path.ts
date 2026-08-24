import { createClient } from "@/lib/supabase/server";

export async function getActiveSessionPath() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims.sub === "string" ? claimsData.claims.sub : null;

  if (claimsError || !userId) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile || !profile.active) {
    return null;
  }

  return profile.role === "admin" ? "/admin" : "/seller";
}
