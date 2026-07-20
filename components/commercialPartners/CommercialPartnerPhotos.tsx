import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabase';
import {
  Camera,
  Upload,
  Trash2,
  Loader2,
  ImageOff,
  X,
} from 'lucide-react';

export interface PartnerPhoto {
  id: string;
  partner_id: string;
  photo_type: string;
  storage_bucket: string;
  storage_path: string;
  caption?: string | null;
  uploaded_by?: string | null;
  created_at?: string | null;
  signedUrl?: string | null;
}

const PHOTO_TYPES = [
  { value: 'fachada',    label: 'Fachada' },
  { value: 'interior',   label: 'Interior' },
  { value: 'exhibicion', label: 'Exhibición' },
  { value: 'anaquel',    label: 'Anaquel' },
  { value: 'otro',       label: 'Otro' },
];

// ─── Exported upload helper ──────────────────────────────────────────────────
// Can be used by CommercialPartnerForm to upload photos right after partner creation.
export const uploadPartnerPhoto = async (
  partnerId: string,
  file: File,
  photoType: string,
  caption: string | null
): Promise<void> => {
  if (!supabase) throw new Error('Supabase no configurado');
  const ext = file.name.split('.').pop() ?? 'jpg';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const storagePath = `${partnerId}/${filename}`;
  const { error: storageErr } = await supabase.storage
    .from('partner-photos')
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (storageErr) throw storageErr;
  const { error: dbErr } = await supabase.from('partner_photos').insert({
    partner_id: partnerId,
    photo_type: photoType,
    storage_bucket: 'partner-photos',
    storage_path: storagePath,
    caption: caption || null,
  });
  if (dbErr) throw dbErr;
};

interface CommercialPartnerPhotosProps {
  partnerId: string;
}

