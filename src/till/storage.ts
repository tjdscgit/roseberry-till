import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { putConfig, putSale, removeSale, watchConfig, watchSales } from "./firebase";
import type { Sale } from "./types";

// localStorage is this iPad's own record, written synchronously so nothing is lost if the page
// dies mid-payment. Sales and shared settings are also copied to Firebase, so every till sees
// them. Every access is wrapped: in a private window or with blocked storage the till still
// works for the session, from memory.
const SALES_KEY = "roseberry-till.sales.v1";
const SETTINGS_KEY = "roseberry-till.settings.v1";
const LOG_KEY = "roseberry-till.log.v1";
const KEEP_DAYS = 60;
const KEEP_LOG = 1000;

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
    // storage full or blocked; memory still has it
  }
}

// A random name for this iPad, made once. Sales carry it so each till only chases its own card
// payments with its own terminal.
const DEVICE_KEY = "roseberry-till.device.v1";
export const deviceId: string = (() => {
  const existing = read<string | null>(DEVICE_KEY, null);
  if (existing) return existing;
  const id = crypto.randomUUID().slice(0, 8);
  write(DEVICE_KEY, id);
  return id;
})();

// Sales made before sync existed have no device; they were made on this iPad.
export const isMine = (s: Sale) => !s.device || s.device === deviceId;

const upload = (s: Sale) => {
  if (s.test || !s.device) return; // test sales, and sales from before sync, stay on this iPad
  putSale({ ...s, device: s.device ?? deviceId }).catch(() => {});
};

export interface Settings {
  feeRate?: number; // Zeller card fee, percent
}

// A setting shared by every till: kept on the iPad for offline starts, synced through Firebase.
function useShared<T>(name: string, key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => read<T>(key, fallback));
  useEffect(
    () =>
      watchConfig<T>(name, (v) => {
        const next = v ?? fallback;
        write(key, next);
        setValue(next);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, key]
  );
  const set = useCallback(
    (v: T) => {
      write(key, v);
      setValue(v);
      putConfig(name, v).catch(() => {});
    },
    [name, key]
  );
  return [value, set];
}

export const useSettings = () => useShared<Settings>("settings", SETTINGS_KEY, {});

export const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

// What this iPad keeps in localStorage: its own sales from the last KEEP_DAYS, plus any card
// payment still unsettled, plus test sales.
const local = (s: Sale) => s.test || (isMine(s) && (Date.parse(s.createdAt) >= Date.now() - KEEP_DAYS * 86400000 || s.status !== "complete"));
const persist = (list: Sale[]) => write(SALES_KEY, list.filter(local));

const byTime = (a: Sale, b: Sale) => a.createdAt.localeCompare(b.createdAt);

export function useSales(user: User | null | undefined) {
  const ref = useRef<Sale[]>(read<Sale[]>(SALES_KEY, []));
  const [sales, setSales] = useState(ref.current);

  // Signed in: follow every till's sales, all time. This iPad's own copy of its own recent sales
  // always wins; everything else comes from Firebase, which also brings back a lost iPad's
  // history. Only this iPad's own recent sales are kept in localStorage; Firebase keeps its own
  // offline copy of the rest. Sales from before sync started are not uploaded.
  useEffect(() => {
    if (!user) return;
    return watchSales((remote) => {
      const mine = ref.current.filter((s) => (isMine(s) && local(s)) || s.test);
      const have = new Set(mine.map((s) => s.id));
      ref.current = [...mine, ...remote.filter((s) => !have.has(s.id))].sort(byTime);
      setSales(ref.current);
    });
  }, [user]);

  // Memory is the source of truth; storage is written through on every change, synchronously,
  // so a sale is on disk before a payment starts.
  const upsert = useCallback((id: string, patch: Partial<Sale>, base?: Sale) => {
    const list = ref.current.slice();
    const i = list.findIndex((s) => s.id === id);
    if (i >= 0) list[i] = { ...list[i], ...patch };
    else if (base) list.push({ ...base, ...patch });
    else return;
    ref.current = list;
    persist(list);
    setSales(ref.current);
    const saved = ref.current.find((s) => s.id === id);
    if (saved) upload(saved);
  }, []);

  // Swaps the whole list at once (loading or removing test sales).
  const replace = useCallback((list: Sale[]) => {
    const keep = new Set(list.map((s) => s.id));
    for (const s of ref.current) if (!keep.has(s.id) && !s.test) removeSale(s.id).catch(() => {});
    ref.current = list;
    persist(list);
    setSales(list);
  }, []);

  const get = useCallback((id: string) => ref.current.find((s) => s.id === id), []);
  const all = useCallback(() => ref.current, []);

  const nextNumber = useCallback(
    () => ref.current.filter((s) => isToday(s.createdAt)).reduce((n, s) => Math.max(n, s.number), 0) + 1,
    []
  );

  return { sales, upsert, replace, get, all, nextNumber };
}

// Diagnostic log of every payment call, kept on the iPad and downloadable from Reports.
export interface LogEntry {
  at: string;
  kind: "request" | "result" | "info";
  method: string;
  data?: unknown;
}

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

export function appendLog(kind: LogEntry["kind"], method: string, data?: unknown) {
  const log = read<LogEntry[]>(LOG_KEY, []);
  log.push({ at: new Date().toISOString(), kind, method, data: stripCard(data) });
  write(LOG_KEY, log.slice(-KEEP_LOG));
}

export const loadLog = () => read<LogEntry[]>(LOG_KEY, []);

// The front page: an ordered list of tiles, each a product or a veg group, with a size.
export type TileSize = "xs" | "s" | "w" | "t" | "l"; // extra small is a quarter of small; small 1x1, wide 2x1, tall 1x2, large 2x2
export interface HomeTile {
  kind: "product" | "group";
  id: string; // product id, or the category name
  size: TileSize;
  photo?: string; // group tiles only; a shrunk data URL
}
const HOME_KEY = "roseberry-till.home.v2";
// null means the default layout (all groups, all produce).
export const useHome = () => useShared<HomeTile[] | null>("home", HOME_KEY, null);
