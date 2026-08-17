import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, Save } from 'lucide-react';
import { SellerMonthlyPartnerProgress } from './commissionTypes';
import {
  getSellerMonthlyPartnerProgress,
  setSellerMonthlyPartnerTarget,
} from '../../../lib/sellerPartnerTargetRpcs';

interface AdminPartnerTargetEditorProps {
  sellerId: string;
  sellerName: string;
  monthStart: string;
  onSaveSuccess?: () => void;
}

export const AdminPartnerTargetEditor = ({
  sellerId,
  sellerName,
  monthStart,
  onSaveSuccess,
}: AdminPartnerTargetEditorProps) => {
  const [progress, setProgress] = useState<SellerMonthlyPartnerProgress | null>(null);
  const [inputValue, setInputValue] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Parse month display
  const getMonthDisplay = () => {
    const [year, month, day] = monthStart.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const monthName = date.toLocaleString('es-MX', { month: 'long' });
    return `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;
  };

  const loadProgress = async () => {
    setLoading(true);
    setError(null);
    const result = await getSellerMonthlyPartnerProgress(sellerId, monthStart);
    if (result) {
      setProgress(result);
      setInputValue(result.target_active_partners?.toString() || '');
    } else {
      setError('No se pudo cargar el progreso');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProgress();
  }, [sellerId, monthStart]);

  const handleSave = async () => {
    // Validaciones
    const trimmed = inputValue.trim();
    
    if (!trimmed) {
      setError('La meta es obligatoria');
      return;
    }

    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed)) {
      setError('Debe ingresar un número entero');
      return;
    }

    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError('La meta debe ser un número entero positivo');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    const response = await setSellerMonthlyPartnerTarget(sellerId, monthStart, parsed);

    if (response.success && response.target_id) {
      setSuccessMessage('Meta mensual actualizada correctamente.');
      // Recargar progreso
      setTimeout(() => {
        loadProgress();
        setSuccessMessage(null);
        if (onSaveSuccess) onSaveSuccess();
      }, 1500);
    } else {
      setError(response.error_message || 'Error al guardar la meta');
    }

    setSaving(false);
  };

  if (loading) {
    return (
      <div className="bg-cc-surface rounded-xl border border-white/5 p-6">
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 text-cc-primary animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-cc-surface rounded-xl border border-white/5 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-cc-cream">🎯 Meta mensual de socios</h3>
      </div>

      {/* Info Section */}
      <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-white/5 rounded-lg">
        <div>
          <p className="text-xs text-cc-text-muted">Vendedor</p>
          <p className="text-sm font-semibold text-cc-cream">{sellerName}</p>
        </div>
        <div>
          <p className="text-xs text-cc-text-muted">Mes</p>
          <p className="text-sm font-semibold text-cc-cream">{getMonthDisplay()}</p>
        </div>
      </div>

      {/* Meta Status */}
      {progress ? (
        <div className="space-y-4 mb-6">
          {progress.target_active_partners !== null ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-cc-bg rounded-lg p-3">
                  <p className="text-xs text-cc-text-muted">Meta</p>
                  <p className="text-xl font-bold text-cc-cream">
                    {progress.target_active_partners}
                  </p>
                </div>
                <div className="bg-cc-bg rounded-lg p-3">
                  <p className="text-xs text-cc-text-muted">Logrados</p>
                  <p className="text-xl font-bold text-green-400">
                    {progress.achieved_active_partners}
                  </p>
                </div>
                <div className="bg-cc-bg rounded-lg p-3">
                  <p className="text-xs text-cc-text-muted">Restantes</p>
                  <p className="text-xl font-bold text-yellow-400">
                    {progress.remaining_active_partners}
                  </p>
                </div>
                <div className="bg-cc-bg rounded-lg p-3">
                  <p className="text-xs text-cc-text-muted">Avance</p>
                  <p className="text-xl font-bold text-cc-primary">
                    {progress.progress_percentage?.toFixed(2)}%
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <p className="text-sm text-blue-300">
                Meta mensual aún no configurada
              </p>
              <p className="text-xs text-blue-200 mt-1">
                Progreso actual: {progress.achieved_active_partners} socios activados este mes
              </p>
            </div>
          )}
        </div>
      ) : null}

      {/* Input Section */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="text-xs font-semibold text-cc-text-muted mb-2 block">
            Establecer nueva meta (número de socios)
          </label>
          <input
            type="number"
            value={inputValue}
            onChange={e => {
              setInputValue(e.target.value);
              setError(null);
              setSuccessMessage(null);
            }}
            placeholder="Por ejemplo: 12"
            disabled={saving}
            min="1"
            step="1"
            className="w-full px-4 py-2 bg-cc-bg border border-white/10 rounded-lg text-cc-text-main placeholder:text-cc-text-muted/50 focus:outline-none focus:border-cc-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Success Message */}
        {successMessage && (
          <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
            <p className="text-sm text-green-300">{successMessage}</p>
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving || !inputValue.trim()}
          className="w-full px-6 py-3 bg-cc-primary/20 border border-cc-primary text-cc-primary rounded-lg font-semibold hover:bg-cc-primary/30 hover:border-cc-primary/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Guardar meta
            </>
          )}
        </button>
      </div>
    </div>
  );
};
