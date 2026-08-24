import { redirect } from "next/navigation";

import { LoginForm } from "./login-form";
import { BrandMark, SectionCard } from "@/components/ui";
import { getActiveSessionPath } from "@/lib/auth/get-active-session-path";

export default async function LoginPage() {
  const activeSessionPath = await getActiveSessionPath();

  if (activeSessionPath) {
    redirect(activeSessionPath);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-8">
      <SectionCard className="w-full max-w-md overflow-hidden">
        <div className="border-b border-border bg-graphite p-7 text-on-graphite">
          <span className="[&>div>span:last-child]:text-on-graphite"><BrandMark /></span>
          <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-primary">Acceso comercial</p>
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em]">Iniciar sesión</h1>
          <p className="mt-3 text-base leading-7 text-on-graphite-muted">Accede con tu cuenta autorizada.</p>
        </div>
        <div className="p-6 sm:p-7">
          <LoginForm />
        </div>
      </SectionCard>
    </main>
  );
}
