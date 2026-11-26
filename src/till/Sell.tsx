import { useEffect, useMemo, useRef, useState } from "react";
import type { Line, Product } from "./types";
import { kg, money, optionPrice, price } from "./money";
import { basketTotal, itemCount } from "./basket";
import { Back, Close, Minus, Plus, Search } from "./Icons";
import { Photo } from "./Photo";
import { shrinkPhoto } from "./Products";
import { loadHome, saveHome, type HomeTile, type TileSize } from "./storage";

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

const SIZES: { id: TileSize; label: string }[] = [
  { id: "xs", label: "Extra small" },
  { id: "s", label: "Small" },
  { id: "w", label: "Wide" },
  { id: "t", label: "Tall" },
  { id: "l", label: "Large" },
];

// Until the front page is edited: every group, then every product.
const defaultHome = (cats: string[], products: Product[]): HomeTile[] => [
  ...cats.map((c) => ({ kind: "group" as const, id: c, size: "s" as TileSize })),
  ...products.map((p) => ({ kind: "product" as const, id: p.id, size: "s" as TileSize })),
];

const lineDetail = (l: Line) =>
  l.unit === "kg" ? `${kg(l.grams ?? 0)} at ${price(l.unitPrice)}/kg` : `${l.optionLabel} · ${price(l.unitPrice)} each`;

