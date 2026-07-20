import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabase';
import { Upload, Check, AlertCircle, Loader } from 'lucide-react';
import { LABEL_CLS, CARD_CLS, ALLOWED_IMAGE_TYPES, ALLOWED_IMAGE_EXTENSIONS, MAX_DOCUMENT_SIZE, generateDocumentPath } from './types';

interface Props {
  partnerId: string;
  onUploaded: (paths: { ine_front_path: string; ine_back_path: string; business_photo_path: string }) => void;
  onError: (error: string) => void;
}

interface DocumentUpload {
  type: 'ine_front' | 'ine_back' | 'business_photo';
  label: string;
  file?: File;
  preview?: string;
  uploading?: boolean;
  uploaded?: boolean;
  path?: string;
  documentId?: string;
}

const WholesaleDocumentsUploader: React.FC<Props> = ({ partnerId, onUploaded, onError }) => {
  const [documents, setDocuments] = useState<DocumentUpload[]>([
    { type: 'ine_front', label: 'INE Frente (requerido)' },
    { type: 'ine_back', label: 'INE Reverso (requerido)' },
    { type: 'business_photo', label: 'Foto del Negocio (requerido)' },
  ]);
  const [loading, setLoading] = useState(true);

  // Load existing documents from Supabase
  useEffect(() => {
    const loadExistingDocuments = async () => {
      try {
        if (!supabase) return;

        const { data, error } = await supabase
          .from('commercial_partner_documents')
          .select('*')
          .eq('partner_id', partnerId)
          .in('document_type', ['ine_front', 'ine_back', 'business_photo']);

        if (error) throw error;

        if (data && data.length > 0) {
          setDocuments(prev =>
            prev.map(doc => {
              const existing = data.find(d => d.document_type === doc.type);
              if (existing) {
                return {
                  ...doc,
                  uploaded: true,
                  path: existing.storage_path,
                  documentId: existing.id,
                };
              }
              return doc;
            })
          );
        }
      } catch (err: any) {
        console.error('Error loading documents:', err);
      } finally {
        setLoading(false);
      }
    };

    loadExistingDocuments();
  }, [partnerId]);

  const handleFileSelect = async (type: 'ine_front' | 'ine_back' | 'business_photo', file: File) => {
    // Validation
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      onError(`Formato de archivo no permitido para ${type}. Usa JPG, PNG o WebP.`);
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE) {
      onError(`El archivo es demasiado grande. Máximo 5 MB.`);
      return;
    }

    // Preview
    const reader = new FileReader();
    reader.onload = e => {
      setDocuments(prev =>
        prev.map(d =>
          d.type === type
            ? {
                ...d,
                file,
                preview: e.target?.result as string,
              }
            : d,
        ),
      );
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async (type: 'ine_front' | 'ine_back' | 'business_photo') => {
    const doc = documents.find(d => d.type === type);
    if (!doc || !doc.file) {
      onError('No hay archivo seleccionado');
      return;
    }

    setDocuments(prev =>
      prev.map(d =>
        d.type === type ? { ...d, uploading: true } : d,
      ),
    );

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const path = generateDocumentPath(partnerId, type, doc.file.name);

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('partner-documents')
        .upload(path, doc.file, { upsert: true });

      if (uploadError) throw uploadError;

      // Create or update record in commercial_partner_documents
      let documentRecord;

      if (doc.documentId) {
        // Update existing record
        const { data, error: updateError } = await supabase
          .from('commercial_partner_documents')
          .update({
            storage_path: path,
            file_name: doc.file.name,
            mime_type: doc.file.type,
            updated_at: new Date().toISOString(),
          })
          .eq('id', doc.documentId)
          .select()
          .single();

        if (updateError) throw updateError;
        documentRecord = data;
      } else {
        // Create new record
        const { data, error: insertError } = await supabase
          .from('commercial_partner_documents')
          .insert({
            partner_id: partnerId,
            document_type: type,
            storage_bucket: 'partner-documents',
            storage_path: path,
            file_name: doc.file.name,
            mime_type: doc.file.type,
          })
          .select()
          .single();

        if (insertError) throw insertError;
        documentRecord = data;
      }

      setDocuments(prev =>
        prev.map(d =>
          d.type === type
            ? {
                ...d,
                uploading: false,
                uploaded: true,
                path,
                documentId: documentRecord?.id,
              }
            : d,
        ),
      );
    } catch (err: any) {
      onError(err.message || 'Error al subir documento');
      setDocuments(prev =>
        prev.map(d =>
          d.type === type ? { ...d, uploading: false } : d,
        ),
      );
    }
  };

  const handleRemove = (type: 'ine_front' | 'ine_back' | 'business_photo') => {
    setDocuments(prev =>
      prev.map(d =>
        d.type === type
          ? { ...d, file: undefined, preview: undefined, uploaded: false, path: undefined, documentId: undefined }
          : d,
      ),
    );
  };

  // Check if all uploaded
  const allUploaded = documents.every(d => d.uploaded && d.path);

  useEffect(() => {
    if (allUploaded) {
      onUploaded({
        ine_front_path: documents.find(d => d.type === 'ine_front')?.path || '',
        ine_back_path: documents.find(d => d.type === 'ine_back')?.path || '',
        business_photo_path: documents.find(d => d.type === 'business_photo')?.path || '',
      });
    }
  }, [allUploaded, documents, onUploaded]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader className="w-6 h-6 animate-spin text-[#D6A23A]" />
      </div>
    );
  }

  const missingDocuments = documents.filter(d => !d.uploaded);
  const shouldShowMissingMessage = missingDocuments.length > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6b7280]">
        Sube los documentos requeridos. Formatos: JPG, PNG, WebP. Máximo 5 MB cada uno.
      </p>

      {documents.map(doc => (
        <div key={doc.type} className={CARD_CLS}>
          <div className="flex items-center justify-between mb-3">
            <label className={LABEL_CLS}>{doc.label}</label>
            {doc.uploaded && (
              <div className="flex items-center gap-1 px-2 py-1 bg-green-50 rounded-lg">
                <Check className="w-4 h-4 text-green-600" />
                <span className="text-xs text-green-700 font-medium">Cargado</span>
              </div>
            )}
            {!doc.uploaded && !doc.preview && (
              <div className="flex items-center gap-1 px-2 py-1 bg-amber-50 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span className="text-xs text-amber-700 font-medium">Pendiente</span>
              </div>
            )}
          </div>

          {doc.uploaded ? (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-300 rounded-lg">
              <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm text-green-800 font-medium">Documento cargado correctamente</p>
                <p className="text-xs text-green-700 mt-1">{doc.file?.name || 'Archivo guardado'}</p>
              </div>
            </div>
          ) : doc.preview ? (
            <div className="space-y-3">
              <img
                src={doc.preview}
                alt="preview"
                className="w-full max-h-48 object-cover rounded-lg border border-[#e8d5a0]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleUpload(doc.type)}
                  disabled={doc.uploading}
                  className="flex-1 px-3 py-2 bg-[#D6A23A] text-[#111111] font-semibold rounded-lg hover:bg-[#c49330] disabled:opacity-50 transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {doc.uploading ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      Subiendo...
                    </>
                  ) : (
                    'Subir documento'
                  )}
                </button>
                <button
                  onClick={() => handleRemove(doc.type)}
                  disabled={doc.uploading}
                  className="px-3 py-2 bg-white border border-[#c49330] text-[#111111] font-semibold rounded-lg hover:bg-[#f5e9c8] disabled:opacity-50 transition-colors text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <label className="flex items-center justify-center w-full p-6 border-2 border-dashed border-[#c49330] rounded-lg cursor-pointer hover:bg-[#fffbf0] transition-colors">
              <div className="text-center">
                <Upload className="w-8 h-8 text-[#7a4a0a] mx-auto mb-2" />
                <p className="text-sm font-medium text-[#111111]">Haz clic para seleccionar archivo</p>
                <p className="text-xs text-[#666666] mt-1">JPG, PNG o WebP (máx. 5 MB)</p>
              </div>
              <input
                type="file"
                accept={ALLOWED_IMAGE_EXTENSIONS.map(ext => `.${ext}`).join(',')}
                onChange={e => {
                  const file = e.currentTarget.files?.[0];
                  if (file) handleFileSelect(doc.type, file);
                }}
                className="hidden"
              />
            </label>
          )}
        </div>
      ))}

      {shouldShowMissingMessage && (
        <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">Para continuar debes subir:</p>
            <ul className="mt-1 space-y-1 ml-4 list-disc">
              {missingDocuments.map(d => (
                <li key={d.type}>{d.label}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default WholesaleDocumentsUploader;
