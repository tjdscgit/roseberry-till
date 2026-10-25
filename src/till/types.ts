export type Unit = "each" | "kg";
export type Gst = "free" | "taxable";

// One way a product is sold. `price` is in cents: per item for "each", per kg for "kg".
export interface Option {
  id: string;
  label: string;
  unit: Unit;
  price: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  gst: Gst;
  hidden?: boolean;
  photo?: string;
  options: Option[];
}

export interface Line {
  key: string;
  productId: string;
  sku: string;
  name: string;
  optionLabel: string;
  unit: Unit;
  unitPrice: number;
  qty: number; // items for "each"; always 1 for "kg"
  grams?: number;
  amount: number; // cents
  gst: Gst;
}

// complete      money taken (cash, or card approved)
// card_pending  purchase() sent to Zeller, no answer yet
// card_unknown  the answer was lost (network etc.); recovery will find the truth
// card_failed   declined, cancelled or never sent; nothing charged
// not_charged   recovery looked twice and Zeller has no such payment
export type SaleStatus = "complete" | "card_pending" | "card_unknown" | "card_failed" | "not_charged";

export interface Sale {
  id: string;
  number: number;
  createdAt: string;
  lines: Line[];
  total: number;
  method: "card" | "cash";
  status: SaleStatus;
  detail?: string;
  cash?: { tendered: number; change: number };
  card?: { reference: string; transactionUuid?: string; scheme?: string; receiptLink?: string; timedOut?: boolean };
  // Card sale moved off the screen while still being checked; its outcome must be shown later.
  setAside?: boolean;
  acknowledged?: boolean;
}
