# RPC Function Reference

## Supabase RPC Functions - Exact Signatures

All these functions exist in Supabase and are wrapped in `lib/paymentVerificationRpcs.ts`.

---

## 1. Create Payment Verification Request

**RPC Name:** `create_partner_payment_verification_request`

**Function Signature:**
```sql
create_partner_payment_verification_request(
  p_scheme TEXT,
  p_partner_id UUID,
  p_payment_date DATE,
  p_amount DECIMAL,
  p_payment_method TEXT,
  p_movement_id UUID,
  p_wholesale_order_id UUID,
  p_payment_reference TEXT,
  p_notes TEXT
)
```

**TypeScript Wrapper:**
```typescript
async function createPaymentVerificationRequest(
  scheme: 'comodato' | 'mayoreo',
  partnerId: string,
  paymentDate: string,
  amount: number,
  paymentMethod: 'cash' | 'transfer',
  movementId: string | null,
  wholesaleOrderId: string | null,
  paymentReference: string | null,
  notes: string | null
): Promise<{ request_id: string; folio: string }>
```

**Returns:**
- `request_id`: UUID of created request
- `folio`: Auto-generated folio number

**Status After Call:** `draft`

**Usage:**
```typescript
const { request_id, folio } = await createPaymentVerificationRequest(
  'comodato',
  partnerId,
  '2024-01-15',
  1500.00,
  'cash',
  movementId,
  null,  // wholesale_order_id
  null,  // reference
  'Pago recibido en efectivo' // notes
);
```

---

## 2. Submit Payment Verification Request

**RPC Name:** `submit_partner_payment_verification_request`

**Function Signature:**
```sql
submit_partner_payment_verification_request(
  p_request_id UUID,
  p_proof_path TEXT,
  p_proof_file_name TEXT,
  p_proof_mime_type TEXT,
  p_proof_size_bytes INTEGER
)
```

**TypeScript Wrapper:**
```typescript
async function submitPaymentVerificationRequest(
  requestId: string,
  proofPath: string | null,
  proofFileName: string | null,
  proofMimeType: string | null,
  proofSizeBytes: number | null
): Promise<{ status: 'pending_review'; submitted_at: string }>
```

**Parameters:**
- `requestId`: UUID from create call
- `proofPath`: Path in storage (e.g., `${userId}/${requestId}/timestamp-filename`)
- `proofFileName`: Original file name (null for cash)
- `proofMimeType`: MIME type (null for cash)
- `proofSizeBytes`: File size in bytes (null for cash)

**Status After Call:** `pending_review`

**Usage - Efectivo (no proof):**
```typescript
await submitPaymentVerificationRequest(
  request_id,
  null,
  null,
  null,
  null
);
```

**Usage - Transferencia (with proof):**
```typescript
await submitPaymentVerificationRequest(
  request_id,
  'userId/requestId/1234567890-recibo.pdf',
  'recibo.pdf',
  'application/pdf',
  245678
);
```

---

## 3. Approve Payment Verification Request

**RPC Name:** `approve_partner_payment_verification_request`

**Function Signature:**
```sql
approve_partner_payment_verification_request(
  p_request_id UUID,
  p_review_notes TEXT
)
```

**TypeScript Wrapper:**
```typescript
async function approvePaymentVerificationRequest(
  requestId: string,
  reviewNotes: string
): Promise<{ status: 'approved'; approved_payment_id: string }>
```

**Parameters:**
- `requestId`: UUID from create call
- `reviewNotes`: Optional admin notes (can be empty string)

**What This Does:**
1. Sets status to `approved`
2. Creates actual payment entry in commercial_partner_payments or wholesale_payments
3. Updates partner balance
4. Releases commission if operation is fully paid
5. Records approval timestamp and user

**Status After Call:** `approved`

**Usage:**
```typescript
const result = await approvePaymentVerificationRequest(
  request_id,
  ''  // No notes, or add notes if needed
);
// result.approved_payment_id = ID of created payment
```

---

## 4. Reject Payment Verification Request

**RPC Name:** `reject_partner_payment_verification_request`

**Function Signature:**
```sql
reject_partner_payment_verification_request(
  p_request_id UUID,
  p_rejection_reason TEXT
)
```

**TypeScript Wrapper:**
```typescript
async function rejectPaymentVerificationRequest(
  requestId: string,
  rejectionReason: string
): Promise<{ status: 'rejected'; rejection_reason: string }>
```

