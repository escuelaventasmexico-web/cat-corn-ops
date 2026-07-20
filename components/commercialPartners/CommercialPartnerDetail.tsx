import { useState } from 'react';
import {
  X,
  Pencil,
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  Clock,
  CalendarDays,
  StickyNote,
  Store,
  Hash,
  Calendar,
  User,
  Info,
} from 'lucide-react';
import {
  CommercialPartner,
  BUSINESS_TYPES,
  STATUS_BADGE,
  MODEL_BADGE,
} from './types';
import { CommercialPartnerMap } from './CommercialPartnerMap';
import { CommercialPartnerPhotos } from './CommercialPartnerPhotos';
import { CommercialPartnerForm } from './CommercialPartnerForm';
import CommercialPartnerComodato from './comodato/CommercialPartnerComodato';
import CommercialPartnerWholesale from './wholesale/CommercialPartnerWholesale';
import { CommercialB2BSummary } from './CommercialB2BSummary';

type DetailTab = 'resumen' | 'ubicacion' | 'fotos' | 'comodato' | 'mayoreo';

interface CommercialPartnerDetailProps {
  partner: CommercialPartner;
  onClose: () => void;
  onUpdated: (updated: CommercialPartner) => void;
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const InfoRow = ({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value?: string | null;
}) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-[#7a4a0a] shrink-0">
        <Icon size={15} />
      </div>
      <div>
        <p className="text-xs text-[#6b7280]">{label}</p>
        <p className="text-sm text-[#111111]">{value}</p>
      </div>
    </div>
  );
};

