import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Loader2, AlertCircle } from 'lucide-react';
import { B2BPartnerMap } from './b2bReportTypes';
import {
  formatCurrency,
  formatNumber,
  getMapMarkerColor,
  formatDate,
} from './b2bReportHelpers';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface B2BMapReportProps {
  refreshTrigger?: number;
  onPartnerSelect?: (partnerId: string) => void;
}

type MarkerType = 'saldo_pendiente' | 'mayoreo' | 'comodato' | 'en_negociacion' | 'activo' | 'otro';
type MapMarkerTypeFilter = 'todos' | 'saldo_pendiente' | 'mayoreo' | 'comodato' | 'en_negociacion' | 'activo';

// Defensive marker type calculation based on business logic
const getMarkerType = (row: B2BPartnerMap): MarkerType => {
  const pending = Number(row.b2b_pending_balance || 0);
  const model = String(row.partner_model || '').toLowerCase().trim();
  const status = String(row.status || '').toLowerCase().trim();

  // Priority: saldo > model > status
  if (pending > 0) return 'saldo_pendiente';
  if (model === 'mayoreo') return 'mayoreo';
  if (model === 'comodato') return 'comodato';
  if (status === 'en_negociacion' || status === 'en negociación') return 'en_negociacion';
  if (status === 'activo' || status === 'active') return 'activo';

  return 'otro';
};

const markerColors: Record<MarkerType, string> = {
  saldo_pendiente: '#ef4444',
  mayoreo: '#3b82f6',
  comodato: '#a855f7',
  en_negociacion: '#eab308',
  activo: '#22c55e',
  otro: '#6b7280',
};

