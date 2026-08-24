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

import { createSeller, updateSeller } from "./actions";

export type AdminSeller = {
  id: string;
  fullName: string;
  email: string | null;
  active: boolean;
  createdAt: string;
};

function SellerIcon({
  name,
  className = "size-5",
}: {
  name: "team" | "plus" | "edit" | "mail" | "lock";
  className?: string;
}) {
  const paths = {
    team: <><circle cx="9" cy="9" r="3" /><path d="M3.5 20c.7-3.1 2.6-4.7 5.5-4.7s4.8 1.6 5.5 4.7M16 7.5c2.5.2 3.9 1.5 4.3 4M16.6 15.5c2.1.5 3.4 1.9 3.9 4.2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    edit: <><path d="m5 19 1.3-4.2L16.8 4.3a2.1 2.1 0 0 1 3 3L9.2 17.8z" /><path d="m14.8 6.3 3 3" /></>,
    mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="1.8" /><path d="m4.8 7 7.2 5.7L19.2 7" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14v2" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-bold text-foreground">{children}</span>;
}

function ActiveToggle({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4">
      <span>
        <span className="block text-sm font-bold text-foreground">Vendedor activo</span>
        <span className="mt-1 block text-sm text-muted">
          Puede iniciar sesión y usar el flujo de vendedor.
        </span>
      </span>
      <input
        className="peer sr-only"
        defaultChecked={defaultChecked}
        name="active"
        type="checkbox"
      />
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
      <section
        aria-modal="true"
        className="max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-background shadow-[var(--shadow-modal)] md:max-w-xl md:rounded-3xl"
        role="dialog"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-border bg-background px-5 py-5 md:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
              Equipo comercial
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-foreground">
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted">{description}</p>
          </div>
          <button
            aria-label="Cerrar formulario"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-lg text-muted"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="p-5 md:p-7">{children}</div>
      </section>
    </div>
  );
}

function CreateSellerEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSaving(true);
    const result = await createSeller(new FormData(event.currentTarget));
    setIsSaving(false);

    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    onSaved();
  }

  return (
    <EditorShell
      description="Crea un acceso para una persona del equipo comercial. No se crean cuentas públicas."
      onClose={onClose}
      title="Nuevo vendedor"
    >
      <form className="grid gap-5" onSubmit={handleSubmit}>
        <label className="grid gap-2">
          <FieldLabel>Nombre completo</FieldLabel>
          <input
            autoComplete="name"
            className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            name="fullName"
            required
          />
        </label>
        <label className="grid gap-2">
          <FieldLabel>Correo</FieldLabel>
          <span className="relative">
            <SellerIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" name="mail" />
            <input
              autoComplete="email"
              className="min-h-12 w-full rounded-xl border border-border bg-surface py-3 pl-12 pr-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              inputMode="email"
              name="email"
              required
              type="email"
            />
          </span>
        </label>
        <label className="grid gap-2">
          <FieldLabel>Contraseña temporal</FieldLabel>
          <span className="relative">
            <SellerIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" name="lock" />
            <input
              autoComplete="new-password"
              className="min-h-12 w-full rounded-xl border border-border bg-surface py-3 pl-12 pr-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              minLength={8}
              name="temporaryPassword"
              required
              type="password"
            />
          </span>
          <span className="text-xs leading-5 text-muted">
            Mínimo 8 caracteres. El restablecimiento de contraseña se incorporará después.
          </span>
        </label>
        <ActiveToggle defaultChecked />

        {errorMessage ? (
          <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm font-bold text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
          <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
          <PrimaryButton disabled={isSaving} type="submit">
            {isSaving ? "Creando..." : "Crear vendedor"}
          </PrimaryButton>
        </div>
      </form>
    </EditorShell>
  );
}

function EditSellerEditor({
  seller,
  onClose,
  onSaved,
}: {
  seller: AdminSeller;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSaving(true);
    const result = await updateSeller(new FormData(event.currentTarget));
    setIsSaving(false);

    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    onSaved();
  }

  return (
    <EditorShell
      description="Puedes actualizar el nombre y el acceso del vendedor. Su rol siempre permanece como vendedor."
      onClose={onClose}
      title="Editar vendedor"
    >
      <form className="grid gap-5" onSubmit={handleSubmit}>
        <input name="id" type="hidden" value={seller.id} />
        <label className="grid gap-2">
          <FieldLabel>Nombre completo</FieldLabel>
          <input
            autoComplete="name"
            className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            defaultValue={seller.fullName}
            name="fullName"
            required
          />
        </label>
        <div className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-muted">
          <span className="font-bold text-foreground">Correo:</span>{" "}
          {seller.email ?? "No disponible"}
        </div>
        <ActiveToggle defaultChecked={seller.active} />
        <p className="text-sm leading-6 text-muted">
          Restablecimiento de contraseña: pendiente.
        </p>

        {errorMessage ? (
          <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm font-bold text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
          <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
          <PrimaryButton disabled={isSaving} type="submit">
            {isSaving ? "Guardando..." : "Guardar cambios"}
          </PrimaryButton>
        </div>
      </form>
    </EditorShell>
  );
}

function SellerCard({
  seller,
  disabled,
  onEdit,
  onToggle,
}: {
  seller: AdminSeller;
  disabled: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const createdAt = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
  }).format(new Date(seller.createdAt));

  return (
    <SectionCard className="flex min-h-64 flex-col p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <SellerIcon className="size-6" name="team" />
        </span>
        <StatusBadge tone={seller.active ? "success" : "neutral"}>
          {seller.active ? "Activo" : "Inactivo"}
        </StatusBadge>
      </div>
      <div className="mt-5 min-w-0">
        <h2 className="truncate text-xl font-bold tracking-[-0.02em] text-foreground">
          {seller.fullName}
        </h2>
        <p className="mt-2 truncate text-sm text-muted">
          {seller.email ?? "Correo disponible al configurar el acceso administrativo."}
        </p>
      </div>
      <p className="mt-4 text-sm text-muted">Alta: {createdAt}</p>
      <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
        <SecondaryButton disabled={disabled} onClick={onEdit}>
          <SellerIcon className="size-4" name="edit" />
          Editar
        </SecondaryButton>
        <SecondaryButton disabled={disabled} onClick={onToggle}>
          {seller.active ? "Desactivar" : "Activar"}
        </SecondaryButton>
      </div>
    </SectionCard>
  );
}

export function SellerManager({
  sellers,
  authAdministrationAvailable,
}: {
  sellers: AdminSeller[];
  authAdministrationAvailable: boolean;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<AdminSeller | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [isMutating, setIsMutating] = useState(false);

  function saved() {
    setEditor(null);
    setNotice("");
    router.refresh();
  }

  async function toggleSeller(seller: AdminSeller) {
    setNotice("");
    setIsMutating(true);
    const formData = new FormData();
    formData.set("id", seller.id);
    formData.set("fullName", seller.fullName);
    if (!seller.active) {
      formData.set("active", "on");
    }
    const result = await updateSeller(formData);
    setIsMutating(false);

    if (result.error) {
      setNotice(result.error);
      return;
    }

    router.refresh();
  }

  const managementDisabled = !authAdministrationAvailable || isMutating;

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">
        <span>Administración</span>
        <span className="text-primary">/</span>
        <span>Vendedores</span>
      </div>
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold tracking-[-0.04em] text-foreground">
            Vendedores
          </h1>
          <p className="mt-3 text-base leading-7 text-muted">
            Administra el acceso del equipo comercial sin alterar su historial de cotizaciones.
          </p>
        </div>
        <PrimaryButton
          disabled={!authAdministrationAvailable}
          onClick={() => setEditor("new")}
          title={
            authAdministrationAvailable
              ? undefined
              : "Configura SUPABASE_SECRET_KEY en el servidor para crear vendedores."
          }
        >
          <SellerIcon name="plus" />
          Nuevo vendedor
        </PrimaryButton>
      </div>

      {!authAdministrationAvailable ? (
        <section className="rounded-2xl border border-warning/25 bg-warning/10 px-5 py-4 text-sm leading-6 text-foreground">
          <p className="font-bold">Administración de accesos pendiente de configuración.</p>
          <p className="mt-1 text-muted">
            Añade <code className="font-bold text-foreground">SUPABASE_SECRET_KEY</code> solo al entorno del servidor y reinicia la aplicación. La clave nunca se envía al navegador.
          </p>
        </section>
      ) : null}

      {notice ? (
        <p className="rounded-2xl bg-danger/10 px-5 py-4 text-sm font-semibold text-danger" role="alert">
          {notice}
        </p>
      ) : null}

      {sellers.length === 0 ? (
        <EmptyState
          action={
            <PrimaryButton
              disabled={!authAdministrationAvailable}
              onClick={() => setEditor("new")}
            >
              <SellerIcon name="plus" />
              Crear primer vendedor
            </PrimaryButton>
          }
          description="Crea el primer acceso para que el equipo comercial pueda usar el cotizador Expo."
          icon={<SellerIcon className="size-8" name="team" />}
          title="No hay vendedores todavía"
        />
      ) : (
        <section aria-label="Vendedores" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {sellers.map((seller) => (
            <SellerCard
              disabled={managementDisabled}
              key={seller.id}
              onEdit={() => setEditor(seller)}
              onToggle={() => toggleSeller(seller)}
              seller={seller}
            />
          ))}
        </section>
      )}

      {editor === "new" ? (
        <CreateSellerEditor onClose={() => setEditor(null)} onSaved={saved} />
      ) : null}
      {editor && editor !== "new" ? (
        <EditSellerEditor
          key={editor.id}
          onClose={() => setEditor(null)}
          onSaved={saved}
          seller={editor}
        />
      ) : null}
    </main>
  );
}
