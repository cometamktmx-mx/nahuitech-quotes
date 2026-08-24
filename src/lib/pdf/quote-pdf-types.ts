export type QuotePdfAddon = {
  id: string;
  name: string;
  calculationType: "FIXED" | "PER_BASE" | "QUANTITY";
  description: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type QuotePdfCoupon = {
  code: string;
  name: string;
  discountType: "FIXED_AMOUNT" | "PERCENTAGE";
  discountValue: number;
  discountAmount: number;
};

export type QuotePdfSnapshot = {
  folio: string;
  createdAt: string;
  customer: {
    name: string;
    company: string | null;
    whatsapp: string;
    email: string | null;
  };
  sellerName: string | null;
  machine: {
    name: string;
    basePrice: number;
    numberOfBases: number | null;
    imageUrl: string | null;
    variant: { type: "AUTOMATIC" | "SEMI_AUTOMATIC"; name: string; price: number } | null;
  };
  addons: QuotePdfAddon[];
  subtotal: number;
  discountAmount: number;
  total: number;
  coupon: QuotePdfCoupon | null;
  delivery: {
    type: "SHIPPING" | "INSTALLATION" | "LATER";
    note: string | null;
  };
  notes: string | null;
};