export const CommercialPartnerDetail = ({
  partner: initialPartner,
  onClose,
  onUpdated,
}: CommercialPartnerDetailProps) => {
  const [partner, setPartner] = useState(initialPartner);
  const [activeTab, setActiveTab] = useState<DetailTab>('resumen');
  const [showEditForm, setShowEditForm] = useState(false);

  const statusCfg = STATUS_BADGE[partner.status] ?? {
    label: partner.status,
    className: 'bg-white/5 text-cc-text-muted border-white/10',
  };
  const modelCfg = MODEL_BADGE[partner.partner_model] ?? {
    label: partner.partner_model,
    className: 'bg-white/5 text-cc-text-muted border-white/10',
  };
  // Badge classes tuned for mustard (#D6A23A) background
  const BADGE_STATUS_MUSTARD: Record<string, string> = {
    prospecto:      'bg-blue-100 text-blue-800 border-blue-300',
    en_negociacion: 'bg-amber-100 text-amber-900 border-amber-500',
    activo:         'bg-green-100 text-green-800 border-green-300',
    pausado:        'bg-orange-100 text-orange-800 border-orange-300',
    rechazado:      'bg-red-100 text-red-800 border-red-300',
    inactivo:       'bg-gray-200 text-gray-700 border-gray-400',
  };
  const BADGE_MODEL_MUSTARD: Record<string, string> = {
    prospecto: 'bg-purple-100 text-purple-800 border-purple-300',
    comodato:  'bg-yellow-50  text-yellow-900 border-yellow-500',
    mayoreo:   'bg-teal-100   text-teal-800   border-teal-300',
  };
  const statusBadgeClass = BADGE_STATUS_MUSTARD[partner.status] ?? 'bg-gray-200 text-gray-700 border-gray-400';
  const modelBadgeClass  = BADGE_MODEL_MUSTARD[partner.partner_model] ?? 'bg-gray-200 text-gray-700 border-gray-400';
  const businessTypeLabel =
    partner.business_type === 'otro'
      ? partner.business_type_other || 'Otro'
      : BUSINESS_TYPES.find(b => b.value === partner.business_type)?.label ?? partner.business_type;

  // ── Comodato access rules ────────────────────────────────────────────────
  const COMODATO_ALLOWED_STATUSES = ['activo', 'pausado', 'inactivo'];
  const comodatoAllowed = COMODATO_ALLOWED_STATUSES.includes(partner.status);
  const mayoreoAllowed = partner.partner_model === 'mayoreo' || partner.wholesale_status === 'active';

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'resumen',   label: 'Resumen' },
    { id: 'ubicacion', label: 'Ubicación' },
    { id: 'fotos',      label: 'Fotografías' },
    ...(comodatoAllowed ? [{ id: 'comodato' as DetailTab, label: 'Comodato' }] : []),
    ...(mayoreoAllowed ? [{ id: 'mayoreo' as DetailTab, label: 'Mayoreo' }] : []),
  ];

  const handleSaved = (updated: CommercialPartner) => {
    setPartner(updated);
    onUpdated(updated);
    setShowEditForm(false);
    // Reset to resumen if comodato tab was active but new status no longer allows it
    if (activeTab === 'comodato' && !['activo', 'pausado', 'inactivo'].includes(updated.status)) {
      setActiveTab('resumen');
    }
  };

  /* ─── Full address string ─────────────────────────────────── */
  const buildAddress = () => {
    const parts = [
      partner.address,
      partner.neighborhood,
      partner.city,
      partner.state,
      partner.postal_code,
    ].filter(Boolean);
    return parts.join(', ') || null;
  };

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/70 flex items-start justify-end">
        <div className="w-full max-w-xl h-full bg-[#D6A23A] border-l border-[#a87820] flex flex-col shadow-[−8px_0_50px_rgba(0,0,0,0.7)] overflow-hidden">
          {/* ── Header ─────────────────────────────────────────── */}
          <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-black/20 gap-4">
            <div className="flex-1 min-w-0">
              {partner.folio && (
                <p className="text-xs text-[#4a2c0a] font-mono mb-0.5">{partner.folio}</p>
              )}
              <h2 className="text-lg font-bold text-[#111111] leading-tight truncate">
                {partner.business_name}
              </h2>
              <p className="text-sm text-[#374151] mt-0.5">{partner.responsible_name}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusBadgeClass}`}
                >
                  {statusCfg.label}
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${modelBadgeClass}`}
                >
                  {modelCfg.label}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowEditForm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2d1a00] hover:bg-[#1a0f00] border border-[#2d1a00] text-[#F6E7C1] text-xs font-medium transition-colors"
              >
                <Pencil size={13} />
                Editar
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-[#1f2937] hover:bg-black/10 hover:text-black transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* ── Tabs ───────────────────────────────────────────── */}
          <div className="flex border-b border-black/20 px-4">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-[#2d1a00] text-[#111111] font-semibold'
                    : 'border-transparent text-[#4a2c0a] hover:text-[#111111]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab content ────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {/* RESUMEN */}
            {activeTab === 'resumen' && (
              <div className="space-y-5">
                {/* Identificación */}
                <div className="rounded-xl bg-[#fff8e6] border border-[#c49330] p-4 space-y-3">
                  <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
                    Identificación
                  </p>
                  {partner.folio && (
                    <InfoRow icon={Hash} label="Folio" value={partner.folio} />
                  )}
                  <InfoRow icon={Store} label="Negocio" value={partner.business_name} />
                  <InfoRow icon={User} label="Responsable" value={partner.responsible_name} />
                  <InfoRow icon={Store} label="Giro" value={businessTypeLabel} />
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-[#7a4a0a] shrink-0">
                      <Calendar size={15} />
                    </div>
                    <div>
                      <p className="text-xs text-[#6b7280]">Fecha de alta</p>
                      <p className="text-sm text-[#111111]">{fmtDate(partner.created_at)}</p>
                    </div>
                  </div>
                </div>

                {/* Contacto */}
                <div className="rounded-xl bg-[#fff8e6] border border-[#c49330] p-4 space-y-3">
                  <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
                    Contacto
                  </p>
                  {partner.phone ? (
                    <a
                      href={`tel:${partner.phone}`}
                      className="flex items-start gap-3 hover:text-[#4a2c0a] transition-colors group"
                    >
                      <Phone size={15} className="mt-0.5 text-[#7a4a0a] shrink-0" />
                      <div>
                        <p className="text-xs text-[#6b7280]">Teléfono</p>
                        <p className="text-sm text-[#111111] group-hover:text-[#4a2c0a] transition-colors">
                          {partner.phone}
                        </p>
                      </div>
                    </a>
                  ) : null}
                  {partner.whatsapp ? (
                    <a
                      href={`https://wa.me/${partner.whatsapp?.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 hover:text-green-800 transition-colors group"
                    >
                      <MessageCircle size={15} className="mt-0.5 text-green-700 shrink-0" />
                      <div>
                        <p className="text-xs text-[#6b7280]">WhatsApp</p>
                        <p className="text-sm text-[#111111] group-hover:text-green-800 transition-colors">
                          {partner.whatsapp}
                        </p>
                      </div>
                    </a>
                  ) : null}
                  {partner.email ? (
                    <a
                      href={`mailto:${partner.email}`}
                      className="flex items-start gap-3 hover:text-[#4a2c0a] transition-colors group"
                    >
                      <Mail size={15} className="mt-0.5 text-[#7a4a0a] shrink-0" />
                      <div>
                        <p className="text-xs text-[#6b7280]">Correo</p>
                        <p className="text-sm text-[#111111] group-hover:text-[#4a2c0a] transition-colors break-all">
                          {partner.email}
                        </p>
                      </div>
                    </a>
                  ) : null}
                  {!partner.phone && !partner.whatsapp && !partner.email && (
                    <p className="text-sm text-[#6b7280] italic">Sin datos de contacto</p>
                  )}
                </div>

                {/* Resumen comercial B2B */}
                <CommercialB2BSummary partnerId={partner.id} />

                {/* Operación */}
                {(partner.opening_hours || partner.preferred_visit_days) && (
                  <div className="rounded-xl bg-[#fff8e6] border border-[#c49330] p-4 space-y-3">
                    <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
                      Operación
                    </p>
                    <InfoRow icon={Clock} label="Horario de atención" value={partner.opening_hours} />
                    <InfoRow
                      icon={CalendarDays}
                      label="Días recomendados para visita"
                      value={partner.preferred_visit_days}
                    />
                  </div>
                )}

                {/* Notas */}
                {partner.notes && (
                  <div className="rounded-xl bg-[#fff8e6] border border-[#c49330] p-4 space-y-2">
                    <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider flex items-center gap-1.5">
                      <StickyNote size={12} />
                      Notas internas
                    </p>
                    <p className="text-sm text-[#111111] whitespace-pre-wrap">{partner.notes}</p>
                  </div>
                )}

                {/* Info: comodato not available for this status */}
                {!comodatoAllowed && (
                  <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 flex items-start gap-2">
                    <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700">
                      Los movimientos comerciales estarán disponibles cuando el socio esté activo.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* UBICACIÓN */}
            {activeTab === 'ubicacion' && (
              <div className="space-y-4">
                <div className="rounded-xl bg-[#fff8e6] border border-[#c49330] p-4 space-y-3">
                  {buildAddress() && (
                    <InfoRow icon={MapPin} label="Dirección completa" value={buildAddress()} />
                  )}
                  {partner.location_notes && (
                    <InfoRow icon={StickyNote} label="Referencias" value={partner.location_notes} />
                  )}
                </div>
                <CommercialPartnerMap
                  latitude={partner.latitude}
                  longitude={partner.longitude}
                  googleMapsUrl={partner.google_maps_url}
                  address={buildAddress()}
                  locationNotes={partner.location_notes}
                />
              </div>
            )}

            {/* FOTOGRAFÍAS */}
            {activeTab === 'fotos' && (
              <CommercialPartnerPhotos partnerId={partner.id} />
            )}

            {/* COMODATO */}
            {activeTab === 'comodato' && comodatoAllowed && (
              <CommercialPartnerComodato partnerId={partner.id} partnerStatus={partner.status} />
            )}

            {/* MAYOREO */}
            {activeTab === 'mayoreo' && mayoreoAllowed && (
              <CommercialPartnerWholesale partnerId={partner.id} />
            )}
          </div>
        </div>
      </div>

      {/* Edit form on top of detail */}
      {showEditForm && (
        <CommercialPartnerForm
          partner={partner}
          onClose={() => setShowEditForm(false)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
};
