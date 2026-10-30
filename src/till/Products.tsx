import { useMemo, useRef, useState } from "react";
import type { Gst, Product, Unit } from "./types";
import { saveProduct } from "./firebase";
import { Close, Plus, Search } from "./Icons";
import { Photo } from "./Photo";
import { Keypad, press } from "./Keypad";

// Editing products on the iPad. Changes save to Firebase and appear on every signed-in device.

interface DraftOption {
  id: string;
  label: string;
  unit: Unit;
  price: string; // dollars as typed
}

interface Draft {
  id: string;
  sku: string;
  name: string;
  category: string;
  gst: Gst;
  hidden: boolean;
  photo?: string;
  options: DraftOption[];
  isNew: boolean;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function toDraft(p: Product): Draft {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    gst: p.gst,
    hidden: !!p.hidden,
    photo: p.photo,
    options: p.options.map((o) => ({ id: o.id, label: o.label, unit: o.unit, price: (o.price / 100).toFixed(2) })),
    isNew: false,
  };
}

function newDraft(all: Product[]): Draft {
  const used = new Set(all.map((p) => p.sku));
  let sku: string;
  do sku = String(100000 + Math.floor(Math.random() * 900000));
  while (used.has(sku));
  return { id: "", sku, name: "", category: "", gst: "free", hidden: false, options: [{ id: "", label: "Bunch", unit: "each", price: "" }], isNew: true };
}

// Square-crops and shrinks a photo to about 30–60 KB so it fits in the database.
async function shrinkPhoto(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const size = 480;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  img.close();
  return canvas.toDataURL("image/jpeg", 0.72);
}

function check(d: Draft): string | null {
  if (!d.name.trim()) return "Give the product a name.";
  if (!d.category.trim()) return "Choose or type a category.";
  if (!d.options.length) return "Add at least one way to sell it.";
  for (const o of d.options) {
    if (!o.label.trim()) return "Every way to sell it needs a name (e.g. Bunch).";
    if (!(Number(o.price) > 0)) return `Give "${o.label}" a price.`;
  }
  return null;
}

function fromDraft(d: Draft): Product {
  const id = d.isNew ? slug(d.name) || d.sku : d.id;
  const seen = new Set<string>();
  return {
    id,
    sku: d.sku,
    name: d.name.trim(),
    category: d.category.trim(),
    gst: d.gst,
    hidden: d.hidden,
    photo: d.photo,
    options: d.options.map((o) => {
      let oid = slug(o.label) || "option";
      while (seen.has(oid)) oid += "-2";
      seen.add(oid);
      return { id: oid, label: o.label.trim(), unit: o.unit, price: Math.round(Number(o.price) * 100) };
    }),
  };
}