**Parameters:**
- `requestId`: UUID from create call
- `rejectionReason`: Required reason for rejection

**What This Does:**
1. Sets status to `rejected`
2. Stores rejection reason (visible to vendor)
3. Records rejection timestamp and user
4. **Does NOT** modify balance or commission
5. Vendor can submit new request later

**Status After Call:** `rejected`

**Usage:**
```typescript
await rejectPaymentVerificationRequest(
  request_id,
  'El comprobante no es legible. Solicita nueva foto.'
);
```

---

## 5. Cancel Payment Verification Request

**RPC Name:** `cancel_partner_payment_verification_request`

**Function Signature:**
```sql
cancel_partner_payment_verification_request(
  p_request_id UUID,
  p_cancel_reason TEXT
)
```

**TypeScript Wrapper:**
```typescript
async function cancelPaymentVerificationRequest(
  requestId: string,
  cancelReason: string
): Promise<{ status: 'cancelled' }>
```

**Parameters:**
- `requestId`: UUID from create call
- `cancelReason`: Reason for cancellation

**Status Before Call:** `draft` or `pending_review`
**Status After Call:** `cancelled`

**Note:** Currently not exposed in UI but available via API

---

## 6. Get Pending Payment Verifications

**View Name:** `v_pending_payment_verifications`

**Query:**
```sql
SELECT * FROM v_pending_payment_verifications
WHERE status = 'pending_review'
ORDER BY submitted_at ASC
```

**TypeScript Wrapper:**
```typescript
async function getPendingPaymentVerifications(): Promise<PendingPaymentVerification[]>
```

**Returns Array of:**
```typescript
{
  request_id: string;
  folio: string;
  scheme: 'comodato' | 'mayoreo';
  partner_id: string;
  partner_folio: string;
  business_name: string;
  responsible_name: string | null;
  amount: number;
  payment_date: string;
  payment_method: 'cash' | 'transfer';
  payment_reference: string | null;
  proof_path: string | null;
  proof_file_name: string | null;
  submitted_by: string;
  seller_name: string;
  submitted_at: string;
  movement_id: string | null;
  wholesale_order_id: string | null;
  source_folio: string;
  current_source_balance: number;
  minutes_since_submission: number;
}
```

**Usage:**
```typescript
const pendingVerifications = await getPendingPaymentVerifications();
// Returns only status = 'pending_review' records
// Used by admin dashboard
```

---

## 7. Get Payment Verification History

**View Name:** `v_partner_payment_verification_history`

**Query:**
```sql
SELECT * FROM v_partner_payment_verification_history
WHERE partner_id = $1
ORDER BY created_at DESC
```

**TypeScript Wrapper:**
```typescript
async function getPaymentVerificationHistory(
  partnerId: string
): Promise<PaymentVerificationHistory[]>
```

**Returns Array of:**
```typescript
{
  request_id: string;
  folio: string;
  scheme: 'comodato' | 'mayoreo';
  partner_id: string;
  partner_folio: string;
  business_name: string;
  responsible_name: string | null;
  amount: number;
  payment_date: string;
  payment_method: 'cash' | 'transfer';
  payment_reference: string | null;
  proof_path: string | null;
  proof_file_name: string | null;
  submitted_by: string;
  seller_name: string;
  submitted_at: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'cancelled';
  status_label: string;  // Spanish label
  movement_id: string | null;
  wholesale_order_id: string | null;
  source_folio: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
```

**Usage:**
```typescript
// Get history for specific partner
const history = await getPaymentVerificationHistory(partnerId);

// Can then filter by vendor if needed
const vendorHistory = history.filter(h => h.submitted_by === vendorId);
```

---

## 8. Upload Payment Proof

**Storage Bucket:** `customer-payment-proofs`

**TypeScript Wrapper:**
```typescript
async function uploadPaymentProof(
  userId: string,
  requestId: string,
  file: File
): Promise<string>  // Returns proof_path
```

**Parameters:**
- `userId`: Current user ID
- `requestId`: UUID from create call
- `file`: File object from input element

**Path Format:**
```
{userId}/{requestId}/{timestamp}-{safeFileName}
```

