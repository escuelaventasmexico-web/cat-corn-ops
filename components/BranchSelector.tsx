import { Building2, Loader2 } from 'lucide-react';
import { useBranch } from '../contexts/BranchContext';

interface Props {
  onBeforeChange?: (nextBranchId: string) => boolean;
  disabled?: boolean;
  compact?: boolean;
}

export const BranchSelector = ({ onBeforeChange, disabled = false, compact = false }: Props) => {
  const { branches, selectedBranch, loading, error, selectBranch } = useBranch();

  if (loading) {
    return <span className="inline-flex items-center gap-2 text-xs text-cc-text-muted"><Loader2 size={14} className="animate-spin" /> Cargando sucursales…</span>;
  }

  if (!selectedBranch) {
    return <div className="text-xs text-red-400">{error || 'No tienes una sucursal autorizada.'}</div>;
  }

  return (
    <label className={`inline-flex items-center gap-2 ${compact ? '' : 'rounded-lg border border-cc-primary/30 bg-cc-primary/10 px-3 py-2'}`}>
      <Building2 size={compact ? 15 : 17} className="text-cc-primary flex-shrink-0" />
      {!compact && <span className="text-xs font-semibold text-cc-text-muted">Sucursal</span>}
      <select
        value={selectedBranch.id}
        disabled={disabled || branches.length <= 1}
        onChange={(event) => {
          const nextId = event.target.value;
          if (nextId === selectedBranch.id) return;
          if (onBeforeChange && !onBeforeChange(nextId)) return;
          selectBranch(nextId);
        }}
        className="min-w-0 bg-transparent text-sm font-bold text-cc-cream outline-none disabled:cursor-not-allowed disabled:opacity-100"
        aria-label="Sucursal seleccionada"
      >
        {branches.map(branch => <option key={branch.id} value={branch.id} className="bg-cc-surface text-cc-cream">{branch.name}</option>)}
      </select>
    </label>
  );
};
