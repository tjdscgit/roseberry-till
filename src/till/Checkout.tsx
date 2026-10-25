import { useEffect, useState } from "react";
import type { Sale } from "./types";
import { money, price } from "./money";
import { Check, Terminal } from "./Icons";
import { Keypad, press } from "./Keypad";

// ---------- Cash ----------

// Note amounts above the total a customer is likely to hand over.
function likelyNotes(total: number): number[] {
  const out = new Set<number>();
  for (const step of [500, 1000, 2000, 5000, 10000]) {
    const up = Math.ceil(total / step) * step;
    if (up > total) out.add(up);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

export function Cash({ total, onDone }: { total: number; onDone: (tendered: number) => void }) {
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const tendered = picked ?? Math.round((Number(typed) || 0) * 100);
  const change = tendered - total;
  const notes = likelyNotes(total);

  return (
    <div className="screen cash">
      <div className="main">
        <div className="total">
          <span className="label">Total</span>
          <span className="big num">{money(total)}</span>
        </div>
        <div>
          <div style={{ fontSize: 20, color: "var(--muted)", margin: "0 0 10px 4px" }}>Customer handed over</div>
          <div className="tenders">
            <button className={`tender${picked === total ? " on" : ""}`} onClick={() => { setPicked(total); setTyped(""); }}>
              Exact
            </button>
            {notes.map((n) => (
              <button key={n} className={`tender${picked === n ? " on" : ""}`} onClick={() => { setPicked(n); setTyped(""); }}>
                {price(n)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Cash received</span>
          <span className="val num">{tendered ? money(tendered) : "—"}</span>
        </div>
        <div className={`change${change < 0 ? " short" : ""}`} role="status">
          <span className="label">{change < 0 ? (tendered ? `${money(-change)} still to pay` : "Enter cash received") : "Give change"}</span>
          <span className="val num">{change >= 0 ? money(change) : ""}</span>
        </div>
        <button className="btn-go" disabled={change < 0} onClick={() => onDone(tendered)}>
          Done · sale complete
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, justifyContent: "flex-end" }}>
        <div style={{ fontSize: 18, color: "var(--muted)", marginLeft: 4 }}>Or type an amount</div>
        <Keypad
          extra="."
          onKey={(k) => {
            setPicked(null);
            setTyped((v) => press(v, k, 7));
          }}
        />
      </div>
    </div>
  );
}

// ---------- Card ----------

const STEP_TEXT: Record<string, string> = {
  AWAITING_PAYMENT_METHOD: "Waiting for card…",
  RETRYING_PAYMENT_METHOD: "Try the card again…",
  AWAITING_PIN_ENTRY: "Customer is entering their PIN…",
  AWAITING_ACCOUNT_SELECTION: "Customer is choosing an account…",
  AWAITING_APPLICATION_SELECTION: "Customer is choosing a card…",
  AWAITING_SIGNATURE: "Waiting for signature…",
  PROCESSING: "Processing…",
  DISPLAYING_PAYMENT_MESSAGE: "Check the terminal…",
};

interface CardProps {
  sale: Sale;
  step: string;
  onCancel: () => void;
  onCheckNow: () => void;
  onSetAside: () => void;
  onRetry: () => void;
  onCash: () => void;
  onBack: () => void;
}

export function Card({ sale, step, onCancel, onCheckNow, onSetAside, onRetry, onCash, onBack }: CardProps) {
  const pending = sale.status === "card_pending";
  const unknown = sale.status === "card_unknown";
  const failed = sale.status === "card_failed" || sale.status === "not_charged";
  const processing = step === "PROCESSING";

  return (
    <div className="screen">
      <div className="center">
        <div>
          <div className="caption">Charging</div>
          <div className="huge num">{money(sale.total)}</div>
        </div>

        {pending && (
          <>
            <div className="notice wait" role="status">
              <Terminal size={64} />
              <div>
                <b>Customer taps card on the terminal</b>
                <span>{STEP_TEXT[step] ?? "Sending to the terminal…"}</span>
              </div>
            </div>
            <ol className="steps" aria-label="Progress">
              <li className={step ? "done" : "now"}>Sent to terminal</li>
              <li className={processing ? "done" : step ? "now" : ""}>Waiting for card</li>
              <li className={processing ? "now" : ""}>Approved</li>
            </ol>
            <button className="btn-plain small" onClick={onCancel}>
              Cancel payment
            </button>
            <p className="small-print">If the connection drops, the till checks the result with Zeller by itself. Never charge the card again until it says so.</p>
          </>
        )}

        {unknown && (
          <>
            <div className="notice check" role="status">
              <div>
                <b>Checking with Zeller…</b>
                <span>{sale.detail ?? "The answer didn't come back. Don't charge again yet."}</span>
              </div>
            </div>
            <div className="row">
              <button className="btn-go small" onClick={onCheckNow}>
                Check now
              </button>
              <button className="btn-plain small" onClick={onSetAside}>
                Next customer, keep checking
              </button>
            </div>
            <p className="small-print">"Next customer" clears the basket. If this payment turns out not to have gone through, the till will tell you and can put the items back.</p>
          </>
        )}

        {failed && (
          <>
            <div className="notice fail" role="alert">
              <div>
                <b>Not charged</b>
                <span>{sale.detail ?? "The payment didn't go through."}</span>
              </div>
            </div>
            <div className="row">
              <button className="btn-go small" onClick={onRetry}>
                Try card again
              </button>
              <button className="btn-plain small" onClick={onCash}>
                Pay with cash
              </button>
              <button className="btn-plain small" onClick={onBack}>
                Back to basket
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Done ----------

const AUTO_RETURN_S = 5;

export function Done({ sale, onNext }: { sale: Sale; onNext: () => void }) {
  const [left, setLeft] = useState(AUTO_RETURN_S);
  useEffect(() => {
    if (left <= 0) {
      onNext();
      return;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onNext]);

  const isCash = sale.method === "cash";
  return (
    <div className="screen done-screen">
      <div className="center">
        <div className="tick">
          <Check size={72} color="#FFFFFF" />
        </div>
        <div>
          <div className="what">{isCash ? "Paid in cash" : "Approved"}</div>
          <div className="huge num">{money(sale.total)}</div>
          <div className="how">
            {isCash ? `Received ${money(sale.cash!.tendered)} · change ${money(sale.cash!.change)}` : `Card${sale.card?.scheme ? ` · ${sale.card.scheme}` : ""} · receipt on the terminal`}
          </div>
        </div>
        <button className="btn-go" style={{ width: 520 }} onClick={onNext}>
          Next customer
        </button>
        <div className="how">Back to the till by itself in {left} seconds</div>
      </div>
    </div>
  );
}
