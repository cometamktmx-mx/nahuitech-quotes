import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark, primaryButtonClass, SectionCard } from "@/components/ui";
import { getActiveSessionPath } from "@/lib/auth/get-active-session-path";

export default async function Home() {
  const activeSessionPath = await getActiveSessionPath();

  if (activeSessionPath) {
    redirect(activeSessionPath);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-8">
      <SectionCard className="w-full max-w-2xl overflow-hidden">
        <div className="bg-graphite p-7 text-on-graphite sm:p-10">
          <span className="[&>div>span:last-child]:text-on-graphite"><BrandMark /></span>
          <p className="mt-16 text-xs font-bold uppercase tracking-[0.18em] text-primary">Software comercial</p>
          <h1 className="mt-4 max-w-xl text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Tecnología que se siente tan sólida como tu maquinaria.</h1>
        </div>
        <div className="flex flex-col items-start gap-6 p-7 sm:flex-row sm:items-end sm:justify-between sm:p-10">
          <p className="max-w-md text-base leading-7 text-muted">Accede al espacio de trabajo de Nahuitech para gestionar el catálogo y la operación comercial.</p>
          <Link className={primaryButtonClass} href="/login">Iniciar sesión <span aria-hidden="true">→</span></Link>
        </div>
      </SectionCard>
    </main>
  );
}
