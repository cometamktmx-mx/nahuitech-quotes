"use client";

import { type FormEvent, type ReactNode, useState, useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  EmptyState,
  PrimaryButton,
  SectionCard,
  SecondaryButton,
  StatusBadge,
} from "@/components/ui";

import {
  deleteAddon,
  deleteMachine,
  saveAddon,
  saveMachine,
  setAddonActive,
  setMachineActive,
} from "./actions";

export type CatalogMachine = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string;
  basePrice: number;
  numberOfBases: number | null;
  supportsAddons: boolean;
  deliveryPolicy: "FLEXIBLE" | "INSTALLATION_REQUIRED" | "SHIPPING_ONLY";
  variantSelectionRequired: boolean;
  allowedVariantTypes: Array<"AUTOMATIC" | "SEMI_AUTOMATIC">;
  imageUrl: string | null;
  active: boolean;
  sortOrder: number;
  variants: Array<{ id: string; variantType: "AUTOMATIC" | "SEMI_AUTOMATIC"; displayName: string; price: number | null; description: string | null; active: boolean; sortOrder: number }>;
};

export type CatalogAddon = {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number;
  calculationType: "FIXED" | "PER_BASE" | "QUANTITY";
  required: boolean;
  active: boolean;
  compatibilities: Array<{
    machineId: string;
    unitPriceOverride: number | null;
    descriptionOverride: string | null;
  }>;
};

type CatalogManagerProps = {
  machines: CatalogMachine[];
  addons: CatalogAddon[];
};

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
});

