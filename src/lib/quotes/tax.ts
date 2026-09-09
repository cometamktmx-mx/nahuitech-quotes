/**
 * Nahuitech catalog prices already include IVA. Keep the calculation in one
 * pure helper so the seller UI, offline mode, PDF and historic views agree.
 */
export const INCLUDED_IVA_RATE = 0.16;

export type IncludedTaxBreakdown = {
  subtotalBeforeTax: number;
  taxRate: number;
  taxAmount: number;
  totalWithTax: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function grossToNet(gross: number) {
  return roundMoney(gross / (1 + INCLUDED_IVA_RATE));
}

export function netDiscount(configurationGross: number, finalGross: number) {
  return roundMoney(grossToNet(configurationGross) - grossToNet(finalGross));
}

export function calculateIncludedTaxBreakdown(totalWithTax: number): IncludedTaxBreakdown {
  const total = roundMoney(totalWithTax);
  const subtotalBeforeTax = grossToNet(total);
  const taxAmount = roundMoney(total - subtotalBeforeTax);

  return {
    subtotalBeforeTax,
    taxRate: INCLUDED_IVA_RATE,
    taxAmount,
    totalWithTax: total,
  };
}
