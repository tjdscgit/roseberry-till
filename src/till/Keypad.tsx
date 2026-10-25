import { Backspace } from "./Icons";

// Big number pad. `extra` is the bottom-left key: "00" for grams, "." for dollars.
export function Keypad({ extra, onKey, className = "keypad" }: { extra: "00" | "."; onKey: (k: string) => void; className?: string }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", extra, "0", "back"];
  return (
    <div className={className} role="group" aria-label="Number pad">
      {keys.map((k) => (
        <button key={k} className="key" aria-label={k === "back" ? "Delete" : k === "." ? "Decimal point" : k} onClick={() => onKey(k)}>
          {k === "back" ? <Backspace size={38} /> : k}
        </button>
      ))}
    </div>
  );
}

// Applies a key press to a digits string, keeping it to `max` characters.
export function press(value: string, k: string, max: number): string {
  if (k === "back") return value.slice(0, -1);
  if (k === "." && value.includes(".")) return value;
  if (/\.\d\d$/.test(value)) return value; // no more than cents
  const next = value === "0" && k !== "." ? k : value + k;
  return next.length > max ? value : next;
}
