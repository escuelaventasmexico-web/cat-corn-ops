# Mayoreo Payment Verification System - Implementation

## 📋 Overview

Fixed the mayoreo (wholesale) payment flow for vendors (`socios_comerciales` role) by implementing the same payment verification workflow that was already working for comodato.

**Problem**: Vendors were seeing the error "Los vendedores deben reportar el cobro para revisión administrativa" (Vendors must report payment for admin review) but the system wasn't providing a way to actually report payments - it was just blocking direct inserts.

**Solution**: Implemented a complete vendor-facing payment verification workflow using the backend RPC functions that were already created in the database migration.

---

## 🎯 Changes Made

### File: `/components/commercialPartners/wholesale/WholesalePaymentForm.tsx`

**Complete rewrite** to implement the three-step verification workflow:

#### 1. **Role-Based Flow Detection**
```typescript
// Get user role from user_profiles
const { data: profile } = await supabase
  .from('user_profiles')
  .select('role')
  .eq('id', user.id)
  .single();
setUserRole(profile?.role || null);
```

- **For vendors** (`socios_comerciales`): Use payment verification RPC workflow
- **For admins** (`admin`): Keep existing direct insert behavior

#### 2. **Order Selection (Critical Requirement)**
```typescript
// Load pending orders from v_wholesale_order_totals
const { data: ordersData } = await supabase
  .from('v_wholesale_order_totals')
  .select('wholesale_order_id, pending_amount')
  .eq('partner_id', partnerId)
  .gt('pending_amount', 0.005);
```

**Key features:**
- Display only orders with `pending_amount > 0.005`
- Show folio (first 8 chars of UUID) to vendor
- Auto-select if only 1 pending order
- Auto-fill amount with the pending balance
- Allow partial payments by editing amount

**UI Format:**
```
"Orden 0a5cfb99 — saldo pendiente $300.00"
```

#### 3. **Vendor Workflow: Three Steps**

**Step 1: Form** (standard payment form)
- Order selector (auto-populated)
- Amount (can modify from pending balance)
- Payment method (cash/transfer/card/other)
- Reference & notes
- Date picker
- Informational message (not blocking error):
  > "El cobro será enviado a revisión administrativa. El saldo y tu comisión se actualizarán cuando Cat Corn confirme que recibió el dinero."

**Step 2: Proof (if transfer)**
- File upload required for transfers
- Accepts: PDF, JPG, PNG, WEBP
- Max: 10 MB
- Only shown if `method === 'transfer'`

**Step 3: Success**
- Displays folio, amount, client, order, status
- Shows message about pending admin review
- Auto-closes after 3 seconds

#### 4. **Payment Verification RPC Workflow**

```typescript
// Step 1: Create draft verification
const createResult = await createPaymentVerificationRequest(
  'mayoreo',              // scheme
  partnerId,
  paymentDate,
  amountNum,
  method as 'cash' | 'transfer',
  null,                   // No movement_id for mayoreo
  selectedOrderId,        // CRITICAL: Must specify which order
  reference || null,
  notes || null
);

// Step 2: Upload proof if transfer (only if required)
if (method === 'transfer' && proofFile) {
  proofPath = await uploadPaymentProof(
    user.id,
    createResult.requestId,
    proofFile
  );
}

// Step 3: Submit for review
await submitPaymentVerificationRequest(
  createResult.requestId,
  proofPath,
  proofFileName,
  proofMimeType,
  proofSizeBytes
);
```

#### 5. **State Machine**

```
VENDOR FLOW:
'form' → (if transfer) → 'proof' → (submit) → 'success' → (close)
  ↓ (if cash & confirmed)
'success' → (close)

ADMIN FLOW:
Direct insert to wholesale_payments on save
```

#### 6. **Cash Handling**
- For cash payments, optionally show:
  > "Confirmo que el cliente entregó este monto en efectivo"
- Required for vendors to ensure they don't accidentally report payments they didn't receive

---

## 🔌 Integration Points

### Database RPC Functions Used
All functions already exist in migration SQL:
- ✅ `create_partner_payment_verification_request()`
- ✅ `submitPaymentVerificationRequest()`
- ✅ `uploadPaymentProof()`

### Views Queried
- ✅ `v_wholesale_order_totals` - Get pending orders
- ✅ `wholesale_orders` - Get order folios
- ✅ `v_commercial_partner_wholesale_summary` - Get summary

### Admin Dashboard Integration
Mayoreo payments automatically appear in:
- 📍 Components → PendingPaymentVerifications.tsx
- 📍 Path: Socios Comerciales → Comisiones → Cobros pendientes de revisión

**Admin sees:**
```
"Gerardo Ventas reportó un cobro de $300.00 de prueba4"
```

And can:
- ✅ View payment proof (if transfer)
- ✅ Approve → Creates wholesale_payment entry
- ✅ Reject → Returns to pending_review

---

## 📊 State After Vendor Reports

| Item | Before Report | After Report (Pending Review) | After Admin Approval |
|------|---|---|---|
| **wholesale_payments entry** | N/A | ❌ Not created yet | ✅ Created |
| **Order balance** | $300 | $300 (unchanged) | $0 (if fully paid) |
| **Commission status** | Pending | Pending | Available (if order paid) |
| **Request status** | N/A | `pending_review` | `approved` |
| **Location** | Hidden | Admin dashboard | Archive |

---

## 🧪 Test Case: Gerardo Ventas (prueba4)

**Setup:**
- Partner: `prueba4` (Gerardo Ventas)
- Order: 1 pending order with $300 balance
- Scheme: Mayoreo

