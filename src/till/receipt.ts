import type { Sale } from "./types";

// An itemised receipt carried entirely in a link: the sale is packed into the URL fragment of
// receipt.html, shown to the customer as a QR code. Nothing is stored online, it works with no
// internet at the stall, and the fragment never leaves the customer's phone (browsers don't send
// it to the server). No card details are included, only items and amounts.

// [name, option, isKg, qty or grams, unit price, amount, taxable]
export type ReceiptLine = [string, string, 0 | 1, number, number, number, 0 | 1];

export interface ReceiptData {
  v: 1;
  n: number; // sale number
  t: number; // time, seconds since epoch
  p: "card" | "cash";
  T: number; // total, cents
  l: ReceiptLine[];
  c?: [number, number]; // cash tendered, change
  s?: string; // card scheme
  z?: string; // Zeller's own receipt link
}

export function receiptData(sale: Sale): ReceiptData {
  return {
    v: 1,
    n: sale.number,
    t: Math.round(Date.parse(sale.createdAt) / 1000),
    p: sale.method,
    T: sale.total,
    l: sale.lines.map((l) => [
      l.name,
      l.optionLabel,
      l.unit === "kg" ? 1 : 0,
      l.unit === "kg" ? (l.grams ?? 0) : l.qty,
      l.unitPrice,
      l.amount,
      l.gst === "taxable" ? 1 : 0,
    ]),
    ...(sale.cash ? { c: [sale.cash.tendered, sale.cash.change] as [number, number] } : {}),
    ...(sale.card?.scheme ? { s: sale.card.scheme } : {}),
    ...(sale.card?.receiptLink ? { z: sale.card.receiptLink } : {}),
  };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function receiptUrl(sale: Sale): string {
  const url = new URL("receipt.html", location.href);
  url.hash = "r=" + toBase64Url(JSON.stringify(receiptData(sale)));
  return url.toString();
}
