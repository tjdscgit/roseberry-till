import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminal } from "@zeller-public/payments-sdk-react";
import type { TerminalTransaction } from "@zeller-public/payments-sdk-react";
import {
  LogEntry,
  TxRecord,
  TxStatus,
  loadLog,
  loadTx,
  newReference,
  saveLog,
  saveTx,
  stripCard,
} from "./store";

const CHARGE_CENTS = 100;
// If purchase() hasn't settled by now, mark the outcome unknown and let recovery decide.
// The SDK promise is still watched, and its real result overwrites the record if it arrives later.
const PURCHASE_WATCHDOG_MS = 3 * 60 * 1000;
// A lookup that finds nothing is only trusted once it has been repeated after this delay.
const RECHECK_DELAY_MS = 30 * 1000;
// How often to retry recovery automatically while any record is still unknown or pending.
const AUTO_RECHECK_INTERVAL_MS = 60 * 1000;

type Pairing = "checking" | "paired" | "setup_required" | "error";

// Exact `.type` strings from @zeller-public/payments-sdk-core ClientError.
type SdkError = Error & { type: string };

// The terminal never ran the transaction, or the customer/terminal cancelled it.
const CANCELLED_TYPES = new Set(["Cancelled", "Inactivity Timeout"]);
// Card refused before any money moved.
const DECLINED_TYPES = new Set([
  "Card Declined",
  "Card Blocked",
  "Card Not Supported",
  "Card Read Failure",
  "Card Insert Required",
  "Transaction Declined",
]);
// Rejected before reaching the terminal, so nothing can have been charged.
const NOT_SENT_TYPES = new Set([
  "Setup Required",
  "Operation Busy",
  "Operation Request Invalid",
  "Paired Device Busy",
]);
// Every other type (Network Failure, Operation Interrupted, Operation Failure, Operation Response
// Invalid, Connection Failure, Paired Device Not Available, Transaction Response Timeout, Transaction
// Response Invalid, Transaction Network Failure, Transaction System Failure, Transaction Failure)
// leaves the outcome uncertain, so it becomes `unknown` and goes to recovery.

function statusFromError(e: SdkError): TxStatus {
  if (CANCELLED_TYPES.has(e.type)) return "cancelled";
  if (DECLINED_TYPES.has(e.type)) return "declined";
  if (NOT_SENT_TYPES.has(e.type)) return "error";
  return "unknown";
}

// The SDK's own verdict: `$type` is "Approved" | "Declined".
const statusFromTx = (tx: TerminalTransaction): TxStatus => (tx.$type === "Approved" ? "approved" : "declined");

const errText = (e: SdkError) => `${e.type}${e.message ? `: ${e.message}` : ""}`;
const txText = (tx: TerminalTransaction) => `${tx.$type} ${tx.responseCode} ${tx.responseText}`.trim();

