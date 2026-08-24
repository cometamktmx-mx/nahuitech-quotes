"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";

import {
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "@/components/ui";

import {
  addSalespeopleInBulk,
  createSalesperson,
  updateSalesperson,
} from "./actions";

export type AdminSalesperson = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
};

function Icon({
  name,
  className = "size-5",
}: {
  name: "team" | "plus" | "edit" | "bulk";
  className?: string;
}) {
  const paths = {
    team: <><circle cx="9" cy="9" r="3" /><path d="M3.5 20c.7-3.1 2.6-4.7 5.5-4.7s4.8 1.6 5.5 4.7M16 7.5c2.5.2 3.9 1.5 4.3 4M16.6 15.5c2.1.5 3.4 1.9 3.9 4.2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    edit: <><path d="m5 19 1.3-4.2L16.8 4.3a2.1 2.1 0 0 1 3 3L9.2 17.8z" /><path d="m14.8 6.3 3 3" /></>,
    bulk: <><path d="M5 5.5h14M5 12h14M5 18.5h9" /><path d="M18 16v5M15.5 18.5h5" /></>,
  };

  return <svg aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-bold text-foreground">{children}</span>;
}

function ActiveToggle({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4">
      <span>
        <span className="block text-sm font-bold text-foreground">Vendedor activo</span>
        <span className="mt-1 block text-sm text-muted">Disponible para el selector de Expo.</span>
      </span>
      <input className="peer sr-only" defaultChecked={defaultChecked} name="active" type="checkbox" />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-border transition after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-surface after:shadow-sm after:transition peer-checked:bg-primary peer-checked:after:translate-x-5" />
    </label>
  );
}

function EditorShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid items-end bg-graphite/45 p-0 backdrop-blur-[2px] md:place-items-center md:p-6">
      <section aria-modal="true" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-background shadow-[var(--shadow-modal)] md:max-w-xl md:rounded-3xl" role="dialog">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-border bg-background px-5 py-5 md:px-7">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Equipo comercial</p><h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-foreground">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div>
          <button aria-label="Cerrar formulario" className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-lg text-muted" onClick={onClose} type="button">×</button>
        </div>
        <div className="p-5 md:p-7">{children}</div>
      </section>
    </div>
  );
}

function SalespersonEditor({
  salesperson,
  onClose,
  onSaved,
}: {
  salesperson: AdminSalesperson | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSaving(true);
    const result = salesperson
      ? await updateSalesperson(new FormData(event.currentTarget))
      : await createSalesperson(new FormData(event.currentTarget));
    setIsSaving(false);
    if (result.error) return setErrorMessage(result.error);
    onSaved();
  }

  return (
    <EditorShell description="Este registro comercial no requiere correo, contraseña ni una cuenta Auth." onClose={onClose} title={salesperson ? "Editar vendedor" : "Nuevo vendedor"}>
      <form className="grid gap-5" onSubmit={handleSubmit}>
        {salesperson ? <input name="id" type="hidden" value={salesperson.id} /> : null}
        <label className="grid gap-2"><FieldLabel>Nombre completo</FieldLabel><input autoComplete="name" className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={salesperson?.fullName} name="fullName" required /></label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="grid gap-2"><FieldLabel>Correo (opcional)</FieldLabel><input autoComplete="email" className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={salesperson?.email ?? ""} inputMode="email" name="email" type="email" /></label>
          <label className="grid gap-2"><FieldLabel>Teléfono (opcional)</FieldLabel><input autoComplete="tel" className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={salesperson?.phone ?? ""} inputMode="tel" name="phone" type="tel" /></label>
        </div>
        <label className="grid gap-2"><FieldLabel>Orden</FieldLabel><input className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={salesperson?.sortOrder ?? 0} min="0" name="sortOrder" type="number" /></label>
        <ActiveToggle defaultChecked={salesperson?.active ?? true} />
        {errorMessage ? <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm font-bold text-danger" role="alert">{errorMessage}</p> : null}
        <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end"><SecondaryButton onClick={onClose}>Cancelar</SecondaryButton><PrimaryButton disabled={isSaving} type="submit">{isSaving ? "Guardando..." : salesperson ? "Guardar cambios" : "Crear vendedor"}</PrimaryButton></div>
      </form>
    </EditorShell>
  );
}

function BulkSalespeopleEditor({ onClose, onSaved }: { onClose: () => void; onSaved: (created: number) => void }) {
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSaving(true);
    const result = await addSalespeopleInBulk(new FormData(event.currentTarget));
    setIsSaving(false);
    if (result.error) return setErrorMessage(result.error);
    onSaved(result.created ?? 0);
  }
  return <EditorShell description="Pega un nombre por línea. Los vacíos y duplicados por nombre se ignoran." onClose={onClose} title="Agregar varios vendedores"><form className="grid gap-5" onSubmit={handleSubmit}><label className="grid gap-2"><FieldLabel>Vendedores</FieldLabel><textarea className="min-h-56 rounded-2xl border border-border bg-surface px-4 py-3 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" name="names" placeholder={"Camilo\nDiana\nFelipe\nPaola"} required /></label>{errorMessage ? <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm font-bold text-danger" role="alert">{errorMessage}</p> : null}<div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end"><SecondaryButton onClick={onClose}>Cancelar</SecondaryButton><PrimaryButton disabled={isSaving} type="submit">{isSaving ? "Agregando..." : "Agregar vendedores"}</PrimaryButton></div></form></EditorShell>;
}

function SalespersonCard({ salesperson, disabled, onEdit, onToggle }: { salesperson: AdminSalesperson; disabled: boolean; onEdit: () => void; onToggle: () => void }) {
  const createdAt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(salesperson.createdAt));
  return <SectionCard className="flex min-h-64 flex-col p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon className="size-6" name="team" /></span><StatusBadge tone={salesperson.active ? "success" : "neutral"}>{salesperson.active ? "Activo" : "Inactivo"}</StatusBadge></div><div className="mt-5 min-w-0"><h2 className="truncate text-xl font-bold tracking-[-0.02em] text-foreground">{salesperson.fullName}</h2>{salesperson.email ? <p className="mt-2 truncate text-sm text-muted">{salesperson.email}</p> : null}{salesperson.phone ? <p className="mt-1 truncate text-sm text-muted">{salesperson.phone}</p> : null}</div><p className="mt-4 text-sm text-muted">Orden: {salesperson.sortOrder} · Alta: {createdAt}</p><div className="mt-auto grid grid-cols-2 gap-3 pt-6"><SecondaryButton disabled={disabled} onClick={onEdit}><Icon className="size-4" name="edit" />Editar</SecondaryButton><SecondaryButton disabled={disabled} onClick={onToggle}>{salesperson.active ? "Desactivar" : "Activar"}</SecondaryButton></div></SectionCard>;
}