function CatalogIcon({
  name,
  className = "size-6",
}: {
  name: "machine" | "addon" | "plus" | "edit" | "trash" | "bases" | "image" | "arrow";
  className?: string;
}) {
  const paths = {
    machine: <><path d="M4 16.5h16v3H4z" /><path d="M6.5 16.5V11h11v5.5M9 11V7h6v4" /><path d="M7.5 21h.01M16.5 21h.01" /></>,
    addon: <><path d="M5 8.5V5h14v3.5a2.5 2.5 0 0 0 0 5V17H5v-3.5a2.5 2.5 0 0 0 0-5Z" /><path d="M12 7v1M12 11v1M12 15v1" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    edit: <><path d="m5 19 1.3-4.2L16.8 4.3a2.1 2.1 0 0 1 3 3L9.2 17.8z" /><path d="m14.8 6.3 3 3" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l.8 13h8.4L17 7M10 11v5M14 11v5" /></>,
    bases: <><path d="M5 17.5h14L12 5z" /><path d="M8.3 14h7.4" /></>,
    image: <><rect height="14" rx="1.5" width="16" x="4" y="5" /><circle cx="9" cy="10" r="1.2" /><path d="m6 17 4.4-4.4 3 3L16 13l2 2" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  };

  return (
    <svg aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-bold text-foreground">{children}</span>;
}

function ToggleField({
  name,
  defaultChecked,
  title,
  description,
  disabled = false,
}: {
  name: string;
  defaultChecked: boolean;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <span>
        <span className="block text-sm font-bold text-foreground">{title}</span>
        <span className="mt-1 block text-sm text-muted">{description}</span>
      </span>
      <input className="peer sr-only" defaultChecked={defaultChecked} disabled={disabled} name={name} type="checkbox" />
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
      <section aria-modal="true" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-background shadow-[var(--shadow-modal)] md:max-w-3xl md:rounded-3xl" role="dialog">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-border bg-background px-5 py-5 md:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Catálogo</p>
            <h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted">{description}</p>
          </div>
          <button aria-label="Cerrar formulario" className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-lg text-muted" onClick={onClose} type="button">×</button>
        </div>
        <div className="p-5 md:p-7">{children}</div>
      </section>
    </div>
  );
}

function MachineEditor({
  machine,
  onClose,
  onSaved,
}: {
  machine?: CatalogMachine;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  useEffect(() => {
    return () => { if (photoPreview) URL.revokeObjectURL(photoPreview); };
  }, [photoPreview]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSaving(true);
    const data = new FormData(event.currentTarget);
    data.set("removePhoto", removePhoto ? "yes" : "no");
    if (photo) data.set("machinePhoto", photo);
    let result;
    try { result = await saveMachine(data); }
    catch { result = { error: "No se pudo guardar. Revisa tu conexión e intenta nuevamente." }; }
    setIsSaving(false);

    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    onSaved();
  }

  return (
    <EditorShell description="Define los datos técnicos y comerciales de la máquina." onClose={onClose} title={machine ? "Editar máquina" : "Nueva máquina"}>
      <form className="grid gap-6" onSubmit={handleSubmit}>
        <p className="rounded-xl bg-primary/10 p-3 text-sm">Los precios incluyen IVA. El cotizador mostrará automáticamente el valor antes de IVA. Esto aplica también a versiones y precios especiales.</p>
        <input name="id" type="hidden" value={machine?.id ?? ""} />
        <input name="variantSelectionRequired" type="hidden" value={machine?.variantSelectionRequired === false ? "" : "on"} />
        <input name="allowedVariantTypes" type="hidden" value={(machine?.allowedVariantTypes ?? ["AUTOMATIC", "SEMI_AUTOMATIC"]).join(",")} />

        <div className="grid gap-5 md:grid-cols-2">
          <label className="grid gap-2">
            <FieldLabel>Nombre</FieldLabel>
            <input className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={machine?.name} name="name" required />
          </label>
          <label className="grid gap-2">
            <FieldLabel>Slug</FieldLabel>
            <input className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={machine?.slug} name="slug" placeholder="pro-8" required />
          </label>
          <label className="grid gap-2 md:col-span-2">
            <FieldLabel>Descripción corta</FieldLabel>
            <textarea className="min-h-28 rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={machine?.shortDescription} name="shortDescription" required />
          </label>
        </div>

        <div className="border-t border-border pt-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Configuración comercial</p>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <label className="grid gap-2">
              <FieldLabel>Precio base · con IVA incluido</FieldLabel>
              <div className="flex min-h-12 overflow-hidden rounded-xl border border-border bg-surface focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
                <span className="grid w-12 place-items-center border-r border-border text-sm font-bold text-muted">$</span>
                <input className="min-w-0 flex-1 bg-transparent px-4 text-base outline-none" defaultValue={machine?.basePrice} min="0" name="basePrice" required step="0.01" type="number" />
              </div>
            </label>
            <label className="grid gap-2">
              <FieldLabel>Número de bases</FieldLabel>
              <input className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={machine?.numberOfBases ?? ""} min="1" name="numberOfBases" placeholder="No aplica" step="1" type="number" />
            </label>
            <section className="grid gap-3">
              <FieldLabel>Fotografía</FieldLabel>
              {(photo ? photoPreview : !removePhoto ? machine?.imageUrl : null) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="h-48 w-full rounded-xl bg-surface-muted object-contain" alt="Vista previa de la máquina" src={(photo ? photoPreview : machine?.imageUrl) ?? undefined} />
              ) : <div className="grid h-40 place-items-center rounded-xl bg-surface-muted text-muted">Sin fotografía</div>}
              <label className="grid min-h-12 cursor-pointer gap-2 rounded-xl border border-border p-3 font-bold">
                {photo || (!removePhoto && machine?.imageUrl) ? "Cambiar fotografía" : "Subir fotografía"}
                <input accept="image/png,image/jpeg,image/webp" disabled={isSaving} type="file" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
                    setErrorMessage("Selecciona PNG, JPG o WEBP de hasta 8 MB."); event.target.value = ""; return;
                  }
                  setErrorMessage(""); setPhotoPreview(URL.createObjectURL(file)); setPhoto(file); setRemovePhoto(false);
                  event.target.value = "";
                }} />
              </label>
              <p className="text-sm text-muted">PNG, JPG o WEBP · Hasta 8 MB. Se optimiza al guardar.</p>
              {(photo || (!removePhoto && machine?.imageUrl)) ? <SecondaryButton disabled={isSaving} onClick={() => { setPhoto(null); setPhotoPreview(null); setRemovePhoto(true); }}>Eliminar fotografía</SecondaryButton> : null}
            </section>
            <label className="grid gap-2">
              <FieldLabel>Orden de aparición</FieldLabel>
              <input className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={machine?.sortOrder ?? 0} min="0" name="sortOrder" required step="1" type="number" />
            </label>
          </div>
          <label className="mt-5 grid gap-2 md:max-w-md">
            <FieldLabel>Política de entrega</FieldLabel>
            <select className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={machine?.deliveryPolicy ?? "FLEXIBLE"} name="deliveryPolicy">
              <option value="FLEXIBLE">Flexible — vendedor elige</option>
              <option value="INSTALLATION_REQUIRED">Instalación requerida</option>
              <option value="SHIPPING_ONLY">Solo envío</option>
            </select>
          </label>
          {machine?.variants.length ? <section className="mt-6 border-t border-border pt-6"><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Versiones</p><p className="mt-2 text-sm leading-6 text-muted">El precio comercial se toma de la versión activa. La selección del vendedor respeta las versiones aplicables configuradas para esta máquina.</p><div className="mt-4 grid gap-4 md:grid-cols-2">{machine.variants.map((variant) => { const isCommerciallyAllowed = machine.allowedVariantTypes.includes(variant.variantType); return <div className="rounded-2xl border border-border bg-surface-muted/50 p-4" key={variant.id}><input name="variantIds" type="hidden" value={variant.id} /><input name={`variantType:${variant.id}`} type="hidden" value={variant.variantType} /><p className="font-bold text-foreground">{variant.displayName}</p>{!isCommerciallyAllowed ? <p className="mt-1 text-sm font-semibold text-muted">No aplicable comercialmente</p> : null}<label className="mt-3 grid gap-2"><FieldLabel>Precio con IVA incluido</FieldLabel><input className="min-h-11 rounded-xl border border-border bg-surface px-3 disabled:cursor-not-allowed disabled:opacity-60" defaultValue={variant.price ?? ""} disabled={!isCommerciallyAllowed} min="0.01" name={`variantPrice:${variant.id}`} placeholder="Sin precio" step="0.01" type="number" /></label><label className="mt-3 grid gap-2"><FieldLabel>Descripción comercial</FieldLabel><textarea className="min-h-24 rounded-xl border border-border bg-surface px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60" defaultValue={variant.description ?? ""} disabled={!isCommerciallyAllowed} name={`variantDescription:${variant.id}`} placeholder="Descripción de esta versión" /></label><ToggleField defaultChecked={variant.active} description="Solo puede estar disponible con precio válido." disabled={!isCommerciallyAllowed} name={`variantActive:${variant.id}`} title="Disponible" /></div>; })}</div></section> : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleField defaultChecked={machine?.active ?? true} description="Se mostrará como disponible dentro del catálogo." name="active" title="Máquina activa" />
          <ToggleField defaultChecked={machine?.supportsAddons ?? true} description="Permite compatibilidades y configuración adicional." name="supportsAddons" title="Admite add-ons" />
        </div>

        {errorMessage ? <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm font-semibold text-danger" role="alert">{errorMessage}</p> : null}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
          <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
          <PrimaryButton disabled={isSaving} type="submit">{isSaving ? "Guardando..." : "Guardar máquina"}</PrimaryButton>
        </div>
      </form>
    </EditorShell>
  );
}

