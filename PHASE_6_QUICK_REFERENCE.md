/* ═══════════════════════════════════════════════════════════════════════════════
   PHASE 6: PAYMENT FLOW - QUICK REFERENCE GUIDE
   ═════════════════════════════════════════════════════════════════════════════ */

COMPONENT HIERARCHY
════════════════════════════════════════════════════════════════════════════════

AdminCommissionDashboard
  ├── PayCommissionsButton
  │   ├── CommissionPaymentModal (Step 1 + 2)
  │   │   ├── CommissionSettlementSummary (Step 1)
  │   │   └── CommissionPaymentMethod (Step 2)
  │   │       └── CommissionProofUploader
  │   └── CommissionDraftCard (if draft exists)
  └── CommissionSettlementHistory
      └── CommissionSettlementDetailModal

SellerCommissionDashboard
  └── CommissionSettlementHistory (view only)
      └── CommissionSettlementDetailModal


FILE LOCATIONS
════════════════════════════════════════════════════════════════════════════════

components/commercialPartners/commissions/
├── payments/
│   ├── paymentUtils.ts ......................... RPC + Storage utilities
│   ├── CommissionProofUploader.tsx ............. Drag-drop file uploader
│   ├── CommissionPaymentMethod.tsx ............. Method selector (transfer/cash)
│   ├── CommissionSettlementSummary.tsx ......... Modal step 1 summary
│   ├── CommissionPaymentModal.tsx .............. 2-step payment modal
│   ├── PayCommissionsButton.tsx ................ Admin button + integration
│   ├── CommissionDraftCard.tsx ................. Draft alert card
│   ├── CommissionSettlementHistory.tsx ......... Settlement records table
│   └── CommissionSettlementDetailModal.tsx .... Detail view modal
├── AdminCommissionDashboard.tsx ............... Admin dashboard (MODIFIED)
└── SellerCommissionDashboard.tsx .............. Seller dashboard (MODIFIED)


API ENDPOINTS (RPC Functions)
════════════════════════════════════════════════════════════════════════════════

create_commission_settlement(
  p_seller_id,
  p_period_start,
  p_period_end
) → {
  settlement_id, 
  folio, 
  total_amount, 
  event_count
}

pay_commission_settlement(
  p_settlement_id,
  p_payment_method,      // 'transfer' | 'cash'
  p_payment_reference,   // null or string
  p_payment_proof_path,  // null or storage path
  p_payment_proof_file_name,
  p_payment_proof_mime_type,
  p_cash_confirmed,      // boolean
  p_notes               // null or string
) → { ...settlement data }

cancel_commission_settlement_draft(
  p_settlement_id,
  p_reason
) → { ...settlement data }


VIEWS / DATA SOURCES
════════════════════════════════════════════════════════════════════════════════

v_commissions_available_for_payment
  → available_amount
  → available_event_count
  → has_draft_settlement
  → draft_settlement_id

v_commission_settlement_history
  → settlement_id, seller_id, folio, month_start, month_end
  → period_label, event_count, total_amount
  → status, payment_method, paid_at, created_at
  → payment_proof_path, has_payment_proof

v_commission_settlement_detail
  → settlement_id, commission_event_id, earned_at
  → business_name, partner_folio
  → product_name, product_variant, product_size, source_type
  → quantity, unit_commission, settlement_item_amount


STORAGE
════════════════════════════════════════════════════════════════════════════════

Bucket: commission-proofs (PRIVATE)
Path format: {seller_id}/{settlement_id}/{timestamp}-{sanitized_name}

Signed URL expiry: 300 seconds (5 minutes)
Allowed types: JPEG, PNG, WebP, PDF
Max size: 10 MB


STATE & PROPS
════════════════════════════════════════════════════════════════════════════════

PayCommissionsButton
  Props:
    - sellerId: string
    - sellerName: string
    - onPaymentComplete: () => void
  State:
    - loading, available, availableCount
    - hasDraft, draftData
    - isModalOpen, error

CommissionPaymentModal
  Props:
    - isOpen, onClose, onSuccess
    - sellerId, sellerName
    - periodStart, periodEnd, periodLabel
    - totalAmount, movementCount
  State:
    - step (1 | 2)
    - loading, settlementId, folio
    - error, successMessage

CommissionPaymentMethod
  Props:
    - totalAmount, onSubmit, onCancel, loading
  State:
    - method ('transfer' | 'cash')
    - proofFile, reference, notes
    - cashConfirmed, submitting


KEY FUNCTIONS
════════════════════════════════════════════════════════════════════════════════

// Utilities (paymentUtils.ts)
sanitizeFileName(name: string) → string

createCommissionSettlement(sellerId, start, end)
  → { settlement_id, folio, total_amount, event_count }

payCommissionSettlement(settlementId, method, ...)
  → { ...settlement }

cancelCommissionSettlementDraft(settlementId, reason)
  → { ...settlement }

uploadPaymentProof(file, sellerId, settlementId)
  → proofPath: string

createSignedProofUrl(proofPath)
  → { signedUrl }

// UI Helpers
loadAvailableForPayment(sellerId)
loadSettlementHistory(sellerId)
loadSettlementDetail(settlementId)


