import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2, AlertCircle } from 'lucide-react';
import { supabase } from '../../../supabase';
import {
  MovementType,
  MOVEMENT_TYPE_LABELS,
  SPOILAGE_ABSORBED_BY,
  INPUT_CLS,
  SELECT_CLS,
  LABEL_CLS,
  CARD_CLS,
  todayISO,
  fmtCurrency,
  PartnerCurrentStockItem,
} from './types';
import {
  getProductNames,
  getAllowedVariants,
  getComodatoSourceProductCode,
  getProductSize,
  getProductPrice,
} from '../../../lib/comodatoProducts';
import { CommercialDeliveryUnit, createComodatoDeliveryWithUnits, findCommercialDeliveryUnitForPartner, registerPartnerReturnByBarcode, registerPartnerReturnException, registerPartnerSpoilageByBarcode, registerPartnerSpoilageException, resolveActiveComodatoProductIds } from '../../../services/commercialDeliveryUnitService';
import { useAuth } from '../../../contexts/AuthContext';

// ── Internal types ────────────────────────────────────────────────────────────────────────────────

type ManualRow = {
  _key: number;
  source_product_code: string;
  product_name: string;
  product_variant: string;
  product_size: string;
  quantity_delivered: string;
  price_to_catcorn: string;
  suggested_retail_price: string;
  notes: string;
};

type StockRow = {
  _key: number;
  product_name: string;
  product_variant: string;
  product_size: string;
  current_quantity: number;
  price_to_catcorn: string;
  suggested_retail_price: string;
  quantity_sold: string;
  quantity_withdrawn: string;
  quantity_spoiled: string;
  spoilage_absorbed_by: string;
  notes: string;
};

type CatalogProduct = Record<string, unknown> & { id: string };

const normalizeProductIdentity = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const productField = (product: CatalogProduct, ...keys: string[]) =>
  keys.map(key => product[key]).find(value => value !== null && value !== undefined && String(value).trim() !== '');

const productSize = (product: CatalogProduct) => {
  const direct = productField(product, 'product_size', 'size_label', 'size');
  if (direct !== undefined) return direct;
  const grams = productField(product, 'weight_grams', 'grams');
  return grams === undefined ? undefined : `${grams} gr`;
};

const resolveCatalogProduct = (products: CatalogProduct[], row: Pick<ManualRow | StockRow, 'product_name' | 'product_variant' | 'product_size'>) => {
  const matches = products.filter(product =>
    normalizeProductIdentity(productField(product, 'product_name', 'name')) === normalizeProductIdentity(row.product_name)
    && normalizeProductIdentity(productField(product, 'product_variant', 'category', 'flavor')) === normalizeProductIdentity(row.product_variant)
    && normalizeProductIdentity(productSize(product)) === normalizeProductIdentity(row.product_size),
  );
  return matches.length === 1 ? matches[0] : null;
};

