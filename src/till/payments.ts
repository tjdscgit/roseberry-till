import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminal } from "@zeller-public/payments-sdk-react";
import type { TerminalTransaction } from "@zeller-public/payments-sdk-react";
import type { Sale, SaleStatus } from "./types";
import { appendLog } from "./storage";

// Card payments through the Zeller SDK. Same rules the test page proved on the iPad:
// the sale is saved before purchase() starts, uncertain outcomes become card_unknown and are
// recovered with getTransactions, "nothing found" is only trusted after two lookups 30s apart,
// and a purchase is never retried automatically.

const PURCHASE_WATCHDOG_MS = 3 * 60 * 1000;
const RECHECK_DELAY_MS = 30 * 1000;
const AUTO_RECHECK_INTERVAL_MS = 60 * 1000;

type SdkError = Error & { type: string };
export type TerminalStatus = "checking" | "ready" | "setup" | "error";

const CANCELLED_TYPES = new Set(["Cancelled", "Inactivity Timeout"]);
const DECLINED_TYPES = new Set([
  "Card Declined",
  "Card Blocked",
  "Card Not Supported",
  "Card Read Failure",
  "Card Insert Required",
  "Transaction Declined",
]);
// Rejected before reaching the terminal, so nothing can have been charged.
const NOT_SENT_TYPES = new Set(["Setup Required", "Operation Busy", "Operation Request Invalid", "Paired Device Busy"]);

// Plain-English reasons for the screen.
const ERROR_TEXT: Record<string, string> = {
  Cancelled: "Payment cancelled",
  "Inactivity Timeout": "Timed out waiting for the card",
  "Card Declined": "Card declined",
  "Card Blocked": "Card blocked",
  "Card Not Supported": "Card not supported",
  "Card Read Failure": "Card couldn't be read. Try again",
  "Card Insert Required": "Customer needs to insert the card",
  "Transaction Declined": "Declined",
  "Setup Required": "Terminal needs pairing",
  "Operation Busy": "Terminal busy. Try again",
  "Paired Device Busy": "Terminal busy. Try again",
};

const errText = (e: SdkError) => ERROR_TEXT[e.type] ?? `${e.type}${e.message ? `: ${e.message}` : ""}`;

function statusFromError(e: SdkError): SaleStatus {
  if (CANCELLED_TYPES.has(e.type) || DECLINED_TYPES.has(e.type) || NOT_SENT_TYPES.has(e.type)) return "card_failed";
  return "card_unknown";
}

export function newReference() {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `rg-${new Date().toISOString()}-${rand}`;
}

interface Store {
  upsert: (id: string, patch: Partial<Sale>, base?: Sale) => void;
  get: (id: string) => Sale | undefined;
  all: () => Sale[];
}