export const CommercialPartnerPhotos = ({ partnerId }: CommercialPartnerPhotosProps) => {
  const [photos, setPhotos] = useState<PartnerPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Upload state */
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState('fachada');
  const [uploadCaption, setUploadCaption] = useState('');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  /* Lightbox */
  const [lightbox, setLightbox] = useState<PartnerPhoto | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ─── Load photos ─────────────────────────────────────────────── */
  const loadPhotos = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbErr } = await supabase
        .from('partner_photos')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (dbErr) throw dbErr;

      const withUrls: PartnerPhoto[] = await Promise.all(
        (data || []).map(async (photo: PartnerPhoto) => {
          try {
            const { data: urlData } = await supabase!.storage
              .from('partner-photos')
              .createSignedUrl(photo.storage_path, 3600);
            return { ...photo, signedUrl: urlData?.signedUrl ?? null };
          } catch {
            return { ...photo, signedUrl: null };
          }
        })
      );
      setPhotos(withUrls);
    } catch (e: any) {
      setError(e?.message || 'Error al cargar fotografías');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  /* ─── File picker ─────────────────────────────────────────────── */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('Solo se permiten imágenes');
      return;
    }
    setPreviewFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadError(null);
  };

  const clearFile = () => {
    setPreviewFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /* ─── Upload ──────────────────────────────────────────────────── */
  const handleUpload = async () => {
    if (!supabase || !previewFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const ext = previewFile.name.split('.').pop() ?? 'jpg';
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const storagePath = `${partnerId}/${filename}`;

      const { error: storageErr } = await supabase.storage
        .from('partner-photos')
        .upload(storagePath, previewFile, { contentType: previewFile.type, upsert: false });

      if (storageErr) throw storageErr;

      const { error: dbErr } = await supabase.from('partner_photos').insert({
        partner_id: partnerId,
        photo_type: uploadType,
        storage_bucket: 'partner-photos',
        storage_path: storagePath,
        caption: uploadCaption.trim() || null,
      });

      if (dbErr) throw dbErr;

      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 2500);
      setShowUploadForm(false);
      setUploadCaption('');
      setUploadType('fachada');
      clearFile();
      await loadPhotos();
    } catch (e: any) {
      setUploadError(e?.message || 'Error al subir fotografía');
    } finally {
      setUploading(false);
    }
  };

  /* ─── Delete photo ─────────────────────────────────────────────── */
  const handleDelete = async (photo: PartnerPhoto) => {
    if (!supabase) return;
    if (!confirm('¿Eliminar esta fotografía? Esta acción no se puede deshacer.')) return;
    try {
      await supabase.storage.from('partner-photos').remove([photo.storage_path]);
      await supabase.from('partner_photos').delete().eq('id', photo.id);
      setPhotos(prev => prev.filter(p => p.id !== photo.id));
    } catch (e: any) {
      setError(e?.message || 'Error al eliminar fotografía');
    }
  };

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-cc-text-muted uppercase tracking-wider flex items-center gap-2">
          <Camera size={16} />
          Fotografías del lugar
        </h3>
        <button
          onClick={() => {
            setShowUploadForm(v => !v);
            setUploadError(null);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cc-primary/10 hover:bg-cc-primary/20 border border-cc-primary/30 text-cc-primary text-xs font-medium transition-colors"
        >
          <Upload size={13} />
          Subir foto
        </button>
      </div>

      {/* Upload success */}
      {uploadSuccess && (
        <div className="rounded-lg bg-green-500/15 border border-green-500/30 text-green-300 text-sm px-4 py-2">
          ✓ Fotografía subida exitosamente
        </div>
      )}

      {/* Upload form */}
      {showUploadForm && (
        <div className="rounded-xl bg-cc-surface border border-white/10 p-4 space-y-3">
          <p className="text-sm font-medium text-cc-text-main">Nueva fotografía</p>

          {/* File picker */}
          {!previewFile ? (
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-white/15 rounded-lg py-8 cursor-pointer hover:border-cc-primary/40 transition-colors text-cc-text-muted text-sm">
              <Upload size={22} />
              <span>Seleccionar imagen</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          ) : (
            <div className="relative">
              <img
                src={previewUrl!}
                alt="Preview"
                className="w-full max-h-48 object-cover rounded-lg border border-white/10"
              />
              <button
                onClick={clearFile}
                className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white hover:bg-red-500/70 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Type */}
          <div>
            <label className="block text-xs text-cc-text-muted mb-1">Tipo de foto</label>
            <select
              value={uploadType}
              onChange={e => setUploadType(e.target.value)}
              className="w-full bg-cc-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-text-main focus:outline-none focus:border-cc-primary/50"
            >
              {PHOTO_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Caption */}
          <div>
            <label className="block text-xs text-cc-text-muted mb-1">Descripción (opcional)</label>
            <input
              type="text"
              value={uploadCaption}
              onChange={e => setUploadCaption(e.target.value)}
              placeholder="Ej. Entrada principal, vista frontal..."
              className="w-full bg-cc-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-text-main focus:outline-none focus:border-cc-primary/50"
            />
          </div>

          {uploadError && (
            <p className="text-red-400 text-xs">{uploadError}</p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowUploadForm(false); clearFile(); setUploadError(null); }}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-cc-text-muted hover:bg-white/5 text-sm transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleUpload}
              disabled={!previewFile || uploading}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cc-primary text-cc-bg font-semibold text-sm hover:bg-cc-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? 'Subiendo...' : 'Subir'}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 size={22} className="animate-spin text-cc-primary" />
        </div>
      )}

      {/* Empty state */}
      {!loading && photos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-cc-text-muted">
          <ImageOff size={28} />
          <p className="text-sm">Sin fotografías</p>
          <p className="text-xs">Usa el botón "Subir foto" para agregar la primera imagen</p>
        </div>
      )}

      {/* Photo grid */}
      {!loading && photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map(photo => (
            <div
              key={photo.id}
              className="relative group rounded-xl overflow-hidden border border-white/10 cursor-pointer bg-black/20"
              onClick={() => setLightbox(photo)}
            >
              {photo.signedUrl ? (
                <img
                  src={photo.signedUrl}
                  alt={photo.caption || photo.photo_type}
                  className="w-full h-32 object-cover"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-full h-32 flex items-center justify-center bg-cc-surface text-cc-text-muted">
                  <ImageOff size={20} />
                </div>
              )}

              {/* Overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex flex-col justify-end">
                <div className="p-2 translate-y-full group-hover:translate-y-0 transition-transform">
                  <span className="text-xs font-medium text-white bg-black/60 rounded px-1.5 py-0.5 capitalize">
                    {PHOTO_TYPES.find(t => t.value === photo.photo_type)?.label ?? photo.photo_type}
                  </span>
                </div>
              </div>

              {/* Delete button */}
              <button
                onClick={e => { e.stopPropagation(); handleDelete(photo); }}
                className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500/80 transition-all"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Photo count */}
      {!loading && photos.length > 0 && (
        <p className="text-xs text-cc-text-muted">{photos.length} fotografía{photos.length !== 1 ? 's' : ''}</p>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-10 right-0 text-white hover:text-cc-primary transition-colors"
            >
              <X size={24} />
            </button>
            {lightbox.signedUrl ? (
              <img
                src={lightbox.signedUrl}
                alt={lightbox.caption || lightbox.photo_type}
                className="w-full max-h-[80vh] object-contain rounded-lg"
              />
            ) : (
              <div className="flex items-center justify-center h-64 text-cc-text-muted">
                <ImageOff size={32} />
              </div>
            )}
            {lightbox.caption && (
              <p className="mt-3 text-center text-sm text-cc-text-muted">{lightbox.caption}</p>
            )}
            <p className="mt-1 text-center text-xs text-cc-text-muted/60 capitalize">
              {PHOTO_TYPES.find(t => t.value === lightbox.photo_type)?.label ?? lightbox.photo_type}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
