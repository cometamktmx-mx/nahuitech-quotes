"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";

import {
  EmptyState,
  PrimaryButton,
  SectionCard,
  SecondaryButton,
  StatusBadge,
} from "@/components/ui";

import { deleteCoupon, saveCoupon, setCouponActive } from "./actions";

export type CouponMachine = {
  id: string;
  name: string;
  slug: string;
};

export type AdminCoupon = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  discountType: "FIXED_AMOUNT" | "PERCENTAGE";
  discountValue: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  eventName: string | null;
  appliesToAllMachines: boolean;
  machineIds: string[];
};

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

const inputClass =
  "min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10";

function CouponIcon({
  name,
  className = "size-6",
}: {
  name: "coupon" | "plus" | "edit" | "trash";
  className?: string;
}) {
  const paths = {
    coupon: (
      <>
        <path d="M4 9V5.5h16V9a2.5 2.5 0 0 0 0 5v4.5H4V14a2.5 2.5 0 0 0 0-5Z" />
        <path d="M12 7.5v1M12 11.5v1M12 15.5v1" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    edit: (
      <>
        <path d="m5 19 1.3-4.2L16.8 4.3a2.1 2.1 0 0 1 3 3L9.2 17.8z" />
        <path d="m14.8 6.3 3 3" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l.8 13h8.4L17 7M10 11v5M14 11v5" />
      </>
    ),
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

function ActiveToggle({
  defaultChecked,
}: {
  defaultChecked: boolean;
}) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4">
      <span>
        <span className="block text-sm font-bold text-foreground">Cupón activo</span>
        <span className="mt-1 block text-sm text-muted">
          Los vendedores podrán validarlo durante una cotización.
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
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid items-end bg-graphite/45 p-0 backdrop-blur-[2px] md:place-items-center md:p-6">
      <section
        aria-modal="true"
        className="max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-background shadow-[var(--shadow-modal)] md:max-w-3xl md:rounded-3xl"
        role="dialog"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-border bg-background px-5 py-5 md:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
              Promociones expo
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-foreground">
              {title}
            </h2>
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

function dateValue(value: string | null) {
  return value?.slice(0, 10) ?? "";
}

function promotionValue(coupon: AdminCoupon) {
  return coupon.discountType === "PERCENTAGE"
    ? `${coupon.discountValue}% de descuento`
    : `${currencyFormatter.format(coupon.discountValue)} de descuento`;
}

function promotionDates(coupon: AdminCoupon) {
  if (!coupon.startsAt && !coupon.endsAt) return "Sin vigencia definida";
  const formatter = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
  });
  const start = coupon.startsAt
    ? formatter.format(new Date(coupon.startsAt))
    : "Desde ahora";
  const end = coupon.endsAt
    ? formatter.format(new Date(coupon.endsAt))
    : "Sin fecha fin";
  return `${start} — ${end}`;
}

function CouponEditor({
  coupon,
  machines,
  onClose,
  onSaved,
}: {
  coupon?: AdminCoupon;
  machines: CouponMachine[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [discountType, setDiscountType] = useState<AdminCoupon["discountType"]>(
    coupon?.discountType ?? "PERCENTAGE"
  );
  const [appliesToAll, setAppliesToAll] = useState(
    coupon?.appliesToAllMachines ?? true
  );
  const [selectedMachineIds, setSelectedMachineIds] = useState<Set<string>>(
    () => new Set(coupon?.machineIds ?? [])
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function toggleMachine(machineId: string) {
    setSelectedMachineIds((current) => {
      const next = new Set(current);
      if (next.has(machineId)) next.delete(machineId);
      else next.add(machineId);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSaving(true);
    const result = await saveCoupon(new FormData(event.currentTarget));
    setIsSaving(false);

    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    onSaved();
  }

  return (
    <EditorShell
      onClose={onClose}
      title={coupon ? "Editar cupón" : "Nuevo cupón"}
    >
      <form className="grid gap-7" onSubmit={handleSubmit}>
        <input name="id" type="hidden" value={coupon?.id ?? ""} />

        <div className="grid gap-5 md:grid-cols-2">
          <label className="grid gap-2 md:col-span-2">
            <FieldLabel>Nombre de promoción</FieldLabel>
            <input
              className={inputClass}
              defaultValue={coupon?.name}
              name="name"
              placeholder="FESPA 2026"
              required
            />
          </label>
          <label className="grid gap-2">
            <FieldLabel>Código</FieldLabel>
            <input
              className={`${inputClass} uppercase`}
              defaultValue={coupon?.code}
              name="code"
              placeholder="FESPA26"
              required
            />
          </label>
          <label className="grid gap-2">
            <FieldLabel>
              Evento <span className="font-normal text-muted">(opcional)</span>
            </FieldLabel>
            <input
              className={inputClass}
              defaultValue={coupon?.eventName ?? ""}
              name="eventName"
              placeholder="FESPA 2026"
            />
          </label>
          <label className="grid gap-2 md:col-span-2">
            <FieldLabel>
              Descripción <span className="font-normal text-muted">(opcional)</span>
            </FieldLabel>
            <textarea
              className="min-h-24 rounded-xl border border-border bg-surface px-4 py-3 text-base text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              defaultValue={coupon?.description ?? ""}
              name="description"
            />
          </label>
        </div>

        <fieldset className="border-t border-border pt-6">
          <legend className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            Beneficio
          </legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              <input
                checked={discountType === "PERCENTAGE"}
                className="peer sr-only"
                name="discountType"
                onChange={() => setDiscountType("PERCENTAGE")}
                type="radio"
                value="PERCENTAGE"
              />
              <span className="flex min-h-24 cursor-pointer flex-col justify-center rounded-2xl border border-border bg-surface p-4 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/20">
                <span className="font-bold text-foreground">Porcentaje</span>
                <span className="mt-1 text-sm text-muted">Se calcula sobre el subtotal.</span>
              </span>
            </label>
            <label>
              <input
                checked={discountType === "FIXED_AMOUNT"}
                className="peer sr-only"
                name="discountType"
                onChange={() => setDiscountType("FIXED_AMOUNT")}
                type="radio"
                value="FIXED_AMOUNT"
              />
              <span className="flex min-h-24 cursor-pointer flex-col justify-center rounded-2xl border border-border bg-surface p-4 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/20">
                <span className="font-bold text-foreground">Cantidad fija</span>
                <span className="mt-1 text-sm text-muted">Nunca supera el subtotal.</span>
              </span>
            </label>
          </div>
          <label className="mt-5 grid gap-2">
            <FieldLabel>
              {discountType === "PERCENTAGE" ? "Porcentaje" : "Cantidad"}
            </FieldLabel>
            <div className="flex min-h-12 overflow-hidden rounded-xl border border-border bg-surface focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
              <span className="grid w-12 place-items-center border-r border-border text-sm font-bold text-muted">
                {discountType === "PERCENTAGE" ? "%" : "$"}
              </span>
              <input
                className="min-w-0 flex-1 bg-transparent px-4 text-base outline-none"
                defaultValue={coupon?.discountValue}
                max={discountType === "PERCENTAGE" ? "100" : undefined}
                min="0.01"
                name="discountValue"
                required
                step="0.01"
                type="number"
              />
            </div>
          </label>
        </fieldset>

        <fieldset className="grid gap-5 border-t border-border pt-6 md:grid-cols-2">
          <label className="grid gap-2">
            <FieldLabel>
              Fecha inicio <span className="font-normal text-muted">(opcional)</span>
            </FieldLabel>
            <input
              className={inputClass}
              defaultValue={dateValue(coupon?.startsAt ?? null)}
              name="startsAt"
              type="date"
            />
          </label>
          <label className="grid gap-2">
            <FieldLabel>
              Fecha fin <span className="font-normal text-muted">(opcional)</span>
            </FieldLabel>
            <input
              className={inputClass}
              defaultValue={dateValue(coupon?.endsAt ?? null)}
              name="endsAt"
              type="date"
            />
          </label>
        </fieldset>

        <fieldset className="border-t border-border pt-6">
          <legend className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            Aplicación
          </legend>
          <p className="mt-2 text-sm leading-6 text-muted">
            Define si esta promoción se puede usar en todo el catálogo o solo en equipos específicos.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              <input
                checked={appliesToAll}
                className="peer sr-only"
                name="appliesTo"
                onChange={() => setAppliesToAll(true)}
                type="radio"
                value="all"
              />
              <span className="flex min-h-20 cursor-pointer flex-col justify-center rounded-2xl border border-border bg-surface p-4 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/20">
                <span className="font-bold text-foreground">Todas las máquinas</span>
                <span className="mt-1 text-sm text-muted">Disponible en todo el catálogo activo.</span>
              </span>
            </label>
            <label>
              <input
                checked={!appliesToAll}
                className="peer sr-only"
                name="appliesTo"
                onChange={() => setAppliesToAll(false)}
                type="radio"
                value="selected"
              />
              <span className="flex min-h-20 cursor-pointer flex-col justify-center rounded-2xl border border-border bg-surface p-4 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/20">
                <span className="font-bold text-foreground">Máquinas seleccionadas</span>
                <span className="mt-1 text-sm text-muted">Solo las que marques abajo.</span>
              </span>
            </label>
          </div>
          {!appliesToAll ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {machines.map((machine) => (
                <label className="cursor-pointer" key={machine.id}>
                  <input
                    checked={selectedMachineIds.has(machine.id)}
                    className="peer sr-only"
                    name="machineIds"
                    onChange={() => toggleMachine(machine.id)}
                    type="checkbox"
                    value={machine.id}
                  />
                  <span className="flex min-h-20 items-center justify-between rounded-2xl border border-border bg-surface p-4 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/20">
                    <span>
                      <span className="block font-bold text-foreground">{machine.name}</span>
                      <span className="mt-1 block text-sm text-muted">{machine.slug}</span>
                    </span>
                    <span className="grid size-6 place-items-center rounded-full border border-border text-transparent transition peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground">
                      ✓
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {!appliesToAll && machines.length === 0 ? (
            <p className="mt-4 rounded-xl bg-danger/10 p-4 text-sm font-semibold text-danger">
              No hay máquinas activas para asignar.
            </p>
          ) : null}
        </fieldset>

        <ActiveToggle defaultChecked={coupon?.active ?? true} />
        {errorMessage ? (
          <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm font-bold text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
          <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
          <PrimaryButton disabled={isSaving} type="submit">
            {isSaving ? "Guardando..." : "Guardar cupón"}
          </PrimaryButton>
        </div>
      </form>
    </EditorShell>
  );
}

function CouponCard({
  coupon,
  isMutating,
  onEdit,
  onToggle,
  onDelete,
}: {
  coupon: AdminCoupon;
  isMutating: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <SectionCard className="flex min-h-80 flex-col p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <CouponIcon name="coupon" />
        </span>
        <StatusBadge tone={coupon.active ? "success" : "neutral"}>
          {coupon.active ? "Activo" : "Inactivo"}
        </StatusBadge>
      </div>
      <div className="mt-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
          {coupon.eventName ?? "Promoción expo"}
        </p>
        <h2 className="mt-2 text-xl font-bold tracking-[-0.02em] text-foreground">
          {coupon.name}
        </h2>
        <p className="mt-1 font-mono text-sm font-bold tracking-[0.08em] text-muted">
          {coupon.code}
        </p>
      </div>
      <p className="mt-5 text-2xl font-black tracking-[-0.03em] text-foreground">
        {promotionValue(coupon)}
      </p>
      <div className="mt-5 grid gap-2 text-sm text-muted">
        <p>{promotionDates(coupon)}</p>
        <p>
          {coupon.appliesToAllMachines
            ? "Todas las máquinas"
            : `${coupon.machineIds.length} ${coupon.machineIds.length === 1 ? "máquina seleccionada" : "máquinas seleccionadas"}`}
        </p>
        {coupon.description ? <p className="line-clamp-2">{coupon.description}</p> : null}
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
        <SecondaryButton onClick={onEdit}>
          <CouponIcon className="size-4" name="edit" />
          Editar
        </SecondaryButton>
        <SecondaryButton disabled={isMutating} onClick={onToggle}>
          {coupon.active ? "Desactivar" : "Activar"}
        </SecondaryButton>
      </div>
      <button
        className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50"
        disabled={isMutating}
        onClick={onDelete}
        type="button"
      >
        <CouponIcon className="size-4" name="trash" />
        Eliminar cupón
      </button>
    </SectionCard>
  );
}

export function CouponManager({
  coupons,
  machines,
}: {
  coupons: AdminCoupon[];
  machines: CouponMachine[];
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<AdminCoupon | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [isMutating, setIsMutating] = useState(false);

  function saved() {
    setEditor(null);
    setNotice("");
    router.refresh();
  }

  async function runAction(action: () => Promise<{ error?: string }>) {
    setNotice("");
    setIsMutating(true);
    const result = await action();
    setIsMutating(false);
    if (result.error) {
      setNotice(result.error);
      return;
    }
    router.refresh();
  }

  async function confirmDelete(coupon: AdminCoupon) {
    if (!window.confirm(`¿Eliminar el cupón “${coupon.code}”? Esta acción no se puede deshacer.`)) {
      return;
    }
    await runAction(() => deleteCoupon(coupon.id));
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">
        <span>Administración</span>
        <span className="text-primary">/</span>
        <span>Cupones</span>
      </div>
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold tracking-[-0.04em] text-foreground">
            Cupones y promociones
          </h1>
          <p className="mt-3 text-base leading-7 text-muted">
            Crea beneficios de expo y define exactamente en qué máquinas pueden aplicarse.
          </p>
        </div>
        <PrimaryButton onClick={() => setEditor("new")}>
          <CouponIcon className="size-5" name="plus" />
          Nuevo cupón
        </PrimaryButton>
      </div>

      {notice ? (
        <p className="rounded-2xl bg-danger/10 px-5 py-4 text-sm font-semibold text-danger" role="alert">
          {notice}
        </p>
      ) : null}

      {coupons.length === 0 ? (
        <EmptyState
          action={
            <PrimaryButton onClick={() => setEditor("new")}>
              <CouponIcon className="size-5" name="plus" />
              Crear primer cupón
            </PrimaryButton>
          }
          description="Prepara una promoción de expo con una vigencia y reglas claras de aplicación."
          icon={<CouponIcon className="size-8" name="coupon" />}
          title="No hay cupones todavía"
        />
      ) : (
        <section aria-label="Cupones" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {coupons.map((coupon) => (
            <CouponCard
              coupon={coupon}
              isMutating={isMutating}
              key={coupon.id}
              onDelete={() => confirmDelete(coupon)}
              onEdit={() => setEditor(coupon)}
              onToggle={() => runAction(() => setCouponActive(coupon.id, !coupon.active))}
            />
          ))}
        </section>
      )}

      {editor ? (
        <CouponEditor
          coupon={editor === "new" ? undefined : editor}
          key={editor === "new" ? "new-coupon" : editor.id}
          machines={machines}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      ) : null}
    </main>
  );
}
