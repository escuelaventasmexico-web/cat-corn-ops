# Quick Integration Guide

## Status
✅ All components built and passing TypeScript compilation  
✅ RPC wrappers ready to use  
✅ 4 new components ready to integrate  

---

## Step 1: Integrate into Comodato

**File:** `components/commercialPartners/comodato/CommercialPartnerComodato.tsx`

### 1a. Add Import
```tsx
import ReportPaymentModal from '../ReportPaymentModal';
```

### 1b. Find the "Pago" Button Section
Look for existing payment button/modal:
```tsx
// Replace or update this section:
{showPaymentModal && (
  <PartnerPaymentForm ... />
)}
```

### 1c. Replace with New Modal
```tsx
{showPaymentModal && (
  <ReportPaymentModal
    partnerId={partnerId}
    scheme="comodato"
    movements={comodatoMovements.filter(m => 
      m.movement_type === 'settlement' && m.status === 'completed'
    )}
    onClose={() => setShowPaymentModal(false)}
    onSuccess={() => {
      // Refresh all relevant data
      loadBalance();
      loadPayments();
      loadMovementHistory();
      loadCommissions?.();
    }}
  />
)}
```

### 1d. Update Button Label
```tsx
// Change button text from "Pago" to:
<button onClick={() => setShowPaymentModal(true)}>
  Reportar cobro
</button>
```

---

## Step 2: Integrate into Mayoreo/Wholesale

**File:** `components/commercialPartners/wholesale/CommercialPartnerWholesale.tsx`

### 2a. Add Import
```tsx
import ReportPaymentModal from '../ReportPaymentModal';
```

### 2b. Replace Payment Modal
```tsx
{showPaymentModal && (
  <ReportPaymentModal
    partnerId={partnerId}
    scheme="mayoreo"
    wholesaleOrders={wholesaleOrders.filter(o => 
      o.order_status in ['delivered', 'completed']
    )}
    onClose={() => setShowPaymentModal(false)}
    onSuccess={() => {
      loadBalance();
      loadOrders();
      loadOrderHistory();
      loadCommissions?.();
    }}
  />
)}
```

### 2c. Update Button Label
```tsx
<button onClick={() => setShowPaymentModal(true)}>
  Reportar cobro
</button>
```

---

## Step 3: Add Admin Dashboard Section

**File:** `components/commercialPartners/commissions/AdminCommissionDashboard.tsx`

### 3a. Add Import
```tsx
import AdminPaymentVerificationsSection from '../AdminPaymentVerificationsSection';
```

### 3b. Add Section to Dashboard
```tsx
export const AdminCommissionDashboard = () => {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefreshData = () => {
    // Reload commissions, balances, etc.
    loadCommissions();
    loadBalances();
    setRefreshKey(k => k + 1); // Force re-render
  };

  return (
    <div className="space-y-6">
      {/* Existing commission displays */}
      
      {/* NEW: Add this section */}
      <AdminPaymentVerificationsSection 
        key={refreshKey}
        onRefresh={handleRefreshData} 
      />
    </div>
  );
};
```

---

## Step 4: Add Mayoreo Activation Block

**File:** `components/commercialPartners/wholesale/WholesaleActivationWizard.tsx`

### 4a. Add Import
```tsx
import { getComodatoPendingBalance } from '../../../lib/paymentVerificationRpcs';
```

### 4b. Add Balance Check
```tsx
const handleActivateMayoreo = async () => {
  try {
    // Check if partner has pending comodato balance
    const pendingBalance = await getComodatoPendingBalance(partnerId);
    
    if (pendingBalance > 0) {
      setError(
        `No se puede activar mayoreo. El socio mantiene adeudo de ${pendingBalance.toLocaleString('es-MX', {
          style: 'currency',
          currency: 'MXN'
        })}`
      );
      return;
    }
    
    // Proceed with activation
    await activateWholesale();
    setSuccess('Mayoreo activado correctamente');
    
  } catch (err: any) {
    setError(err.message);
  }
};
```

---

## Verification Commands

### Build Check
```bash
npm run build
```
Expected: ✅ 0 TypeScript errors

### Quick Import Test
```tsx
// In any component
import ReportPaymentModal from 'components/commercialPartners/ReportPaymentModal';
import AdminPaymentVerificationsSection from 'components/commercialPartners/AdminPaymentVerificationsSection';
import { getPendingPaymentVerifications } from 'lib/paymentVerificationRpcs';

// Should work without errors
```

---

## Runtime Checklist

After integrating and deploying:

