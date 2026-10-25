import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./receipt.css";
import { fromBase64Url, type ReceiptData, type ReceiptLine } from "../till/receipt";
import { gstIncluded, money, price } from "../till/money";

// The customer's itemised receipt, opened from the QR code on the till. Everything shown comes
// from the URL fragment, so it is written with textContent only, never as HTML.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function parse(): ReceiptData | null {
  try {
    const raw = new URLSearchParams(location.hash.slice(1)).get("r");
    if (!raw) return null;
    const d = JSON.parse(fromBase64Url(raw)) as ReceiptData;
    const ok =
      d.v === 1 &&
      Number.isFinite(d.n) &&
      Number.isFinite(d.t) &&
      Number.isFinite(d.T) &&
      (d.p === "card" || d.p === "cash") &&
      Array.isArray(d.l) &&
      d.l.every((l) => Array.isArray(l) && typeof l[0] === "string" && typeof l[1] === "string" && l.slice(2).every(Number.isFinite));
    return ok ? d : null;
  } catch {
    return null;
  }
}

const lineDetail = ([, option, isKg, qty, unit]: ReceiptLine) =>
  isKg ? `${(qty / 1000).toFixed(3)} kg at ${price(unit)}/kg` : qty > 1 ? `${option} × ${qty} at ${price(unit)}` : option;

function render(d: ReceiptData) {
  const root = document.getElementById("receipt")!;
  const when = new Date(d.t * 1000);

  const head = el("header");
  head.append(el("h1", "", "Roseberry Growers"), el("p", "muted", "Receipt"));
  root.append(head);

  const meta = el("p", "meta");
  meta.textContent = `${when.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · ${when.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })} · Sale ${d.n}`;
  root.append(meta);

  const list = el("ul", "lines");
  for (const l of d.l) {
    const li = el("li");
    const info = el("div");
    info.append(el("div", "name", l[0] + (l[6] ? " *" : "")), el("div", "muted", lineDetail(l)));
    li.append(info, el("div", "amt", money(l[5])));
    list.append(li);
  }
  root.append(list);

  const total = el("div", "total");
  total.append(el("span", "", "Total"), el("span", "", money(d.T)));
  root.append(total);

  const taxable = d.l.filter((l) => l[6]).reduce((t, l) => t + l[5], 0);
  root.append(
    el("p", "muted", taxable ? `* Includes GST of ${money(gstIncluded(taxable))}. Other items are GST-free.` : "All items GST-free.")
  );

  const paid = el("div", "paid");
  if (d.p === "cash") {
    paid.append(el("div", "", "Paid in cash"));
    if (d.c) paid.append(el("div", "muted", `Received ${money(d.c[0])} · change ${money(d.c[1])}`));
  } else {
    paid.append(el("div", "", `Paid by card${d.s ? ` · ${d.s}` : ""}`));
    if (d.z && /^https:\/\/[a-z0-9.-]*myzeller\.com\//i.test(d.z)) {
      const a = el("a", "", "View your card receipt from Zeller");
      a.href = d.z;
      a.rel = "noopener noreferrer";
      paid.append(a);
    }
  }
  root.append(paid);

  root.append(el("p", "thanks", "Thanks for shopping with us."));
  document.title = `Receipt ${money(d.T)} · Roseberry Growers`;
}

const data = parse();
if (data) render(data);
else {
  const root = document.getElementById("receipt")!;
  root.append(el("h1", "", "Roseberry Growers"), el("p", "muted", "This receipt link is incomplete. Please ask at the stall for a new one."));
}
