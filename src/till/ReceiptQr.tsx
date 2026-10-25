import { useMemo } from "react";
import qrcode from "qrcode-generator";
import type { Sale } from "./types";
import { money } from "./money";
import { receiptUrl } from "./receipt";

const QUIET = 4; // blank modules around the code, needed by phone cameras

function qrPath(text: string): { path: string; size: number } | null {
  try {
    const qr = qrcode(0, "L");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
    return { path, size: n + QUIET * 2 };
  } catch {
    return null; // too much data for one QR code
  }
}

// Full-screen QR code the customer scans for their itemised receipt.
export function ReceiptQr({ sale, closeLabel, onClose }: { sale: Sale; closeLabel: string; onClose: () => void }) {
  const qr = useMemo(() => qrPath(receiptUrl(sale)), [sale]);
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="dialog receipt-qr" role="dialog" aria-modal="true" aria-label={`Receipt for sale ${sale.number}`}>
        <h2>Scan for your receipt</h2>
        <p className="sub">Point your phone camera at the code</p>
        {qr ? (
          <svg className="qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR code for the itemised receipt" shapeRendering="crispEdges">
            <rect width={qr.size} height={qr.size} fill="#FFFFFF" />
            <path d={qr.path} fill="#111814" />
          </svg>
        ) : (
          <p className="sub">This sale has too many items for one QR code.</p>
        )}
        <p className="num" style={{ fontSize: 22, fontWeight: 700 }}>
          Sale {sale.number} · {money(sale.total)} · {sale.lines.length} item{sale.lines.length === 1 ? "" : "s"}
        </p>
        <button className="btn-go" onClick={onClose}>
          {closeLabel}
        </button>
      </section>
    </div>
  );
}
