import { MapPin, ExternalLink } from 'lucide-react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons for Vite bundler
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface CommercialPartnerMapProps {
  latitude?: number | null;
  longitude?: number | null;
  googleMapsUrl?: string | null;
  address?: string | null;
  locationNotes?: string | null;
}

export const CommercialPartnerMap = ({
  latitude,
  longitude,
  googleMapsUrl,
  address,
  locationNotes,
}: CommercialPartnerMapProps) => {
  const hasCoords = latitude != null && longitude != null;
  const hasUrl    = !!googleMapsUrl;

  // Build open-map URL: prefer OSM coords, fallback to stored URL
  const openUrl = hasCoords
    ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`
    : (googleMapsUrl ?? '');

  if (!hasCoords && !hasUrl && !address) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-cc-text-muted gap-2">
        <MapPin size={28} />
        <p className="text-sm">Ubicación no registrada</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Address text */}
      {address && (
        <div className="flex items-start gap-2 text-sm text-cc-text-main">
          <MapPin size={16} className="mt-0.5 shrink-0 text-cc-primary" />
          <span>{address}</span>
        </div>
      )}
      {locationNotes && (
        <p className="text-sm text-cc-text-muted italic">{locationNotes}</p>
      )}

      {/* Leaflet read-only map */}
      {hasCoords && (
        <div
          className="rounded-xl overflow-hidden border border-white/10"
          style={{ height: 256 }}
        >
          <MapContainer
            center={[latitude!, longitude!]}
            zoom={16}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
            zoomControl
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[latitude!, longitude!]} />
          </MapContainer>
        </div>
      )}

      {/* Open in OpenStreetMap */}
      {(hasCoords || hasUrl) && (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-cc-text-main text-sm transition-colors"
        >
          <ExternalLink size={14} />
          Abrir mapa
        </a>
      )}
    </div>
  );
};
