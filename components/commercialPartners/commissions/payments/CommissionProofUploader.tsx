/* ── Commission Proof Uploader ───────────────────────────────────────── */

import React, { useState, useRef } from 'react';
import { Upload, X, CheckCircle2, AlertCircle } from 'lucide-react';

interface CommissionProofUploaderProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  maxSizeMB?: number;
  acceptedTypes?: string[];
}

const DEFAULT_ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const DEFAULT_MAX_SIZE = 10; // MB

export const CommissionProofUploader: React.FC<CommissionProofUploaderProps> = ({
  onFileSelected,
  disabled = false,
  maxSizeMB = DEFAULT_MAX_SIZE,
  acceptedTypes = DEFAULT_ACCEPTED,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string>('');
  const [isHovering, setIsHovering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): boolean => {
    setError('');

    // Check type
    if (!acceptedTypes.includes(file.type)) {
      setError(`Tipo de archivo no permitido. Soportados: JPEG, PNG, WebP, PDF`);
      return false;
    }

    // Check size
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > maxSizeMB) {
      setError(`Archivo muy grande. Máximo ${maxSizeMB} MB`);
      return false;
    }

    return true;
  };

  const handleFileSelect = (file: File) => {
    if (validateFile(file)) {
      setSelectedFile(file);
      onFileSelected(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHovering(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleRemove = () => {
    setSelectedFile(null);
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isImage = selectedFile && ['image/jpeg', 'image/png', 'image/webp'].includes(selectedFile.type);

  return (
    <div className="space-y-3">
      {/* Drop Zone */}
      {!selectedFile && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsHovering(true);
          }}
          onDragLeave={() => setIsHovering(false)}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
          className={`
            relative p-8 border-2 border-dashed rounded-lg cursor-pointer
            transition-all duration-200
            ${
              disabled
                ? 'bg-neutral-950 border-neutral-700 opacity-50 cursor-not-allowed'
                : isHovering
                  ? 'bg-neutral-900 border-yellow-500 shadow-lg shadow-yellow-500/20'
                  : 'bg-neutral-950 border-neutral-700 hover:border-neutral-600'
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedTypes.map((t) => {
              if (t === 'image/jpeg') return '.jpg,.jpeg';
              if (t === 'image/png') return '.png';
              if (t === 'image/webp') return '.webp';
              if (t === 'application/pdf') return '.pdf';
              return '';
            }).join(',')}
            onChange={handleInputChange}
            disabled={disabled}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center gap-2">
            <Upload
              size={32}
              className={`${
                isHovering
                  ? 'text-yellow-500'
                  : disabled
                    ? 'text-neutral-600'
                    : 'text-neutral-500'
              } transition-colors`}
            />
            <div className="text-center">
              <p className={`font-medium ${disabled ? 'text-neutral-500' : 'text-neutral-300'}`}>
                {isHovering ? 'Suelta el archivo aquí' : 'Arrastra un archivo o haz clic'}
              </p>
              <p className="text-xs text-neutral-500 mt-1">JPEG, PNG, WebP o PDF • Máx {maxSizeMB} MB</p>
            </div>
          </div>
        </div>
      )}

      {/* Selected File */}
      {selectedFile && (
        <div className="bg-neutral-900 border border-green-500/30 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-200 truncate">{selectedFile.name}</p>
              <p className="text-xs text-neutral-500">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>

              {/* Image Preview */}
              {isImage && (
                <div className="mt-3">
                  <img
                    src={URL.createObjectURL(selectedFile)}
                    alt="Preview"
                    className="h-24 w-auto rounded border border-neutral-700"
                  />
                </div>
              )}
            </div>

            {/* Remove Button */}
            <button
              onClick={handleRemove}
              className="text-neutral-500 hover:text-red-400 transition-colors flex-shrink-0"
              title="Remover archivo"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
};
