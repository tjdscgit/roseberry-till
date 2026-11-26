// Builds a made-up set of market-day sales from a Square item export, for testing the till's
// reports. Only items, amounts, times and card/cash are used: no customer or card details.
//
//   node scripts/make-test-sales.mjs <square-items.csv> [weeks]
//
// Writes private/test-sales.json (git-ignored). Load it on the till from the report screen.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const [file, weeksArg] = process.argv.slice(2);
if (!file) throw new Error("Give the path to the Square items CSV.");
const WEEKS = Number(weeksArg ?? 8);

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n") row.push(field.replace(/\r$/, "")), rows.push(row), (row = []), (field = "");
    else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ""), r[i] ?? ""])));
}

const cents = (s) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const catalogue = JSON.parse(readFileSync(new URL("../src/till/catalogue.json", import.meta.url), "utf8"));
const byName = new Map(catalogue.map((p) => [p.name.toLowerCase(), p]));

// Group the export's rows into sales.
const sales = new Map();
for (const r of parseCsv(readFileSync(file, "utf8"))) {
  if (r["Event Type"] !== "Payment") continue;
  const s = sales.get(r["Transaction ID"]) ?? { time: r.Time, card: !!r["Card Brand"], items: [] };
  const p = byName.get(r.Item.toLowerCase());
  const kg = r.Unit === "kg";
  const qty = Number(r.Qty);
  const amount = cents(r["Gross Sales"]);
  s.items.push({
    productId: p?.id ?? slug(r.Item),
    sku: p?.sku ?? r.SKU,
    name: p?.name ?? r.Item,
    optionLabel: kg ? "By weight" : r["Price Point Name"] || "Each",
    unit: kg ? "kg" : "each",
    unitPrice: Math.round(amount / Math.max(kg ? 0.001 : 1, kg ? qty : Math.round(qty))),
    qty: kg ? 1 : Math.max(1, Math.round(qty)),
    grams: kg ? Math.round(qty * 1000) : undefined,
    gst: cents(r.Tax) > 0 ? "taxable" : (p?.gst ?? "free"),
  });
  sales.set(r["Transaction ID"], s);
}
const pattern = [...sales.values()];
console.log(`Read ${pattern.length} sales from the export.`);

// The latest Saturday on or before today, then the ones before it.
const now = new Date();
const lastSat = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 1) % 7));
const rand = (a, b) => a + Math.random() * (b - a);

const out = [];
for (let w = 0; w < WEEKS; w++) {
  const day = new Date(lastSat.getFullYear(), lastSat.getMonth(), lastSat.getDate() - 7 * w);
  const busy = rand(0.7, 1.15); // quieter and busier weeks
  const picks = pattern.filter(() => Math.random() < busy).concat(pattern.filter(() => Math.random() < busy - 0.85));
  const made = picks.map((s) => {
    const [h, m, sec] = s.time.split(":").map(Number);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m + Math.round(rand(-8, 8)), sec);
    const lines = s.items.map((i) => {
      const grams = i.grams && Math.max(50, Math.round((i.grams * rand(0.8, 1.2)) / 5) * 5);
      const amount = grams ? Math.round((i.unitPrice * grams) / 1000) : i.unitPrice * i.qty;
      return { key: randomUUID(), ...i, grams, amount };
    });
    const total = lines.reduce((t, l) => t + l.amount, 0);
    const card = Math.random() < 0.1 ? !s.card : s.card;
    const tendered = Math.ceil(total / 500) * 500 + (Math.random() < 0.4 ? 1000 : 0);
    return {
      id: randomUUID(),
      createdAt: at.toISOString(),
      lines,
      total,
      method: card ? "card" : "cash",
      status: "complete",
      ...(card ? { card: { reference: `TEST-${randomUUID().slice(0, 8)}`, scheme: "Test card" } } : { cash: { tendered, change: tendered - total } }),
      test: true,
    };
  });
  made.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((s, i) => (s.number = i + 1));
  out.push(...made);
  console.log(`${day.toDateString()}: ${made.length} sales, $${(made.reduce((t, s) => t + s.total, 0) / 100).toFixed(2)}`);
}

mkdirSync(new URL("../private/", import.meta.url), { recursive: true });
writeFileSync(new URL("../private/test-sales.json", import.meta.url), JSON.stringify(out));
console.log(`Wrote private/test-sales.json (${out.length} sales).`);
