import { useCallback, useEffect, useMemo, useState } from "react";
import catalogue from "./catalogue.json";
import type { Line, Option, Product, Sale } from "./types";
import { money } from "./money";
import { addEach, addWeight, basketTotal, changeQty, removeLine, summarise } from "./basket";
import { isToday, useSales } from "./storage";
import { newReference, usePayments } from "./payments";
import { Back, WifiOff } from "./Icons";
import { Sell } from "./Sell";
import { OptionDialog } from "./OptionDialog";
import { Card, Cash, Done } from "./Checkout";
import { Reports } from "./Reports";

type Screen =
  | { name: "sell" }
  | { name: "cash" }
  | { name: "card"; saleId: string }
  | { name: "done"; saleId: string }
  | { name: "reports" };

const products = (catalogue as Product[]).filter((p) => !p.hidden && p.options.length);

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

// Keep the iPad screen on while the till is open, where the browser allows it.
function useWakeLock() {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<unknown> } };
    if (!nav.wakeLock) return;
    const request = () => document.visibilityState === "visible" && nav.wakeLock!.request("screen").catch(() => {});
    request();
    document.addEventListener("visibilitychange", request);
    return () => document.removeEventListener("visibilitychange", request);
  }, []);
}

export default function App() {
  const { sales, upsert, get, all, nextNumber } = useSales();
  const pay = usePayments({ upsert, get, all });
  const online = useOnline();
  useWakeLock();

  const [lines, setLines] = useState<Line[]>([]);
  const [screen, setScreen] = useState<Screen>({ name: "sell" });
  const [picking, setPicking] = useState<Product | null>(null);

  const total = basketTotal(lines);
  const today = useMemo(() => summarise(sales.filter((s) => isToday(s.createdAt))), [sales]);
  const canCard = online && pay.status === "ready";
  const cardLabel = !online
    ? "Card paused"
    : pay.status === "ready"
      ? "Card"
      : pay.status === "checking"
        ? "Card…"
        : pay.status === "setup"
          ? "Pair terminal first"
          : "Card unavailable";

  // Card sales moved off screen while being checked, whose outcome still needs to be seen.
  const settled = sales.filter((s) => s.setAside && !s.acknowledged && (s.status === "complete" || s.status === "card_failed" || s.status === "not_charged"));
  const checking = sales.filter((s) => s.setAside && (s.status === "card_unknown" || s.status === "card_pending")).length;

  const tap = (p: Product) => {
    // One way to sell it, sold by count: straight into the basket.
    if (p.options.length === 1 && p.options[0].unit === "each") setLines((l) => addEach(l, p, p.options[0], 1));
    else setPicking(p);
  };

  const startCard = () => {
    const id = crypto.randomUUID();
    const sale: Sale = {
      id,
      number: nextNumber(),
      createdAt: new Date().toISOString(),
      lines,
      total,
      method: "card",
      status: "card_pending",
      card: { reference: newReference() },
    };
    upsert(id, {}, sale); // saved before Zeller is asked, so a crash can be recovered
    setScreen({ name: "card", saleId: id });
    pay.charge(id);
  };

  const finishCash = (tendered: number) => {
    const id = crypto.randomUUID();
    upsert(id, {}, {
      id,
      number: nextNumber(),
      createdAt: new Date().toISOString(),
      lines,
      total,
      method: "cash",
      status: "complete",
      cash: { tendered, change: tendered - total },
    });
    setLines([]);
    setScreen({ name: "done", saleId: id });
  };

  const toSell = useCallback(() => setScreen({ name: "sell" }), []);

  // Approved card sale on screen: clear the basket and show the result.
  const cardSale = screen.name === "card" ? sales.find((s) => s.id === screen.saleId) : undefined;
  useEffect(() => {
    if (cardSale?.status === "complete") {
      setLines([]);
      setScreen({ name: "done", saleId: cardSale.id });
    }
  }, [cardSale?.status, cardSale?.id]);

  const setAside = (s: Sale) => {
    upsert(s.id, { setAside: true });
    setLines([]);
    setScreen({ name: "sell" });
  };

  const header =
    screen.name === "sell" ? (
      <header className="topbar">
        <h1>Roseberry Till</h1>
        {checking > 0 && (
          <span className="chip">
            <span className="dot warn" />
            Checking {checking} card payment{checking === 1 ? "" : "s"}
          </span>
        )}
        {pay.status === "ready" && (
          <span className="chip">
            <span className="dot" />
            T2 ready
          </span>
        )}
        {pay.status === "checking" && (
          <span className="chip">
            <span className="dot warn" />
            Checking T2…
          </span>
        )}
        {pay.status === "setup" && (
          <button className="btn-light solid" disabled={pay.busy} onClick={pay.pair}>
            Pair terminal
          </button>
        )}
        {pay.status === "error" && (
          <button className="btn-light" disabled={pay.busy} onClick={pay.checkTerminal}>
            <span className="chip">
              <span className="dot bad" />
              T2 problem · retry
            </span>
          </button>
        )}
        <span className="chip">{online ? "Online" : <strong style={{ color: "#FBBF24" }}>Offline</strong>}</span>
        <button className="btn-light" onClick={() => setScreen({ name: "reports" })}>
          Today {money(today.gross)} · {today.count} sale{today.count === 1 ? "" : "s"}
        </button>
      </header>
    ) : (
      <header className="topbar">
        {(screen.name === "cash" || screen.name === "reports") && (
          <button className="btn-back" onClick={toSell}>
            <Back /> {screen.name === "cash" ? "Back to basket" : "Back to till"}
          </button>
        )}
        <h1>
          {screen.name === "cash" && "Cash payment"}
          {screen.name === "card" && "Card payment"}
          {screen.name === "done" && `Sale ${get(screen.saleId)?.number ?? ""}`}
          {screen.name === "reports" && `Today · ${new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" })}`}
        </h1>
      </header>
    );

  return (
    <div className="app">
      {header}

      {screen.name === "sell" && (
        <>
          {!online && (
            <div className="banner offline" role="status">
              <WifiOff size={28} />
              <span className="grow">
                <strong>No internet.</strong> Cash sales still work and are saved on this iPad. Card is paused until the connection is back.
              </span>
            </div>
          )}
          {pay.status === "error" && online && (
            <div className="banner offline" role="status">
              <span className="grow">Can't reach the terminal: {pay.statusText}</span>
            </div>
          )}
          {settled.map((s) =>
            s.status === "complete" ? (
              <div key={s.id} className="banner good" role="status">
                <span className="grow">
                  <strong>Sale {s.number} · {money(s.total)}:</strong> the card payment went through.
                </span>
                <button onClick={() => upsert(s.id, { acknowledged: true })}>OK</button>
              </div>
            ) : (
              <div key={s.id} className="banner alert" role="alert">
                <span className="grow">
                  <strong>Sale {s.number} · {money(s.total)}:</strong> the card payment did NOT go through.
                </span>
                <button
                  onClick={() => {
                    setLines(s.lines);
                    upsert(s.id, { acknowledged: true });
                  }}
                >
                  Put items back in basket
                </button>
                <button onClick={() => upsert(s.id, { acknowledged: true })}>Dismiss</button>
              </div>
            )
          )}
          <Sell
            products={products}
            lines={lines}
            canCard={canCard}
            cardLabel={cardLabel}
            onTap={tap}
            onQty={(key, qty) => setLines((l) => changeQty(l, key, qty))}
            onRemove={(key) => setLines((l) => removeLine(l, key))}
            onClear={() => setLines([])}
            onCard={startCard}
            onCash={() => setScreen({ name: "cash" })}
          />
        </>
      )}

      {screen.name === "cash" && <Cash total={total} onDone={finishCash} />}

      {screen.name === "card" && cardSale && (
        <Card
          sale={cardSale}
          step={pay.step}
          onCancel={pay.cancel}
          onCheckNow={() => pay.recover(cardSale.id)}
          onSetAside={() => setAside(cardSale)}
          onRetry={startCard}
          onCash={() => setScreen({ name: "cash" })}
          onBack={toSell}
        />
      )}

      {screen.name === "done" && get(screen.saleId) && <Done sale={get(screen.saleId)!} onNext={toSell} />}

      {screen.name === "reports" && <Reports sales={sales} />}

      {picking && (
        <OptionDialog
          product={picking}
          onClose={() => setPicking(null)}
          onAddEach={(o: Option, qty: number) => {
            setLines((l) => addEach(l, picking, o, qty));
            setPicking(null);
          }}
          onAddWeight={(o: Option, grams: number) => {
            setLines((l) => addWeight(l, picking, o, grams));
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
