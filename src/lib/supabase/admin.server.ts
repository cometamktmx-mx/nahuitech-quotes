import { createClient } from "@supabase/supabase-js";

const missingAdminConfigurationMessage =
  "Falta configurar SUPABASE_SECRET_KEY para administrar vendedores.";

export function hasSupabaseAdminConfiguration() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  );
}

export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(missingAdminConfigurationMessage);
  }

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function isMissingSupabaseAdminConfiguration(
  error: unknown
): error is Error {
  return (
    error instanceof Error && error.message === missingAdminConfigurationMessage
  );
}
