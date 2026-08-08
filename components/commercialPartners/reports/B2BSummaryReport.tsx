import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../../supabase';
import { Loader2, AlertCircle } from 'lucide-react';
import {
  B2BDashboardSummary,
  B2BPipelineByStatus,
  B2BConversionSummary,
} from './b2bReportTypes';
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from './b2bReportHelpers';
import { getPieceSaleSummary, SalesChannelSummary } from '../../../services/commercialCollectionsService';

interface B2BSummaryReportProps {
  refreshTrigger?: number;
}

export const B2BSummaryReport = ({ refreshTrigger = 0 }: B2BSummaryReportProps) => {
  const [summary, setSummary] = useState<B2BDashboardSummary | null>(null);
  const [pipeline, setPipeline] = useState<B2BPipelineByStatus[]>([]);
  const [conversion, setConversion] = useState<B2BConversionSummary | null>(null);
  const [pieceSale, setPieceSale] = useState<SalesChannelSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Procesar y validar datos de conversión
  const conversionData = useMemo(() => {
    if (!conversion) return null;

    const registered = conversion.total_registered ?? 0;
    const active = conversion.active ?? 0;
    const prospects = conversion.prospects ?? 0;
    const inNegotiation = conversion.in_negotiation ?? 0;
    const rejected = conversion.rejected ?? 0;

    // La vista SQL ya calcula correctamente la tasa como fracción (0-1)
    // Si viene null/undefined, recalcular de forma segura
    const conversionRate = conversion.conversion_rate ?? 
      (registered > 0 ? active / registered : 0);

    console.log('B2B_CONVERSION_COUNTS', {
      registeredCount: registered,
      activeCount: active,
      prospectCount: prospects,
      negotiationCount: inNegotiation,
      rejectedCount: rejected,
      rawConversionRate: conversion.conversion_rate,
      calculatedConversionRate: conversionRate,
    });

    return {
      total_registered: registered,
      prospects,
      in_negotiation: inNegotiation,
      active,
      rejected,
      conversion_rate: conversionRate,
    };
  }, [conversion]);

  const loadData = async () => {
    if (!supabase) {
      setError('Supabase no está configurado');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [summaryRes, pipelineRes, conversionRes] = await Promise.all([
        supabase.from('v_b2b_dashboard_summary').select('*').limit(1),
        supabase.from('v_b2b_pipeline_by_status').select('*'),
        supabase.from('v_b2b_conversion_summary').select('*').limit(1),
      ]);

      if (summaryRes.error) throw summaryRes.error;
      if (pipelineRes.error) throw pipelineRes.error;
      if (conversionRes.error) throw conversionRes.error;

      const summaryData = summaryRes.data?.[0] as B2BDashboardSummary | null;
      const conversionData = conversionRes.data?.[0] as B2BConversionSummary | null;

      setSummary(summaryData);
      setPipeline((pipelineRes.data as B2BPipelineByStatus[]) ?? []);
      setConversion(conversionData);

      // Load Venta por Pieza summary for current month
      const today = new Date();
      const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
      const pieceSaleSummary = await getPieceSaleSummary(monthStart, monthEnd);
      setPieceSale(pieceSaleSummary);

      // Update summary with piece sale data if successful
      if (!pieceSaleSummary.error && summaryData) {
        summaryData.pieceSale_generated_total = pieceSaleSummary.generated;
        summaryData.pieceSale_paid_total = pieceSaleSummary.paid;
        summaryData.pieceSale_pending_total = pieceSaleSummary.pending;
        summaryData.pieceSale_total_pieces = pieceSaleSummary.units;
      }

      // Log detallado de conversión
      console.log('B2B_CONVERSION_RAW', conversionData);
      console.log('B2B_CONVERSION_COUNTS', {
        registeredCount: conversionData?.total_registered,
        activeCount: conversionData?.active,
        prospectCount: conversionData?.prospects,
        negotiationCount: conversionData?.in_negotiation,
        rejectedCount: conversionData?.rejected,
        rawConversionRate: conversionData?.conversion_rate,
      });

      // Log piece sale summary
      console.log('B2B_PIECE_SALE_SUMMARY', pieceSaleSummary);
    } catch (err: any) {
      console.error('Error loading B2B summary:', err);
      setError(err?.message || 'Error al cargar resumen');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  useEffect(() => {
    if (summary) {
      console.log('B2B_DASHBOARD_SUMMARY', summary);
    }
  }, [summary]);

  useEffect(() => {
    if (conversionData) {
      console.log('B2B_CONVERSION_PROCESSED', conversionData);
    }
  }, [conversionData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cc-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-red-300">Error al cargar datos</h3>
          <p className="text-sm text-red-200">{error}</p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="text-center py-12 text-cc-text-muted">
        No hay datos todavía para este reporte.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── GENERAL SECTION ────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold text-cc-text-main mb-4">Resumen General B2B</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Total Generado */}
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Total Generado</p>
            <p className="text-2xl font-bold text-cc-cream">
              {formatCurrency((summary.b2b_total_generated ?? 0) + (summary.pieceSale_generated_total ?? 0))}
            </p>
            <p className="text-xs text-cc-text-muted mt-2">
              {formatNumber((summary.b2b_total_units ?? 0) + (summary.pieceSale_total_pieces ?? 0))} piezas
            </p>
          </div>

          {/* Total Cobrado */}
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Total Cobrado</p>
            <p className="text-2xl font-bold text-cc-cream">
              {formatCurrency((summary.b2b_total_paid ?? 0) + (summary.pieceSale_paid_total ?? 0))}
            </p>
            <p className="text-xs text-cc-text-muted mt-2">
              {formatPercent(((summary.b2b_total_paid ?? 0) + (summary.pieceSale_paid_total ?? 0)) / (((summary.b2b_total_generated ?? 0) + (summary.pieceSale_generated_total ?? 0)) || 1))}
            </p>
          </div>

          {/* Saldo Pendiente */}
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Pendiente</p>
            <p className="text-2xl font-bold text-red-400">
              {formatCurrency((summary.b2b_pending_balance ?? 0) + (summary.pieceSale_pending_total ?? 0))}
            </p>
            <p className="text-xs text-red-300 mt-2">
              {formatNumber(summary.partners_with_pending_balance)} socios
            </p>
          </div>

          {/* Socios Totales */}
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Socios Totales</p>
            <p className="text-2xl font-bold text-cc-cream">
              {formatNumber(summary.total_partners)}
            </p>
            <p className="text-xs text-cc-text-muted mt-2">
              {formatNumber(summary.active_partners)} activos
            </p>
          </div>

          {/* Modelos */}
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Modelos</p>
            <div className="space-y-1">
              <p className="text-sm">
                <span className="text-cc-text-muted">Comodato:</span>{' '}
                <span className="font-semibold text-cc-cream">{formatNumber(summary.comodato_partners)}</span>
              </p>
              <p className="text-sm">
                <span className="text-cc-text-muted">Mayoreo:</span>{' '}
                <span className="font-semibold text-cc-cream">{formatNumber(summary.wholesale_partners)}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── COBRADO POR CANAL SECTION ─────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold text-cc-text-main mb-4">Cobrado por Canal</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Comodato Cobrado */}
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-3">Comodato</p>
            <div className="space-y-1">
              <p className="text-2xl font-bold text-cc-cream">
                {formatCurrency(summary.comodato_paid_total ?? 0)}
              </p>
              <p className="text-xs text-cc-text-muted">
                de {formatCurrency(summary.comodato_generated_total ?? 0)} generado
              </p>
            </div>
          </div>

          {/* Mayoreo Cobrado */}
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-3">Mayoreo</p>
            <div className="space-y-1">
              <p className="text-2xl font-bold text-cc-cream">
                {formatCurrency(summary.wholesale_paid_total ?? 0)}
              </p>
              <p className="text-xs text-cc-text-muted">
                de {formatCurrency(summary.wholesale_purchased_total ?? 0)} comprado
              </p>
            </div>
          </div>

          {/* Venta por Pieza Cobrado */}
          {pieceSale && !pieceSale.error && (
            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-3">Venta por Pieza</p>
              <div className="space-y-1">
                <p className="text-2xl font-bold text-cc-cream">
                  {formatCurrency(pieceSale.paid ?? 0)}
                </p>
                <p className="text-xs text-cc-text-muted">
                  de {formatCurrency(pieceSale.generated ?? 0)} vendido
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── COMODATO SECTION ───────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold text-cc-text-main mb-4">Comodato</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Generado</p>
            <p className="text-2xl font-bold text-cc-cream">
              {formatCurrency(summary.comodato_generated_total)}
            </p>
            <p className="text-xs text-cc-text-muted mt-2">
              {formatNumber(summary.comodato_units_in_partner)} unidades
            </p>
          </div>

          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Cobrado</p>
            <p className="text-2xl font-bold text-cc-cream">
              {formatCurrency(summary.comodato_paid_total)}
            </p>
            <p className="text-xs text-cc-text-muted mt-2">
              {formatPercent((summary.comodato_paid_total ?? 0) / (summary.comodato_generated_total ?? 1))}
            </p>
          </div>

          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Pendiente</p>
            <p className="text-2xl font-bold text-red-400">
              {formatCurrency(summary.comodato_pending_total)}
            </p>
          </div>

          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Socios</p>
            <p className="text-2xl font-bold text-cc-cream">
              {formatNumber(summary.comodato_partners)}
            </p>
          </div>
        </div>
      </div>

      {/* ── MAYOREO SECTION ────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold text-cc-text-main mb-4">Mayoreo</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Comprado</p>
            <p className="text-2xl font-bold text-cc-cream">
              {formatCurrency(summary.wholesale_purchased_total)}
            </p>
            <p className="text-xs text-cc-text-muted mt-2">
              {formatNumber(summary.wholesale_total_pieces)} piezas
            </p>
          </div>

          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Pagado</p>
            <p className="text-2xl font-bold text-cc-cream">
              {formatCurrency(summary.wholesale_paid_total)}
            </p>
            <p className="text-xs text-cc-text-muted mt-2">
              {formatPercent((summary.wholesale_paid_total ?? 0) / (summary.wholesale_purchased_total ?? 1))}
            </p>
          </div>

          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Pendiente</p>
            <p className="text-2xl font-bold text-red-400">
              {formatCurrency(summary.wholesale_pending_total)}
            </p>
          </div>

          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Socios</p>
            <p className="text-2xl font-bold text-cc-cream">
              {formatNumber(summary.wholesale_partners)}
            </p>
          </div>
        </div>
      </div>

      {/* ── VENTA POR PIEZA SECTION ────────────────────────────── */}
      {pieceSale && !pieceSale.error && (
        <div>
          <h2 className="text-lg font-bold text-cc-text-main mb-4">Venta por Pieza</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Vendido</p>
              <p className="text-2xl font-bold text-cc-cream">
                {formatCurrency(pieceSale.generated)}
              </p>
              <p className="text-xs text-cc-text-muted mt-2">
                {formatNumber(pieceSale.units)} piezas
              </p>
            </div>

            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Cobrado</p>
              <p className="text-2xl font-bold text-cc-cream">
                {formatCurrency(pieceSale.paid)}
              </p>
              <p className="text-xs text-cc-text-muted mt-2">
                {formatPercent((pieceSale.paid ?? 0) / (pieceSale.generated ?? 1))}
              </p>
            </div>

            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Pendiente</p>
              <p className="text-2xl font-bold text-red-400">
                {formatCurrency(pieceSale.pending)}
              </p>
            </div>

            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Vendedores</p>
              <p className="text-2xl font-bold text-cc-cream">
                {formatNumber(0)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── CONVERSION SECTION ─────────────────────────────────── */}
      {conversionData && (
        <div>
          <h2 className="text-lg font-bold text-cc-text-main mb-4">Tasa de Conversión</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Registrados</p>
              <p className="text-2xl font-bold text-cc-cream">
                {formatNumber(conversionData.total_registered)}
              </p>
            </div>

            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Prospectos</p>
              <p className="text-2xl font-bold text-yellow-400">
                {formatNumber(conversionData.prospects)}
              </p>
            </div>

            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">En negociación</p>
              <p className="text-2xl font-bold text-orange-400">
                {formatNumber(conversionData.in_negotiation)}
              </p>
            </div>

            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Activos</p>
              <p className="text-2xl font-bold text-green-400">
                {formatNumber(conversionData.active)}
              </p>
            </div>

            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Rechazados</p>
              <p className="text-2xl font-bold text-red-400">
                {formatNumber(conversionData.rejected)}
              </p>
            </div>

            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Tasa conversión</p>
              <p className="text-2xl font-bold text-cc-cream">
                {formatPercent(conversionData.conversion_rate)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── PIPELINE SECTION ───────────────────────────────────── */}
      {pipeline.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-cc-text-main mb-4">Pipeline por Estado</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pipeline.map((item, idx) => (
              <div key={idx} className="bg-cc-surface rounded-2xl border border-white/5 p-6">
                <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-3 capitalize">
                  {item.status}
                </p>
                <div className="space-y-2">
                  <p className="text-sm">
                    <span className="text-cc-text-muted">Socios:</span>{' '}
                    <span className="font-semibold text-cc-cream">
                      {formatNumber(item.partner_count)}
                    </span>
                  </p>
                  <p className="text-sm">
                    <span className="text-cc-text-muted">Generado:</span>{' '}
                    <span className="font-semibold text-cc-cream">
                      {formatCurrency(item.total_generated)}
                    </span>
                  </p>
                  <p className="text-sm">
                    <span className="text-cc-text-muted">Pendiente:</span>{' '}
                    <span className="font-semibold text-red-400">
                      {formatCurrency(item.total_pending)}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