FLOW SEQUENCES
════════════════════════════════════════════════════════════════════════════════

TRANSFER PAYMENT:
1. PayCommissionsButton mounts → loads available + drafts
2. User clicks button
3. CommissionPaymentModal opens (Step 1)
4. User clicks "Preparar pago"
5. RPC: create_commission_settlement → settlement_id, folio
6. Step 2: CommissionPaymentMethod shown
7. User selects "Transferencia" + fills reference + uploads proof
8. User clicks "Confirmar pago"
9. uploadPaymentProof(file) → proofPath
10. RPC: pay_commission_settlement(transfer, reference, proofPath, ...)
11. Success screen shows folio
12. Auto-close + onPaymentComplete() called
13. Admin dashboard refreshes

CASH PAYMENT:
1-7. Same as above
8. User selects "Efectivo" + checks confirmation
9. User clicks "Confirmar pago"
10. RPC: pay_commission_settlement(cash, null, null, ..., cashConfirmed=true)
11-13. Same as above

DRAFT CONTINUATION:
1. PayCommissionsButton detects draft
2. Shows CommissionDraftCard instead of button
3. User clicks "Continuar pago"
4. CommissionPaymentModal opens (Step 2 directly)
5-8. Same payment flow as above


ERROR HANDLING
════════════════════════════════════════════════════════════════════════════════

RPC Errors:
  → Logged to console with full error object
  → User shown friendly message: "Error al procesar pago: {message}"
  → Modal stays open for retry

Upload Errors:
  → File type mismatch → "Tipo de archivo no permitido"
  → File too large → "Archivo muy grande. Máximo 10 MB"
  → Upload fail → Shown in CommissionProofUploader with retry option

Validation Errors:
  → Reference missing → "Ingresa la referencia de transferencia"
  → Proof missing → "Sube el comprobante de transferencia"
  → Cash not confirmed → "Confirma que el efectivo fue entregado"


STYLING & COLORS
════════════════════════════════════════════════════════════════════════════════

Backgrounds:
  - Main: bg-neutral-900, border-neutral-800
  - Hover: hover:bg-neutral-800, hover:border-neutral-700
  - Sections: bg-cc-surface (from existing theme)

Text:
  - Primary: text-cc-cream (#F4C542 accent for amounts)
  - Secondary: text-cc-text-muted (dim labels)
  - Status labels: text-neutral-300

Buttons:
  - Primary: bg-yellow-500 text-black (hover: bg-yellow-400)
  - Secondary: bg-neutral-800 (hover: bg-neutral-700)
  - Disabled: opacity-50, cursor-not-allowed

Status Badges:
  - Draft: bg-amber-500/20, border-amber-500/30, text-amber-300
  - Paid: bg-green-500/20, border-green-500/30, text-green-300
  - Cancelled: bg-neutral-700/50, border-neutral-700, text-neutral-400

Icons:
  - All from lucide-react
  - Upload: Upload
  - Download: Download
  - View: Eye
  - Delete: Trash2
  - Expand: ChevronRight/Left
  - Close: X


BEST PRACTICES
════════════════════════════════════════════════════════════════════════════════

✓ All RPC calls are logged to console for debugging
✓ File uploads sanitize filenames before storage
✓ Signed URLs use 5-min expiry (security best practice)
✓ Type safety: All responses cast to interfaces
✓ Defensive conversion: parseNumericValue() for Decimal fields
✓ Seller-only access: RLS enforced at Supabase (no frontend changes needed)
✓ No direct SQL: All operations through RPC or Views
✓ Error recovery: Modal stays open for retry on fail
✓ User feedback: Loading states, success messages, error details
✓ Responsive: Desktop-first, table overflow-x-auto for mobile


TESTING SCENARIOS
════════════════════════════════════════════════════════════════════════════════

Scenario 1: First-time payment (no draft)
  → Click "Pagar comisiones" → Modal step 1 → "Preparar pago"
  → Modal step 2 → Select transfer → Fill details → Upload proof → Success

Scenario 2: Draft exists
  → See CommissionDraftCard → Click "Continuar pago"
  → Modal step 2 directly → Continue payment

Scenario 3: Cash payment
  → Modal step 2 → Select "Efectivo" → Check confirmation → Submit → Success

Scenario 4: File upload error
  → Try upload >10MB → Error "Archivo muy grande"
  → Try .txt file → Error "Tipo de archivo no permitido"
  → Upload valid file → Success

Scenario 5: View history
  → Go to "Historial de liquidaciones"
  → Filter by status
  → Click eye icon → Detail modal shows movements
  → Click download → Signed URL opens

Scenario 6: Cancel draft
  → See CommissionDraftCard → Click trash icon
  → Confirm dialog → RPC called → Card disappears


BUILD OUTPUT
════════════════════════════════════════════════════════════════════════════════

✓ Built in 4.10s
✓ 2837 modules transformed
✓ 0 TypeScript errors
✓ Main bundle: 2,455.97 KB (667.81 KB gzipped)

Note: Some chunks >500KB warning is normal for this app size.
      Consider dynamic imports for future optimization.
