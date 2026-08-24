import { createClient } from "@/lib/supabase/server";

export default async function TestSupabasePage() {
  let initialized = false;

  try {
    await createClient();
    initialized = true;
  } catch {
    initialized = false;
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Prueba Supabase</h1>
      <p>
        {initialized
          ? "Supabase se inicializó correctamente."
          : "No se pudo inicializar Supabase. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en .env.local."}
      </p>
    </main>
  );
}
