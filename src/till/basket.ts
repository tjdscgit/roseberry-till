import type { Line, Option, Product, Sale } from "./types";
import { gstIncluded, weightAmount } from "./money";

export function addEach(lines: Line[], p: Product, o: Option, qty: number): Line[] {
  const key = `${p.id}:${o.id}`;
  const i = lines.findIndex((l) => l.key === key);
  if (i >= 0) return changeQty(lines, key, lines[i].qty + qty);
  return [
    ...lines,
    { key, productId: p.id, sku: p.sku, name: p.name, optionLabel: o.label, unit: "each", unitPrice: o.price, qty, amount: qty * o.price, gst: p.gst },
  ];
}

// Each weighed amount is its own line, even for the same product.
export function addWeight(lines: Line[], p: Product, o: Option, grams: number): Line[] {
  return [
    ...lines,
    {
      key: `${p.id}:${o.id}:${Date.now()}`,
      productId: p.id,
      sku: p.sku,
      name: p.name,
      optionLabel: o.label,
      unit: "kg",
      unitPrice: o.price,
      qty: 1,
      grams,
      amount: weightAmount(grams, o.price),
      gst: p.gst,
    },
  ];
}

export function changeQty(lines: Line[], key: string, qty: number): Line[] {
  if (qty <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, qty, amount: qty * l.unitPrice } : l));
}

export const removeLine = (lines: Line[], key: string) => lines.filter((l) => l.key !== key);

export const basketTotal = (lines: Line[]) => lines.reduce((t, l) => t + l.amount, 0);

export const itemCount = (lines: Line[]) => lines.reduce((n, l) => n + (l.unit === "each" ? l.qty : 1), 0);

export interface ItemRow {
  name: string;
  amount: number;
  sold: string;
}

export interface Summary {
  gross: number;
  count: number;
  card: number;
  cash: number;
  gstFree: number;
  taxable: number;
  gst: number;
  items: ItemRow[];
}

export function summarise(sales: Sale[]): Summary {
  const done = sales.filter((s) => s.status === "complete");
  const byItem = new Map<string, { name: string; amount: number; units: Map<string, number>; grams: number }>();
  let gstFree = 0;
  let taxable = 0;
  for (const s of done) {
    for (const l of s.lines) {
      if (l.gst === "taxable") taxable += l.amount;
      else gstFree += l.amount;
      const row = byItem.get(l.productId) ?? { name: l.name, amount: 0, units: new Map(), grams: 0 };
      row.amount += l.amount;
      if (l.unit === "kg") row.grams += l.grams ?? 0;
      else row.units.set(l.optionLabel, (row.units.get(l.optionLabel) ?? 0) + l.qty);
      byItem.set(l.productId, row);
    }
  }
  const items = [...byItem.values()]
    .map((r) => {
      const parts = [...r.units.entries()].map(([label, n]) => `${n} × ${label.toLowerCase()}`);
      if (r.grams) parts.push(`${(r.grams / 1000).toFixed(2)} kg`);
      return { name: r.name, amount: r.amount, sold: parts.join(" · ") };
    })
    .sort((a, b) => b.amount - a.amount);
  const sum = (m: "card" | "cash") => done.filter((s) => s.method === m).reduce((t, s) => t + s.total, 0);
  return {
    gross: done.reduce((t, s) => t + s.total, 0),
    count: done.length,
    card: sum("card"),
    cash: sum("cash"),
    gstFree,
    taxable,
    gst: gstIncluded(taxable),
    items,
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// One row per line sold, for spreadsheets and QuickBooks.
export function salesCsv(sales: Sale[]): string {
  const head = ["Date", "Time", "Sale", "Paid by", "Item", "SKU", "Option", "Qty", "Kg", "Unit price", "Amount", "GST", "Card transaction"];
  const rows = sales
    .filter((s) => s.status === "complete")
    .flatMap((s) => {
      const d = new Date(s.createdAt);
      return s.lines.map((l) => [
        d.toLocaleDateString("en-AU"),
        d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }),
        s.number,
        s.method,
        l.name,
        l.sku,
        l.optionLabel,
        l.unit === "each" ? l.qty : "",
        l.grams ? (l.grams / 1000).toFixed(3) : "",
        (l.unitPrice / 100).toFixed(2),
        (l.amount / 100).toFixed(2),
        l.gst === "taxable" ? "GST" : "GST free",
        s.card?.transactionUuid ?? "",
      ]);
    });
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}