export default function App() {
  const terminal = useTerminal();
  const [pairing, setPairing] = useState<Pairing>("checking");
  const [pairingDetail, setPairingDetail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  // Handle to the in-flight purchase promise; its .cancel() is how the SDK cancels.
  const purchaseRef = useRef<ReturnType<typeof terminal.purchase> | null>(null);
  const [purchaseInFlight, setPurchaseInFlight] = useState(false);
  const [txs, setTxs] = useState<TxRecord[]>(loadTx);
  const [log, setLog] = useState<LogEntry[]>(loadLog);
  const [lookupRef, setLookupRef] = useState("");
  const [lookupResult, setLookupResult] = useState("");

  const addLog = useCallback((kind: LogEntry["kind"], method: string, data?: unknown) => {
    const entry: LogEntry = { at: new Date().toISOString(), kind, method, data: stripCard(data) };
    setLog((prev) => {
      const next = [...prev, entry];
      saveLog(next);
      return next;
    });
  }, []);

  const upsertTx = useCallback((ref: string, patch: Partial<TxRecord>, base?: TxRecord) => {
    // Write localStorage synchronously so a crash/reload right after still has the record.
    const current = loadTx();
    const idx = current.findIndex((t) => t.reference === ref);
    const updated = { ...(idx >= 0 ? current[idx] : base!), ...patch, updatedAt: new Date().toISOString() };
    if (idx >= 0) current[idx] = updated;
    else current.push(updated);
    saveTx(current);
    setTxs(current);
  }, []);

  // Runs one SDK method at a time; every button is disabled while busy.
  const run = useCallback(
    async <T,>(method: string, args: unknown, fn: () => Promise<T>): Promise<T | undefined> => {
      if (busyRef.current) {
        addLog("info", method, "blocked: another operation is in flight");
        return undefined;
      }
      busyRef.current = true;
      setBusy(method);
      addLog("request", method, args);
      try {
        const result = await fn();
        addLog("result", method, result);
        return result;
      } catch (e) {
        addLog("result", method, e);
        return e as T;
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [addLog]
  );

  const checkStatus = useCallback(async () => {
    setPairing("checking");
    const r = await run("initialise", null, () => terminal.initialise());
    if (r === undefined) return;
    if (r instanceof Error) {
      const e = r as SdkError;
      setPairing(e.type === "Setup Required" ? "setup_required" : "error");
      setPairingDetail(errText(e));
    } else {
      setPairing("paired");
      setPairingDetail("");
    }
  }, [run, terminal]);

  // One lookup. Returns the matching purchase, null if Zeller has none, or an error if the lookup failed.
  const lookupPurchase = useCallback(
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
    (reference: string, tx: TerminalTransaction) =>
      upsertTx(reference, {
        status: statusFromTx(tx),
        transactionUuid: tx.transactionUuid,
        detail: `recovered: ${txText(tx)}`,
      }),
    [upsertTx]
  );

  // Resolve the given records. Nothing found is only trusted if a second lookup ~30s later agrees.
  const recover = useCallback(
    async (only?: string) => {
      const open = loadTx().filter(
        (t) => (t.status === "pending" || t.status === "unknown") && (!only || t.reference === only)
      );
      if (!open.length) {
        addLog("info", "recover", "nothing pending");
        return;
      }
      const emptyOnce: string[] = [];
      for (const t of open) {
        const r = await lookupPurchase(t.reference);
        if (r === undefined) return;
        if (r instanceof Error) {
          upsertTx(t.reference, { status: "unknown", detail: `lookup failed: ${errText(r)}` });
        } else if (r) {
          applyFound(t.reference, r);
        } else {
          upsertTx(t.reference, { status: "unknown", detail: "not found yet; re-checking in 30s" });
          emptyOnce.push(t.reference);
        }
      }
      if (!emptyOnce.length) return;

      busyRef.current = true;
      setBusy("waiting 30s to re-check");
      addLog("info", "recover", `nothing found for ${emptyOnce.length} record(s); re-checking in 30s`);
      await new Promise((res) => setTimeout(res, RECHECK_DELAY_MS));
      busyRef.current = false;
      setBusy(null);

      for (const ref of emptyOnce) {
        // A late purchase result may have settled it meanwhile.
        if (loadTx().find((t) => t.reference === ref)?.status !== "unknown") continue;
        const r = await lookupPurchase(ref);
        if (r === undefined) return;
        if (r instanceof Error) {
          upsertTx(ref, { status: "unknown", detail: `second lookup failed: ${errText(r)}` });
        } else if (r) {
          applyFound(ref, r);
        } else {
          upsertTx(ref, { status: "not_charged", detail: "no transaction found in two lookups 30s apart" });
        }
      }
    },
    [addLog, applyFound, lookupPurchase, upsertTx]
  );

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      await checkStatus();
      await recover();
    })();
  }, [checkStatus, recover]);

  // Re-check unknown/pending records without anyone tapping a button: when the internet comes back,
  // when the page is shown again (unlock, app switch), and every minute while any remain open.
  // Skipped while an SDK call or a purchase is in flight, so it never races the live payment.
  const autoRecovering = useRef(false);
  const autoRecover = useCallback(
    async (why: string) => {
      if (autoRecovering.current || busyRef.current || purchaseRef.current) return;
      if (!loadTx().some((t) => t.status === "pending" || t.status === "unknown")) return;
      autoRecovering.current = true;
      addLog("info", "auto-recover", why);
      try {
        await recover();
      } finally {
        autoRecovering.current = false;
      }
    },
    [addLog, recover]
  );

  useEffect(() => {
    const onOnline = () => autoRecover("internet back");
    const onVisible = () => document.visibilityState === "visible" && autoRecover("page shown again");
    const timer = setInterval(() => autoRecover("periodic check"), AUTO_RECHECK_INTERVAL_MS);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [autoRecover]);

  const pair = async () => {
    await run("setup", null, () => terminal.setup());
    await checkStatus();
  };

  const applyPurchaseResult = useCallback(
    (reference: string, r: Awaited<ReturnType<typeof terminal.purchase>>, late: boolean) => {
      const prefix = late ? "late result: " : "";
      if (r instanceof Error) {
        upsertTx(reference, { status: statusFromError(r), detail: prefix + errText(r) });
      } else {
        upsertTx(reference, { status: statusFromTx(r), transactionUuid: r.transactionUuid, detail: prefix + txText(r) });
      }
    },
    [upsertTx]
  );

  const charge = async () => {
    if (busyRef.current) return;
    const reference = newReference();
    upsertTx(reference, {}, { reference, amount: CHARGE_CENTS, status: "pending", startedAt: new Date().toISOString() });

    const args = { amount: CHARGE_CENTS, reference, terminalReceipt: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<"timeout">((res) => (timer = setTimeout(() => res("timeout"), PURCHASE_WATCHDOG_MS)));

    const r = await run("purchase", args, () => {
      const p = terminal.purchase(args);
      purchaseRef.current = p;
      setPurchaseInFlight(true);
      p.finally(() => {
        if (purchaseRef.current === p) {
          purchaseRef.current = null;
          setPurchaseInFlight(false);
        }
      });
      return Promise.race([p, watchdog]).then((res) => {
        if (res === "timeout") {
          // Keep listening: if the SDK settles later, its real result wins over `unknown`.
          p.then(
            (late) => {
              addLog("result", "purchase (late)", late);
              applyPurchaseResult(reference, late, true);
            },
            (err) => addLog("result", "purchase (late)", err)
          );
        }
        return res;
      });
    });
    clearTimeout(timer);

    if (r === undefined) return;
    if (r === "timeout") {
      upsertTx(reference, { status: "unknown", timedOut: true, detail: "purchase() did not resolve in 3 min; run Recover" });
    } else {
      applyPurchaseResult(reference, r, false);
    }
  };

  const cancel = () => {
    // Allowed while a purchase is in flight, so it bypasses the busy guard.
    addLog("request", "cancel", null);
    purchaseRef.current?.cancel();
  };

  const refund = async (t: TxRecord) => {
    const reference = newReference();
    const args = { purchase: t.reference, amount: t.amount, reference };
    const r = await run("refund", args, () => terminal.refund(args));
    if (r === undefined) return;
    if (r instanceof Error) {
      upsertTx(t.reference, { detail: `refund failed: ${errText(r)}`, refundReference: reference });
    } else if (r.$type === "Approved") {
      upsertTx(t.reference, { status: "refunded", refundReference: reference, detail: `refund ${txText(r)}` });
    } else {
      upsertTx(t.reference, { refundReference: reference, detail: `refund declined: ${txText(r)}` });
    }
  };

  const lookup = async () => {
    const ref = lookupRef.trim();
    const args = ref ? { reference: ref } : {};
    const r = await run("getTransactions", args, () => terminal.getTransactions(args));
    if (r !== undefined) setLookupResult(JSON.stringify(stripCard(r), null, 2));
  };

  const downloadLog = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), transactions: txs, log }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rg-test-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const clearLog = () => {
    if (!confirm("Clear the log? Download it first if you need it.")) return;
    setLog([]);
    saveLog([]);
  };

  const disabled = busy !== null;
  const pairingLabel = {
    checking: "Checking…",
    paired: "Paired",
    setup_required: "Setup required",
    error: "Error",
  }[pairing];

  return (
    <main>
      <h1>Roseberry Till Test</h1>

      <section>
        <strong className={pairing === "paired" ? "status-ok" : "status-bad"}>{pairingLabel}</strong>
        {pairingDetail && <div>{pairingDetail}</div>}
        <div>{busy ? `In progress: ${busy}…` : purchaseInFlight ? "Purchase still open on SDK" : "Ready"}</div>
        <button disabled={disabled} onClick={checkStatus}>Re-check</button>
        <button disabled={disabled} onClick={pair}>Pair</button>
      </section>

      <section>
        <button disabled={disabled || purchaseInFlight} onClick={charge}>Charge $1</button>
        <button disabled={!purchaseInFlight} onClick={cancel}>Cancel</button>
        <button disabled={disabled} onClick={() => recover()}>Recover pending</button>
      </section>

      <section>
        <h2>Transactions</h2>
        <table>
          <thead>
            <tr><th>Started</th><th>Reference</th><th>Amount</th><th>Status</th><th>UUID / detail</th><th></th></tr>
          </thead>
          <tbody>
            {[...txs].reverse().map((t) => (
              <tr key={t.reference}>
                <td>{new Date(t.startedAt).toLocaleString()}</td>
                <td>{t.reference}</td>
                <td>${(t.amount / 100).toFixed(2)}</td>
                <td><strong>{t.status}</strong></td>
                <td>{t.transactionUuid}<br />{t.detail}</td>
                <td>
                  {t.status === "approved" && (
                    <button disabled={disabled} onClick={() => refund(t)}>Refund</button>
                  )}
                  {t.status === "unknown" && (
                    <button disabled={disabled} onClick={() => recover(t.reference)}>Check again</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Look up</h2>
        <input
          value={lookupRef}
          onChange={(e) => setLookupRef(e.target.value)}
          placeholder="Reference or transactionUuid (blank = most recent)"
        />
        <button disabled={disabled} onClick={lookup}>Look up</button>
        {lookupResult && <pre>{lookupResult}</pre>}
      </section>

      <section>
        <h2>Log</h2>
        <button onClick={downloadLog}>Download log (JSON)</button>
        <button disabled={disabled} onClick={clearLog}>Clear</button>
        <pre>
          {log.map((l) => `${l.at} ${l.kind.toUpperCase()} ${l.method} ${l.data === undefined ? "" : JSON.stringify(l.data)}`).join("\n")}
        </pre>
      </section>
    </main>
  );
}
