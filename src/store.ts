export type TxStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled"
  | "error"
  | "unknown"
  | "not_charged"
  | "refunded";

export interface TxRecord {
  reference: string;
  amount: number; // cents
  status: TxStatus;
  startedAt: string;
  updatedAt?: string;
  transactionUuid?: string;
  detail?: string;
  refundReference?: string;
  // Set when the purchase promise was still unresolved at the watchdog timeout.
  timedOut?: boolean;
}

export interface LogEntry {
  at: string;
  kind: "request" | "result" | "info";
  method: string;
  data?: unknown;
}

const TX_KEY = "rg-test-transactions";
const LOG_KEY = "rg-test-log";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable; the page still works for this session
  }
}

export const loadTx = () => read<TxRecord[]>(TX_KEY, []);
export const saveTx = (list: TxRecord[]) => write(TX_KEY, list);
export const loadLog = () => read<LogEntry[]>(LOG_KEY, []);
export const saveLog = (list: LogEntry[]) => write(LOG_KEY, list);

// Card fields that must never be logged, displayed or stored. `panMasked` and `bin` are the
// SDK's ClientTransaction fields; `receiptText` can contain the masked PAN. The rest are defensive.
const CARD_KEYS = /^(panmasked|maskedpan|pan|bin|receipttext|expiry|expirydate|cvv|cvc|pin|cardnumber|track)$/i;

export function stripCard(value: unknown): unknown {
  if (value instanceof Error) {
    return { error: true, type: (value as { type?: unknown }).type, message: value.message };
  }
  if (Array.isArray(value)) return value.map(stripCard);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (CARD_KEYS.test(k.replace(/[_-]/g, ""))) continue;
      out[k] = stripCard(v);
    }
    return out;
  }
  return value;
}

export function newReference() {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `rg-test-${new Date().toISOString()}-${rand}`;
}