export function Products({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [padFor, setPadFor] = useState<number | null>(null);
  const [padValue, setPadValue] = useState("");
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);
  const shown = products.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  const edit = (d: Draft) => {
    setDraft(d);
    setError("");
    setSaved("");
  };
  const set = (patch: Partial<Draft>) => draft && setDraft({ ...draft, ...patch });
  const setOption = (i: number, patch: Partial<DraftOption>) =>
    draft && setDraft({ ...draft, options: draft.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  const onPhoto = async (file: File | undefined) => {
    if (!file || !draft) return;
    try {
      set({ photo: await shrinkPhoto(file) });
    } catch {
      setError("Couldn't read that photo. Try another.");
    }
  };

  const save = () => {
    if (!draft) return;
    const problem = check(draft);
    if (problem) return setError(problem);
    const p = fromDraft(draft);
    if (draft.isNew && products.some((x) => x.id === p.id)) return setError(`There's already a product called ${draft.name}.`);
    // Saved on the iPad straight away; Firebase uploads it when there's internet.
    saveProduct(p).catch(() => setError("Couldn't save to Firebase. Check the internet and try again."));
    setDraft(toDraft(p));
    setError("");
    setSaved(`Saved ${p.name}`);
  };

  return (
    <div className="products">
      <nav className="plist" aria-label="Products">
        <label className="search" style={{ width: "100%" }}>
          <Search size={20} color="#4A5550" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a product" aria-label="Find a product" />
        </label>
        <button className="btn-plain small" style={{ minHeight: 52, fontSize: 18, borderWidth: 2 }} onClick={() => edit(newDraft(products))}>
          + New product
        </button>
        <div className="plist-items">
          {shown.map((p) => (
            <button key={p.id} className={`prow${draft?.id === p.id && !draft.isNew ? " on" : ""}`} onClick={() => edit(toDraft(p))}>
              <Photo product={p} className="thumb" />
              <span className="grow">{p.name}</span>
              {p.hidden && <span className="flag">Hidden</span>}
            </button>
          ))}
        </div>
      </nav>

      {draft ? (
        <main className="editor">
          <div className="photo-col">
            <Photo product={{ name: draft.name || "?", category: draft.category, photo: draft.photo }} className="big" />
            <button className="btn-go small" onClick={() => camera.current?.click()}>
              Take photo
            </button>
            <button className="btn-plain small" style={{ borderWidth: 2 }} onClick={() => library.current?.click()}>
              Choose from Photos
            </button>
            {draft.photo && (
              <button className="link" onClick={() => set({ photo: undefined })}>
                Remove photo
              </button>
            )}
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
            <input ref={library} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
          </div>

          <div className="fields">
            <div className="two">
              <label className="fld">
                Name
                <input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label className="fld">
                Category
                <input list="categories" value={draft.category} onChange={(e) => set({ category: e.target.value })} />
                <datalist id="categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
            </div>

            <div className="fld">
              Ways it's sold
              {draft.options.map((o, i) => (
                <div key={i} className="optrow">
                  <input aria-label="Option name" value={o.label} placeholder="e.g. Bunch" onChange={(e) => setOption(i, { label: e.target.value })} />
                  {/* iPads have no number-only keyboard, so prices use the till's own number pad */}
                  <button className="price-btn num" aria-label={`Price for ${o.label || "option"}`} onClick={() => {
                      setPadValue("");
                      setPadFor(i);
                    }}
                  >
                    ${o.price || "0.00"}
                  </button>
                  <select aria-label="Priced" value={o.unit} onChange={(e) => setOption(i, { unit: e.target.value as Unit })}>
                    <option value="each">each</option>
                    <option value="kg">per kg</option>
                  </select>
                  <button className="icon-btn" aria-label={`Remove ${o.label || "option"}`} onClick={() => set({ options: draft.options.filter((_, j) => j !== i) })}>
                    <Close size={18} />
                  </button>
                </div>
              ))}
              <button className="link add" onClick={() => set({ options: [...draft.options, { id: "", label: "", unit: "each", price: "" }] })}>
                <Plus size={18} /> Add another way to sell it
              </button>
            </div>

            <div className="two">
              <div className="fld">
                GST
                <div className="seg" role="radiogroup" aria-label="GST">
                  <button role="radio" aria-checked={draft.gst === "free"} className={draft.gst === "free" ? "on" : ""} onClick={() => set({ gst: "free" })}>
                    GST-free
                  </button>
                  <button role="radio" aria-checked={draft.gst === "taxable"} className={draft.gst === "taxable" ? "on" : ""} onClick={() => set({ gst: "taxable" })}>
                    Includes GST
                  </button>
                </div>
              </div>
              <div className="fld">
                On the till
                <div className="seg" role="radiogroup" aria-label="On the till">
                  <button role="radio" aria-checked={!draft.hidden} className={!draft.hidden ? "on" : ""} onClick={() => set({ hidden: false })}>
                    Show
                  </button>
                  <button role="radio" aria-checked={draft.hidden} className={draft.hidden ? "on" : ""} onClick={() => set({ hidden: true })}>
                    Hide for now
                  </button>
                </div>
              </div>
            </div>

            <div className="grow" />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {saved && !error && <p className="ok" role="status">{saved}</p>}
            <div className="actions">
              <span className="sku">SKU {draft.sku}</span>
              <button className="btn-plain small" style={{ borderWidth: 2 }} onClick={() => setDraft(null)}>
                Close
              </button>
              <button className="btn-go small" onClick={save}>
                Save
              </button>
            </div>
          </div>
        </main>
      ) : (
        <main className="editor empty">Choose a product to edit, or add a new one.</main>
      )}

      {draft && padFor !== null && draft.options[padFor] && (
        <div className="backdrop" onClick={(e) => e.target === e.currentTarget && setPadFor(null)}>
          <section className="dialog price-pad" role="dialog" aria-modal="true" aria-label="Price">
            <h2>{draft.options[padFor].label || "Price"}</h2>
            <div className="readout num">
              <div className="hint">{draft.options[padFor].unit === "kg" ? "Price per kg" : "Price each"}</div>
              <div className="w">${padValue || "0"}</div>
            </div>
            <Keypad extra="." onKey={(k) => setPadValue((v) => press(v, k, 6))} />
            <div className="row">
              <button className="btn-plain small" style={{ borderWidth: 2 }} onClick={() => setPadFor(null)}>
                Cancel
              </button>
              <button
                className="btn-go small"
                onClick={() => {
                  const n = Number(padValue);
                  if (n > 0) setOption(padFor, { price: n.toFixed(2) });
                  setPadFor(null);
                }}
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