export function SellerManager({ sellers }: { sellers: AdminSalesperson[] }) {
  const router = useRouter();
  const [editor, setEditor] = useState<AdminSalesperson | "new" | "bulk" | null>(null);
  const [notice, setNotice] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  function saved(message = "") { setEditor(null); setNotice(message); router.refresh(); }
  async function toggleSalesperson(salesperson: AdminSalesperson) {
    setNotice(""); setIsMutating(true);
    const formData = new FormData();
    formData.set("id", salesperson.id); formData.set("fullName", salesperson.fullName);
    formData.set("email", salesperson.email ?? ""); formData.set("phone", salesperson.phone ?? ""); formData.set("sortOrder", String(salesperson.sortOrder));
    if (!salesperson.active) formData.set("active", "on");
    const result = await updateSalesperson(formData); setIsMutating(false);
    if (result.error) return setNotice(result.error); router.refresh();
  }
  return <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 md:py-12"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted"><span>Administración</span><span className="text-primary">/</span><span>Vendedores</span></div><div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between"><div className="max-w-2xl"><h1 className="text-4xl font-bold tracking-[-0.04em] text-foreground">Vendedores</h1><p className="mt-3 text-base leading-7 text-muted">Administra las personas comerciales que aparecen en Expo. No necesitan una cuenta de acceso.</p></div><div className="grid gap-3 sm:flex"><SecondaryButton onClick={() => setEditor("bulk")}><Icon name="bulk" />Agregar varios</SecondaryButton><PrimaryButton onClick={() => setEditor("new")}><Icon name="plus" />Nuevo vendedor</PrimaryButton></div></div>{notice ? <p className="rounded-2xl bg-success/10 px-4 py-3 text-sm font-bold text-success" role="status">{notice}</p> : null}<SectionCard className="border-primary/15 bg-primary/5 p-5"><p className="font-bold text-foreground">Cuentas de acceso independientes</p><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Un vendedor comercial puede existir sin correo ni contraseña. Si después requiere login individual, se crea una cuenta con rol seller y se vincula a este registro comercial desde una operación administrativa separada.</p></SectionCard>{sellers.length === 0 ? <EmptyState action={<PrimaryButton onClick={() => setEditor("new")}><Icon name="plus" />Nuevo vendedor</PrimaryButton>} description="Agrega personas comerciales para que la cuenta Expo pueda atribuir cada cotización." icon={<Icon className="size-8" name="team" />} title="No hay vendedores todavía" /> : <section aria-label="Vendedores comerciales" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{sellers.map((salesperson) => <SalespersonCard disabled={isMutating} key={salesperson.id} onEdit={() => setEditor(salesperson)} onToggle={() => void toggleSalesperson(salesperson)} salesperson={salesperson} />)}</section>}{editor === "new" ? <SalespersonEditor onClose={() => setEditor(null)} onSaved={() => saved()} salesperson={null} /> : null}{editor === "bulk" ? <BulkSalespeopleEditor onClose={() => setEditor(null)} onSaved={(created) => saved(`${created} vendedor${created === 1 ? "" : "es"} agregado${created === 1 ? "" : "s"}.`)} /> : null}{editor && editor !== "new" && editor !== "bulk" ? <SalespersonEditor onClose={() => setEditor(null)} onSaved={() => saved()} salesperson={editor} /> : null}</main>;
}
