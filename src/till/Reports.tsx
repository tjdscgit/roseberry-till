import { useMemo, useState } from "react";
import type { Sale } from "./types";
import { money } from "./money";
import { salesCsv, summarise } from "./basket";
import { isToday, loadLog, loadSettings, saveSettings } from "./storage";

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

const STATUS_TEXT: Record<string, string> = {
  card_pending: "Being charged",
  card_unknown: "Checking with Zeller",
  not_charged: "Not charged",
  card_failed: "Not charged",
};

export function Reports({ sales }: { sales: Sale[] }) {
  const today = useMemo(() => sales.filter((s) => isToday(s.createdAt)), [sales]);
  const sum = useMemo(() => summarise(today), [today]);
  const [feeRate, setFeeRate] = useState(() => loadSettings().feeRate?.toString() ?? "");
  const rate = Number(feeRate);
  const fees = rate > 0 ? Math.round((sum.card * rate) / 100) : null;
  const cardPct = sum.gross ? Math.round((sum.card / sum.gross) * 100) : 0;
  const open = today.filter((s) => s.method === "card" && s.status !== "complete" && s.status !== "card_failed");

  const saveRate = (v: string) => {
    setFeeRate(v);
    const n = Number(v);
    saveSettings({ ...loadSettings(), feeRate: n > 0 ? n : undefined });
  };

  return (
    <div className="reports">
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
                    No sales yet today
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
                      Sale {s.number} · {new Date(s.createdAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}
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
          <button className="btn-plain small" onClick={() => download(`roseberry-sales-${stamp()}.csv`, salesCsv(today), "text/csv")}>
            Export today (CSV)
          </button>
          <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => download(`roseberry-till-log-${stamp()}.json`, JSON.stringify({ sales: today, log: loadLog() }, null, 2), "application/json")}>
            Download payment log
          </button>
        </section>
      </div>
    </div>
  );
}
