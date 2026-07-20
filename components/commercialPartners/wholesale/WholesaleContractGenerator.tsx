import React, { useState } from 'react';
import { supabase } from '../../../supabase';
import { CommercialPartner } from '../types';
import { jsPDF } from 'jspdf';
import { Download, Loader2, AlertCircle } from 'lucide-react';
import { CARD_CLS } from './types';

interface Props {
  partner: CommercialPartner;
  documentPaths: { ine_front_path?: string; ine_back_path?: string; business_photo_path?: string };
  onGenerated: (contractId: string, pdfPath: string) => void;
  onError: (error: string) => void;
}

interface CatCornBusinessProfile {
  id: string;
  legal_name: string;
  rfc: string;
  fiscal_address: string;
  representative_name: string;
  phone?: string;
  email?: string;
  trade_name: string;
}

const WholesaleContractGenerator: React.FC<Props> = ({ partner, documentPaths, onGenerated, onError }) => {
  const [generating, setGenerating] = useState(false);
  const [contractId, setContractId] = useState<string | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Validate required data before contract generation
  const validateData = (businessProfile: CatCornBusinessProfile | null): { valid: boolean; message?: string } => {
    if (!businessProfile) {
      return {
        valid: false,
        message: 'No se encontraron los datos legales de Cat Corn. Revisa catcorn_business_profile en Supabase.',
      };
    }

    if (!businessProfile.legal_name?.trim()) {
      return { valid: false, message: 'Falta legal_name en catcorn_business_profile' };
    }
    if (!businessProfile.rfc?.trim()) {
      return { valid: false, message: 'Falta rfc en catcorn_business_profile' };
    }
    if (!businessProfile.fiscal_address?.trim()) {
      return { valid: false, message: 'Falta fiscal_address en catcorn_business_profile' };
    }
    if (!businessProfile.representative_name?.trim()) {
      return { valid: false, message: 'Falta representative_name en catcorn_business_profile' };
    }
    if (!businessProfile.trade_name?.trim()) {
      return { valid: false, message: 'Falta trade_name en catcorn_business_profile' };
    }

    if (!documentPaths.ine_front_path) {
      return { valid: false, message: 'Falta INE frente' };
    }
    if (!documentPaths.ine_back_path) {
      return { valid: false, message: 'Falta INE reverso' };
    }
    if (!documentPaths.business_photo_path) {
      return { valid: false, message: 'Falta foto del negocio' };
    }

    return { valid: true };
  };

  // Helper: Normalize storage path
  const normalizePath = (path: string): string => {
    if (!path) return '';
    return path.replace(/^partner-documents\//, '').trim();
  };

  // Helper: Load image from Supabase Storage
  const getDocumentImageDataUrl = async (storagePath: string): Promise<string | null> => {
    if (!storagePath || !supabase) return null;

    const cleanPath = normalizePath(storagePath);
    console.log('📥 Loading image:', cleanPath);

    try {
      const { data, error } = await supabase.storage
        .from('partner-documents')
        .createSignedUrl(cleanPath, 3600);

      if (error || !data?.signedUrl) {
        console.error('❌ Error creating signed URL:', cleanPath, error?.message);
        return null;
      }

      console.log('✅ Signed URL created');

      const response = await fetch(data.signedUrl);
      if (!response.ok) {
        console.error('❌ Failed to fetch image:', response.statusText);
        return null;
      }

      const blob = await response.blob();
      console.log('✅ Image fetched:', blob.size, 'bytes');

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          console.log('✅ Image converted to DataURL');
          resolve(reader.result as string);
        };
        reader.onerror = () => {
          console.error('❌ Failed to read image as DataURL');
          reject(null);
        };
        reader.readAsDataURL(blob);
      });
    } catch (err: any) {
      console.error('❌ Error loading image:', cleanPath, err.message);
      return null;
    }
  };

  // Helper: Add image maintaining aspect ratio
  const addImageContained = (doc: any, dataUrl: string | null, x: number, y: number, maxW: number, maxH: number, label: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(label, x, y - 4);

    if (!dataUrl) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Imagen no disponible', x, y + 10);
      return;
    }

    try {
      // Detect image type
      const imageType = dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      
      const props = doc.getImageProperties(dataUrl);
      const ratio = props.width / props.height;

      let w = maxW;
      let h = w / ratio;

      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }

      const centeredX = x + (maxW - w) / 2;
      doc.addImage(dataUrl, imageType, centeredX, y, w, h);
      console.log(`✅ ${label} added to PDF (${imageType})`);
    } catch (err: any) {
      console.error(`❌ Failed to add ${label}:`, err.message);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Error al cargar', x, y + 10);
    }
  };

  const generateContractPDF = async () => {
    if (!supabase) {
      onError('Supabase no configurado');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      // Load Cat Corn business profile
      const { data: businessProfile, error: profileError } = await supabase
        .from('catcorn_business_profile')
        .select('*')
        .eq('id', 'catcorn')
        .single();

      if (profileError || !businessProfile) {
        const errorMsg =
          'No se encontraron los datos legales de Cat Corn. Revisa catcorn_business_profile en Supabase.';
        setError(errorMsg);
        onError(errorMsg);
        setGenerating(false);
        return;
      }

      // Validate all required data
      const validation = validateData(businessProfile);
      if (!validation.valid) {
        setError(validation.message || 'Datos incompletos');
        onError(validation.message || 'Datos incompletos');
        setGenerating(false);
        return;
      }

      console.log('📄 Starting contract PDF generation (LETTER format, PORTRAIT)...');
      console.log('📸 Document paths:', documentPaths);

      // Load images from Storage
      const [ineFrameB64, ineBackB64, businessPhotoB64] = await Promise.all([
        getDocumentImageDataUrl(documentPaths.ine_front_path || ''),
        getDocumentImageDataUrl(documentPaths.ine_back_path || ''),
        getDocumentImageDataUrl(documentPaths.business_photo_path || ''),
      ]);

      console.log('🖼️ Images loaded:', {
        ineFrame: ineFrameB64 ? 'YES' : 'NO',
        ineBack: ineBackB64 ? 'YES' : 'NO',
        businessPhoto: businessPhotoB64 ? 'YES' : 'NO',
      });

      // ========== CREAR PDF LETTER PORTRAIT (2 PAGES) ==========
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'letter',
      });

      const pageWidth = doc.internal.pageSize.getWidth(); // ~215.9 mm
      
      // ========== LAYOUT MEJORADO: BLOQUE CENTRADO ==========
      const contentWidth = 175; // mm - bloque centrado
      const leftX = (pageWidth - contentWidth) / 2;
      
      // Columnas para datos
      const colGap = 8;
      const colWidth = (contentWidth - colGap) / 2;
      const col1X = leftX;
      const col2X = leftX + colWidth + colGap;

      let yPos = 12; // margen superior

      // ========== HOJA 1: CONTRATO ==========

      // Título
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('CONTRATO DE SUMINISTRO MAYOREO CAT CORN', pageWidth / 2, yPos, { align: 'center' });
      yPos += 6;

      // Fecha y folio centrados
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const dateStr = new Date().toLocaleDateString('es-MX');
      const dateText = `Fecha: ${dateStr}     Folio: ${partner.folio}`;
      doc.text(dateText, pageWidth / 2, yPos, { align: 'center' });
      yPos += 8;

      // Párrafo 1
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const intro1 = `El presente contrato de suministro en esquema de mayoreo se celebra entre Cat Corn, representada por ${businessProfile.representative_name}, y el socio comercial ${partner.business_name}, representado por ${partner.responsible_name}, con la finalidad de establecer las condiciones bajo las cuales el socio podrá adquirir productos Cat Corn a precios preferenciales para su reventa.`;
      const lines1 = doc.splitTextToSize(intro1, contentWidth);
      lines1.forEach((line: string) => {
        doc.text(line, leftX, yPos);
        yPos += 4.7;
      });
      yPos += 6;

      // Párrafo 2
      const intro2 = `Ambas partes manifiestan que conocen y aceptan los términos aquí estipulados, reconociendo que el producto adquirido bajo este esquema será propiedad del socio comercial una vez entregado, quedando sujeto a las condiciones de pago, manejo, merma y reventa descritas en el presente documento.`;
      const lines2 = doc.splitTextToSize(intro2, contentWidth);
      lines2.forEach((line: string) => {
        doc.text(line, leftX, yPos);
        yPos += 4.7;
      });
      yPos += 6;

      // ========== DATOS EN DOS COLUMNAS ==========
      const dataStartY = yPos;
      let col1Y = dataStartY;
      let col2Y = dataStartY;

      // COLUMNA 1: CAT CORN
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('DATOS DE CAT CORN:', col1X, col1Y);
      col1Y += 4.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      const catCornData = [
        `Nombre legal: ${businessProfile.legal_name}`,
        `RFC: ${businessProfile.rfc}`,
        `Domicilio: ${businessProfile.fiscal_address}`,
        `Representante: ${businessProfile.representative_name}`,
        `Teléfono: ${businessProfile.phone || '—'}`,
        `Correo: ${businessProfile.email || '—'}`,
        `Nombre comercial: ${businessProfile.trade_name}`,
      ];

      catCornData.forEach(line => {
        const wrapped = doc.splitTextToSize(line, colWidth - 2);
        wrapped.forEach((l: string) => {
          doc.text(l, col1X + 1, col1Y);
          col1Y += 4.2;
        });
      });

      // COLUMNA 2: SOCIO
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('DATOS DEL SOCIO COMERCIAL:', col2X, col2Y);
      col2Y += 4.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      const partnerData = [
        `Nombre del negocio: ${partner.business_name}`,
        `Responsable: ${partner.responsible_name}`,
        `Teléfono: ${partner.phone || '—'}`,
        `WhatsApp: ${partner.whatsapp || '—'}`,
        `Correo: ${partner.email || '—'}`,
        `Dirección: ${partner.address || '—'}`,
        `Folio: ${partner.folio}`,
      ];

      partnerData.forEach(line => {
        const wrapped = doc.splitTextToSize(line, colWidth - 2);
        wrapped.forEach((l: string) => {
          doc.text(l, col2X + 1, col2Y);
          col2Y += 4.2;
        });
      });

      yPos = Math.max(col1Y, col2Y) + 5;

      // ========== CONDICIONES ==========
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('CONDICIONES DEL CONTRATO:', leftX, yPos);
      yPos += 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);

      const conditions = [
        '1. El socio comercial podrá comprar producto Cat Corn en esquema de mayoreo.',
        '2. La compra mínima será de 10 piezas mezcladas por pedido.',
        '3. El socio podrá comprar producto cuantas veces desee, sin obligación de compra frecuente.',
        '4. El pago deberá realizarse en un plazo no mayor a 72 horas posteriores a la entrega del producto.',
        '5. Una vez entregado y comprado el producto, este será propiedad del socio comercial.',
        '6. La merma, pérdida, daño, caducidad, mal manejo o falta de rotación del producto correrá por cuenta del socio comercial.',
        '7. Cat Corn no estará obligado a retirar, recomprar o cambiar producto comprado en mayoreo.',
        '8. Los precios de mayoreo podrán actualizarse por Cat Corn previo aviso.',
        '9. El socio podrá vender el producto al precio que considere conveniente.',
        '10. El presente contrato queda sujeto a revisión por ambas partes.',
      ];

      conditions.forEach(cond => {
        const wrapped = doc.splitTextToSize(cond, contentWidth - 2);
        wrapped.forEach((l: string) => {
          doc.text(l, leftX + 1, yPos);
          yPos += 4.3;
        });
      });

      // ========== HOJA 2: ANEXOS Y FIRMAS ==========
      doc.addPage();
      yPos = 12; // margen superior

      // Título
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('ANEXOS Y FIRMAS', pageWidth / 2, yPos, { align: 'center' });
      yPos += 6;

      // Subtítulo
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('Documentos anexos del socio comercial', pageWidth / 2, yPos, { align: 'center' });
      yPos += 8;

      // INE FRENTE y INE REVERSO lado a lado (centrados)
      const ineWidth = 80;
      const ineHeight = 50;
      const ineY = yPos;
      const ine1X = leftX + (contentWidth / 4 - ineWidth / 2);
      const ine2X = leftX + (3 * contentWidth / 4 - ineWidth / 2);

      addImageContained(doc, ineFrameB64, ine1X, ineY, ineWidth, ineHeight, 'INE FRENTE');
      addImageContained(doc, ineBackB64, ine2X, ineY, ineWidth, ineHeight, 'INE REVERSO');

      yPos = ineY + ineHeight + 10;

      // Foto del negocio (centrada, más grande)
      const photoWidth = 150;
      const photoHeight = 75;
      const photoX = pageWidth / 2 - photoWidth / 2;

      addImageContained(doc, businessPhotoB64, photoX, yPos, photoWidth, photoHeight, 'FOTO DEL NEGOCIO');

      yPos = yPos + photoHeight + 12;

      // Firmas (centradas en el bloque)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('FIRMAS:', leftX, yPos);
      yPos += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);

      // Cat Corn
      doc.text('POR CAT CORN:', leftX, yPos);
      yPos += 5;
      doc.text('____________________________', leftX, yPos);
      yPos += 4;
      doc.text(businessProfile.representative_name, leftX, yPos);
      yPos += 10;

      // Socio
      doc.text('POR EL SOCIO COMERCIAL:', leftX, yPos);
      yPos += 5;
      doc.text('____________________________', leftX, yPos);
      yPos += 4;
      doc.text(partner.responsible_name, leftX, yPos);

      // ========== GUARDAR PDF ==========
      const filename = `contrato_mayoreo_${partner.folio}_${Date.now()}.pdf`;
      const storagePath = `${partner.id}/wholesale/${filename}`;
      const pdfBlob = doc.output('blob');

      console.log('📤 Uploading PDF to storage:', storagePath);

      const { error: uploadError } = await supabase.storage
        .from('partner-documents')
        .upload(storagePath, pdfBlob, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError) throw uploadError;
      console.log('✅ PDF uploaded successfully');

      // ========== REGISTRAR EN BD ==========
      const { data: contractData, error: contractError } = await supabase
        .from('commercial_partner_contracts')
        .insert({
          partner_id: partner.id,
          contract_type: 'wholesale',
          contract_status: 'generated',

          // Cat Corn data with catcorn_ prefix
          catcorn_legal_name: businessProfile.legal_name,
          catcorn_rfc: businessProfile.rfc,
          catcorn_fiscal_address: businessProfile.fiscal_address,
          catcorn_representative_name: businessProfile.representative_name,
          catcorn_phone: businessProfile.phone || null,
          catcorn_email: businessProfile.email || null,
          catcorn_trade_name: businessProfile.trade_name,

          // Partner data
          partner_business_name: partner.business_name,
          partner_responsible_name: partner.responsible_name,
          partner_phone: partner.phone || null,
          partner_whatsapp: partner.whatsapp || null,
          partner_email: partner.email || null,
          partner_address: partner.address || null,

          // Contract terms
          minimum_order_pieces: 10,
          payment_terms_hours: 72,

          // Consent
          privacy_consent_accepted: true,
          privacy_consent_at: new Date().toISOString(),

          // Document paths
          ine_front_storage_path: documentPaths.ine_front_path,
          ine_back_storage_path: documentPaths.ine_back_path,
          business_photo_storage_path: documentPaths.business_photo_path,
          contract_pdf_storage_path: storagePath,

          // Timestamps
          generated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (contractError) throw contractError;
      console.log('✅ Contract record created:', contractData.id);

      // Registrar PDF en documentos
      await supabase.from('commercial_partner_documents').insert({
        partner_id: partner.id,
        contract_id: contractData.id,
        document_type: 'contract_pdf',
        storage_bucket: 'partner-documents',
        storage_path: storagePath,
        file_name: filename,
        mime_type: 'application/pdf',
      });

      // Generar URL firmada para preview
      const { data: signedData } = await supabase.storage
        .from('partner-documents')
        .createSignedUrl(storagePath, 3600);

      setContractId(contractData.id);
      setPdfPath(storagePath);
      setPdfUrl(signedData?.signedUrl || null);
      console.log('✅ Contract generated successfully! (LETTER, PORTRAIT, 2 PAGES)');
      onGenerated(contractData.id, storagePath);
    } catch (err: any) {
      const errorMsg = err.message || 'Error al generar contrato';
      console.error('❌ Contract generation error:', errorMsg);
      setError(errorMsg);
      onError(errorMsg);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">{error}</div>
        </div>
      )}

      {contractId && pdfPath ? (
        <div>
          <div className={`${CARD_CLS} bg-green-50 border-green-300`}>
            <p className="text-sm font-semibold text-green-900 mb-2">✓ Contrato generado correctamente</p>
            <p className="text-xs text-green-700">El PDF ha sido guardado y registrado en el sistema.</p>
          </div>

          {pdfUrl && (
            <div className="mt-4">
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#D6A23A] text-[#111111] font-semibold rounded-lg hover:bg-[#c49330] transition-colors"
              >
                <Download size={16} />
                Descargar Contrato PDF
              </a>
            </div>
          )}
        </div>
      ) : (
        <div>
          <p className="text-sm text-[#6b7280] mb-4">
            Se generará un contrato PDF con los datos del socio, datos de Cat Corn y las condiciones de mayoreo.
          </p>
          <button
            onClick={generateContractPDF}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#D6A23A] text-[#111111] font-semibold rounded-lg hover:bg-[#c49330] disabled:opacity-50 transition-colors"
          >
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generando...
              </>
            ) : (
              'Generar Contrato'
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default WholesaleContractGenerator;