export function usePayments({ upsert, get, all }: Store) {
  const terminal = useTerminal();
  const [status, setStatus] = useState<TerminalStatus>("checking");
  const [statusText, setStatusText] = useState("");
  const [step, setStep] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const purchaseRef = useRef<ReturnType<typeof terminal.purchase> | null>(null);

  // One SDK call at a time; a second call would get Operation Busy.
  const run = useCallback(async <T,>(method: string, args: unknown, fn: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    appendLog("request", method, args);
    try {
      const r = await fn();
      appendLog("result", method, r);
      return r;
    } catch (e) {
      appendLog("result", method, e);
      return e as T;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const checkTerminal = useCallback(async () => {
    setStatus("checking");
    const r = await run("initialise", null, () => terminal.initialise());
    if (r === undefined) return;
    if (r instanceof Error) {
      const e = r as SdkError;
      setStatus(e.type === "Setup Required" ? "setup" : "error");
      setStatusText(errText(e));
    } else {
      setStatus("ready");
      setStatusText("");
    }
  }, [run, terminal]);

  const pair = useCallback(async () => {
    await run("setup", null, () => terminal.setup());
    await checkTerminal();
  }, [run, terminal, checkTerminal]);

  const applyResult = useCallback(
    (saleId: string, r: Awaited<ReturnType<typeof terminal.purchase>>, late: boolean) => {
      const sale = get(saleId);
      if (!sale) return;
      if (r instanceof Error) {
        const e = r as SdkError;
        upsert(saleId, { status: statusFromError(e), detail: (late ? "Late result: " : "") + errText(e) });
      } else if (r.$type === "Approved") {
        upsert(saleId, {
          status: "complete",
          detail: undefined,
          card: { ...sale.card!, transactionUuid: r.transactionUuid, scheme: r.scheme },
        });
      } else {
        upsert(saleId, { status: "card_failed", detail: `Declined: ${r.responseText || r.responseCode}` });
      }
    },
    [get, upsert]
  );

  // Charge a card sale that has already been saved with status card_pending.
  const charge = useCallback(
    async (saleId: string) => {
      const sale = get(saleId);
      if (!sale?.card || busyRef.current) return;
      const args = { amount: sale.total, reference: sale.card.reference, terminalReceipt: true };
      setStep("");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const watchdog = new Promise<"timeout">((res) => (timer = setTimeout(() => res("timeout"), PURCHASE_WATCHDOG_MS)));

      const r = await run("purchase", args, () => {
        const p = terminal.purchase(args);
        purchaseRef.current = p;
        p.onEvent((e) => setStep(e.event));
        p.finally(() => {
          if (purchaseRef.current === p) purchaseRef.current = null;
        });
        return Promise.race([p, watchdog]).then((res) => {
          if (res === "timeout") {
            // Keep listening: if Zeller answers later, the real result replaces "unknown".
            p.then((late) => {
              appendLog("result", "purchase (late)", late);
              applyResult(saleId, late, true);
            });
          }
          return res;
        });
      });
      clearTimeout(timer);
      if (r === undefined) return;
      if (r === "timeout") {
        upsert(saleId, { status: "card_unknown", detail: "No answer from Zeller yet", card: { ...sale.card, timedOut: true } });
      } else {
        applyResult(saleId, r, false);
      }
    },
    [applyResult, get, run, terminal, upsert]
  );

  const cancel = useCallback(() => {
    appendLog("request", "cancel", null);
    purchaseRef.current?.cancel();
  }, []);

  const lookup = useCallback(
    async (reference: string): Promise<TerminalTransaction | null | SdkError | undefined> => {
      const r = await run("getTransactions", { reference }, () => terminal.getTransactions({ reference }));
      if (r === undefined) return undefined;
      if (r instanceof Error) return r as SdkError;
      const matches = r.filter((tx) => tx.type === "PURCHASE" && tx.externalReference === reference);
      return matches.find((tx) => tx.$type === "Approved") ?? matches[0] ?? null;
    },
    [run, terminal]
  );

  const applyFound = useCallback(
    (sale: Sale, tx: TerminalTransaction) =>
      upsert(
        sale.id,
        tx.$type === "Approved"
          ? { status: "complete", detail: undefined, card: { ...sale.card!, transactionUuid: tx.transactionUuid, scheme: tx.scheme } }
          : { status: "card_failed", detail: `Declined: ${tx.responseText || tx.responseCode || "failed"}` }
      ),
    [upsert]
  );

  // Find the true result of card sales still pending or unknown.
  const recovering = useRef(false);
  const recover = useCallback(
    async (only?: string) => {
      if (recovering.current || busyRef.current || purchaseRef.current) return;
      const open = all().filter(
        (s) => (s.status === "card_pending" || s.status === "card_unknown") && (!only || s.id === only)
      );
      if (!open.length) return;
      recovering.current = true;
      try {
        const emptyOnce: Sale[] = [];
        for (const s of open) {
          const r = await lookup(s.card!.reference);
          if (r === undefined) return;
          if (r instanceof Error) upsert(s.id, { status: "card_unknown", detail: `Can't reach Zeller: ${errText(r)}` });
          else if (r) applyFound(s, r);
          else {
            upsert(s.id, { status: "card_unknown", detail: "Not found yet. Checking again in 30 seconds" });
            emptyOnce.push(s);
          }
        }
        if (!emptyOnce.length) return;
        await new Promise((res) => setTimeout(res, RECHECK_DELAY_MS));
        for (const s of emptyOnce) {
          if (get(s.id)?.status !== "card_unknown") continue; // a late result may have settled it
          const r = await lookup(s.card!.reference);
          if (r === undefined) return;
          if (r instanceof Error) upsert(s.id, { status: "card_unknown", detail: `Can't reach Zeller: ${errText(r)}` });
          else if (r) applyFound(s, r);
          else upsert(s.id, { status: "not_charged", detail: "Zeller has no record of this payment" });
        }
      } finally {
        recovering.current = false;
      }
    },
    [all, applyFound, get, lookup, upsert]
  );

  // On load: check the terminal, then settle anything left from before a reload or crash.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    for (const s of all()) if (s.status === "card_pending") upsert(s.id, { status: "card_unknown", setAside: true });
    (async () => {
      await checkTerminal();
      await recover();
    })();
  }, [all, checkTerminal, recover, upsert]);

  // Re-check without anyone tapping: internet back, page shown again, and every minute.
  useEffect(() => {
    const onOnline = () => {
      checkTerminal().then(() => recover());
    };
    const onVisible = () => document.visibilityState === "visible" && recover();
    const timer = setInterval(() => recover(), AUTO_RECHECK_INTERVAL_MS);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [checkTerminal, recover]);

  return { status, statusText, step, busy, checkTerminal, pair, charge, cancel, recover };
}
