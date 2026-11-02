import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Landmark, Loader2, RefreshCw, Undo2, Wallet, X } from 'lucide-react';
import {
  getAvailableFundsSnapshot,
  listFinanceCreditCards,
  listFinanceCreditCardPayments,
  registerCreditCardPayment,
  reverseCreditCardPayment,
  clearOpeningMovementDecision,
  saveOpeningBalance,
  saveOpeningMovementDecision,
  saveOpeningSourceDefault,
  type AvailableFundsSnapshot,
  type CreditCardPaymentKind,
  type CreditCardPaymentSource,
  type FinanceCreditCard,
  type FinanceCreditCardPayment,
} from '../../services/availableFundsService';
import { getMexicoCityDateKey } from '../../lib/datetime';

const money = (value: number | null | undefined) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN',
}).format(Number(value) || 0);
const inputClass = 'w-full rounded-lg border border-white/10 bg-[#1C1A1A] px-3 py-2 text-cc-text-main outline-none focus:ring-2 focus:ring-cc-primary';

const limitationLabels: Record<string, string> = {
  pending_expenses: 'Gastos sin tratamiento de liquidez',
  refunded_pos_sales: 'Ventas POS devueltas sin salida de reembolso registrada',
  order_sales: 'Pedidos con cobro aún no conciliado por esta etapa',
  delivery_sales: 'Delivery sin liquidación real registrada',
  unsupported_pos_payments: 'Cobros POS con método no soportado',
  ambiguous_cutoff_movements: 'Movimientos del día pendientes de confirmar',
};

interface Props { monthStartISO: string }

