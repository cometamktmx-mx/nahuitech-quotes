"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.user) {
        setErrorMessage("Correo o contraseña incorrectos.");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, active")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError || !profile || !profile.active) {
        await supabase.auth.signOut();
        setErrorMessage(
          "Tu cuenta no tiene un perfil activo. Contacta a un administrador."
        );
        return;
      }

      router.replace(profile.role === "admin" ? "/admin" : "/seller");
      router.refresh();
    } catch {
      setErrorMessage("No se pudo iniciar sesión. Intenta de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit}>
      <label className="grid gap-2" htmlFor="email">
        <span className="text-sm font-bold text-foreground">Correo electrónico</span>
        <input
          autoComplete="email"
          className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base text-foreground outline-none transition placeholder:text-muted focus:border-primary focus:ring-4 focus:ring-primary/10"
          id="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>

      <label className="grid gap-2" htmlFor="password">
        <span className="text-sm font-bold text-foreground">Contraseña</span>
        <input
          autoComplete="current-password"
          className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base text-foreground outline-none transition placeholder:text-muted focus:border-primary focus:ring-4 focus:ring-primary/10"
          id="password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>

      {errorMessage ? (
        <p aria-live="polite" className="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <button
        className="min-h-12 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-[var(--shadow-primary)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Iniciando sesión..." : "Iniciar sesión"}
      </button>
    </form>
  );
}