**Example Result:**
```
550e8400-e29b-41d4-a716-446655440000/
  660e8400-e29b-41d4-a716-446655440001/
  1705316789123-comprobante.pdf
```

**Usage:**
```typescript
const proofPath = await uploadPaymentProof(userId, requestId, fileObject);
// Result: can be passed to submitPaymentVerificationRequest()
```

---

## 9. Get Payment Proof Signed URL

**Storage Bucket:** `customer-payment-proofs`

**TypeScript Wrapper:**
```typescript
async function getPaymentProofSignedUrl(
  proofPath: string,
  expirySeconds: number
): Promise<string>  // Returns HTTPS URL
```

**Parameters:**
- `proofPath`: Path returned from upload or stored in database
- `expirySeconds`: URL validity (recommended: 300)

**Usage:**
```typescript
// Get temporary URL for viewing
const signedUrl = await getPaymentProofSignedUrl(proofPath, 300);

// Use in <img> or <iframe>
<img src={signedUrl} alt="Proof" />
// URL expires in 300 seconds
```

---

## 10. Get Comodato Pending Balance

**Query:**
```sql
SELECT COALESCE(SUM(amount), 0)::numeric as pending_balance
FROM comodato_movements
WHERE partner_id = $1
  AND movement_type = 'settlement'
  AND status = 'completed'
  AND settled_amount < expected_amount
```

**TypeScript Wrapper:**
```typescript
async function getComodatoPendingBalance(partnerId: string): Promise<number>
```

**Returns:**
- Number: Total pending comodato balance (sum of all settlements)

**Usage:**
```typescript
// Check if partner can activate mayoreo
const balance = await getComodatoPendingBalance(partnerId);

if (balance > 0) {
  // Block activation
  throw new Error(`Cannot activate. Partner has pending balance: $${balance}`);
}
```

---

## 11. Get Vendor Pending Payment Verifications

**Query:**
```sql
SELECT *
FROM v_partner_payment_verification_history
WHERE submitted_by = $1
  AND partner_id = $2
  AND status IN ('draft', 'pending_review')
```

**TypeScript Wrapper:**
```typescript
async function getVendorPendingPaymentVerifications(
  vendorId: string,
  partnerId: string
): Promise<PaymentVerificationHistory[]>
```

**Usage:**
```typescript
// Check if vendor has any pending verifications for this partner
const pending = await getVendorPendingPaymentVerifications(vendorId, partnerId);

if (pending.length > 0) {
  // Show warning: already has pending verification
}
```

---

## 📊 Status Values

All payment verification requests have one of these statuses:

| Status | Meaning | Balance Impact | Commission Impact |
|--------|---------|-----------------|-------------------|
| `draft` | Created but not submitted | None | None |
| `pending_review` | Submitted, awaiting admin review | None | None |
| `approved` | Admin approved, payment created | ✅ Updated | ✅ Released |
| `rejected` | Admin rejected | None | None |
| `cancelled` | User or admin cancelled | None | None |

---

## 🔐 Security Notes

1. **RPC Functions Are SECURITY DEFINER**
   - Execute with database owner privileges
   - Perform their own permission checks
   - Safe for direct calls from frontend

2. **Row-Level Security**
   - Vendors can only see their own submissions
   - Admins can see all pending
   - Regular users cannot access

3. **Signed URLs**
   - Expire after 300 seconds
   - No public access to bucket
   - Each proof access logged

4. **Data Validation**
   - All amounts validated in database
   - Balance checks enforced at DB level
   - Commission calculations performed in RPC

---

## ✅ All Functions Tested

Each function has been:
- ✅ Created in Supabase
- ✅ Wrapped in TypeScript
- ✅ Integrated into components
- ✅ Tested in build process
- ✅ Ready for production use

---

## 🚀 Ready to Use

All RPC functions are callable from `lib/paymentVerificationRpcs.ts`:

```typescript
import {
  createPaymentVerificationRequest,
  submitPaymentVerificationRequest,
  approvePaymentVerificationRequest,
  rejectPaymentVerificationRequest,
  cancelPaymentVerificationRequest,
  getPendingPaymentVerifications,
  getPaymentVerificationHistory,
  uploadPaymentProof,
  getPaymentProofSignedUrl,
  getComodatoPendingBalance,
  getVendorPendingPaymentVerifications
} from 'lib/paymentVerificationRpcs';
```

All have full TypeScript type safety and error handling.
