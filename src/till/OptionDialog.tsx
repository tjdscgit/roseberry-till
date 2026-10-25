import { useState } from "react";
import type { Option, Product } from "./types";
import { kg, money, optionPrice, price, weightAmount } from "./money";
import { Close, Minus, Plus } from "./Icons";
import { Keypad, press } from "./Keypad";
import { Photo } from "./Photo";

interface Props {
  product: Product;
  onAddEach: (o: Option, qty: number) => void;
  onAddWeight: (o: Option, grams: number) => void;
  onClose: () => void;
}

// Pick how an item is sold, then a count (bunches, bags) or a weight in grams.
export function OptionDialog({ product, onAddEach, onAddWeight, onClose }: Props) {
  const [option, setOption] = useState<Option>(product.options[0]);
  const [qty, setQty] = useState(1);
  const [grams, setGrams] = useState("");

  const g = Number(grams) || 0;
  const isKg = option.unit === "kg";
  const amount = isKg ? weightAmount(g, option.price) : qty * option.price;

  const pick = (o: Option) => {
    setOption(o);
    setQty(1);
    setGrams("");
  };

  const add = () => (isKg ? onAddWeight(option, g) : onAddEach(option, qty));
  const addLabel = isKg
    ? g > 0
      ? `Add ${money(amount)} to basket`
      : "Enter the weight"
    : `Add ${qty} × ${option.label.toLowerCase()} · ${money(amount)}`;

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`dialog${isKg ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={product.name}>
        <div className="hero">
          <Photo product={product} className="" />
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Close size={24} />
          </button>
        </div>
        <div className="cols">
          <div className="body">
            <div>
              <h2>{product.name}</h2>
              <div className="sub">{product.category}</div>
            </div>

            {product.options.length > 1 && (
              <div className="choices" role="radiogroup" aria-label="How it's sold">
                {product.options.map((o) => (
                  <button key={o.id} role="radio" aria-checked={o.id === option.id} className={`choice${o.id === option.id ? " on" : ""}`} onClick={() => pick(o)}>
                    <b>{o.label}</b>
                    <span>{optionPrice(o)}</span>
                  </button>
                ))}
              </div>
            )}

            {isKg ? (
              <div className="readout num">
                <div className="hint">Weight on the scales</div>
                <div className="w">
                  {g || 0} <small>g</small>
                </div>
                <div className="calc">
                  {kg(g)} × {price(option.price)}/kg
                </div>
                <div className="amt">{money(amount)}</div>
              </div>
            ) : (
              <div className="stepper">
                <span className="label">How many</span>
                <button className="icon-btn" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>
                  <Minus size={28} />
                </button>
                <span className="count num">{qty}</span>
                <button className="icon-btn" aria-label="One more" onClick={() => setQty(qty + 1)}>
                  <Plus size={28} />
                </button>
              </div>
            )}

            <button className="btn-go" disabled={isKg && g <= 0} onClick={add}>
              {addLabel}
            </button>
          </div>
          {isKg && <Keypad extra="00" onKey={(k) => setGrams((v) => press(v, k, 5))} />}
        </div>
      </section>
    </div>
  );
}
