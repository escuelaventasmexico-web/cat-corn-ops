import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, Loader2, MapPin, AlertCircle } from 'lucide-react';

// ── Fix Leaflet default marker icons for Vite bundler ─────────────────────────
// (Vite doesn't resolve leaflet's relative image paths automatically)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Types ─────────────────────────────────────────────────────────────────────
export interface OSMLocationResult {
  latitude: number;
  longitude: number;
  /** Full display name from Nominatim */
  formatted_address: string;
  /** OSM URL — stored in google_maps_url column for DB compat */
  google_maps_url: string;
  map_provider: 'openstreetmap';
  osm_place_id: string | null;
  osm_type: string | null;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  osm_type: string;
  osm_id: number;
  type: string;
}

interface OpenStreetMapPickerProps {
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  initialAddress?: string | null;
  onLocationSelect: (result: OSMLocationResult) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_CENTER: [number, number] = [18.9261, -99.2306]; // Cuernavaca, Morelos
const DEFAULT_ZOOM  = 13;
const SELECTED_ZOOM = 17;

const buildOsmUrl = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

// ── Inner component: handles map events + programmatic fly-to ─────────────────
// Must live inside <MapContainer> to use react-leaflet hooks.
const MapController = ({
  flyToLat,
  flyToLng,
  onMapClick,
}: {
  flyToLat: number | null;
  flyToLng: number | null;
  onMapClick: (lat: number, lng: number) => void;
}) => {
  const map = useMap();
  const isFirst = useRef(true);

  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });

  useEffect(() => {
    // Skip the initial mount so we don't double-center on load
    if (isFirst.current) { isFirst.current = false; return; }
    if (flyToLat !== null && flyToLng !== null) {
      map.setView([flyToLat, flyToLng], SELECTED_ZOOM, { animate: true });
    }
  }, [flyToLat, flyToLng, map]);

  return null;
};

// ── Main component ────────────────────────────────────────────────────────────
export const OpenStreetMapPicker = ({
  initialLatitude,
  initialLongitude,
  initialAddress,
  onLocationSelect,
}: OpenStreetMapPickerProps) => {
  const hasInitial = initialLatitude != null && initialLongitude != null;

  const [searchQuery,    setSearchQuery]    = useState(initialAddress ?? '');
  const [results,        setResults]        = useState<NominatimResult[]>([]);
  const [searching,      setSearching]      = useState(false);
  const [searchError,    setSearchError]    = useState<string | null>(null);

  const [markerPos,      setMarkerPos]      = useState<[number, number] | null>(
    hasInitial ? [initialLatitude!, initialLongitude!] : null
  );
  // Separate state for the fly-to trigger (primitive values to avoid array identity issues)
  const [flyLat,         setFlyLat]         = useState<number | null>(null);
  const [flyLng,         setFlyLng]         = useState<number | null>(null);
  const [manuallyAdj,    setManuallyAdj]    = useState(false);

  // ── Nominatim search ──────────────────────────────────────────────────────
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;

    setSearching(true);
    setSearchError(null);
    setResults([]);

    try {
      // Add Cuernavaca/Morelos context if the query has no Mexico geo reference
      const enriched = /m[eé]xico|morelos|cuernavaca|jalisco|cdmx|ciudad de m|veracruz|monterrey|guadalajara/i.test(q)
        ? q
        : `${q}, Cuernavaca, Morelos, México`;

      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', enriched);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '5');
      url.searchParams.set('countrycodes', 'mx');
      url.searchParams.set('accept-language', 'es');

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Error del servidor de búsqueda');

      const data: NominatimResult[] = await res.json();
      if (data.length === 0) {
        setSearchError('No encontramos resultados. Intenta con una dirección más específica.');
      } else {
        setResults(data);
      }
    } catch {
      setSearchError(
        'No se pudo buscar la ubicación. Puedes colocar el pin manualmente en el mapa.'
      );
    } finally {
      setSearching(false);
    }
  };

  // ── Select a Nominatim result ─────────────────────────────────────────────
  const handleSelectResult = (r: NominatimResult) => {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);

    setMarkerPos([lat, lng]);
    setFlyLat(lat);
    setFlyLng(lng);
    setResults([]);
    setManuallyAdj(false);

    onLocationSelect({
      latitude:          lat,
      longitude:         lng,
      formatted_address: r.display_name,
      google_maps_url:   buildOsmUrl(lat, lng),
      map_provider:      'openstreetmap',
      osm_place_id:      String(r.place_id),
      osm_type:          r.osm_type,
    });
  };

  // ── Map click / pin drag ──────────────────────────────────────────────────
  const handleMapClick = (lat: number, lng: number) => {
    setMarkerPos([lat, lng]);
    setManuallyAdj(true);

    onLocationSelect({
      latitude:          lat,
      longitude:         lng,
      formatted_address: '',
      google_maps_url:   buildOsmUrl(lat, lng),
      map_provider:      'openstreetmap',
      osm_place_id:      null,
      osm_type:          null,
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* Search bar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setSearchError(null); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
          placeholder="Buscar negocio, dirección o referencia..."
          className="flex-1 bg-white border border-[#c49330] rounded-lg px-3 py-2 text-sm text-[#111111] placeholder:text-gray-400 focus:outline-none focus:border-[#7a4a0a] transition-colors"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching || !searchQuery.trim()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2d1a00] text-[#F6E7C1] text-sm font-medium hover:bg-[#1a0f00] transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {searching
            ? <Loader2 size={14} className="animate-spin" />
            : <Search size={14} />
          }
          {searching ? 'Buscando…' : 'Buscar ubicación'}
        </button>
      </div>

      {/* Search error */}
      {searchError && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 text-amber-800 text-xs">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{searchError}</span>
        </div>
      )}

      {/* Results list */}
      {results.length > 0 && (
        <ul className="rounded-lg border border-[#c49330] bg-white divide-y divide-gray-100 max-h-44 overflow-y-auto shadow-lg">
          {results.map(r => (
            <li key={r.place_id}>
              <button
                type="button"
                onClick={() => handleSelectResult(r)}
                className="w-full text-left px-3 py-2.5 hover:bg-amber-50 transition-colors flex items-start gap-2"
              >
                <MapPin size={14} className="mt-0.5 shrink-0 text-[#a87820]" />
                <span className="text-sm text-[#111111] leading-snug">{r.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Leaflet map */}
      <div
        className="rounded-xl overflow-hidden border border-[#c49330]"
        style={{ height: 300 }}
      >
        <MapContainer
          center={markerPos ?? DEFAULT_CENTER}
          zoom={hasInitial ? SELECTED_ZOOM : DEFAULT_ZOOM}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {markerPos && (
            <Marker
              position={markerPos}
              draggable
              eventHandlers={{
                dragend(e) {
                  const pos = (e.target as L.Marker).getLatLng();
                  handleMapClick(pos.lat, pos.lng);
                },
              }}
            />
          )}
          <MapController
            flyToLat={flyLat}
            flyToLng={flyLng}
            onMapClick={handleMapClick}
          />
        </MapContainer>
      </div>

      {/* Status line */}
      <p className="text-xs text-[#4a2c0a]">
        {markerPos
          ? manuallyAdj
            ? `📍 Ubicación ajustada manualmente · ${markerPos[0].toFixed(5)}, ${markerPos[1].toFixed(5)}`
            : `✓ Ubicación seleccionada · ${markerPos[0].toFixed(5)}, ${markerPos[1].toFixed(5)}`
          : 'Busca una dirección o haz clic en el mapa para fijar el pin'}
      </p>
    </div>
  );
};
