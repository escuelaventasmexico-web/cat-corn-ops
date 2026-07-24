import { Check, Copy } from 'lucide-react';
import { PieceSaleResponse } from '../../../types/pieceSales';
import { useState } from 'react';

interface NewPieceSaleSuccessProps {
  data: PieceSaleResponse;
  onClose: () => void;
}

export const NewPieceSaleSuccess = ({ data, onClose }: NewPieceSaleSuccessProps) => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(data.sale_folio);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-cc-bg rounded-3xl border border-green-500/30 max-w-md w-full overflow-hidden">
        {/* ── SUCCESS HEADER ──────────────────────────── */}
        <div className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-b border-green-500/30 px-6 py-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-green-500/20 border border-green-500/30 rounded-full flex items-center justify-center">
              <Check className="w-8 h-8 text-green-400" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-green-400 mb-2">¡Venta registrada!</h2>
          <p className="text-cc-text-muted text-sm">
            Tu reporte ha sido enviado exitosamente
          </p>
        </div>

        {/* ── FOLIO DISPLAY ────────────────────────── */}
        <div className="px-6 py-6 space-y-4">
          <div className="bg-cc-surface/50 rounded-xl p-4">
            <p className="text-xs text-cc-text-muted mb-2">Folio de venta</p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <p className="text-2xl font-bold text-cc-cream font-mono">
                  {data.sale_folio}
                </p>
              </div>
              <button
                onClick={copyToClipboard}
                className="p-2 hover:bg-cc-surface rounded-lg transition-colors"
              >
                <Copy className="w-5 h-5 text-cc-primary" />
              </button>
            </div>
            {copied && (
              <p className="text-xs text-green-400 mt-2">✓ Folio copiado</p>
            )}
          </div>

          {/* ── DETAILS ─────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-cc-text-muted">Solicitud de pago:</span>
              <span className="text-cc-cream font-mono text-xs bg-cc-surface/50 px-2 py-1 rounded">
                {data.request_id.slice(0, 8)}...
              </span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-cc-text-muted">Estado:</span>
              <span className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-500/10 border border-yellow-500/30 rounded-full text-xs font-semibold text-yellow-300">
                <div className="w-2 h-2 bg-yellow-400 rounded-full" />
                En revisión
              </span>
            </div>

            <div className="flex items-center justify-between text-sm border-t border-white/10 pt-3">
              <span className="text-cc-text-muted">Próximo paso:</span>
              <span className="text-cc-cream text-right text-xs">
                Admin verificará y confirmará
              </span>
            </div>
          </div>

          {/* ── INFO MESSAGES ───────────────────────── */}
          <div className="space-y-2 pt-4 border-t border-white/10">
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl">
              <p className="text-xs text-blue-300">
                <span className="font-semibold">Número de venta:</span> Guarda tu folio para
                referencias futuras
              </p>
            </div>

            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl">
              <p className="text-xs text-blue-300">
                <span className="font-semibold">Comisión:</span> Se acreditará después de que el
                admin confirme
              </p>
            </div>
          </div>
        </div>

        {/* ── BUTTON ──────────────────────────────── */}
        <div className="px-6 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="w-full px-4 py-3 bg-cc-primary hover:bg-cc-primary/90 text-cc-surface rounded-xl font-semibold transition-colors"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
};
