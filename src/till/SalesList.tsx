import { useMemo, useState } from "react";
import type { Line, Sale } from "./types";
import { kg, money, price } from "./money";
import { ReceiptQr } from "./ReceiptQr";

// Every sale kept on this iPad (the last 60 days), newest first, grouped by day.

const STATUS: Record<string, string> = {
  card_pending: "Being charged",
  card_unknown: "Checking with Zeller",
  card_failed: "Not charged",
  not_charged: "Not charged",
};

const dayLabel = (d: Date) => {
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
const lineText = (l: Line) =>
  l.unit === "kg" ? `${kg(l.grams ?? 0)} at ${price(l.unitPrice)}/kg` : l.qty > 1 ? `${l.optionLabel} × ${l.qty}` : l.optionLabel;

export function SalesList({ sales }: { sales: Sale[] }) {
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<Sale | null>(null);

  const days = useMemo(() => {
    const list = [...sales]
      .filter((s) => showAll || s.status === "complete")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const groups: { label: string; total: number; sales: Sale[] }[] = [];
    for (const s of list) {
      const label = dayLabel(new Date(s.createdAt));
      let g = groups[groups.length - 1];
      if (!g || g.label !== label) groups.push((g = { label, total: 0, sales: [] }));
      g.sales.push(s);
      if (s.status === "complete") g.total += s.total;
    }
    return groups;
  }, [sales, showAll]);

  return (
    <div className="saleslist">
      <div className="toolbar">
        <p className="sub grow">Sales on this iPad from the last 60 days. Tap a sale for its details and receipt.</p>
        <button className={`pill${showAll ? " on" : ""}`} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Showing unpaid too" : "Show unpaid too"}
        </button>
      </div>

      {!days.length && <p className="nothing">No sales yet.</p>}

      {days.map((g) => (
        <section key={g.label} className="day">
          <h2>
            <span>{g.label}</span>
            <span className="num">
              {g.sales.filter((s) => s.status === "complete").length} sales · {money(g.total)}
            </span>
          </h2>
          {g.sales.map((s) => {
            const open = openId === s.id;
            const paid = s.status === "complete";
            return (
              <div key={s.id} className={`sale${open ? " open" : ""}${paid ? "" : " unpaid"}`}>
                <button className="sale-row" aria-expanded={open} onClick={() => setOpenId(open ? null : s.id)}>
                  <span className="when num">{timeOf(s.createdAt)}</span>
                  <span className="no">Sale {s.number}</span>
                  <span className="what">{s.lines.map((l) => l.name).join(", ")}</span>
                  <span className="how">{paid ? (s.method === "card" ? "Card" : "Cash") : STATUS[s.status]}</span>
                  <span className="amt num">{money(s.total)}</span>
                </button>
                {open && (
                  <div className="sale-detail">
                    <ul>
                      {s.lines.map((l) => (
                        <li key={l.key}>
                          <span>
                            <strong>{l.name}</strong> · {lineText(l)}
                            {l.gst === "taxable" ? " · incl. GST" : ""}
                          </span>
                          <span className="num">{money(l.amount)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="pay-info">
                      {s.method === "cash" && s.cash && `Cash · received ${money(s.cash.tendered)} · change ${money(s.cash.change)}`}
                      {s.method === "card" && `Card${s.card?.scheme ? ` · ${s.card.scheme}` : ""}${s.detail ? ` · ${s.detail}` : ""}`}
                    </div>
                    {paid && (
                      <button className="btn-go small" onClick={() => setReceiptFor(s)}>
                        Show receipt QR code
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {receiptFor && <ReceiptQr sale={receiptFor} closeLabel="Close" onClose={() => setReceiptFor(null)} />}
    </div>
  );
}