export const AvailableFundsPanel = ({ monthStartISO }: Props) => {
  const [snapshot, setSnapshot] = useState<AvailableFundsSnapshot | null>(null);
  const [cards, setCards] = useState<FinanceCreditCard[]>([]);
  const [cardPayments, setCardPayments] = useState<FinanceCreditCardPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingOpen, setOpeningOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [reversalPayment, setReversalPayment] = useState<FinanceCreditCardPayment | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [posDetailsOpen, setPosDetailsOpen] = useState(false);

  const [openingAmount, setOpeningAmount] = useState('');
  const [cutoffBusinessDate, setCutoffBusinessDate] = useState(monthStartISO);
  const [openingNotes, setOpeningNotes] = useState('');

  const [cardId, setCardId] = useState('');
  const [newCardName, setNewCardName] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(getMexicoCityDateKey());
  const [paymentKind, setPaymentKind] = useState<CreditCardPaymentKind>('PARTIAL');
  const [paymentSource, setPaymentSource] = useState<CreditCardPaymentSource>('TRANSFER');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentToken, setPaymentToken] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextSnapshot, nextCards, nextPayments] = await Promise.all([
        getAvailableFundsSnapshot(monthStartISO),
        listFinanceCreditCards(),
        listFinanceCreditCardPayments(monthStartISO),
      ]);
      setSnapshot(nextSnapshot);
      setCards(nextCards);
      setCardPayments(nextPayments);
      if (nextCards.length) setCardId(current => current || nextCards[0].id);
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo cargar el dinero disponible.');
    } finally {
      setLoading(false);
    }
  }, [monthStartISO]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!snapshot?.opening_balance) {
      setOpeningAmount('');
      setCutoffBusinessDate(monthStartISO);
      setOpeningNotes('');
      return;
    }
    setOpeningAmount(String(snapshot.opening_balance.amount_mxn));
    setCutoffBusinessDate(snapshot.opening_balance.cutoff_business_date);
    setOpeningNotes(snapshot.opening_balance.notes || '');
  }, [monthStartISO, snapshot?.opening_balance]);

  const activeLimitations = useMemo(() => Object.entries(snapshot?.limitations ?? {})
    .filter(([, value]) => Number(value?.count || 0) > 0), [snapshot]);

  const saveOpening = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const amount = Number(openingAmount);
      if (!Number.isFinite(amount)) throw new Error('Captura un saldo inicial válido.');
      await saveOpeningBalance({
        monthStart: monthStartISO,
        amountMxn: amount,
        cutoffBusinessDate,
        notes: openingNotes,
      });
      setOpeningOpen(false);
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo guardar el saldo inicial.');
    } finally { setSaving(false); }
  };

  const saveCardPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      if (!cardId && !newCardName.trim()) throw new Error('Selecciona una tarjeta o registra su nombre.');
      const amount = Number(paymentAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('El pago debe ser mayor que cero.');
      await registerCreditCardPayment({
        creditCardId: cardId || undefined,
        newCardName: cardId ? undefined : newCardName,
        amountMxn: amount,
        paymentDate,
        paymentKind,
        sourceInstrument: paymentSource,
        reference: paymentReference,
        notes: paymentNotes,
        idempotencyKey: paymentToken,
      });
      setPaymentOpen(false);
      setPaymentAmount(''); setPaymentReference(''); setPaymentNotes(''); setNewCardName('');
      setPaymentToken(crypto.randomUUID());
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo registrar el pago de tarjeta.');
    } finally { setSaving(false); }
  };

  const decideMovement = async (sourceType: string, sourceId: string, position: 'BEFORE_OPENING' | 'AFTER_OPENING') => {
    if (!snapshot?.opening_balance) return;
    setSaving(true); setError('');
    try {
      await saveOpeningMovementDecision({
        openingBalanceId: snapshot.opening_balance.id,
        sourceType,
        sourceId,
        position,
      });
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo conciliar el movimiento con el saldo inicial.');
    } finally { setSaving(false); }
  };

  const decideAllOpeningDayPos = async (position: 'BEFORE_OPENING' | 'AFTER_OPENING') => {
    if (!snapshot?.opening_balance) return;
    setSaving(true); setError('');
    try {
      await saveOpeningSourceDefault({
        openingBalanceId: snapshot.opening_balance.id,
        sourceType: 'POS_SALE',
        position,
        notes: 'Confirmación conjunta desde Finanzas',
      });
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo confirmar conjuntamente las ventas POS del día.');
    } finally { setSaving(false); }
  };

  const clearMovementException = async (sourceType: string, sourceId: string) => {
    if (!snapshot?.opening_balance) return;
    setSaving(true); setError('');
    try {
      await clearOpeningMovementDecision({
        openingBalanceId: snapshot.opening_balance.id,
        sourceType,
        sourceId,
      });
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo restaurar la regla conjunta para esta venta.');
    } finally { setSaving(false); }
  };

  const reversePayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reversalPayment) return;
    setSaving(true); setError('');
    try {
      if (!reversalReason.trim()) throw new Error('Explica por qué se reversa este pago.');
      await reverseCreditCardPayment({ paymentId: reversalPayment.id, reason: reversalReason });
      setReversalPayment(null); setReversalReason('');
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo reversar el pago de tarjeta.');
    } finally { setSaving(false); }
  };

  return (
    <section className="bg-gradient-to-br from-cyan-500/10 to-blue-600/5 border border-cyan-500/30 p-6 rounded-xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Wallet className="text-cyan-300" size={24} /><h3 className="text-lg font-bold text-cc-cream">Dinero disponible</h3></div>
          <p className="text-xs text-cc-text-muted mt-1">Dinero real disponible desde un saldo y corte explícitos; no es la venta ni el resultado del mes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setError(''); setOpeningOpen(true); }} className="px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-200 text-sm hover:bg-cyan-500/30">
            {snapshot?.opening_balance ? 'Editar saldo y corte' : 'Capturar saldo inicial'}
          </button>
          <button onClick={() => { setError(''); setPaymentOpen(true); }} className="px-3 py-2 rounded-lg bg-blue-500/20 text-blue-200 text-sm hover:bg-blue-500/30">
            Registrar pago de tarjeta
          </button>
          <button onClick={() => void load()} aria-label="Actualizar dinero disponible" className="p-2 rounded-lg bg-white/5 text-cc-text-muted hover:bg-white/10"><RefreshCw size={18} /></button>
        </div>
      </div>

      {error && <div role="alert" className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><AlertTriangle size={18} className="shrink-0" />{error}</div>}
      {loading ? <div className="flex items-center gap-2 text-cc-text-muted"><Loader2 size={18} className="animate-spin" />Calculando movimientos posteriores al corte…</div> : snapshot && (
        <>
          {!snapshot.opening_balance ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
              Falta capturar el saldo inicial y su día de corte. No se calcula un saldo por diferencia histórica.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
                <Metric label="Saldo inicial" value={snapshot.opening_balance.amount_mxn} />
                <Metric label="+ Cobros POS" value={snapshot.inflows.pos_collections_mxn} positive />
                <Metric label="+ Cobranza B2B" value={snapshot.inflows.b2b_collections_mxn} positive />
                <Metric label="− Gastos pagados" value={snapshot.outflows.immediate_expenses_mxn} negative />
                <Metric label="− Pagos de tarjeta" value={snapshot.outflows.credit_card_payments_mxn} negative />
              </div>
              <div className="rounded-lg border border-cyan-400/20 bg-black/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Cómo se obtiene el saldo disponible</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-cc-cream">
                  <span>{money(snapshot.opening_balance.amount_mxn)}</span>
                  <span className="text-green-300">+</span>
                  <span>{money(snapshot.inflows.pos_collections_mxn)}</span>
                  <span className="text-green-300">+</span>
                  <span>{money(snapshot.inflows.b2b_collections_mxn)}</span>
                  <span className="text-red-300">−</span>
                  <span>{money(snapshot.outflows.immediate_expenses_mxn)}</span>
                  <span className="text-red-300">−</span>
                  <span>{money(snapshot.outflows.credit_card_payments_mxn)}</span>
                  <span className="text-cyan-300">=</span>
                  <span className={Number(snapshot.known_available_mxn) < 0 ? 'text-red-300' : 'text-cyan-200'}>{money(snapshot.known_available_mxn)}</span>
                </p>
                <p className="mt-1 text-xs text-cc-text-muted">Saldo inicial + cobros POS + cobranza B2B − gastos pagados − pagos de tarjeta.</p>
                <p className="mt-2 text-xs text-cc-text-muted">El saldo inicial sólo pertenece a este flujo: no se vuelve a sumar como venta del mes.</p>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-3 border-t border-cyan-500/20 pt-4">
                <div>
                  <p className="text-xs text-cc-text-muted">Día del saldo inicial: {snapshot.opening_balance.cutoff_business_date}</p>
                  <p className="text-xs text-cc-text-muted">Compras nuevas a crédito (no restadas): {money(snapshot.informational.credit_purchases_mxn)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-cc-text-muted">{snapshot.is_exact ? 'Saldo disponible' : 'Saldo conocido, incompleto'}</p>
                  <p className={`text-3xl font-bold ${Number(snapshot.known_available_mxn) < 0 ? 'text-red-300' : 'text-cyan-200'}`}>{money(snapshot.known_available_mxn)}</p>
                </div>
              </div>
              {activeLimitations.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-sm font-semibold text-amber-200">No se presenta como saldo exacto</p>
                  <ul className="mt-2 space-y-1 text-xs text-amber-100/90">
                    {activeLimitations.map(([key, value]) => <li key={key}>• {limitationLabels[key] || key}: {value.count} movimiento(s), {money(value.amount_mxn)}</li>)}
                  </ul>
                </div>
              )}
              {Number(snapshot.opening_day_pos?.count || 0) > 0 && (
                <div className="rounded-lg border border-cyan-400/25 bg-black/20 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-cyan-100">Ventas POS del día del saldo inicial</p>
                      <p className="text-xs text-cc-text-muted">
                        {snapshot.opening_day_pos.count} venta(s) · {money(snapshot.opening_day_pos.amount_mxn)} · {' '}
                        {snapshot.opening_day_pos.default_position === 'AFTER_OPENING'
                          ? 'Regla conjunta: ocurrieron después'
                          : snapshot.opening_day_pos.default_position === 'BEFORE_OPENING'
                            ? 'Regla conjunta: ya estaban incluidas'
                            : 'Falta una regla conjunta'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={saving} onClick={() => void decideAllOpeningDayPos('BEFORE_OPENING')} className="rounded bg-white/10 px-3 py-1.5 text-xs text-cc-text-muted disabled:opacity-50">Todas ya incluidas</button>
                      <button disabled={saving} onClick={() => void decideAllOpeningDayPos('AFTER_OPENING')} className="rounded bg-cyan-500/20 px-3 py-1.5 text-xs text-cyan-200 disabled:opacity-50">Todas ocurrieron después</button>
                    </div>
                  </div>
                  <button type="button" onClick={() => setPosDetailsOpen(open => !open)} className="text-xs text-cyan-300 hover:text-cyan-200">
                    {posDetailsOpen ? 'Ocultar ventas y excepciones' : `Revisar ventas y excepciones (${snapshot.opening_day_pos.exception_count})`}
                  </button>
                  {posDetailsOpen && <div className="space-y-2">
                    <p className="text-xs text-cc-text-muted">Una decisión individual prevalece sobre la regla conjunta. “Usar regla conjunta” elimina sólo esa excepción.</p>
                    {snapshot.opening_day_pos.sales.map(sale => (
                      <div key={sale.source_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 p-2">
                        <div>
                          <p className="text-sm text-cc-cream">POS · {sale.payment_method} · {money(sale.amount_mxn)}</p>
                          <p className="text-xs text-cc-text-muted">
                            {sale.business_date} · {sale.individual_position
                              ? `Excepción: ${sale.individual_position === 'AFTER_OPENING' ? 'después' : 'incluida'}`
                              : `Regla conjunta: ${sale.effective_position === 'AFTER_OPENING' ? 'después' : sale.effective_position === 'BEFORE_OPENING' ? 'incluida' : 'sin confirmar'}`}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button disabled={saving} onClick={() => void decideMovement('POS_SALE', sale.source_id, 'BEFORE_OPENING')} className="rounded bg-white/10 px-2 py-1 text-xs text-cc-text-muted disabled:opacity-50">Excepción: incluida</button>
                          <button disabled={saving} onClick={() => void decideMovement('POS_SALE', sale.source_id, 'AFTER_OPENING')} className="rounded bg-cyan-500/20 px-2 py-1 text-xs text-cyan-200 disabled:opacity-50">Excepción: después</button>
                          {sale.individual_position && <button disabled={saving} onClick={() => void clearMovementException('POS_SALE', sale.source_id)} className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-200 disabled:opacity-50">Usar regla conjunta</button>}
                        </div>
                      </div>
                    ))}
                  </div>}
                </div>
              )}
              {snapshot.ambiguous_movements.length > 0 && (
                <div className="rounded-lg border border-yellow-400/30 bg-black/20 p-3 space-y-2">
                  <p className="text-sm font-semibold text-yellow-200">Confirma los movimientos del día del saldo inicial</p>
                  <p className="text-xs text-cc-text-muted">“Antes” significa que ya estaba incluido en los {money(snapshot.opening_balance.amount_mxn)}. “Después” lo suma, resta o reporta como limitación.</p>
                  {snapshot.ambiguous_movements.map(movement => (
                    <div key={`${movement.source_type}-${movement.source_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 p-2">
                      <div><p className="text-sm text-cc-cream">{movement.label}</p><p className="text-xs text-cc-text-muted">{movement.business_date} · {money(movement.amount_mxn)}</p></div>
                      <div className="flex gap-2">
                        <button disabled={saving} onClick={() => void decideMovement(movement.source_type, movement.source_id, 'BEFORE_OPENING')} className="rounded bg-white/10 px-2 py-1 text-xs text-cc-text-muted disabled:opacity-50">Ya incluido</button>
                        <button disabled={saving} onClick={() => void decideMovement(movement.source_type, movement.source_id, 'AFTER_OPENING')} className="rounded bg-cyan-500/20 px-2 py-1 text-xs text-cyan-200 disabled:opacity-50">Ocurrió después</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {cardPayments.length > 0 && (
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
                  <p className="text-sm font-semibold text-cc-cream">Pagos de tarjeta del mes</p>
                  {cardPayments.map(payment => (
                    <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 p-2">
                      <div>
                        <p className="text-sm text-cc-cream">{payment.card?.name || 'Tarjeta'} · {money(payment.amount_mxn)}</p>
                        <p className="text-xs text-cc-text-muted">
                          {payment.payment_date} · {payment.payment_kind === 'TOTAL' ? 'Total' : 'Parcial'} · {payment.status === 'REVERSED' ? 'Reversado' : 'Registrado'}
                        </p>
                        {payment.status === 'REVERSED' && <p className="text-xs text-amber-300">Motivo: {payment.reversal_reason}</p>}
                      </div>
                      {payment.status === 'POSTED' && (
                        <button
                          disabled={saving}
                          onClick={() => { setError(''); setReversalReason(''); setReversalPayment(payment); }}
                          className="flex items-center gap-1 rounded bg-red-500/10 px-2 py-1 text-xs text-red-300 disabled:opacity-50"
                        >
                          <Undo2 size={13} /> Reversar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {openingOpen && <Modal title="Saldo inicial y punto de corte" onClose={() => setOpeningOpen(false)}>
        <form onSubmit={saveOpening} className="space-y-4">
          <InlineError error={error} />
          <Field label="Saldo disponible en el corte (MXN)"><input type="number" step="0.01" value={openingAmount} onChange={e => setOpeningAmount(e.target.value)} required className={inputClass} /></Field>
          <Field label="Día de corte · Ciudad de México"><input type="date" value={cutoffBusinessDate} onChange={e => setCutoffBusinessDate(e.target.value)} required className={inputClass} /></Field>
          <p className="text-xs text-amber-200">No se inventa una hora: las ventas POS pueden confirmarse juntas; otros movimientos y las excepciones conservan conciliación individual.</p>
          <Field label="Notas"><textarea value={openingNotes} onChange={e => setOpeningNotes(e.target.value)} rows={2} className={inputClass} /></Field>
          <SubmitButton saving={saving} label="Guardar saldo y corte" />
        </form>
      </Modal>}

      {paymentOpen && <Modal title="Pago real de tarjeta de crédito" onClose={() => setPaymentOpen(false)}>
        <form onSubmit={saveCardPayment} className="space-y-4">
          <InlineError error={error} />
          <Field label="Tarjeta">
            <select value={cardId} onChange={e => setCardId(e.target.value)} className={inputClass}><option value="">Registrar nueva…</option>{cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select>
          </Field>
          {!cardId && <Field label="Nombre de la tarjeta"><input value={newCardName} onChange={e => setNewCardName(e.target.value)} required className={inputClass} /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Importe (MXN)"><input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} required className={inputClass} /></Field>
            <Field label="Pago"><select value={paymentKind} onChange={e => setPaymentKind(e.target.value as CreditCardPaymentKind)} className={inputClass}><option value="PARTIAL">Parcial</option><option value="TOTAL">Total</option></select></Field>
          </div>
          <Field label="Fecha real en que salió el dinero · Ciudad de México"><input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} required className={inputClass} /></Field>
          <Field label="Origen del dinero"><select value={paymentSource} onChange={e => setPaymentSource(e.target.value as CreditCardPaymentSource)} className={inputClass}><option value="TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="DEBIT_CARD">Débito</option><option value="MERCADO_PAGO">Mercado Pago</option><option value="OTHER">Otro</option></select></Field>
          <Field label="Referencia"><input value={paymentReference} onChange={e => setPaymentReference(e.target.value)} className={inputClass} /></Field>
          <Field label="Notas"><textarea value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} rows={2} className={inputClass} /></Field>
          <p className="text-xs text-cc-text-muted">Esta salida reduce dinero disponible, pero no crea otro gasto en P&L.</p>
          <SubmitButton saving={saving} label="Registrar salida" />
        </form>
      </Modal>}

      {reversalPayment && <Modal title="Reversar pago de tarjeta" onClose={() => { setReversalPayment(null); setReversalReason(''); }}>
        <form onSubmit={reversePayment} className="space-y-4">
          <InlineError error={error} />
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-100">
            Se conservará el pago de {money(reversalPayment.amount_mxn)} como reversado. Para corregir importe, fecha o tarjeta, registra después un pago nuevo.
          </div>
          <Field label="Motivo de la reversa"><textarea value={reversalReason} onChange={e => setReversalReason(e.target.value)} rows={3} required className={inputClass} /></Field>
          <SubmitButton saving={saving} label="Confirmar reversa" />
        </form>
      </Modal>}
    </section>
  );
};

const Metric = ({ label, value, positive, negative }: { label: string; value: number; positive?: boolean; negative?: boolean }) => <div className="rounded-lg bg-black/20 p-3"><p className="text-xs text-cc-text-muted">{label}</p><p className={`font-bold ${positive ? 'text-green-300' : negative ? 'text-red-300' : 'text-cc-cream'}`}>{money(value)}</p></div>;
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block text-sm text-cc-text-muted"><span className="block mb-1.5">{label}</span>{children}</label>;
const SubmitButton = ({ saving, label }: { saving: boolean; label: string }) => <button disabled={saving} className="w-full rounded-lg bg-cc-primary px-4 py-2.5 font-semibold text-cc-bg disabled:opacity-50">{saving ? 'Guardando…' : label}</button>;
const InlineError = ({ error }: { error: string }) => error ? <div role="alert" className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><AlertTriangle size={18} className="shrink-0" />{error}</div> : null;
const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#2A2A2A] shadow-2xl"><div className="flex items-center justify-between border-b border-white/10 p-4"><div className="flex items-center gap-2"><Landmark className="text-cyan-300" size={20} /><h3 className="font-bold text-cc-cream">{title}</h3></div><button type="button" onClick={onClose} className="p-1 text-cc-text-muted hover:text-white"><X size={20} /></button></div><div className="max-h-[75vh] overflow-y-auto p-5">{children}</div></div></div>;