function AddonEditor({
  addon,
  machines,
  onClose,
  onSaved,
}: {
  addon?: CatalogAddon;
  machines: CatalogMachine[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [calculationType, setCalculationType] = useState<"FIXED" | "PER_BASE" | "QUANTITY">(addon?.calculationType ?? "FIXED");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSaving(true);
    const result = await saveAddon(new FormData(event.currentTarget));
    setIsSaving(false);

    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    onSaved();
  }

  return (
    <EditorShell description="Configura el precio, el tipo de cálculo y dónde estará disponible." onClose={onClose} title={addon ? "Editar add-on" : "Nuevo add-on"}>
      <form className="grid gap-6" onSubmit={handleSubmit}>
        <p className="rounded-xl bg-primary/10 p-3 text-sm">Los precios incluyen IVA. El cotizador mostrará automáticamente el valor antes de IVA. Esto aplica también a versiones y precios especiales.</p>
        <input name="id" type="hidden" value={addon?.id ?? ""} />

        <div className="grid gap-5 md:grid-cols-2">
          <label className="grid gap-2">
            <FieldLabel>Nombre</FieldLabel>
            <input className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={addon?.name} name="name" required />
          </label>
          <label className="grid gap-2">
            <FieldLabel>Precio unitario · con IVA incluido</FieldLabel>
            <div className="flex min-h-12 overflow-hidden rounded-xl border border-border bg-surface focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
              <span className="grid w-12 place-items-center border-r border-border text-sm font-bold text-muted">$</span>
              <input className="min-w-0 flex-1 bg-transparent px-4 text-base outline-none" defaultValue={addon?.unitPrice} min="0" name="unitPrice" required step="0.01" type="number" />
            </div>
          </label>
          <label className="grid gap-2 md:col-span-2">
            <FieldLabel>Descripción</FieldLabel>
            <textarea className="min-h-24 rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" defaultValue={addon?.description ?? ""} name="description" />
          </label>
        </div>

        <fieldset className="border-t border-border pt-6">
          <legend className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Tipo de cálculo</legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <input checked={calculationType === "FIXED"} className="peer sr-only" id="fixed" name="calculationType" onChange={() => setCalculationType("FIXED")} type="radio" value="FIXED" />
              <label className="flex min-h-24 cursor-pointer flex-col justify-center rounded-2xl border border-border bg-surface p-4 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/20" htmlFor="fixed">
                <span className="font-bold text-foreground">Precio fijo</span>
                <span className="mt-1 text-sm text-muted">Se suma una sola vez.</span>
              </label>
            </div>
            <div>
              <input checked={calculationType === "PER_BASE"} className="peer sr-only" id="per-base" name="calculationType" onChange={() => setCalculationType("PER_BASE")} type="radio" value="PER_BASE" />
              <label className="flex min-h-24 cursor-pointer flex-col justify-center rounded-2xl border border-border bg-surface p-4 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/20" htmlFor="per-base">
                <span className="font-bold text-foreground">Por base</span>
                <span className="mt-1 text-sm text-muted">Se multiplica según la máquina.</span>
              </label>
            </div>
            <div>
              <input checked={calculationType === "QUANTITY"} className="peer sr-only" id="quantity" name="calculationType" onChange={() => setCalculationType("QUANTITY")} type="radio" value="QUANTITY" />
              <label className="flex min-h-24 cursor-pointer flex-col justify-center rounded-2xl border border-border bg-surface p-4 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/20" htmlFor="quantity">
                <span className="font-bold text-foreground">Por cantidad</span>
                <span className="mt-1 text-sm text-muted">El vendedor define unidades.</span>
              </label>
            </div>
          </div>
        </fieldset>

        {calculationType === "PER_BASE" ? (
          <div className="flex gap-4 rounded-2xl bg-primary/10 p-4 text-primary-hover">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><CatalogIcon name="bases" /></span>
            <p className="text-sm leading-6"><strong className="font-bold">Este precio se multiplicará por el número de bases de la máquina.</strong><br />Ejemplo: $4,060 × 8 bases = $32,480.</p>
          </div>
        ) : null}

        {calculationType === "QUANTITY" ? (
          <div className="rounded-2xl bg-primary/10 p-4 text-sm leading-6 text-primary-hover"><strong className="font-bold">La cantidad se elige en el cotizador.</strong><br />Cada unidad se suma al precio unitario, sin máximo definido.</div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleField defaultChecked={addon?.required ?? false} description="Se incluirá como parte obligatoria de la configuración." name="required" title="Add-on obligatorio" />
          <ToggleField defaultChecked={addon?.active ?? true} description="Estará disponible dentro del catálogo." name="active" title="Add-on activo" />
        </div>

        <fieldset className="border-t border-border pt-6">
          <legend className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Máquinas compatibles</legend>
          <p className="mt-2 text-sm leading-6 text-muted">Selecciona dónde se podrá ofrecer este add-on.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {machines.map((machine) => {
              const compatibility = addon?.compatibilities.find((relation) => relation.machineId === machine.id);
              return (
                <div className="grid gap-3" key={machine.id}>
                  <label className={machine.supportsAddons ? "cursor-pointer" : "cursor-not-allowed opacity-55"}>
                    <input className="peer sr-only" defaultChecked={Boolean(compatibility)} disabled={!machine.supportsAddons} name="machineIds" type="checkbox" value={machine.id} />
                    <span className="flex min-h-20 items-center justify-between rounded-2xl border border-border bg-surface p-4 transition peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:ring-2 peer-checked:ring-primary/20">
                      <span>
                        <span className="block font-bold text-foreground">{machine.name}</span>
                        <span className="mt-1 block text-sm text-muted">{machine.numberOfBases ? `${machine.numberOfBases} bases` : "Sin bases"}{machine.supportsAddons ? "" : " · No admite add-ons"}{machine.active ? "" : " · Inactiva"}</span>
                      </span>
                      <span className="grid size-6 place-items-center rounded-full border border-border text-transparent transition peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground">✓</span>
                    </span>
                  </label>
                  {machine.supportsAddons ? <div className="grid gap-2 rounded-xl bg-surface-muted/60 p-3"><input className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary" defaultValue={compatibility?.unitPriceOverride ?? ""} min="0" name={`unitPriceOverride:${machine.id}`} placeholder="Precio especial con IVA (opcional)" step="0.01" type="number" /><textarea className="min-h-18 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" defaultValue={compatibility?.descriptionOverride ?? ""} name={`descriptionOverride:${machine.id}`} placeholder="Descripción específica (opcional)" /></div> : null}
                </div>
              );
            })}
          </div>
          {machines.length === 0 ? <p className="mt-4 rounded-xl bg-surface-muted p-4 text-sm text-muted">Primero crea una máquina para asignar compatibilidades.</p> : null}
        </fieldset>

        {errorMessage ? <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm font-semibold text-danger" role="alert">{errorMessage}</p> : null}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
          <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
          <PrimaryButton disabled={isSaving} type="submit">{isSaving ? "Guardando..." : "Guardar add-on"}</PrimaryButton>
        </div>
      </form>
    </EditorShell>
  );
}

function MachineCard({
  machine,
  isMutating,
  onEdit,
  onToggle,
  onDelete,
}: {
  machine: CatalogMachine;
  isMutating: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <SectionCard className="group overflow-hidden">
      <div className="relative aspect-[16/9] bg-graphite">
        {machine.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={`Máquina ${machine.name}`} className="size-full bg-surface-muted object-contain p-4" src={machine.imageUrl} />
        ) : (
          <div className="grid size-full place-items-center bg-[radial-gradient(circle_at_top_right,var(--primary)_0%,transparent_42%)] text-on-graphite">
            <div className="text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-on-graphite/10 text-primary"><CatalogIcon className="size-8" name="machine" /></span>
              <span className="mt-3 block text-[10px] font-bold tracking-[0.22em] text-on-graphite-muted">MAQUINARIA NAHUITECH</span>
            </div>
          </div>
        )}
        <div className="absolute left-4 top-4"><StatusBadge tone={machine.active ? "success" : "neutral"}>{machine.active ? "Activa" : "Inactiva"}</StatusBadge></div>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Orden {machine.sortOrder}</p>
            <h2 className="mt-2 text-xl font-bold tracking-[-0.02em] text-foreground">{machine.name}</h2>
          </div>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-muted text-foreground"><CatalogIcon name="bases" /></span>
        </div>
        <p className="mt-5 text-2xl font-black tracking-[-0.03em] text-foreground">{currencyFormatter.format(machine.basePrice)} <span className="text-sm font-bold text-muted">MXN</span></p>
        <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-muted"><CatalogIcon className="size-5 text-primary" name="bases" /> {machine.numberOfBases ? `${machine.numberOfBases} bases` : "Sin bases"}</div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <SecondaryButton onClick={onEdit}><CatalogIcon className="size-4" name="edit" />Editar</SecondaryButton>
          <SecondaryButton disabled={isMutating} onClick={onToggle}>{machine.active ? "Desactivar" : "Activar"}</SecondaryButton>
        </div>
        <button className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50" disabled={isMutating} onClick={onDelete} type="button"><CatalogIcon className="size-4" name="trash" />Eliminar máquina</button>
      </div>
    </SectionCard>
  );
}

function AddonCard({
  addon,
  isMutating,
  onEdit,
  onToggle,
  onDelete,
}: {
  addon: CatalogAddon;
  isMutating: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const isPerBase = addon.calculationType === "PER_BASE";
  const isQuantity = addon.calculationType === "QUANTITY";

  return (
    <SectionCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-muted text-foreground"><CatalogIcon name="addon" /></span>
        <StatusBadge tone={addon.active ? "success" : "neutral"}>{addon.active ? "Activo" : "Inactivo"}</StatusBadge>
      </div>
      <h2 className="mt-5 text-xl font-bold tracking-[-0.02em] text-foreground">{addon.name}</h2>
      <p className="mt-2 text-2xl font-black tracking-[-0.03em] text-foreground">{currencyFormatter.format(addon.unitPrice)} <span className="text-sm font-bold text-muted">MXN</span></p>
      <div className="mt-5 flex flex-wrap gap-2">
        <StatusBadge tone={isPerBase || isQuantity ? "primary" : "neutral"}>{isPerBase ? "Por base" : isQuantity ? "Por cantidad" : "Precio fijo"}</StatusBadge>
        <StatusBadge tone={addon.required ? "warning" : "neutral"}>{addon.required ? "Obligatorio" : "Opcional"}</StatusBadge>
      </div>
      {isPerBase ? <p className="mt-4 text-sm leading-6 text-muted">Se multiplica por las bases de la máquina.</p> : isQuantity ? <p className="mt-4 text-sm leading-6 text-muted">El vendedor define cuántas unidades incluir.</p> : <p className="mt-4 text-sm leading-6 text-muted">Se suma una sola vez al cálculo.</p>}
      <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-muted"><CatalogIcon className="size-5 text-primary" name="machine" />{addon.compatibilities.length} {addon.compatibilities.length === 1 ? "máquina compatible" : "máquinas compatibles"}</p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <SecondaryButton onClick={onEdit}><CatalogIcon className="size-4" name="edit" />Editar</SecondaryButton>
        <SecondaryButton disabled={isMutating} onClick={onToggle}>{addon.active ? "Desactivar" : "Activar"}</SecondaryButton>
      </div>
      <button className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50" disabled={isMutating} onClick={onDelete} type="button"><CatalogIcon className="size-4" name="trash" />Eliminar add-on</button>
    </SectionCard>
  );
}

export function CatalogManager({ machines, addons }: CatalogManagerProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"machines" | "addons">("machines");
  const [machineEditor, setMachineEditor] = useState<CatalogMachine | "new" | null>(null);
  const [addonEditor, setAddonEditor] = useState<CatalogAddon | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [isMutating, setIsMutating] = useState(false);

  function handleSaved() {
    setMachineEditor(null);
    setAddonEditor(null);
    setNotice("");
    router.refresh();
  }

  async function runListAction(action: () => Promise<{ error?: string }>) {
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

  async function confirmDeleteMachine(machine: CatalogMachine) {
    if (!window.confirm(`¿Eliminar la máquina “${machine.name}”? Esta acción no se puede deshacer.`)) {
      return;
    }

    await runListAction(() => deleteMachine(machine.id));
  }

  async function confirmDeleteAddon(addon: CatalogAddon) {
    if (!window.confirm(`¿Eliminar el add-on “${addon.name}”? Esta acción no se puede deshacer.`)) {
      return;
    }

    await runListAction(() => deleteAddon(addon.id));
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">
        <span>Administración</span><span className="text-primary">/</span><span>Catálogo</span>
      </div>
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold tracking-[-0.04em] text-foreground">Catálogo</h1>
          <p className="mt-3 text-base leading-7 text-muted">Gestiona la configuración comercial de máquinas, add-ons y sus compatibilidades.</p>
        </div>
        <PrimaryButton onClick={() => { setActiveTab("machines"); setMachineEditor("new"); }}><CatalogIcon className="size-5" name="plus" />Nueva máquina</PrimaryButton>
      </div>

      <div className="inline-flex w-full gap-1 rounded-2xl bg-surface-muted p-1 sm:w-auto">
        <button className={activeTab === "machines" ? "min-h-11 flex-1 rounded-xl bg-surface px-5 text-sm font-bold text-foreground shadow-sm sm:flex-none" : "min-h-11 flex-1 rounded-xl px-5 text-sm font-bold text-muted sm:flex-none"} onClick={() => setActiveTab("machines")} type="button">Máquinas <span className="ml-1 text-xs text-muted">{machines.length}</span></button>
        <button className={activeTab === "addons" ? "min-h-11 flex-1 rounded-xl bg-surface px-5 text-sm font-bold text-foreground shadow-sm sm:flex-none" : "min-h-11 flex-1 rounded-xl px-5 text-sm font-bold text-muted sm:flex-none"} onClick={() => setActiveTab("addons")} type="button">Add-ons <span className="ml-1 text-xs text-muted">{addons.length}</span></button>
      </div>

      {notice ? <p className="rounded-2xl bg-danger/10 px-5 py-4 text-sm font-semibold text-danger" role="alert">{notice}</p> : null}

      {activeTab === "machines" ? (
        machines.length === 0 ? (
          <EmptyState action={<PrimaryButton onClick={() => setMachineEditor("new")}><CatalogIcon className="size-5" name="plus" />Agregar máquina</PrimaryButton>} description="Agrega la primera máquina para comenzar a construir el catálogo." icon={<CatalogIcon className="size-8" name="machine" />} title="No hay máquinas todavía" />
        ) : (
          <section aria-label="Máquinas" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {machines.map((machine) => <MachineCard isMutating={isMutating} key={machine.id} machine={machine} onDelete={() => confirmDeleteMachine(machine)} onEdit={() => setMachineEditor(machine)} onToggle={() => runListAction(() => setMachineActive(machine.id, !machine.active))} />)}
          </section>
        )
      ) : (
        <section className="grid gap-5">
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-xl font-bold text-foreground">Add-ons</h2><p className="mt-1 text-sm text-muted">Precios, reglas de cálculo y compatibilidades por máquina.</p></div>
            <PrimaryButton onClick={() => setAddonEditor("new")}><CatalogIcon className="size-5" name="plus" />Nuevo add-on</PrimaryButton>
          </div>
          {addons.length === 0 ? (
            <EmptyState action={<PrimaryButton onClick={() => setAddonEditor("new")}><CatalogIcon className="size-5" name="plus" />Agregar add-on</PrimaryButton>} description="Crea el primer add-on y define en qué máquinas estará disponible." icon={<CatalogIcon className="size-8" name="addon" />} title="No hay add-ons todavía" />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {addons.map((addon) => <AddonCard addon={addon} isMutating={isMutating} key={addon.id} onDelete={() => confirmDeleteAddon(addon)} onEdit={() => setAddonEditor(addon)} onToggle={() => runListAction(() => setAddonActive(addon.id, !addon.active))} />)}
            </div>
          )}
        </section>
      )}

      {machineEditor ? <MachineEditor key={machineEditor === "new" ? "new-machine" : machineEditor.id} machine={machineEditor === "new" ? undefined : machineEditor} onClose={() => setMachineEditor(null)} onSaved={handleSaved} /> : null}
      {addonEditor ? <AddonEditor addon={addonEditor === "new" ? undefined : addonEditor} key={addonEditor === "new" ? "new-addon" : addonEditor.id} machines={machines} onClose={() => setAddonEditor(null)} onSaved={handleSaved} /> : null}
    </main>
  );
}
