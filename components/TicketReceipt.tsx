import { forwardRef } from 'react';

export interface ReceiptItem {
  name: string;
  size: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discount?: number;
  discountReason?: string;
}

export interface ReceiptData {
  saleId: string;
  date: Date;
  items: ReceiptItem[];
  subtotal: number;
  totalDiscount: number;
  total: number;
  method: 'CASH' | 'CARD' | 'MIXED';
  cashAmount: number;
  cardAmount: number;
  changeAmount: number;
  customerName?: string;
}

/** Thermal‑receipt component (58 mm).  Render inside a print‑only container. */
export const TicketReceipt = forwardRef<HTMLDivElement, { data: ReceiptData }>(
  ({ data }, ref) => {
    const folio = data.saleId.slice(0, 8).toUpperCase();
    const dateStr = data.date.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const timeStr = data.date.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const methodLabel =
      data.method === 'MIXED'
        ? 'Mixto'
        : data.method === 'CARD'
          ? 'Tarjeta'
          : 'Efectivo';

    return (
      <div
        ref={ref}
        className="ticket-receipt"
        style={{
          width: '58mm',
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: '12px',
          lineHeight: 1.4,
          color: '#000',
          background: '#fff',
          padding: '4mm 2mm',
          boxSizing: 'border-box',
        }}
      >
        {/* ── Header ── */}
        <div style={{ textAlign: 'center', marginBottom: '3mm' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '2px' }}>
            🍿 CAT CORN
          </div>
          <div style={{ fontSize: '10px', marginTop: '1mm' }}>
            {dateStr} &nbsp; {timeStr}
          </div>
          <div style={{ fontSize: '10px' }}>Folio: {folio}</div>
        </div>

        <Divider />

        {/* ── Items ── */}
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '11px',
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: 'left', paddingBottom: '1mm' }}>Producto</th>
              <th style={{ textAlign: 'right', paddingBottom: '1mm' }}>Importe</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => {
              // Always derive the final line total from the base unit price,
              // NOT from item.lineTotal which may already be post-discount.
              const disc = item.discount || 0;
              const lineSubtotal = item.unitPrice * item.quantity;
              const finalLine = lineSubtotal - disc;
              return (
                <tr key={i}>
                  <td style={{ verticalAlign: 'top', paddingBottom: '1mm' }}>
                    <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                    <div style={{ fontSize: '10px', color: '#444' }}>
                      {item.size} &nbsp; {item.quantity} x ${item.unitPrice.toFixed(2)}
                    </div>
                    {disc > 0 && (
                      <div style={{ fontSize: '9px', color: '#888' }}>
                        Desc: -${disc.toFixed(2)}
                      </div>
                    )}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      verticalAlign: 'top',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ${finalLine.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <Divider />

        {/* ── Totals ── */}
        <div style={{ fontSize: '11px' }}>
          {data.totalDiscount > 0 && (
            <>
              <Row label="Subtotal" value={`$${data.subtotal.toFixed(2)}`} />
              <Row label="Descuento" value={`-$${data.totalDiscount.toFixed(2)}`} />
            </>
          )}
          <Row
            label="TOTAL"
            value={`$${data.total.toFixed(2)}`}
            bold
            big
          />
        </div>

        <Divider />

        {/* ── Payment ── */}
        <div style={{ fontSize: '11px' }}>
          <Row label="Método" value={methodLabel} />
          {data.method === 'MIXED' && (
            <>
              <Row label="  Efectivo" value={`$${data.cashAmount.toFixed(2)}`} />
              <Row label="  Tarjeta" value={`$${data.cardAmount.toFixed(2)}`} />
            </>
          )}
          {data.method === 'CASH' && data.cashAmount > 0 && (
            <Row label="Recibido" value={`$${data.cashAmount.toFixed(2)}`} />
          )}
          {data.changeAmount > 0 && (
            <Row label="Cambio" value={`$${data.changeAmount.toFixed(2)}`} />
          )}
        </div>

        {/* ── Customer ── */}
        {data.customerName && (
          <>
            <Divider />
            <div style={{ fontSize: '10px', textAlign: 'center' }}>
              Cliente: {data.customerName}
            </div>
          </>
        )}

        {/* ── Footer ── */}
        <div
          style={{
            textAlign: 'center',
            marginTop: '4mm',
            fontSize: '11px',
            fontWeight: 'bold',
          }}
        >
          ¡Gracias por tu compra! 🍿
        </div>
      </div>
    );
  },
);

TicketReceipt.displayName = 'TicketReceipt';

/* ── tiny helpers ── */

function Divider() {
  return (
    <div
      style={{
        borderTop: '1px dashed #999',
        margin: '2mm 0',
      }}
    />
  );
}

function Row({
  label,
  value,
  bold,
  big,
}: {
  label: string;
  value: string;
  bold?: boolean;
  big?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontWeight: bold ? 'bold' : 'normal',
        fontSize: big ? '14px' : undefined,
        marginBottom: '0.5mm',
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