export const B2BMapReport = ({
  refreshTrigger = 0,
  onPartnerSelect,
}: B2BMapReportProps) => {
  const [partners, setPartners] = useState<B2BPartnerMap[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<B2BPartnerMap | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [markerTypeFilter, setMarkerTypeFilter] = useState<MapMarkerTypeFilter>('todos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([18.9242, -99.2216]);
  const [mapZoom, setMapZoom] = useState(12);

  const loadData = async () => {
    if (!supabase) {
      setError('Supabase no está configurado');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: dbErr } = await supabase
        .from('v_b2b_partner_map')
        .select('*');

      if (dbErr) throw dbErr;
      
      const partnerData = (data as B2BPartnerMap[]) ?? [];
      setPartners(partnerData);

      // Debug: Log all partner data with computed marker types
      console.log('B2B MAP DATA:', partnerData.map(r => ({
        folio: r.folio,
        business_name: r.business_name,
        partner_model: r.partner_model,
        status: r.status,
        pending: r.b2b_pending_balance,
        map_marker_type: r.map_marker_type,
        computed_marker_type: getMarkerType(r),
        latitude: r.latitude,
        longitude: r.longitude,
        has_coords: Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)),
      })));

      // Calculate map center
      const partnersWithCoords = partnerData.filter(
        p => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))
      );

      if (partnersWithCoords.length > 0) {
        const avgLat = partnersWithCoords.reduce((sum, p) => sum + Number(p.latitude!), 0) / partnersWithCoords.length;
        const avgLng = partnersWithCoords.reduce((sum, p) => sum + Number(p.longitude!), 0) / partnersWithCoords.length;
        setMapCenter([avgLat, avgLng]);
        setMapZoom(13);
      } else {
        setMapCenter([18.9242, -99.2216]);
        setMapZoom(12);
      }
    } catch (err: any) {
      console.error('Error loading map data:', err);
      setError('No se pudo cargar el mapa de socios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const filteredPartners = partners.filter(p => {
    const q = searchFilter.toLowerCase();
    const matchesSearch =
      p.business_name.toLowerCase().includes(q) ||
      (p.folio?.toLowerCase().includes(q) ?? false) ||
      (p.responsible_name?.toLowerCase().includes(q) ?? false);

    // Use computed marker type for filtering
    const markerType = getMarkerType(p);
    const matchesMarkerType =
      markerTypeFilter === 'todos' || markerType === markerTypeFilter;

    return matchesSearch && matchesMarkerType;
  });

  const partnersWithCoords = filteredPartners.filter(p => 
    Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))
  );

  // Calculate stats with computed marker types
  const stats = {
    total: partners.length,
    with_coords: partners.filter(p => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))).length,
    without_coords: partners.filter(p => !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude))).length,
    saldo_pendiente: partners.filter(p => getMarkerType(p) === 'saldo_pendiente' && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))).length,
    mayoreo: partners.filter(p => getMarkerType(p) === 'mayoreo' && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))).length,
    comodato: partners.filter(p => getMarkerType(p) === 'comodato' && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))).length,
  };

  const createMarkerIcon = (markerType: MarkerType) => {
    const color = markerColors[markerType];

    return L.divIcon({
      className: 'b2b-map-marker',
      html: `
        <div style="
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: ${color};
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,.35);
        "></div>
      `,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -9],
    });
  };

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

  if (partners.length === 0) {
    return (
      <div className="p-6 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-yellow-300">Sin datos</h3>
          <p className="text-sm text-yellow-200">No hay socios con ubicación registrada</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* ── Left Panel: Info & List ────────────────────────────── */}
      <div className="lg:col-span-1 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold text-cc-text-main mb-3">Socios en Mapa</h2>
          <input
            type="text"
            placeholder="Buscar socio..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className="w-full bg-cc-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-text-main placeholder-cc-text-muted focus:outline-none focus:border-cc-primary/50"
          />
        </div>

        {/* ── Filters ────────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-cc-text-muted mb-2">Tipo de marcador</p>
          <div className="space-y-2">
            <button
              onClick={() => setMarkerTypeFilter('todos')}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                markerTypeFilter === 'todos'
                  ? 'bg-cc-primary/30 border border-cc-primary/50 text-cc-primary'
                  : 'bg-cc-surface border border-white/5 hover:bg-white/10 text-cc-text-main'
              }`}
            >
              Todos
            </button>
            {(['saldo_pendiente', 'mayoreo', 'comodato', 'en_negociacion', 'activo'] as const).map(type => (
              <button
                key={type}
                onClick={() => setMarkerTypeFilter(type)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                  markerTypeFilter === type
                    ? 'bg-cc-primary/30 border border-cc-primary/50 text-cc-primary'
                    : 'bg-cc-surface border border-white/5 hover:bg-white/10 text-cc-text-main'
                }`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getMapMarkerColor(type) }}
                />
                <span className="capitalize">
                  {type === 'saldo_pendiente' ? 'Saldo pendiente' : 
                   type === 'en_negociacion' ? 'En negociación' : type}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Stats ──────────────────────────────────────────── */}
        <div className="bg-cc-surface rounded-xl border border-white/5 p-4 space-y-2">
          <div className="text-xs">
            <p className="text-cc-text-muted">Total socios</p>
            <p className="text-2xl font-bold text-cc-cream">
              {formatNumber(partners.length)}
            </p>
          </div>
          <div className="text-xs">
            <p className="text-cc-text-muted">Con ubicación</p>
            <p className="text-xl font-bold text-cc-primary">
              {formatNumber(stats.with_coords)}
            </p>
            <p className="text-xs text-cc-text-muted mt-1">
              Solo se muestran socios con ubicación guardada.
            </p>
            {stats.without_coords > 0 && (
              <p className="text-xs text-yellow-400 mt-1">
                Socios sin ubicación: {formatNumber(stats.without_coords)}
              </p>
            )}
          </div>
          <div className="border-t border-white/10 pt-2 mt-2 space-y-1">
            {[
              { type: 'saldo_pendiente' as const, label: 'Con saldo' },
              { type: 'mayoreo' as const, label: 'Mayoreo' },
              { type: 'comodato' as const, label: 'Comodato' },
            ].map(({ type, label }) => (
              <div key={type} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: markerColors[type] }}
                  />
                  <span className="text-cc-text-muted">{label}</span>
                </div>
                <span className="text-cc-cream font-semibold">
                  {formatNumber(partners.filter(p => getMarkerType(p) === type && 
                    Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))).length)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Selected Partner Info ──────────────────────────── */}
        {selectedPartner && (
          <div className="bg-cc-surface rounded-xl border border-cc-primary/30 p-4 space-y-3">
            <div>
              <h3 className="font-bold text-cc-cream text-sm mb-1">
                {selectedPartner.business_name}
              </h3>
              <p className="text-xs text-cc-text-muted">
                {selectedPartner.folio || 'Sin folio'}
              </p>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <p className="text-cc-text-muted mb-1">Responsable</p>
                <p className="text-cc-text-main">{selectedPartner.responsible_name}</p>
              </div>
              <div>
                <p className="text-cc-text-muted mb-1">Teléfono</p>
                <p className="text-cc-text-main font-mono">{selectedPartner.phone || '—'}</p>
              </div>
              <div>
                <p className="text-cc-text-muted mb-1">Dirección</p>
                <p className="text-cc-text-main">
                  {selectedPartner.address}
                  {selectedPartner.neighborhood ? `, ${selectedPartner.neighborhood}` : ''}
                  {selectedPartner.city ? `, ${selectedPartner.city}` : ''}
                </p>
              </div>
              <div>
                <p className="text-cc-text-muted mb-1">Modelo</p>
                <p className="text-cc-text-main capitalize">{selectedPartner.partner_model}</p>
              </div>
              <div>
                <p className="text-cc-text-muted mb-1">Estado</p>
                <p className="text-cc-text-main capitalize">{selectedPartner.status || '—'}</p>
              </div>
              <div>
                <p className="text-cc-text-muted mb-1">Total generado B2B</p>
                <p className="text-cc-cream font-semibold">
                  {formatCurrency(Number(selectedPartner.b2b_total_generated || 0))}
                </p>
              </div>
              <div>
                <p className="text-cc-text-muted mb-1">Saldo pendiente</p>
                <p className="text-red-400 font-semibold">
                  {formatCurrency(Number(selectedPartner.b2b_pending_balance || 0))}
                </p>
              </div>
              {selectedPartner.next_visit_date && (
                <div>
                  <p className="text-cc-text-muted mb-1">Próxima visita</p>
                  <p className="text-cc-text-main">
                    {formatDate(selectedPartner.next_visit_date)}
                    {selectedPartner.next_visit_reason ? ` - ${selectedPartner.next_visit_reason}` : ''}
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={() => onPartnerSelect?.(selectedPartner.partner_id)}
              className="w-full px-3 py-2 bg-cc-primary text-cc-bg rounded-lg font-semibold text-xs hover:bg-cc-primary-dark transition-colors"
            >
              Ver socio completo
            </button>
          </div>
        )}

        {/* ── Partners List ──────────────────────────────────── */}
        <div className="space-y-2">
          {filteredPartners.length === 0 ? (
            <p className="text-xs text-cc-text-muted p-2">Sin resultados</p>
          ) : (
            filteredPartners.map(partner => {
              const markerType = getMarkerType(partner);
              const hasCoords = Number.isFinite(Number(partner.latitude)) && Number.isFinite(Number(partner.longitude));

              return (
                <button
                  key={partner.partner_id}
                  onClick={() => setSelectedPartner(partner)}
                  className={`w-full text-left p-2 rounded-lg text-xs transition-colors ${
                    selectedPartner?.partner_id === partner.partner_id
                      ? 'bg-cc-primary/30 border border-cc-primary/50'
                      : 'bg-cc-surface border border-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: markerColors[markerType] }}
                      title={hasCoords ? `En mapa (${markerType})` : 'Sin ubicación'}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-cc-cream truncate">
                        {partner.business_name}
                      </p>
                      <div className="text-cc-text-muted truncate text-xs space-y-0.5">
                        <p>{partner.folio || 'Sin folio'}</p>
                        {partner.partner_model && (
                          <p className="capitalize">{partner.partner_model}</p>
                        )}
                      </div>
                      {!hasCoords && (
                        <p className="text-yellow-400 text-xs mt-1">Sin ubicación</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Panel: Map ──────────────────────────────────── */}
      <div className="lg:col-span-3">
        {partnersWithCoords.length === 0 ? (
          <div className="bg-cc-surface rounded-xl border border-white/5 p-4 h-96 lg:h-full flex items-center justify-center">
            <div className="text-center space-y-4">
              <AlertCircle className="w-12 h-12 text-cc-text-muted mx-auto" />
              <div>
                <h3 className="font-semibold text-cc-text-main mb-2">
                  Sin ubicaciones
                </h3>
                <p className="text-xs text-cc-text-muted max-w-xs mx-auto">
                  No hay socios con coordenadas registradas para mostrar en el mapa
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden h-96 lg:h-full">
            <MapContainer
              center={mapCenter}
              zoom={mapZoom}
              scrollWheelZoom={true}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {partnersWithCoords.map(partner => {
                const lat = Number(partner.latitude);
                const lng = Number(partner.longitude);

                if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                  return null;
                }

                const markerType = getMarkerType(partner);

                return (
                  <Marker
                    key={partner.partner_id}
                    position={[lat, lng]}
                    icon={createMarkerIcon(markerType)}
                    eventHandlers={{
                      click: () => setSelectedPartner(partner),
                    }}
                  >
                    <Popup maxWidth={300}>
                      <div className="space-y-2 text-sm">
                        <div>
                          <p className="font-bold text-cc-text-main">
                            {partner.business_name}
                          </p>
                          <p className="text-xs text-cc-text-muted">
                            {partner.folio || 'Sin folio'}
                          </p>
                        </div>
                        <div className="border-t pt-2 space-y-1 text-xs">
                          <div>
                            <p className="text-cc-text-muted">Responsable</p>
                            <p className="text-cc-text-main">{partner.responsible_name}</p>
                          </div>
                          <div>
                            <p className="text-cc-text-muted">Modelo</p>
                            <p className="text-cc-text-main capitalize">{partner.partner_model}</p>
                          </div>
                          <div>
                            <p className="text-cc-text-muted">Estado</p>
                            <p className="text-cc-text-main capitalize">{partner.status || '—'}</p>
                          </div>
                          <div>
                            <p className="text-cc-text-muted">Total generado B2B</p>
                            <p className="text-cc-cream font-semibold">
                              {formatCurrency(Number(partner.b2b_total_generated || 0))}
                            </p>
                          </div>
                          <div>
                            <p className="text-cc-text-muted">Saldo pendiente</p>
                            <p className="text-red-400 font-semibold">
                              {formatCurrency(Number(partner.b2b_pending_balance || 0))}
                            </p>
                          </div>
                          {partner.next_visit_date && (
                            <div>
                              <p className="text-cc-text-muted">Próxima visita</p>
                              <p className="text-cc-text-main">
                                {formatDate(partner.next_visit_date)}
                              </p>
                            </div>
                          )}
                          <div>
                            <p className="text-cc-text-muted">Dirección</p>
                            <p className="text-cc-text-main text-xs">
                              {partner.address}
                              {partner.neighborhood ? `, ${partner.neighborhood}` : ''}
                              {partner.city ? `, ${partner.city}` : ''}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => onPartnerSelect?.(partner.partner_id)}
                          className="w-full mt-2 px-2 py-1 bg-cc-primary text-cc-bg rounded text-xs font-semibold hover:bg-cc-primary-dark transition-colors"
                        >
                          Ver socio
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>
        )}

        {/* ── Legend ────────────────────────────────────────── */}
        <div className="mt-4 bg-cc-surface rounded-xl border border-white/5 p-4">
          <p className="text-xs font-semibold text-cc-text-muted mb-3">Leyenda de marcadores</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getMapMarkerColor('saldo_pendiente') }}
              />
              <span className="text-cc-text-muted">Saldo pendiente</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getMapMarkerColor('mayoreo') }}
              />
              <span className="text-cc-text-muted">Mayoreo</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getMapMarkerColor('comodato') }}
              />
              <span className="text-cc-text-muted">Comodato</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getMapMarkerColor('en_negociacion') }}
              />
              <span className="text-cc-text-muted">En negociación</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getMapMarkerColor('activo') }}
              />
              <span className="text-cc-text-muted">Activo</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getMapMarkerColor('otro') }}
              />
              <span className="text-cc-text-muted">Otro</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

