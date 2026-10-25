import { useCallback, useRef, useState } from "react";
import type { Sale } from "./types";

// localStorage is the till's record until online sync arrives. Every access is wrapped: in a
// private window or with blocked storage the till still works for the session, from memory.
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

export interface Settings {
  feeRate?: number; // Zeller card fee, percent
}

export const loadSettings = () => read<Settings>(SETTINGS_KEY, {});
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);

export const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export function useSales() {
  const ref = useRef<Sale[]>(read<Sale[]>(SALES_KEY, []));
  const [sales, setSales] = useState(ref.current);

  // Memory is the source of truth; storage is written through on every change, synchronously,
  // so a sale is on disk before a payment starts.
  const upsert = useCallback((id: string, patch: Partial<Sale>, base?: Sale) => {
    const list = ref.current.slice();
    const i = list.findIndex((s) => s.id === id);
    if (i >= 0) list[i] = { ...list[i], ...patch };
    else if (base) list.push({ ...base, ...patch });
    else return;
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    ref.current = list.filter((s) => Date.parse(s.createdAt) >= cutoff || s.status !== "complete");
    write(SALES_KEY, ref.current);
    setSales(ref.current);
  }, []);

  const get = useCallback((id: string) => ref.current.find((s) => s.id === id), []);
  const all = useCallback(() => ref.current, []);

  const nextNumber = useCallback(
    () => ref.current.filter((s) => isToday(s.createdAt)).reduce((n, s) => Math.max(n, s.number), 0) + 1,
    []
  );

  return { sales, upsert, get, all, nextNumber };
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
