import React, { useState } from 'react';
import { supabase } from '../../../supabase';
import { Upload, Check } from 'lucide-react';
import { CARD_CLS, ALLOWED_IMAGE_TYPES, ALLOWED_IMAGE_EXTENSIONS, MAX_DOCUMENT_SIZE, generateDocumentPath } from './types';

interface Props {
  partnerId: string;
  contractId?: string;
  onUploaded: (path: string) => void;
  onError: (error: string) => void;
}

const WholesaleSignedUploader: React.FC<Props> = ({ partnerId, contractId, onUploaded, onError }) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  const handleFileSelect = (selectedFile: File) => {
    if (!ALLOWED_IMAGE_TYPES.includes(selectedFile.type)) {
      onError('Formato no permitido. Usa JPG, PNG o WebP.');
      return;
    }
    if (selectedFile.size > MAX_DOCUMENT_SIZE) {
      onError('Archivo demasiado grande. Máximo 5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      setPreview(e.target?.result as string);
      setFile(selectedFile);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;
    if (!supabase) {
      onError('Supabase no configurado');
      return;
    }

    setUploading(true);
    try {
      const path = generateDocumentPath(partnerId, 'signed_contract_photo', file.name);
      const { error: uploadError } = await supabase.storage
        .from('partner-documents')
        .upload(path, file);

      if (uploadError) throw uploadError;

      // Registrar documento
      await supabase.from('commercial_partner_documents').insert({
        partner_id: partnerId,
        contract_id: contractId,
        document_type: 'signed_contract_photo',
        storage_bucket: 'partner-documents',
        storage_path: path,
      });

      // Actualizar contrato
      if (contractId) {
        await supabase
          .from('commercial_partner_contracts')
          .update({ signed_contract_storage_path: path })
          .eq('id', contractId);
      }

      setUploaded(true);
      onUploaded(path);
    } catch (err: any) {
      onError(err.message || 'Error al subir contrato firmado');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    setFile(null);
    setPreview(null);
    setUploaded(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6b7280]">
        Imprime el contrato, firma físicamente con el socio, toma una foto clara del contrato firmado y súbela aquí.
      </p>

      {uploaded ? (
        <div className={`${CARD_CLS} bg-green-50 border-green-300`}>
          <div className="flex items-center gap-2">
            <Check className="w-5 h-5 text-green-600" />
            <p className="text-sm font-semibold text-green-900">Contrato firmado subido correctamente</p>
          </div>
        </div>
      ) : preview ? (
        <div className={CARD_CLS}>
          <img
            src={preview}
            alt="preview"
            className="w-full max-h-48 object-cover rounded-lg border border-[#e8d5a0] mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="flex-1 px-3 py-2 bg-[#D6A23A] text-[#111111] font-semibold rounded-lg hover:bg-[#c49330] disabled:opacity-50 transition-colors text-sm"
            >
              {uploading ? 'Subiendo...' : 'Subir contrato firmado'}
            </button>
            <button
              onClick={handleRemove}
              disabled={uploading}
              className="px-3 py-2 bg-white border border-[#c49330] text-[#111111] font-semibold rounded-lg hover:bg-[#f5e9c8] disabled:opacity-50 transition-colors text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <label className={`${CARD_CLS} flex items-center justify-center p-6 border-2 border-dashed border-[#c49330] rounded-lg cursor-pointer hover:bg-[#fffbf0] transition-colors`}>
          <div className="text-center">
            <Upload className="w-8 h-8 text-[#7a4a0a] mx-auto mb-2" />
            <p className="text-sm font-medium text-[#111111]">Haz clic para seleccionar foto del contrato firmado</p>
          </div>
          <input
            type="file"
            accept={ALLOWED_IMAGE_EXTENSIONS.map(ext => `.${ext}`).join(',')}
            onChange={e => {
              const f = e.currentTarget.files?.[0];
              if (f) handleFileSelect(f);
            }}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
};

export default WholesaleSignedUploader;