interface Props {
  partnerId: string;
  movementType: MovementType;
  partnerStatus: string;
  onClose: () => void;
  onSaved: () => void;
  onDeliveryCreated?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

const num = (s: string) => parseFloat(s) || 0;

const emptyManualRow = (k: number): ManualRow => ({
  _key: k,
  source_product_code: '',
  product_name: '',
  product_variant: '',
  product_size: '',
  quantity_delivered: '0',
  price_to_catcorn: '',
  suggested_retail_price: '',
  notes: '',
});

// Auto-fill product details based on selected product and variant
const getProductDetails = (productName: string, variant: string) => {
  const size = getProductSize(productName);
  const price = getProductPrice(productName, variant);
  const sourceProductCode = getComodatoSourceProductCode(productName, variant);
  return { size: size || '', price: price?.toString() || '', sourceProductCode: sourceProductCode || '' };
};

const toStockRow = (item: PartnerCurrentStockItem, k: number): StockRow => ({
  _key: k,
  product_name: item.product_name,
  product_variant: item.product_variant ?? '',
  product_size: item.product_size ?? '',
  current_quantity: item.current_quantity ?? 0,
  price_to_catcorn: String(item.last_price_to_catcorn ?? 0),
  suggested_retail_price: String(item.last_suggested_retail_price ?? 0),
  quantity_sold: '0',
  quantity_withdrawn: '0',
  quantity_spoiled: '0',
  spoilage_absorbed_by: 'catcorn',
  notes: '',
});

// ── Component ──────────────────────────────────────────────────────────────────────────────────

const PartnerMovementForm: React.FC<Props> = ({
  partnerId,
  movementType,
  partnerStatus,
  onClose,
  onSaved,
  onDeliveryCreated,
}) => {
  const { isAdmin } = useAuth();
  const isDelivery   = movementType === 'delivery';
  const isSettlement = movementType === 'settlement';
  const isWithdrawal = movementType === 'withdrawal';
  const isSpoilage   = movementType === 'spoilage';

  const [date, setDate] = useState(todayISO());
  const [nextVisitDate, setNextVisitDate] = useState('');
  const [nextVisitReason, setNextVisitReason] = useState('');
  const [generalNotes, setGeneralNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [manualRows, setManualRows] = useState<ManualRow[]>([emptyManualRow(0)]);
  const [counter, setCounter] = useState(1);

  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [spoilageBarcode, setSpoilageBarcode] = useState('');
  const [spoilageException, setSpoilageException] = useState(false);
  const [exceptionRowKey, setExceptionRowKey] = useState<number | null>(null);
  const [withdrawalBarcode, setWithdrawalBarcode] = useState('');
  const [withdrawalUnit, setWithdrawalUnit] = useState<CommercialDeliveryUnit | null>(null);
  const [withdrawalException, setWithdrawalException] = useState(false);
  const [withdrawalExceptionRowKey, setWithdrawalExceptionRowKey] = useState<number | null>(null);
  const withdrawalInputRef = useRef<HTMLInputElement>(null);

  const typeLabel = MOVEMENT_TYPE_LABELS[movementType];

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.from('products').select('*').then(({ data, error: productError }) => {
      if (!active || productError) return;
      setCatalogProducts((data ?? []) as CatalogProduct[]);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!supabase || isDelivery) return;
    let active = true;
    setLoadingStock(true);
    setError(null);

    supabase
      .from('v_commercial_partner_current_stock')
      .select('*')
      .eq('partner_id', partnerId)
      .gt('current_quantity', 0)
      .order('product_name', { ascending: true })
      .then(({ data, error: stockErr }) => {
        if (!active) return;
        if (stockErr) {
          setError('No se pudo cargar el inventario en posesion del socio.');
          setLoadingStock(false);
          return;
        }
        const mapped = ((data ?? []) as PartnerCurrentStockItem[]).map((it, idx) =>
          toStockRow(it, idx),
        );
        setStockRows(mapped);
        setLoadingStock(false);
      });

    return () => { active = false; };
  }, [isDelivery, partnerId]);

  useEffect(() => {
    if (isWithdrawal && !withdrawalException) withdrawalInputRef.current?.focus();
  }, [isWithdrawal, withdrawalException]);

  const previewWithdrawalUnit = async () => {
    if (!withdrawalBarcode.trim()) return;
    setError(null); setWithdrawalUnit(null);
    try {
      const unit = await findCommercialDeliveryUnitForPartner(withdrawalBarcode, partnerId);
      if (!unit) throw new Error('Etiqueta de entrega desconocida para este socio.');
      if (unit.source_type === 'mayoreo') throw new Error('Esta etiqueta corresponde a un pedido de Mayoreo y no puede retirarse por este flujo.');
      if (unit.status !== 'released') throw new Error(unit.status === 'returned_good' ? 'Esta etiqueta ya fue retirada en buen estado.' : `La etiqueta no está disponible para retiro (${unit.status}).`);
      setWithdrawalUnit(unit);
    } catch (err: any) { setError(err.message || 'No se pudo consultar la etiqueta.'); withdrawalInputRef.current?.focus(); }
  };

  const addManualRow = () => {
    setManualRows(prev => [...prev, emptyManualRow(counter)]);
    setCounter(prev => prev + 1);
  };

  const removeManualRow = (key: number) =>
    setManualRows(prev => prev.filter(r => r._key !== key));

  const updateManualRow = <K extends keyof ManualRow>(
    key: number,
    field: K,
    value: ManualRow[K],
  ) =>
    setManualRows(prev =>
      prev.map(r => (r._key === key ? { ...r, [field]: value } : r)),
    );

  const updateStockRow = <K extends keyof StockRow>(
    key: number,
    field: K,
    value: StockRow[K],
  ) =>
    setStockRows(prev =>
      prev.map(r => (r._key === key ? { ...r, [field]: value } : r)),
    );

  const deliveryEstimateTotal = useMemo(
    () =>
      manualRows.reduce(
        (s, r) => s + num(r.quantity_delivered) * num(r.price_to_catcorn),
        0,
      ),
    [manualRows],
  );

  const settlementTotal = useMemo(
    () =>
      stockRows.reduce(
        (s, r) => s + num(r.quantity_sold) * num(r.price_to_catcorn),
        0,
      ),
    [stockRows],
  );

  const noStock = !isDelivery && !loadingStock && stockRows.length === 0;

  const validateStatus = (): boolean => {
    if (['prospecto', 'en_negociacion', 'rechazado'].includes(partnerStatus)) {
      setError('Este socio aun no esta activo para movimientos comerciales.');
      return false;
    }
    if (isDelivery && partnerStatus !== 'activo') {
      setError('No se pueden registrar nuevas entregas para socios pausados o inactivos.');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!supabase) return;
    setError(null);
    if (!validateStatus()) return;
    if (isSpoilage && !spoilageException) {
      if (!spoilageBarcode.trim()) {
        setError('Escanea la etiqueta de la bolsa para registrar merma.');
        return;
      }
      setSaving(true);
      try {
        await registerPartnerSpoilageByBarcode(spoilageBarcode, partnerId, generalNotes);
        setSaving(false);
        onSaved();
      } catch (err: any) {
        setSaving(false);
        setError(err.message || 'No se pudo registrar la merma.');
      }
      return;
    }
    if (isSpoilage && spoilageException) {
      const selected = stockRows.find(row => row._key === exceptionRowKey);
      if (!selected || !generalNotes.trim()) {
        setError('La excepción administrativa requiere producto y motivo obligatorio.');
        return;
      }
      setSaving(true);
      try {
        const product = resolveCatalogProduct(catalogProducts, selected);
        if (!product) throw new Error('El producto histórico no tiene una coincidencia única en el catálogo real.');
        await registerPartnerSpoilageException(partnerId, {
          product_id: product.id, product_name: selected.product_name,
          product_variant: selected.product_variant, product_size: selected.product_size,
          unit_price: Number(selected.price_to_catcorn),
        }, generalNotes);
        setSaving(false); onSaved();
      } catch (err: any) { setSaving(false); setError(err.message || 'No se pudo registrar la excepción.'); }
      return;
    }
    if (isWithdrawal && !withdrawalException) {
      if (!withdrawalUnit || (withdrawalUnit.scan_code !== withdrawalBarcode.trim() && withdrawalUnit.barcode_value !== withdrawalBarcode.trim())) {
        setError('Escanea una etiqueta liberada antes de confirmar el retiro.');
        withdrawalInputRef.current?.focus();
        return;
      }
      setSaving(true);
      try {
        await registerPartnerReturnByBarcode(withdrawalBarcode, partnerId, generalNotes);
        setSaving(false); onSaved();
      } catch (err: any) { setSaving(false); setError(err.message || 'No se pudo registrar el retiro por etiqueta.'); }
      return;
    }
    if (isWithdrawal && withdrawalException) {
      const selected = stockRows.find(row => row._key === withdrawalExceptionRowKey);
      if (!selected || !generalNotes.trim()) {
        setError('La excepción histórica requiere producto y motivo obligatorio.');
        return;
      }
      setSaving(true);
      try {
        const product = resolveCatalogProduct(catalogProducts, selected);
        if (!product) throw new Error('El producto histórico no tiene una coincidencia única en el catálogo real.');
        await registerPartnerReturnException(partnerId, { product_id: product.id, unit_price: Number(selected.price_to_catcorn) }, generalNotes);
        setSaving(false); onSaved();
      } catch (err: any) { setSaving(false); setError(err.message || 'No se pudo registrar la excepción histórica.'); }
      return;
    }
    if (noStock) {
      setError('Este socio no tiene productos en posesion para registrar este movimiento.');
      return;
    }

    let itemsPayload: Record<string, unknown>[] = [];

    if (isDelivery) {
      const rows = manualRows.filter(
        r => r.product_name.trim() && num(r.quantity_delivered) > 0,
      );
      if (rows.length === 0) {
        setError('Agrega al menos un producto con cantidad entregada mayor a 0.');
        return;
      }
      
      // Validate that all rows have valid product, variant, size, and price
      for (const r of rows) {
        if (!r.product_name.trim()) {
          setError('Todos los productos deben tener un nombre seleccionado.');
          return;
        }
        if (!r.product_variant.trim()) {
          setError('Todos los productos deben tener una variante seleccionada.');
          return;
        }
        if (!r.product_size.trim()) {
          setError('No se pudo determinar el tamaño del producto. Verifica la selección.');
          return;
        }
        if (!r.price_to_catcorn || num(r.price_to_catcorn) <= 0) {
          setError('No se pudo determinar el precio Cat Corn. Verifica la selección.');
          return;
        }
        if (!r.source_product_code) {
          setError(
            `El producto seleccionado ${r.product_name} · ${r.product_variant} · ${r.product_size} no tiene un código de Comodato configurado para generar etiquetas.`,
          );
          return;
        }
      }

      let productIdsBySourceCode: Map<string, string>;
      try {
        productIdsBySourceCode = await resolveActiveComodatoProductIds(
          rows.map(row => row.source_product_code),
        );
      } catch (err: any) {
        const message = err.message || 'No se pudo resolver la relación de Comodato.';
        const affectedRow = rows.find(row => message.includes(row.source_product_code));
        setError(
          affectedRow
            ? `No existe una relación activa única para ${affectedRow.product_name} · ${affectedRow.product_variant} · ${affectedRow.product_size} (código ${affectedRow.source_product_code}).`
            : message,
        );
        return;
      }

      const rowWithoutProductId = rows.find(
        row => !productIdsBySourceCode.get(row.source_product_code),
      );
      if (rowWithoutProductId) {
        setError(
          `No existe una relación activa única para ${rowWithoutProductId.product_name} · ${rowWithoutProductId.product_variant} · ${rowWithoutProductId.product_size} (código ${rowWithoutProductId.source_product_code}).`,
        );
        return;
      }

      itemsPayload = rows.map(r => ({
        partner_id: partnerId,
        product_id: productIdsBySourceCode.get(r.source_product_code)!,
        quantity_delivered: num(r.quantity_delivered),
        quantity_sold: 0,
        quantity_withdrawn: 0,
        quantity_spoiled: 0,
        quantity_adjusted: 0,
        price_to_catcorn: num(r.price_to_catcorn),
        suggested_retail_price: num(r.suggested_retail_price) || 0,
        amount_due: 0,
        notes: r.notes.trim() || null,
      }));
    } else {
      const overLimit = stockRows.some(
        r =>
          num(r.quantity_sold) + num(r.quantity_withdrawn) + num(r.quantity_spoiled) >
          r.current_quantity,
      );
      if (overLimit) {
        setError('No puedes liquidar, retirar o mermar mas piezas de las que el socio tiene en posesion.');
        return;
      }
      const activeRows = stockRows.filter(r => {
        if (isSettlement)
          return num(r.quantity_sold) + num(r.quantity_withdrawn) + num(r.quantity_spoiled) > 0;
        if (isWithdrawal) return num(r.quantity_withdrawn) > 0;
        if (isSpoilage)   return num(r.quantity_spoiled) > 0;
        return false;
      });
      if (activeRows.length === 0) {
        setError('Debes capturar al menos una cantidad mayor a 0 para guardar.');
        return;
      }
      itemsPayload = activeRows.map(r => ({
        partner_id: partnerId,
        product_name: r.product_name,
        product_variant: r.product_variant || null,
        product_size: r.product_size || null,
        quantity_delivered: 0,
        quantity_sold:      isSettlement ? num(r.quantity_sold)      : 0,
        quantity_withdrawn: (isSettlement || isWithdrawal) ? num(r.quantity_withdrawn) : 0,
        quantity_spoiled:   (isSettlement || isSpoilage)   ? num(r.quantity_spoiled)   : 0,
        quantity_adjusted: 0,
        price_to_catcorn: num(r.price_to_catcorn),
        suggested_retail_price: num(r.suggested_retail_price) || 0,
        amount_due: isSettlement ? num(r.quantity_sold) * num(r.price_to_catcorn) : 0,
        ...(isSpoilage ? { spoilage_absorbed_by: r.spoilage_absorbed_by || null } : {}),
        notes: r.notes.trim() || null,
      }));
    }

    setSaving(true);

    if (isDelivery) {
      try {
        await createComodatoDeliveryWithUnits({
          partnerId,
          movementDate: date,
          nextVisitDate,
          nextVisitReason,
          notes: generalNotes,
          items: itemsPayload,
        });
        setSaving(false);
        onDeliveryCreated?.();
        onSaved();
      } catch (err: any) {
        setSaving(false);
        setError(err.message || 'No se pudo guardar la entrega y generar etiquetas.');
      }
      return;
    }

    const { data: movement, error: movementErr } = await supabase
      .from('commercial_partner_movements')
      .insert({
        partner_id: partnerId,
        movement_type: movementType,
        movement_date: date,
        next_visit_date: nextVisitDate || null,
        next_visit_reason: nextVisitReason || null,
        notes: generalNotes || null,
        status: 'completed',
      })
      .select('id')
      .single();

    if (movementErr || !movement) {
      setSaving(false);
      setError(movementErr?.message ?? 'Error al guardar el movimiento.');
      return;
    }

    const { error: itemsErr } = await supabase
      .from('commercial_partner_movement_items')
      .insert(itemsPayload.map(r => ({ ...r, movement_id: movement.id })));

    if (itemsErr) {
      setSaving(false);
      setError(itemsErr.message);
      return;
    }

    setSaving(false);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-16 px-4 pb-8">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl bg-[#D6A23A] shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-[#c49330] sticky top-0 bg-[#D6A23A] z-10">
          <h2 className="text-lg font-bold text-[#111111]">Registrar {typeLabel}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#c49330]/50 text-[#374151] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 flex flex-col gap-5">
          {isSpoilage && (
            <div className={`${CARD_CLS} border-red-300 bg-red-50`}>
              {!spoilageException ? <>
                <label className={LABEL_CLS}>Escanear etiqueta de la bolsa *</label>
                <input value={spoilageBarcode} onChange={e => setSpoilageBarcode(e.target.value)} autoFocus className={INPUT_CLS} placeholder="1234 5678 9012 3456" />
                <p className="mt-1 text-xs text-red-700">La merma operativa sólo puede registrarse sobre una bolsa liberada.</p>
                {isAdmin && <button type="button" onClick={() => setSpoilageException(true)} className="mt-2 text-xs font-semibold text-red-800 underline">Registrar merma sin etiqueta</button>}
              </> : <>
                <p className="text-xs font-bold text-red-800">Excepción administrativa auditada</p>
                <select value={exceptionRowKey ?? ''} onChange={event => setExceptionRowKey(Number(event.target.value))} className={`${SELECT_CLS} mt-2`}>
                  <option value="">Selecciona producto histórico</option>
                  {stockRows.map(row => <option key={row._key} value={row._key}>{row.product_name} — {row.product_variant} ({row.current_quantity})</option>)}
                </select>
                <button type="button" onClick={() => setSpoilageException(false)} className="mt-2 text-xs font-semibold text-red-800 underline">Volver al escaneo obligatorio</button>
              </>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Fecha del movimiento *</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Proxima visita (opcional)</label>
              <input
                type="date"
                value={nextVisitDate}
                onChange={e => setNextVisitDate(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          </div>

          {nextVisitDate && (
            <div>
              <label className={LABEL_CLS}>Motivo de proxima visita</label>
              <input
                type="text"
                value={nextVisitReason}
                onChange={e => setNextVisitReason(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          )}

          {isSpoilage ? (
            <p className="text-xs text-[#6b5c40]">La información de producto y entrega se obtiene de la etiqueta escaneada.</p>
          ) : isDelivery ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">Productos</p>

              {manualRows.map((row, idx) => (
                <div key={row._key} className={`${CARD_CLS} space-y-3`}>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-[#4a2c0a]">Producto {idx + 1}</span>
                    {manualRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeManualRow(row._key)}
                        className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <label className={LABEL_CLS}>Nombre del producto *</label>
                      <select
                        value={row.product_name}
                        onChange={e => {
                          const productName = e.target.value;
                          const allowedVariants = getAllowedVariants(productName);
                          const defaultVariant = allowedVariants.length > 0 ? allowedVariants[0] : '';
                          const { size, price, sourceProductCode } = getProductDetails(productName, defaultVariant);
                          updateManualRow(row._key, 'product_name', productName);
                          updateManualRow(row._key, 'product_variant', defaultVariant);
                          updateManualRow(row._key, 'product_size', size);
                          updateManualRow(row._key, 'source_product_code', sourceProductCode);
                          updateManualRow(row._key, 'price_to_catcorn', price);
                        }}
                        className={`${SELECT_CLS} bg-white`}
                      >
                        <option value="">Selecciona un producto</option>
                        {getProductNames().map(name => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Variante *</label>
                      <select
                        value={row.product_variant}
                        onChange={e => {
                          const variant = e.target.value;
                          const { price, sourceProductCode } = getProductDetails(row.product_name, variant);
                          updateManualRow(row._key, 'product_variant', variant);
                          updateManualRow(row._key, 'source_product_code', sourceProductCode);
                          updateManualRow(row._key, 'price_to_catcorn', price);
                        }}
                        disabled={!row.product_name}
                        className={SELECT_CLS}
                      >
                        <option value="">Selecciona variante</option>
                        {getAllowedVariants(row.product_name).map(v => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Tamaño / Presentación</label>
                      <input
                        type="text"
                        value={row.product_size}
                        disabled
                        readOnly
                        className={INPUT_CLS}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={LABEL_CLS}>Cantidad entregada *</label>
                      <input
                        type="number"
                        min="0"
                        value={row.quantity_delivered}
                        onChange={e => updateManualRow(row._key, 'quantity_delivered', e.target.value)}
                        className={INPUT_CLS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Precio Cat Corn (c/u)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.price_to_catcorn}
                        disabled
                        readOnly
                        className={INPUT_CLS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>PVP sugerido (opcional)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.suggested_retail_price}
                        onChange={e => updateManualRow(row._key, 'suggested_retail_price', e.target.value)}
                        placeholder="Opcional"
                        className={INPUT_CLS}
                      />
                    </div>
                  </div>

                  {num(row.quantity_delivered) * num(row.price_to_catcorn) > 0 && (
                    <p className="text-xs text-[#4a2c0a] font-semibold text-right">
                      Valor estimado (informativo):{' '}
                      {fmtCurrency(num(row.quantity_delivered) * num(row.price_to_catcorn))}
                    </p>
                  )}

                  <div>
                    <label className={LABEL_CLS}>Notas del producto</label>
                    <input
                      type="text"
                      value={row.notes}
                      onChange={e => updateManualRow(row._key, 'notes', e.target.value)}
                      className={INPUT_CLS}
                    />
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addManualRow}
                className="flex items-center gap-2 text-sm text-[#4a2c0a] font-semibold px-3 py-2 rounded-lg border-2 border-dashed border-[#c49330] hover:bg-[#f5e9c8] transition-colors w-full justify-center"
              >
                <Plus className="w-4 h-4" />
                Agregar producto
              </button>

              {deliveryEstimateTotal > 0 && (
                <div className={`${CARD_CLS} flex justify-between items-center`}>
                  <span className="text-sm text-[#4a2c0a]">
                    Valor estimado de la entrega
                    <span className="block text-xs font-normal text-[#9a8060]">
                      Solo informativo — el cobro se registra en la liquidacion
                    </span>
                  </span>
                  <span className="text-lg font-bold text-[#111111]">
                    {fmtCurrency(deliveryEstimateTotal)}
                  </span>
                </div>
              )}
            </div>
          ) : isWithdrawal ? (
            <div className={`${CARD_CLS} space-y-3`}>
              {!withdrawalException ? <>
                <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">Retiro por etiqueta</p>
                <label className={LABEL_CLS}>Escanea el código de barras de la bolsa</label>
                <div className="flex gap-2"><input ref={withdrawalInputRef} autoFocus value={withdrawalBarcode} onChange={event => { setWithdrawalBarcode(event.target.value); setWithdrawalUnit(null); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void previewWithdrawalUnit(); } }} className={INPUT_CLS} placeholder="1234 5678 9012 3456" /><button type="button" onClick={() => void previewWithdrawalUnit()} className="rounded-lg bg-[#2d1a00] px-3 text-xs font-semibold text-[#F6E7C1]">Consultar</button></div>
                <p className="text-xs text-[#6b5c40]">El lector funciona como teclado. Sólo se retira una bolsa liberada por confirmación.</p>
                {withdrawalUnit && <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-[#4a2c0a]"><p className="font-semibold">{withdrawalUnit.product_name}{withdrawalUnit.product_variant ? ` — ${withdrawalUnit.product_variant}` : ''}</p><p>{withdrawalUnit.product_size || '—'} · Precio Cat Corn: {fmtCurrency(withdrawalUnit.unit_price)}</p><p>Socio: {withdrawalUnit.commercial_partners?.business_name || withdrawalUnit.commercial_partners?.responsible_name || 'Socio seleccionado'}</p><p className="text-xs">Liberada: {withdrawalUnit.released_at ? new Date(withdrawalUnit.released_at).toLocaleString('es-MX') : '—'}</p></div>}
                {isAdmin && <button type="button" onClick={() => setWithdrawalException(true)} className="text-xs font-semibold text-orange-800 underline">Registrar retiro histórico sin etiqueta</button>}
              </> : <>
                <p className="text-xs font-bold text-orange-800">Excepción histórica auditada</p>
                <select value={withdrawalExceptionRowKey ?? ''} onChange={event => setWithdrawalExceptionRowKey(Number(event.target.value))} className={SELECT_CLS}><option value="">Selecciona producto histórico</option>{stockRows.map(row => <option key={row._key} value={row._key}>{row.product_name} — {row.product_variant} ({row.current_quantity})</option>)}</select>
                <p className="text-xs text-orange-800">Sólo administrador. El motivo general es obligatorio.</p>
                <button type="button" onClick={() => setWithdrawalException(false)} className="text-xs font-semibold text-orange-800 underline">Volver al escaneo obligatorio</button>
              </>}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
                Productos en posesion del socio
              </p>

              {loadingStock && (
                <div className={`${CARD_CLS} text-sm text-[#6b5c40]`}>
                  Cargando productos en posesion...
                </div>
              )}

              {noStock && (
                <div className={`${CARD_CLS} text-sm text-[#6b5c40]`}>
                  Este socio no tiene productos en posesion para registrar este movimiento.
                </div>
              )}

              {!loadingStock &&
                stockRows.map(row => {
                  const sold      = num(row.quantity_sold);
                  const withdrawn = num(row.quantity_withdrawn);
                  const spoiled   = num(row.quantity_spoiled);
                  const over      = sold + withdrawn + spoiled > row.current_quantity;
                  const rowDue    = isSettlement ? sold * num(row.price_to_catcorn) : 0;

                  return (
                    <div key={row._key} className={`${CARD_CLS} space-y-3`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-semibold text-[#111111]">
                            {row.product_name}
                            {row.product_variant ? ` — ${row.product_variant}` : ''}
                          </p>
                          {row.product_size && (
                            <p className="text-xs text-[#6b5c40]">{row.product_size}</p>
                          )}
                          <p className="text-xs text-[#6b5c40] mt-1">
                            Precio Cat Corn:{' '}
                            <strong className="text-[#111111]">
                              {fmtCurrency(num(row.price_to_catcorn))}
                            </strong>
                          </p>
                          <p className="text-xs text-[#6b5c40]">
                            PVP sugerido:{' '}
                            <strong className="text-[#111111]">
                              {fmtCurrency(num(row.suggested_retail_price))}
                            </strong>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-[#6b5c40]">En posesion</p>
                          <p className="text-2xl font-bold text-[#111111] leading-none">
                            {row.current_quantity}
                          </p>
                        </div>
                      </div>

                      {isSettlement && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div>
                            <label className={LABEL_CLS}>Vendida</label>
                            <input
                              type="number"
                              min="0"
                              value={row.quantity_sold}
                              onChange={e => updateStockRow(row._key, 'quantity_sold', e.target.value)}
                              className={INPUT_CLS}
                            />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Retirada</label>
                            <input
                              type="number"
                              min="0"
                              value={row.quantity_withdrawn}
                              onChange={e => updateStockRow(row._key, 'quantity_withdrawn', e.target.value)}
                              className={INPUT_CLS}
                            />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Merma</label>
                            <input
                              type="number"
                              min="0"
                              value={row.quantity_spoiled}
                              onChange={e => updateStockRow(row._key, 'quantity_spoiled', e.target.value)}
                              className={INPUT_CLS}
                            />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Precio c/u</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.price_to_catcorn}
                              disabled
                              readOnly
                              className={INPUT_CLS}
                            />
                          </div>
                        </div>
                      )}

                      {isWithdrawal && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <label className={LABEL_CLS}>Cantidad a retirar</label>
                            <input
                              type="number"
                              min="0"
                              value={row.quantity_withdrawn}
                              onChange={e => updateStockRow(row._key, 'quantity_withdrawn', e.target.value)}
                              className={INPUT_CLS}
                            />
                          </div>
                        </div>
                      )}

                      {isSpoilage && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <div>
                            <label className={LABEL_CLS}>Cantidad con merma</label>
                            <input
                              type="number"
                              min="0"
                              value={row.quantity_spoiled}
                              onChange={e => updateStockRow(row._key, 'quantity_spoiled', e.target.value)}
                              className={INPUT_CLS}
                            />
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Absorbe merma</label>
                            <select
                              value={row.spoilage_absorbed_by}
                              onChange={e => updateStockRow(row._key, 'spoilage_absorbed_by', e.target.value)}
                              className={`${SELECT_CLS} bg-white`}
                            >
                              {SPOILAGE_ABSORBED_BY.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>Precio c/u</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.price_to_catcorn}
                              disabled
                              readOnly
                              className={INPUT_CLS}
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <label className={LABEL_CLS}>Notas</label>
                        <input
                          type="text"
                          value={row.notes}
                          onChange={e => updateStockRow(row._key, 'notes', e.target.value)}
                          className={INPUT_CLS}
                        />
                      </div>

                      {over && (
                        <p className="text-xs text-red-700 font-medium">
                          La suma excede la cantidad en posesion ({row.current_quantity}).
                        </p>
                      )}

                      {isSettlement && rowDue > 0 && (
                        <p className="text-xs text-[#4a2c0a] font-semibold text-right">
                          Adeudo de este producto: {fmtCurrency(rowDue)}
                        </p>
                      )}
                    </div>
                  );
                })}

              {isSettlement && settlementTotal > 0 && (
                <div className={`${CARD_CLS} flex justify-between items-center`}>
                  <span className="text-sm font-semibold text-[#4a2c0a]">Total adeudo generado</span>
                  <span className="text-lg font-bold text-[#111111]">{fmtCurrency(settlementTotal)}</span>
                </div>
              )}
            </div>
          )}

          <div>
            <label className={LABEL_CLS}>Notas generales</label>
            <textarea
              value={generalNotes}
              rows={2}
              onChange={e => setGeneralNotes(e.target.value)}
              className={`${INPUT_CLS} resize-none`}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-700 text-sm p-3 rounded-lg bg-red-50 border border-red-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1 pb-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl border-2 border-[#c49330] text-[#4a2c0a] font-semibold hover:bg-[#f5e9c8] transition-colors disabled:opacity-75"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving || loadingStock || (!isWithdrawal && noStock)}
              className="flex-1 py-2.5 rounded-xl bg-[#2d1a00] text-[#F6E7C1] font-semibold hover:bg-[#4a2c0a] transition-colors disabled:opacity-75"
            >
              {saving ? 'Guardando...' : isDelivery ? 'Guardar y generar etiquetas' : isWithdrawal && !withdrawalException ? 'Confirmar retiro de 1 bolsa' : `Guardar ${typeLabel}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PartnerMovementForm;
