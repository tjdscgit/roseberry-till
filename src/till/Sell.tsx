import { useMemo, useState } from "react";
import type { Line, Product } from "./types";
import { kg, money, optionPrice, price } from "./money";
import { basketTotal, itemCount } from "./basket";
import { Close, Minus, Plus, Search } from "./Icons";
import { Photo } from "./Photo";

interface Props {
  products: Product[];
  lines: Line[];
  canCard: boolean;
  cardLabel: string;
  onTap: (p: Product) => void;
  onQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onCard: () => void;
  onCash: () => void;
}

// Category pills in stall order; any new category goes on the end.
const CATEGORY_ORDER = ["Salad Greens", "Cooking Greens", "Roots", "Brassica", "Fruiting", "Alliums", "Herbs", "Legume", "Flowers"];

// "Bunch $5 · $12/kg"
const tilePrices = (p: Product) => p.options.map((o) => (o.unit === "kg" ? optionPrice(o) : `${o.label} ${price(o.price)}`)).join(" · ");

const lineDetail = (l: Line) =>
  l.unit === "kg" ? `${kg(l.grams ?? 0)} at ${price(l.unitPrice)}/kg` : `${l.optionLabel} · ${price(l.unitPrice)} each`;

export function Sell({ products, lines, canCard, cardLabel, onTap, onQty, onRemove, onClear, onCard, onCash }: Props) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("All");

  const cats = useMemo(() => {
    const present = new Set(products.map((p) => p.category));
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    return ["All", ...ordered, ...[...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort()];
  }, [products]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => (q ? p.name.toLowerCase().includes(q) : cat === "All" || p.category === cat));
  }, [products, query, cat]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const total = basketTotal(lines);
  const count = itemCount(lines);

  return (
    <div className="sell">
      <main>
        <div className="toolbar">
          <label className="search">
            <Search size={20} color="#4A5550" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search produce" />
            {query && (
              <button className="clear" aria-label="Clear search" onClick={() => setQuery("")}>
                <Close size={18} />
              </button>
            )}
          </label>
          <nav className="cats" aria-label="Categories">
            {cats.map((c) => (
              <button
                key={c}
                className={`pill${!query && c === cat ? " on" : ""}`}
                onClick={() => {
                  setCat(c);
                  setQuery("");
                }}
              >
                {c}
              </button>
            ))}
          </nav>
        </div>

        <div className="grid">
          {shown.map((p) => (
            <button key={p.id} className="tile" onClick={() => onTap(p)}>
              <Photo product={p} className="" />
              <span className="name">{p.name}</span>
              <span className="prices">{tilePrices(p)}</span>
              {p.options.some((o) => o.unit === "kg") && <span className="tag-kg">kg</span>}
            </button>
          ))}
          {!shown.length && <div className="nothing">Nothing matches "{query}"</div>}
        </div>
      </main>

      <aside className="basket" aria-label="Basket">
        <div className="basket-head">
          <h2>{count ? `Basket · ${count} item${count === 1 ? "" : "s"}` : "Basket"}</h2>
          {lines.length > 0 && (
            <button className="link" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
        {lines.length ? (
          <ul className="lines">
            {lines.map((l) => {
              const p = byId.get(l.productId);
              return (
                <li key={l.key} className="line">
                  <Photo product={p ?? { name: l.name, category: "" }} className="thumb" />
                  <div className="info">
                    <div className="n">{l.name}</div>
                    <div className="d">{lineDetail(l)}</div>
                  </div>
                  <div className="side">
                    <span className="amt num">{money(l.amount)}</span>
                    <div className="ctrl">
                      {l.unit === "each" ? (
                        <>
                          <button className="icon-btn" aria-label={`One fewer ${l.name}`} onClick={() => onQty(l.key, l.qty - 1)}>
                            <Minus size={18} />
                          </button>
                          <span className="qty num">{l.qty}</span>
                          <button className="icon-btn" aria-label={`One more ${l.name}`} onClick={() => onQty(l.key, l.qty + 1)}>
                            <Plus size={18} />
                          </button>
                        </>
                      ) : (
                        <button className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => onRemove(l.key)}>
                          <Close size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty">Tap produce to add it</div>
        )}
        <div className="basket-foot">
          <div className="total">
            <span className="label">Total</span>
            <span className="big num">{money(total)}</span>
          </div>
          <div className="pay">
            <button className="btn-go" disabled={!total || !canCard} onClick={onCard}>
              {cardLabel}
            </button>
            <button className={canCard ? "btn-plain" : "btn-go"} disabled={!total} onClick={onCash}>
              Cash
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
