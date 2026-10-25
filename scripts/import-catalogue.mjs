// Turns the market price spreadsheet (data/catalogue.csv, exported from the Square-style
// catalogue template) into src/till/catalogue.json, which the till loads.
//
//   node scripts/import-catalogue.mjs
//
// Re-run it whenever the spreadsheet changes. Existing SKUs are kept by product, so they never
// change between imports; new products get a fresh random 6-digit SKU.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CSV = "data/catalogue.csv";
const OUT = "src/till/catalogue.json";

// Spelling fixes agreed with Roseberry; everything else is taken as typed.
const NAME_FIXES = { "Diakon Radish": "Daikon Radish", "Brussel Sprout": "Brussels Sprouts" };

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cents = (s) => {
  const v = s.replace(/[$,\s]/g, "");
  return v === "" ? null : Math.round(Number(v) * 100);
};

const rows = readFileSync(CSV, "utf8").trim().split(/\r?\n/).map((l) => l.split(","));
const header = rows[0];
// "Attribute Set N" columns start a group (Bunch, By Weight, Bagged...). The "Attribute N"
// columns after it, if any, are that group's variants (Small/Larger, Elephant/True...).
const setCols = header.map((h, i) => (h.startsWith("Attribute Set") ? i : -1)).filter((i) => i >= 0);

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const skuById = new Map(previous.map((p) => [p.id, p.sku]));
const usedSkus = new Set(skuById.values());
const newSku = () => {
  let s;
  do s = String(100000 + Math.floor(Math.random() * 900000));
  while (usedSkus.has(s));
  usedSkus.add(s);
  return s;
};

function optionsFor(cols) {
  const options = [];
  setCols.forEach((start, n) => {
    const end = setCols[n + 1] ?? cols.length;
    const group = (cols[start] ?? "").trim();
    if (!group) return;
    const groupPrice = cents(cols[start + 1] ?? "");
    const isWeight = /^by weight$/i.test(group);
    const subs = [];
    for (let i = start + 2; i < end; i += 2) {
      const name = (cols[i] ?? "").trim();
      const price = cents(cols[i + 1] ?? "");
      if (name && price != null) subs.push({ name: /^true$/i.test(name) ? "True" : name.replace(/^Larger$/i, "Large"), price });
    }
    const unit = isWeight ? "kg" : "each";
    if (subs.length) {
      for (const s of subs) {
        let label = s.name;
        if (/^bagged$/i.test(group)) label = `${s.name} bag`;
        else if (/^head size$/i.test(group)) label = `${s.name} head`;
        options.push({ id: slug(label), label, unit, price: s.price });
      }
    } else if (groupPrice != null) {
      const label = isWeight ? "By weight" : group.replace(/^Bunched$/i, "Bunch").replace(/^Bagged$/i, "Bag");
      options.push({ id: slug(label), label, unit, price: groupPrice });
    } else {
      console.warn(`  skipped "${group}" on ${cols[0].trim()}: no price`);
    }
  });
  return options;
}

const products = rows.slice(1).map((cols) => {
  const raw = cols[0].trim();
  const name = NAME_FIXES[raw] ?? raw;
  const id = slug(name);
  return {
    id,
    sku: skuById.get(id) ?? newSku(),
    name,
    category: (cols[1] ?? "").trim() || "Other",
    gst: /^y/i.test((cols[3] ?? "").trim()) ? "taxable" : "free",
    options: optionsFor(cols),
  };
});

products.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(OUT, JSON.stringify(products, null, 2) + "\n");
console.log(`Wrote ${products.length} products to ${OUT}`);
for (const p of products) if (!p.options.length) console.warn(`  ${p.name} has no prices`);