export function Sell({ products, lines, canCard, cardLabel, onTap, onQty, onRemove, onClear, onCard, onCash }: Props) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("All");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(loadHome);
  const [picked, setPicked] = useState<number | null>(null);
  const groupPhoto = useRef<HTMLInputElement>(null);

  const cats = useMemo(() => {
    const present = new Set(products.map((p) => p.category));
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    return ["All", ...ordered, ...[...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort()];
  }, [products]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => (q ? p.name.toLowerCase().includes(q) : cat === "All" || p.category === cat));
  }, [products, query, cat]);
  const groups = cats.slice(1);
  const home = useMemo(() => {
    const list = saved ?? defaultHome(groups, products.filter((p) => !p.hidden));
    // Drop tiles whose product or group no longer exists.
    return list.filter((t) => (t.kind === "group" ? groups.includes(t.id) : products.some((p) => p.id === t.id)));
  }, [saved, groups, products]);
  const setHome = (tiles: HomeTile[]) => {
    setSaved(tiles);
    saveHome(tiles);
  };
  const onHome = !query && cat === "All";
  // Half-size cells, always an even number of columns, so small tiles (2 cells wide) fill each row.
  const homeRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(8);
  useEffect(() => {
    const el = homeRef.current;
    if (!el) return;
    const fit = () => setCols(Math.max(2, 2 * Math.floor((el.clientWidth + 12) / 180)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHome]);
  const groupCount = (g: string) => products.filter((p) => p.category === g).length;
  const missing = [
    ...groups.filter((g) => !home.some((t) => t.kind === "group" && t.id === g)).map((g) => ({ kind: "group" as const, id: g, name: g })),
    ...products.filter((p) => !home.some((t) => t.kind === "product" && t.id === p.id)).map((p) => ({ kind: "product" as const, id: p.id, name: p.name })),
  ];
  const patch = (i: number, t: Partial<HomeTile>) => setHome(home.map((x, j) => (j === i ? { ...x, ...t } : x)));
  const move = (i: number, to: number) => {
    if (to < 0 || to >= home.length) return;
    const list = home.slice();
    const [t] = list.splice(i, 1);
    list.splice(to, 0, t);
    setHome(list);
    setPicked(to);
  };
  const removeTile = (i: number) => {
    setHome(home.filter((_, j) => j !== i));
    setPicked(null);
  };
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const total = basketTotal(lines);
  const count = itemCount(lines);

  return (
    <div className="sell">
      <main>
        <div className="toolbar">
          {!onHome && (
            <button
              className="icon-btn back-home"
              aria-label="Back to front page"
              onClick={() => {
                setCat("All");
                setQuery("");
              }}
            >
              <Back size={24} />
            </button>
          )}
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

        {onHome && editing && (
          <div className="edit-bar">
            {picked !== null && home[picked] ? (
              <>
                <span className="edit-what">{home[picked].kind === "group" ? home[picked].id : byId.get(home[picked].id)?.name}</span>
                <div className="seg-sizes">
                  {SIZES.map((z) => (
                    <button key={z.id} className={`pill${home[picked].size === z.id ? " on" : ""}`} onClick={() => patch(picked, { size: z.id })}>
                      {z.label}
                    </button>
                  ))}
                </div>
                <button className="pill" disabled={picked === 0} onClick={() => move(picked, picked - 1)}>
                  ◀ Earlier
                </button>
                <button className="pill" disabled={picked === home.length - 1} onClick={() => move(picked, picked + 1)}>
                  Later ▶
                </button>
                {home[picked].kind === "group" && (
                  <>
                    <button className="pill" onClick={() => groupPhoto.current?.click()}>
                      {home[picked].photo ? "Change photo" : "Add photo"}
                    </button>
                    {home[picked].photo && (
                      <button className="pill" onClick={() => patch(picked, { photo: undefined })}>
                        No photo
                      </button>
                    )}
                    <input
                      ref={groupPhoto}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        try {
                          patch(picked, { photo: await shrinkPhoto(f) });
                        } catch {
                          alert("Couldn't read that photo. Try another.");
                        }
                      }}
                    />
                  </>
                )}
                <button className="pill danger" onClick={() => removeTile(picked)}>
                  Remove
                </button>
                <button className="pill on" onClick={() => { setEditing(false); setPicked(null); }}>Done</button>
              </>
            ) : (
              <>
                <span className="edit-what">Tap a tile to size, move or remove it</span>
                <select
                  className="add-select"
                  value=""
                  onChange={(e) => {
                    const m = missing.find((x) => `${x.kind}:${x.id}` === e.target.value);
                    if (m) setHome([...home, { kind: m.kind, id: m.id, size: "s" }]);
                  }}
                >
                  <option value="">+ Add a tile…</option>
                  {missing.some((m) => m.kind === "group") && (
                    <optgroup label="Groups">
                      {missing.filter((m) => m.kind === "group").map((m) => <option key={m.id} value={`group:${m.id}`}>{m.name}</option>)}
                    </optgroup>
                  )}
                  <optgroup label="Produce">
                    {missing.filter((m) => m.kind === "product").map((m) => <option key={m.id} value={`product:${m.id}`}>{m.name}</option>)}
                  </optgroup>
                </select>
                <button
                  className="pill"
                  onClick={() => {
                    if (confirm("Put the front page back to all groups and all produce?")) {
                      setSaved(null);
                      saveHome(null);
                    }
                  }}
                >
                  Reset
                </button>
                <button className="pill on" onClick={() => { setEditing(false); setPicked(null); }}>Done</button>
              </>
            )}
          </div>
        )}

        {onHome ? (
          <div ref={homeRef} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} className={`grid home${editing ? " editing" : ""}`}>
            {home.map((t, i) => {
              const cls = `tile size-${t.size}${editing && picked === i ? " picked" : ""}`;
              const tap = () => (editing ? setPicked(picked === i ? null : i) : t.kind === "group" ? setCat(t.id) : onTap(byId.get(t.id)!));
              if (t.kind === "group")
                return (
                  <button key={`g:${t.id}`} className={`${cls} group`} onClick={tap}>
                    <Photo product={{ name: t.id, category: t.id, photo: t.photo }} className="" />
                    <span className="name">{t.id}</span>
                    <span className="prices">{groupCount(t.id)} items ›</span>
                  </button>
                );
              const p = byId.get(t.id)!;
              return (
                <button key={`p:${p.id}`} className={cls} onClick={tap}>
                  <Photo product={p} className="" />
                  <span className="name">{p.name}</span>
                  <span className="prices">{tilePrices(p)}</span>
                  {p.options.some((o) => o.unit === "kg") && <span className="tag-kg">kg</span>}
                </button>
              );
            })}
            {!home.length && <div className="nothing">Front page is empty. Tap Edit front page to add tiles.</div>}
            {!editing && (
              <button className="edit-home" onClick={() => setEditing(true)}>
                Edit front page
              </button>
            )}
          </div>
        ) : (
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
        )}
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
