"use client";
import { grossToNet, netDiscount, calculateIncludedTaxBreakdown } from "@/lib/quotes/tax";


import { type FormEvent, useState } from "react";

import { validateCoupon } from "@/app/seller/quote/actions";
import { previewOfflineCoupon } from "@/lib/offline/offline-quotes";

import { useSellerOffline } from "./seller-offline-provider";

export type AppliedCoupon = {
  subtotal: number;
  discountAmount: number;
  total: number;
  couponCode: string;
  couponName: string;
  couponDiscountType: "FIXED_AMOUNT" | "PERCENTAGE";
  couponDiscountValue: number;
};

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export function SellerCouponPanel({
  items,
  machineId,
  addonQuantities,
  machineVariantId,
  couponCode,
  appliedCoupon,
  onCouponCodeChange,
  onAppliedCoupon,
}: {
  items?: import("@/lib/quotes/items").QuoteItemInput[];
  machineId: string;
  addonQuantities: Record<string, number>;
  machineVariantId: string | null;
  couponCode: string;
  appliedCoupon: AppliedCoupon | null;
  onCouponCodeChange: (value: string) => void;
  onAppliedCoupon: (coupon: AppliedCoupon | null) => void;
}) {
  const offline = useSellerOffline();
  const [errorMessage, setErrorMessage] = useState("");
  const [isApplying, setIsApplying] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsApplying(true);
    let result: Awaited<ReturnType<typeof validateCoupon>>;

    try {
      result = offline && !offline.isOnline
        ? await previewOfflineCoupon({ items, machineId, addonQuantities, couponCode, machineVariantId })
        : await validateCoupon({ items, machineId, addonQuantities, couponCode, machineVariantId });

      if (result.error && result.retryable) {
        result = await previewOfflineCoupon({ items, machineId, addonQuantities, couponCode, machineVariantId });
      }
    } catch (error) {
      try {
        result = await previewOfflineCoupon({ items, machineId, addonQuantities, couponCode, machineVariantId });
      } catch {
        setIsApplying(false);
        onAppliedCoupon(null);
        setErrorMessage(error instanceof Error ? error.message : "No se pudo validar el cupón offline.");
        return;
      }
    }
    setIsApplying(false);

    if (
      result.error ||
      result.subtotal === undefined ||
      result.discountAmount === undefined ||
      result.total === undefined ||
      !result.couponCode ||
      !result.couponName ||
      !result.couponDiscountType ||
      result.couponDiscountValue === undefined
    ) {
      onAppliedCoupon(null);
      setErrorMessage(result.error ?? "No se pudo validar el cupón.");
      return;
    }

    onAppliedCoupon({
      subtotal: result.subtotal,
      discountAmount: result.discountAmount,
      total: result.total,
      couponCode: result.couponCode,
      couponName: result.couponName,
      couponDiscountType: result.couponDiscountType,
      couponDiscountValue: result.couponDiscountValue,
    });
  }

  return (
    <section className="rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Cupón de expo</p>
      <form className="mt-3 flex gap-2" onSubmit={handleSubmit}>
        <input
          aria-label="Código de cupón de expo"
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm font-bold uppercase outline-none transition placeholder:normal-case placeholder:font-normal focus:border-primary focus:ring-4 focus:ring-primary/10"
          onChange={(event) => {
            setErrorMessage("");
            onCouponCodeChange(event.target.value);
          }}
          placeholder="CÓDIGO"
          value={couponCode}
        />
        <button
          className="min-h-12 rounded-xl border border-border px-4 text-sm font-bold text-foreground transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isApplying}
          type="submit"
        >
          {isApplying ? "Validando..." : "Aplicar"}
        </button>
      </form>

      {errorMessage ? (
        <p aria-live="polite" className="mt-3 rounded-xl bg-danger/10 px-3 py-3 text-sm font-bold text-danger" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {appliedCoupon ? (
        <div aria-live="polite" className="mt-4 grid gap-3 rounded-2xl bg-success/10 p-4">
          <div>
            <p className="text-sm font-bold text-success">✓ Beneficio Expo aplicado</p>
            <p className="mt-1 text-base font-black text-foreground">{appliedCoupon.couponName}</p>
            <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-muted">
              {appliedCoupon.couponCode}
            </p>
          </div>
          <div className="grid gap-2 border-t border-success/20 pt-3 text-sm">
            <div className="flex justify-between gap-3"><span className="text-muted">Precio configuración</span><span className="font-bold text-foreground">{currencyFormatter.format(grossToNet(appliedCoupon.subtotal))}</span></div>
            <div className="flex justify-between gap-3"><span className="text-success">Descuento Expo</span><span className="font-bold text-success">− {currencyFormatter.format(netDiscount(appliedCoupon.subtotal, appliedCoupon.total))}</span></div>
            <div className="flex justify-between gap-3"><span>Subtotal</span><span>{currencyFormatter.format(grossToNet(appliedCoupon.total))}</span></div>
            <div className="flex justify-between gap-3"><span>IVA 16%</span><span>{currencyFormatter.format(calculateIncludedTaxBreakdown(appliedCoupon.total).taxAmount)}</span></div>
            <div className="flex justify-between gap-3 border-t border-success/20 pt-3"><span className="font-bold text-foreground">TOTAL</span><span className="font-black text-foreground">{currencyFormatter.format(appliedCoupon.total)} MXN</span></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