**Vendor Steps:**
1. Click "Registrar Pago" → Modal shows "Reportar Cobro Mayoreo"
2. Order auto-selected: `Orden 0a5cfb99 — saldo pendiente $300.00`
3. Amount auto-filled: `$300.00`
4. Select method: `Transferencia`
5. Enter reference: (e.g., "001234567")
6. Select date
7. Click "Reportar Cobro"
8. Upload proof (PDF/JPG/PNG/WEBP)
9. Click "Reportar Cobro" again
10. Success message: "El cobro de $300.00 fue enviado para revisión administrativa..."

**Expected After Report:**
- ✅ `partner_payment_verification_requests` row exists with `status = 'pending_review'`
- ✅ Order balance still shows `$300` (not yet recorded)
- ✅ Commission still pending
- ✅ Admin dashboard shows verification request

**Admin Steps:**
1. Go to: Socios Comerciales → Comisiones → Cobros pendientes de revisión
2. See card: "Gerardo Ventas reportó un cobro de $300.00"
3. Click "Revisar cobro"
4. Modal shows all payment details
5. Can download proof (if transfer)
6. Click "Confirmar ingreso"
7. Enter optional review notes
8. Click button

**Expected After Admin Approval:**
- ✅ `wholesale_payments` entry created with `status = 'completed'`
- ✅ Order balance becomes `$0`
- ✅ Commission changes to `available` (if fully paid)
- ✅ Request status changes to `approved`

---

## 🔐 Console Logs Added

For debugging, the following are logged:

**Vendor side:**
```javascript
console.log('WHOLESALE PENDING ORDERS', ordersWithFolios);
console.log('WHOLESALE VERIFICATION CREATED', createResult);
console.log('WHOLESALE VERIFICATION SUBMITTED', submitResult);
console.error('WHOLESALE PROOF UPLOAD ERROR', uploadErr);
console.error('WHOLESALE VERIFICATION CREATE ERROR', err);
```

---

## 📝 UI Changes

### Modal Title
- **Before**: "Registrar Pago Mayoreo" (all roles)
- **After**: 
  - Vendors: "Reportar Cobro Mayoreo"
  - Admins: "Registrar Pago Mayoreo" (unchanged)

### Info Message
- **Before**: Error blocking form submission
- **After**: Blue informational banner (not blocking):
  > "El cobro será enviado a revisión administrativa. El saldo y tu comisión se actualizarán cuando Cat Corn confirme que recibió el dinero."

### Button Text
- **Before**: "Registrar Pago"
- **After**:
  - Vendors: "Reportar Cobro" (main form & proof form)
  - Admins: "Registrar Pago" (unchanged)

### Order Selector
- **New**: Mandatory field for vendor workflow
- Shows format: `"Orden 0a5cfb99 — saldo pendiente $300.00"`
- Auto-selected if only 1 pending order

### Cash Confirmation
- **New** optional checkbox for cash payments (vendors only):
  > "Confirmo que el cliente entregó este monto en efectivo"

---

## ✅ No Backend Changes

- ❌ No SQL modifications
- ❌ No RPC function changes
- ❌ No view modifications
- ✅ 100% frontend implementation using existing backend

---

## 🚀 Deployment Checklist

- ✅ WholesalePaymentForm.tsx updated
- ✅ Uses existing RPC functions (already deployed)
- ✅ Uses existing views (already deployed)
- ✅ npm run build: **0 errors, 0 warnings**
- ✅ Maintains admin flow compatibility
- ✅ Integrates with existing admin dashboard

---

## 🎓 How It Works

### The Flow
1. **Vendor captures payment** in modal
2. **System creates draft request** (not yet official)
3. **Vendor uploads proof** (if transfer)
4. **Request submitted** to pending_review status
5. **Admin reviews** in dashboard
6. **Admin approves** → Payment recorded officially
7. **Balance updates** ← Only after admin approval
8. **Commission released** ← Only if order fully paid

### Why This Way?
- **No premature balance updates** → Admin controls official record
- **Verification trail** → Both parties can reference the request
- **Proof storage** → Transfers require documentation
- **Commission safety** → Can't release until admin confirms payment received
- **Audit trail** → All actions logged with timestamps and user IDs

---

## 🔍 Verification

Run after deployment:
```bash
npm run build
# Should show: ✓ 2839 modules transformed. ✓ built in ~4s
```

Test with vendor account:
1. Open Socios Comerciales → [Partner] → Mayoreo
2. Click "Registrar Pago"
3. Should see: "Reportar Cobro Mayoreo"
4. Orders should be pre-populated if pending

Test with admin account:
1. Open Socios Comerciales → Comisiones
2. Scroll to: "Cobros pendientes de revisión"
3. Should see vendor-reported payments
4. Approve/reject buttons should work

---

## 📚 Related Files

- [PartnerPaymentForm.tsx](PartnerPaymentForm.tsx) - Comodato implementation (same pattern)
- [PendingPaymentVerifications.tsx](PendingPaymentVerifications.tsx) - Admin dashboard
- [paymentVerificationRpcs.ts](paymentVerificationRpcs.ts) - RPC wrappers
- [migration_partner_payment_verification_v2.sql](migration_partner_payment_verification_v2.sql) - Backend

---

## 🎉 Summary

**What changed:** WholesalePaymentForm now uses the payment verification system for vendors

**What's the same:** Admin users can still insert payments directly (unchanged)

**Result:** Vendors and admins have clear, separate workflows with proper balance updates and approval tracking