- [ ] Vendor can open "Reportar cobro" in comodato
- [ ] Vendor can open "Reportar cobro" in mayoreo
- [ ] Vendor can select operation with auto-select
- [ ] Vendor can submit efectivo without proof
- [ ] Vendor can upload proof for transferencia
- [ ] Vendor sees request in history as "En revisión"
- [ ] Admin sees badge "X cobros pendientes"
- [ ] Admin can open verification details
- [ ] Admin can approve → balance updates
- [ ] Admin can reject → no balance change
- [ ] Mayoreo activation blocked if comodato balance > 0

---

## Component Prop Reference

### ReportPaymentModal Props
```tsx
interface ReportPaymentModalProps {
  partnerId: string;
  scheme: 'comodato' | 'mayoreo';
  movements?: ComodatoMovement[];  // For comodato
  wholesaleOrders?: WholesaleOrder[]; // For mayoreo
  onClose: () => void;
  onSuccess: () => void;
}
```

### AdminPaymentVerificationsSection Props
```tsx
interface AdminPaymentVerificationsSectionProps {
  onRefresh?: () => void;
}
```

### PaymentVerificationReviewModal Props
```tsx
interface PaymentVerificationReviewModalProps {
  verification: PendingPaymentVerification;
  onClose: () => void;
  onSuccess: () => void;
}
```

### PaymentVerificationHistory Props
```tsx
interface PaymentVerificationHistoryProps {
  partnerId: string;
  vendorId?: string;  // Optional filter for vendor view
}
```

---

## Common Integration Patterns

### Pattern 1: Show Modal on Button Click
```tsx
const [showPaymentModal, setShowPaymentModal] = useState(false);

<button onClick={() => setShowPaymentModal(true)}>
  Reportar cobro
</button>

{showPaymentModal && (
  <ReportPaymentModal
    partnerId={partnerId}
    scheme="comodato"
    movements={validMovements}
    onClose={() => setShowPaymentModal(false)}
    onSuccess={() => {
      setShowPaymentModal(false);
      // Refresh data
    }}
  />
)}
```

### Pattern 2: Filter Operations
```tsx
// For comodato: only settled/completed movements
const validComodatoMovements = comodatoMovements.filter(m => 
  m.movement_type === 'settlement' && m.status === 'completed'
);

// For mayoreo: only delivered/completed orders
const validWholesaleOrders = wholesaleOrders.filter(o => 
  o.order_status in ['delivered', 'completed']
);
```

### Pattern 3: Refresh After Success
```tsx
const handlePaymentSuccess = () => {
  // Refresh all affected data
  loadBalance();           // Update balance display
  loadPayments();          // Update payment history
  loadCommissions?.();     // Update commission display
  setShowPaymentModal(false);
};
```

---

## Error Handling

### Common Errors & Solutions

**Error: "Usuario no autenticado"**
- Cause: Supabase session lost
- Solution: Component checks auth automatically, user logged back in

**Error: "Supabase no inicializado"**
- Cause: Supabase client not available
- Solution: Check supabase.ts configuration

**Error: "El monto no puede exceder el saldo pendiente"**
- Cause: Amount entered exceeds operation balance
- Solution: Vendor should enter amount ≤ pending balance

**Error: "No se pudo cargar el comprobante"**
- Cause: Proof file not found or storage error
- Solution: Admin can still approve/reject without viewing proof

---

## Database Integration

All components use **RPC functions only** - no direct database access.

### RPC Functions Called

**By ReportPaymentModal:**
- `createPaymentVerificationRequest()` - Creates draft
- `submitPaymentVerificationRequest()` - Submits for review
- `uploadPaymentProof()` - Uploads file to storage

**By AdminPaymentVerificationsSection:**
- `getPendingPaymentVerifications()` - Fetches pending list

**By PaymentVerificationReviewModal:**
- `getPaymentProofSignedUrl()` - Gets URL for proof viewing
- `approvePaymentVerificationRequest()` - Approves and creates payment
- `rejectPaymentVerificationRequest()` - Rejects request

**By WholesaleActivationWizard:**
- `getComodatoPendingBalance()` - Checks balance for block

---

## Next Steps

1. ✅ Review this integration guide
2. ⏳ Apply changes to 4 existing components
3. ⏳ Run `npm run build` to verify
4. ⏳ Test in development environment
5. ⏳ Deploy to production

---

## Support Files

- `PAYMENT_VERIFICATION_FRONTEND.md` - Full implementation details
- `lib/paymentVerificationRpcs.ts` - RPC wrappers (ready to use)
- `components/commercialPartners/ReportPaymentModal.tsx` - Vendor modal
- `components/commercialPartners/AdminPaymentVerificationsSection.tsx` - Admin section
- `components/commercialPartners/PaymentVerificationReviewModal.tsx` - Admin review
- `components/commercialPartners/PaymentVerificationHistory.tsx` - History display

All files are TypeScript strict mode compliant and tested with `npm run build`.
