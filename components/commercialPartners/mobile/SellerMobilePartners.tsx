import { useState } from 'react';
import { Search, X, Plus, Store, Phone, User, Loader2, AlertCircle, HeartHandshake, MapPin, CalendarClock } from 'lucide-react';
import { CommercialDirectoryRecord, CommercialPartner, STATUS_BADGE, MODEL_BADGE, BUSINESS_TYPES } from '../types';

interface SellerMobilePartnersProps {
  records: CommercialDirectoryRecord[];
  loading: boolean;
  onSelectRecord: (record: CommercialDirectoryRecord) => void;
  onNewPartner: () => void;
  error?: string | null;
}

const getBusinessTypeLabel = (p: CommercialPartner) => {
  if (p.business_type === 'otro') return p.business_type_other || 'Otro';
  return BUSINESS_TYPES.find(b => b.value === p.business_type)?.label ?? p.business_type;
};

export const SellerMobilePartners = ({
  records,
  loading,
  onSelectRecord,
  onNewPartner,
  error,
}: SellerMobilePartnersProps) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = records.filter(record => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    if (record.recordKind === 'commercial_prospect') {
      return [
        record.businessName,
        record.contactName,
        record.phone,
        record.address,
        record.locationReference,
        record.originatorAlias,
      ].some(value => (value ?? '').toLowerCase().includes(q));
    }
    const p = record.partner;
    return (
      (p.folio ?? '').toLowerCase().includes(q) ||
      p.business_name.toLowerCase().includes(q) ||
      p.responsible_name.toLowerCase().includes(q) ||
      (p.phone ?? '').toLowerCase().includes(q)
    );
  });
  const filteredPartnerCount = filtered.filter(record => record.recordKind === 'commercial_partner').length;
  const filteredProspectCount = filtered.length - filteredPartnerCount;

  return (
    <div className="pb-24 space-y-3">
      {/* Header */}
      <div className="px-4 pt-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-cc-text-main">Directorio comercial</h2>
          <button
            onClick={onNewPartner}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cc-primary text-cc-bg font-semibold text-xs hover:bg-cc-primary-dark transition-colors"
          >
            <Plus size={14} />
            Nuevo
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted pointer-events-none"
          />
          <input
            type="text"
            placeholder="Buscar por nombre, folio..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-cc-surface border border-white/10 rounded-lg pl-9 pr-8 py-2.5 text-xs text-cc-text-main placeholder:text-cc-text-muted focus:outline-none focus:border-cc-primary/50 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cc-text-muted hover:text-cc-text-main transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-red-400 text-xs">
          <AlertCircle size={14} className="flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-cc-primary" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-cc-text-muted px-4">
          <HeartHandshake size={32} className="opacity-30" />
          <p className="text-sm text-center">
            {searchQuery
              ? 'No se encontraron socios con ese criterio'
              : 'Aún no hay socios registrados'}
          </p>
          {!searchQuery && (
            <button
              onClick={onNewPartner}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cc-primary text-cc-bg font-semibold text-xs hover:bg-cc-primary-dark transition-colors mt-2"
            >
              <Plus size={12} />
              Crear el primero
            </button>
          )}
        </div>
      )}

      {/* Partners list */}
      {!loading && filtered.length > 0 && (
        <div className="divide-y divide-white/5 px-4 space-y-0">
          {filtered.map(record => {
            if (record.recordKind === 'commercial_prospect') {
              const followUp = record.proposedVisitAt || record.nextFollowUpAt;
              return (
                <button
                  key={`${record.recordKind}:${record.prospectId}`}
                  onClick={() => onSelectRecord(record)}
                  className="w-full space-y-2 py-4 text-left transition-colors hover:bg-white/3 active:scale-95"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-cc-text-main">{record.businessName}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-cc-primary">
                        PROSPECTO / {record.originatorAlias || 'SIN ALIAS'}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-full border border-purple-500/30 bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-300">
                      {record.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-cc-text-muted">
                    <div className="flex items-center gap-2"><User size={12} className="shrink-0" /><span className="truncate">{record.contactName || 'Sin contacto'}</span></div>
                    {record.phone && <div className="flex items-center gap-2"><Phone size={12} className="shrink-0" /><span>{record.phone}</span></div>}
                    {(record.address || record.locationReference) && <div className="flex items-center gap-2"><MapPin size={12} className="shrink-0" /><span className="truncate">{record.address || record.locationReference}</span></div>}
                    {followUp && <div className="flex items-center gap-2"><CalendarClock size={12} className="shrink-0" /><span>{record.proposedVisitAt ? 'Visita' : 'Seguimiento'}: {new Date(followUp).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>}
                    <div className="flex items-center gap-2"><Store size={12} className="shrink-0" /><span>{BUSINESS_TYPES.find(type => type.value === record.businessType)?.label ?? record.businessType}</span></div>
                  </div>
                </button>
              );
            }

            const p = record.partner;
            const statusCfg = STATUS_BADGE[p.status] ?? {
              label: p.status,
              className: 'bg-white/5 text-cc-text-muted border-white/10',
            };
            const modelCfg = MODEL_BADGE[p.partner_model] ?? {
              label: p.partner_model,
              className: 'bg-white/5 text-cc-text-muted border-white/10',
            };

            return (
              <button
                key={`${record.recordKind}:${p.id}`}
                onClick={() => onSelectRecord(record)}
                className="w-full text-left py-4 hover:bg-white/3 transition-colors active:scale-95 space-y-2"
              >
                {/* Title row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {p.folio && (
                      <p className="text-xs font-mono text-cc-text-muted mb-0.5">{p.folio}</p>
                    )}
                    <p className="font-semibold text-cc-text-main truncate text-sm">
                      {p.business_name}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 items-end shrink-0">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusCfg.className}`}
                    >
                      {statusCfg.label}
                    </span>
                  </div>
                </div>

                {/* Details */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-cc-text-muted">
                    <User size={12} className="flex-shrink-0" />
                    <span className="truncate">{p.responsible_name}</span>
                  </div>
                  {p.phone && (
                    <div className="flex items-center gap-2 text-xs text-cc-text-muted">
                      <Phone size={12} className="flex-shrink-0" />
                      <span className="truncate">{p.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-cc-text-muted">
                    <Store size={12} className="flex-shrink-0" />
                    <span className="truncate">{getBusinessTypeLabel(p)}</span>
                  </div>
                </div>

                {/* Model badge */}
                <div className="pt-1">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${modelCfg.className}`}
                  >
                    {modelCfg.label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Count */}
      {!loading && filtered.length > 0 && (
        <div className="px-4 py-2 text-xs text-cc-text-muted text-center">
          {filteredPartnerCount} socio{filteredPartnerCount !== 1 ? 's' : ''}
          {' · '}
          {filteredProspectCount} prospecto{filteredProspectCount !== 1 ? 's' : ''}
          {searchQuery ? ' (filtrado)' : ''}
        </div>
      )}
    </div>
  );
};
