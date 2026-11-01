import { useMemo, useState } from "react";
import type { Sale } from "./types";
import { money } from "./money";
import { salesCsv, summarise } from "./basket";
import { loadLog, loadSettings, saveSettings } from "./storage";
import { ReceiptQr } from "./ReceiptQr";

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type PeriodId = "today" | "yesterday" | "week" | "lastweek" | "month" | "all" | "day";
const PERIODS: { id: Exclude<PeriodId, "day">; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "lastweek", label: "Last week" },
  { id: "month", label: "This month" },
  { id: "all", label: "Last 60 days" },
];

// From (inclusive) and to (exclusive) for a period; weeks start on Monday.
function range(id: PeriodId, day: string): [Date, Date] {
  const today = dayStart(new Date());
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  switch (id) {
    case "today": return [today, addDays(today, 1)];
    case "yesterday": return [addDays(today, -1), today];
    case "week": return [monday, addDays(today, 1)];
    case "lastweek": return [addDays(monday, -7), monday];
    case "month": return [new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1)];
    case "all": return [addDays(today, -60), addDays(today, 1)];
    case "day": {
      const [y, m, d] = day.split("-").map(Number);
      const from = new Date(y, m - 1, d);
      return [from, addDays(from, 1)];
    }
  }
}
const timeOf = (s: Sale) => new Date(s.createdAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

const STATUS_TEXT: Record<string, string> = {
  card_pending: "Being charged",
  card_unknown: "Checking with Zeller",
  not_charged: "Not charged",
  card_failed: "Not charged",
};

export function Reports({ sales, onReplace }: { sales: Sale[]; onReplace: (list: Sale[]) => void }) {
  const testCount = sales.filter((s) => s.test).length;
  const loadTest = async (file: File | undefined) => {
    if (!file) return;
    try {
      const made = (JSON.parse(await file.text()) as Sale[]).filter((s) => s.id && s.createdAt && Array.isArray(s.lines));
      onReplace([...sales.filter((s) => !s.test), ...made.map((s) => ({ ...s, test: true }))].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      alert(`Loaded ${made.length} test sales.`);
    } catch {
      alert("That file isn't a test sales file.");
    }
  };

  const [period, setPeriod] = useState<PeriodId>("today");
  const [day, setDay] = useState(() => ymd(new Date()));
  const [from, to] = range(period, day);
  const label = period === "day" ? new Date(from).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : PERIODS.find((p) => p.id === period)!.label;
  const fileStamp = period === "today" || period === "yesterday" || period === "day" ? ymd(from) : `${ymd(from)}-to-${ymd(addDays(to, -1))}`;
  const today = useMemo(
    () => sales.filter((s) => { const t = new Date(s.createdAt); return t >= from && t < to; }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, from.getTime(), to.getTime()]
  );
  const sum = useMemo(() => summarise(today), [today]);
  const [feeRate, setFeeRate] = useState(() => loadSettings().feeRate?.toString() ?? "");
  const rate = Number(feeRate);
  const fees = rate > 0 ? Math.round((sum.card * rate) / 100) : null;
  const cardPct = sum.gross ? Math.round((sum.card / sum.gross) * 100) : 0;
  const open = today.filter((s) => s.method === "card" && s.status !== "complete" && s.status !== "card_failed");
  const recent = useMemo(() => today.filter((s) => s.status === "complete").slice(-15).reverse(), [today]);
  const [receiptFor, setReceiptFor] = useState<Sale | null>(null);

  const saveRate = (v: string) => {
    setFeeRate(v);
    const n = Number(v);
    saveSettings({ ...loadSettings(), feeRate: n > 0 ? n : undefined });
  };

  return (
    <div className="reports">
      <div className="periods" role="radiogroup" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.id} role="radio" aria-checked={period === p.id} className={`pill${period === p.id ? " on" : ""}`} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
        <label className={`pill date${period === "day" ? " on" : ""}`}>
          Pick a day
          <input type="date" value={day} max={ymd(new Date())} aria-label="Pick a day" onChange={(e) => { if (e.target.value) { setDay(e.target.value); setPeriod("day"); } }} />
        </label>
      </div>
      <div className="tiles">
        <div className="stat dark">
          <span className="label">Gross sales</span>
          <span className="val num">{money(sum.gross)}</span>
        </div>
        <div className="stat">
          <span className="label">Sales</span>
          <span className="val num">{sum.count}</span>
          <span className="sub num">{sum.count ? `Average ${money(Math.round(sum.gross / sum.count))}` : "None yet"}</span>
        </div>
        <div className="stat">
          <span className="label">Card vs cash</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, color: "var(--go)" }}>Card {money(sum.card)}</span>
          <div className="split" role="img" aria-label={`Card ${cardPct}%, cash ${100 - cardPct}%`}>
            <span style={{ width: `${cardPct}%` }} />
          </div>
          <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>Cash {money(sum.cash)}</span>
        </div>
        <div className="stat">
          <span className="label">Card fees (estimate)</span>
          <span className="val num">{fees == null ? "—" : money(fees)}</span>
          <span className="sub">{fees == null ? "Set your Zeller rate →" : `At ${rate}% of card sales`}</span>
        </div>
      </div>

      <div className="cols">
        <section className="panel items">
          <h2>By item</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Sold</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Sales
                </th>
              </tr>
            </thead>
            <tbody className="num">
              {sum.items.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td>
                  <td className="sold">{i.sold}</td>
                  <td className="r">{money(i.amount)}</td>
                </tr>
              ))}
              {!sum.items.length && (
                <tr>
                  <td colSpan={3} style={{ color: "var(--muted)", fontWeight: 400 }}>
                    No sales in this period
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {open.length > 0 && (
            <>
              <h2>Card payments not settled</h2>
              <div className="checks">
                {open.map((s) => (
                  <div key={s.id} className="c">
                    <span className="grow">
                      Sale {s.number} · {timeOf(s)}
                    </span>
                    <strong className="num">{money(s.total)}</strong>
                    <span>{STATUS_TEXT[s.status]}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="qb">
          <h2>For QuickBooks</h2>
          <div className="kv num"><span>GST-free sales</span><strong>{money(sum.gstFree)}</strong></div>
          <div className="kv num"><span>Taxable sales</span><strong>{money(sum.taxable)}</strong></div>
          <div className="kv minor num"><span>GST included</span><span>{money(sum.gst)}</span></div>
          <hr />
          <div className="kv num"><span>Card</span><strong>{money(sum.card)}</strong></div>
          <div className="kv num"><span>Cash</span><strong>{money(sum.cash)}</strong></div>
          <hr />
          <label>
            Zeller card fee
            <span>
              <input inputMode="decimal" value={feeRate} placeholder="1.4" aria-label="Zeller card fee percent" onChange={(e) => saveRate(e.target.value)} /> %
            </span>
          </label>
          <button className="btn-plain small" onClick={() => download(`roseberry-sales-${fileStamp}.csv`, salesCsv(today), "text/csv")}>
            Export {label.toLowerCase()} (CSV)
          </button>
          <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => download(`roseberry-till-log-${fileStamp}.json`, JSON.stringify({ sales: today, log: loadLog() }, null, 2), "application/json")}>
            Download payment log
          </button>
          <hr />
          <span className="sub">Test data{testCount ? ` · ${testCount} test sales loaded` : ""}</span>
          <label className="link" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
            Load test sales from a file
            <input type="file" accept=".json,application/json" hidden onChange={(e) => loadTest(e.target.files?.[0])} />
          </label>
          {testCount > 0 && (
            <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => confirm(`Remove all ${testCount} test sales? Real sales stay.`) && onReplace(sales.filter((s) => !s.test))}>
              Remove test sales
            </button>
          )}
        </section>
      </div>

      {recent.length > 0 && (
        <section className="panel">
          <h2>Latest sales · {label}</h2>
          <div className="checks">
            {recent.map((s) => (
              <div key={s.id} className="c">
                <span className="grow">
                  Sale {s.number} · {timeOf(s)} · {s.method === "card" ? "Card" : "Cash"} · {s.lines.map((l) => l.name).join(", ")}
                </span>
                <strong className="num">{money(s.total)}</strong>
                <button className="btn-plain" style={{ minHeight: 44, padding: "0 16px", fontSize: 17, borderWidth: 2 }} onClick={() => setReceiptFor(s)}>
                  Receipt
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {receiptFor && <ReceiptQr sale={receiptFor} closeLabel="Close" onClose={() => setReceiptFor(null)} />}
    </div>
  );
}
