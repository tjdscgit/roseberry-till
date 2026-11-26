import { useMemo, useState } from "react";
import type { CashBook, DayClose, Sale } from "./types";
import { money } from "./money";
import { deviceId, useCash, useSettings } from "./storage";

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayOf = (s: Sale) => ymd(new Date(s.createdAt));
export const dayLabel = (v: string) => {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
};
const DEFAULT_FLOAT = 20000;
const DENOMS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5];
const denomLabel = (c: number) => (c >= 100 ? `$${c / 100}` : `${c}c`);

// Market days with completed real sales.
export function marketDays(sales: Sale[]) {
  return [...new Set(sales.filter((s) => s.status === "complete" && !s.test).map(dayOf))].sort();
}

// Market days with sales that no cash count covers yet.
export function uncounted(sales: Sale[], book: CashBook) {
  const done = new Set(book.closes.flatMap((c) => c.days));
  return marketDays(sales).filter((d) => !done.has(d));
}

// "12.50" -> 1250; blank or junk -> null.
const cents = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const dollars = (c: number) => (c % 100 ? (c / 100).toFixed(2) : String(c / 100));

function closeText(c: DayClose, sales: Sale[]) {
  const done = sales.filter((s) => s.status === "complete" && c.days.includes(dayOf(s)));
  const gross = done.reduce((t, s) => t + s.total, 0);
  const diff = c.counted - c.expected;
  return [
    `Roseberry Growers — cash count`,
    `Market day${c.days.length > 1 ? "s" : ""}: ${c.days.map(dayLabel).join(", ")}`,
    `Counted: ${new Date(c.countedAt).toLocaleString("en-AU")}`,
    ``,
    `Sales: ${done.length}, total ${money(gross)}`,
    `Card: ${money(c.card)} (${c.cardCount} sales) — check against Zeller settlement`,
    `Cash sales: ${money(c.cashSales)}`,
    ``,
    `Float: ${money(c.float)}`,
    `Paid out: ${money(c.payouts)}`,
    `Expected in tin: ${money(c.expected)}`,
    `Counted: ${money(c.counted)}`,
    `${diff >= 0 ? "Over" : "Short"}: ${money(Math.abs(diff))}`,
    ``,
    `Kept as float: ${money(c.keep)}`,
    `To bank: ${money(c.banked)}`,
    c.note ? `\nNote: ${c.note}` : "",
  ].join("\n");
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function CloseDay({ sales, onDone }: { sales: Sale[]; onDone: () => void }) {
  const [book, setBook] = useCash();
  const [settings, setSettings] = useSettings();
  const open = useMemo(() => uncounted(sales, book), [sales, book]);
  const today = ymd(new Date());
  const [days, setDays] = useState<string[]>(() => (open.length ? [open[0]] : []));
  const usual = settings.float ?? DEFAULT_FLOAT;
  const [floatText, setFloatText] = useState(dollars(usual));
  const [byCoins, setByCoins] = useState(true);
  const [coins, setCoins] = useState<Record<number, number>>({});
  const [totalText, setTotalText] = useState("");
  const [keepText, setKeepText] = useState(dollars(usual));
  const [note, setNote] = useState("");
  const [poAmount, setPoAmount] = useState("");
  const [poNote, setPoNote] = useState("");
  const [poDay, setPoDay] = useState(days[0] ?? today);

  const inDays = sales.filter((s) => s.status === "complete" && !s.test && days.includes(dayOf(s)));
  const cashSales = inDays.filter((s) => s.method === "cash").reduce((t, s) => t + s.total, 0);
  const cardSales = inDays.filter((s) => s.method === "card");
  const card = cardSales.reduce((t, s) => t + s.total, 0);
  const payouts = book.payouts.filter((p) => days.includes(p.day));
  const paidOut = payouts.reduce((t, p) => t + p.amount, 0);
  const float = cents(floatText) ?? 0;
  const expected = float + cashSales - paidOut;
  const coinTotal = DENOMS.reduce((t, d) => t + d * (coins[d] ?? 0), 0);
  const counted = byCoins ? (coinTotal ? coinTotal : null) : cents(totalText);
  const diff = counted == null ? null : counted - expected;
  const keep = cents(keepText) ?? 0;
  const banked = counted == null ? null : counted - keep;
  const unsettled = sales.filter((s) => s.method === "card" && days.includes(dayOf(s)) && (s.status === "card_pending" || s.status === "card_unknown"));

  const toggle = (d: string) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()));
  const bump = (d: number, n: number) => setCoins((c) => ({ ...c, [d]: Math.max(0, (c[d] ?? 0) + n) }));

  const addPayout = () => {
    const amount = cents(poAmount);
    if (!amount) return;
    setBook({ ...book, payouts: [...book.payouts, { id: crypto.randomUUID(), day: days.includes(poDay) ? poDay : days[0], amount, note: poNote.trim(), at: new Date().toISOString() }] });
    setPoAmount("");
    setPoNote("");
  };
  const removePayout = (id: string) => confirm("Remove this paid out?") && setBook({ ...book, payouts: book.payouts.filter((p) => p.id !== id) });

  const save = () => {
    if (counted == null || banked == null || !days.length) return;
    if (banked < 0 && !confirm(`Keeping ${money(keep)} is more than was counted. Save anyway?`)) return;
    const close: DayClose = {
      id: crypto.randomUUID(),
      days,
      float,
      cashSales,
      payouts: paidOut,
      expected,
      counted,
      ...(byCoins ? { coins: Object.fromEntries(Object.entries(coins).filter(([, n]) => n > 0)) } : {}),
      card,
      cardCount: cardSales.length,
      keep,
      banked,
      ...(note.trim() ? { note: note.trim() } : {}),
      countedAt: new Date().toISOString(),
      device: deviceId,
    };
    setBook({ ...book, closes: [...book.closes, close] });
    if (keep !== usual) setSettings({ ...settings, float: keep });
    onDone();
  };

  const closed = [...book.closes].sort((a, b) => b.days[0].localeCompare(a.days[0])).slice(0, 8);
  const reopen = (c: DayClose) =>
    confirm(`Re-open ${c.days.map(dayLabel).join(", ")}? Its cash count will be deleted and it will need counting again.`) &&
    setBook({ ...book, closes: book.closes.filter((x) => x.id !== c.id) });

  return (
    <div className="reports close-day">
      <section className="panel">
        <h2>Which market day are you counting?</h2>
        <div className="periods pad">
          {open.map((d) => (
            <button key={d} role="checkbox" aria-checked={days.includes(d)} className={`pill${days.includes(d) ? " on" : ""}`} onClick={() => toggle(d)}>
              {dayLabel(d)}
            </button>
          ))}
          {!open.length && <span className="sub">Every market day has been counted.</span>}
        </div>
        {days.length > 1 && <p className="sub pad">Counting {days.length} days together as one tin.</p>}
        {unsettled.length > 0 && <p className="warn pad">{unsettled.length} card payment(s) on this day are still being checked, so the card total may change.</p>}
      </section>

      {days.length > 0 && (
        <div className="cols">
          <section className="panel grow-col">
            <h2>Count the tin</h2>
            <div className="periods pad">
              <button className={`pill${byCoins ? " on" : ""}`} onClick={() => setByCoins(true)}>Notes and coins</button>
              <button className={`pill${!byCoins ? " on" : ""}`} onClick={() => setByCoins(false)}>Type the total</button>
            </div>
            {byCoins ? (
              <div className="denoms pad">
                {DENOMS.map((d) => (
                  <div key={d} className="denom num">
                    <span className="dl">{denomLabel(d)}</span>
                    <button className="pill" aria-label={`One less ${denomLabel(d)}`} onClick={() => bump(d, -1)}>−</button>
                    <input
                      inputMode="numeric"
                      aria-label={`Number of ${denomLabel(d)}`}
                      value={coins[d] ? String(coins[d]) : ""}
                      placeholder="0"
                      onChange={(e) => setCoins((c) => ({ ...c, [d]: Math.max(0, parseInt(e.target.value) || 0) }))}
                    />
                    <button className="pill" aria-label={`One more ${denomLabel(d)}`} onClick={() => bump(d, 1)}>+</button>
                    <span className="dt">{money(d * (coins[d] ?? 0))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <label className="field pad">
                Total in the tin $
                <input inputMode="decimal" value={totalText} onChange={(e) => setTotalText(e.target.value)} placeholder="0.00" autoFocus />
              </label>
            )}

            <h2>Paid out of the tin</h2>
            <div className="checks">
              {payouts.map((p) => (
                <div key={p.id} className="c">
                  <span className="grow">{p.note || "Paid out"}{days.length > 1 ? ` · ${dayLabel(p.day)}` : ""}</span>
                  <strong className="num">{money(p.amount)}</strong>
                  <button className="link" onClick={() => removePayout(p.id)}>Remove</button>
                </div>
              ))}
              <div className="c">
                <input className="po-amt" inputMode="decimal" placeholder="$" aria-label="Amount paid out" value={poAmount} onChange={(e) => setPoAmount(e.target.value)} />
                <input className="grow po-note" placeholder="What for (e.g. helper wages)" value={poNote} onChange={(e) => setPoNote(e.target.value)} />
                {days.length > 1 && (
                  <select value={poDay} onChange={(e) => setPoDay(e.target.value)} aria-label="Market day">
                    {days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
                  </select>
                )}
                <button className="pill" disabled={!cents(poAmount)} onClick={addPayout}>Add</button>
              </div>
            </div>
          </section>

          <section className="qb">
            <h2>Cash</h2>
            <label>
              Float in the tin before the market
              <span>$ <input inputMode="decimal" value={floatText} onChange={(e) => setFloatText(e.target.value)} /></span>
            </label>
            <div className="kv num"><span>Cash sales</span><strong>{money(cashSales)}</strong></div>
            <div className="kv num"><span>Paid out</span><strong>−{money(paidOut)}</strong></div>
            <hr />
            <div className="kv num"><span>Should be in the tin</span><strong>{money(expected)}</strong></div>
            <div className="kv num"><span>Counted</span><strong>{counted == null ? "—" : money(counted)}</strong></div>
            {diff != null && (
              <div className={`diff num ${Math.abs(diff) <= 200 ? "ok" : "off"}`}>
                {diff === 0 ? "Spot on" : `${diff > 0 ? "Over" : "Short"} ${money(Math.abs(diff))}`}
              </div>
            )}
            <hr />
            <label>
              Keep in the tin as next float
              <span>$ <input inputMode="decimal" value={keepText} onChange={(e) => setKeepText(e.target.value)} /></span>
            </label>
            <div className="kv num"><span>To bank</span><strong>{banked == null ? "—" : money(banked)}</strong></div>
            <hr />
            <div className="kv num"><span>Card ({cardSales.length} sales)</span><strong>{money(card)}</strong></div>
            <span className="sub">Check this against the Zeller settlement for the day.</span>
            <hr />
            <input className="note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn-go small" disabled={counted == null} onClick={save}>Save count</button>
          </section>
        </div>
      )}

      {closed.length > 0 && (
        <section className="panel">
          <h2>Counted days</h2>
          <div className="checks">
            {closed.map((c) => {
              const d = c.counted - c.expected;
              return (
                <div key={c.id} className="c">
                  <span className="grow">{c.days.map(dayLabel).join(", ")} · bank {money(c.banked)}</span>
                  <strong className={`num ${Math.abs(d) <= 200 ? "" : "warn"}`}>{d === 0 ? "Spot on" : `${d > 0 ? "Over" : "Short"} ${money(Math.abs(d))}`}</strong>
                  <button className="link" onClick={() => download(`roseberry-cash-${c.days[0]}.txt`, closeText(c, sales))}>Summary</button>
                  <button className="link" onClick={() => reopen(c)}>Re-open</button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
