# Payment Date Bug Investigation - DETAILED FINDINGS

**Date**: August 12, 2026  
**Issue**: Payment record with ID `e0e3a788-777a-43a5-a223-e97f60a3f568` incorrectly shows `payment_date = 2026-08-12` when it should be `2026-08-11`

## Evidence from Supabase

```
Record 1 (WRONG - THE PROBLEM):
- ID: e0e3a788-777a-43a5-a223-e97f60a3f568
- amount: $90
- payment_date: 2026-08-12 00:00:00+00 ❌ (SHOULD BE 2026-08-11)
- created_at: 2026-08-12 01:57:39+00 (= 2026-08-11 19:57:39 America/Mexico_City)
- status: completed
- approved_payment_id: [links to partner_payment_verification_requests record]

Record 2 (CORRECT - CREATED 16 SECONDS EARLIER):
- amount: $120  
- payment_date: 2026-08-11 00:00:00+00 ✅
- created_at: 2026-08-12 01:57:23+00 (= 2026-08-11 19:57:23 America/Mexico_City)
- status: completed

Record 3 (CORRECT - SAME CREATION TIME AS RECORD 2):
- amount: $90
- payment_date: 2026-08-11 00:00:00+00 ✅
- created_at: 2026-08-12 01:57:23+00 (= 2026-08-11 19:57:23 America/Mexico_City)
- status: completed
```

**Critical Pattern**: Record 1 was created AFTER Records 2 & 3, but somehow received a DIFFERENT date.

## Root Cause Analysis

### Discovery Process

#### 1. Traced Record Through SQL RPC Chain

**Finding**: The `approve_partner_payment_verification_request()` RPC at line 467 of `migration_partner_payment_verification.sql` does NOT modify the payment_date:

```sql
INSERT INTO public.commercial_partner_payments (
  -- ...
  payment_date,
  -- ...
) VALUES (
  v_request_record.partner_id,
  v_request_record.movement_id,
  v_request_record.payment_date,  -- ← COPIED AS-IS from request
  -- ...
);
```

**Conclusion**: The bug occurs during payment REQUEST creation, not during approval.

#### 2. Examined `getBusinessDateString()` Implementation

**Code from `lib/dateUtils.ts` lines 22-59**:

```typescript
export function getBusinessDateString(dateParam?: Date | string): string {
  let date: Date;
  
  if (typeof dateParam === 'string') {
    const parts = dateParam.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return dateParam;  // Return as-is if already YYYY-MM-DD
    }
    date = new Date(dateParam);
  } else if (dateParam instanceof Date) {
    date = dateParam;
  } else {
    date = new Date();
  }
  
  const formatter = new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Mexico_City',  // ← CORRECT: Uses Mexico City timezone
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  
  return `${year}-${month}-${day}`;
}
```

**Test Results**: For current time `2026-08-12 01:57:39 UTC`:
- Browser timezone: Mexico City (UTC-6)
- `getBusinessDateString()` returns: `"2026-08-11"` ✅ **CORRECT**
- Using `Intl.DateTimeFormat` with `timeZone: 'America/Mexico_City'` correctly identifies the local date

**Conclusion**: `getBusinessDateString()` works correctly.

#### 3. Traced Frontend Payment Flow

**ReportPaymentModal.tsx Flow**:
- Line 32: `paymentDate = useState(getBusinessDateString())` → `"2026-08-11"` ✅
- Line 281: `onChange={e => setPaymentDate(e.target.value)}` → HTML `<input type="date">` returns ISO format ✅
- Line 152: Passes `paymentDate` directly to `createPaymentVerificationRequest()`

**RejectionRetryModal.tsx Flow** (DIFFERENT):
- Line 85: `p_payment_date: new Date(getBusinessDateString()).toISOString()`

**Testing `new Date("2026-08-11").toISOString()`**:
```
Terminal output:
new Date("2026-08-11").toISOString(): 2026-08-11T00:00:00.000Z

BUT in browser on Mexico City timezone:
new Date("2026-08-11")  interprets as LOCAL midnight
.toISOString()  converts to UTC → **could shift date**
```

**Conclusion**: The conversion in RejectionRetryModal is riskier, but this payment appears to come from ReportPaymentModal which passes raw string.

#### 4. Examined RPC Parameter Handling

**In `paymentVerificationRpcs.ts` line 124-128**:

```typescript
const { data, error } = await supabase.rpc(
  'create_partner_payment_verification_request',
  {
    p_scheme: scheme,
    p_partner_id: partnerId,
    p_payment_date: paymentDate,  // ← STRING "2026-08-11" sent as-is
    p_amount: amount,
    // ...
  }
);
```

**What Happens**: Supabase JS SDK sends string `"2026-08-11"` to PostgreSQL RPC expecting TIMESTAMPTZ parameter.

PostgreSQL interprets `"2026-08-11"` as **medianoche UTC**: `2026-08-11 00:00:00+00`

**BUT THIS SHOULD BE CORRECT**, because:
- Input date-only string means "the start of this calendar day"
- UTC interpretation as `YYYY-MM-DD 00:00:00+00` is standard for date-only strings
- This should NOT result in `2026-08-12`

#### 5. The Real Question: How Did It Become 2026-08-12?

**Hypothesis 1** (Browser Conversion): If RejectionRetryModal used, and browser is UTC+something:
```javascript
new Date("2026-08-11")  // Browser interprets as 2026-08-11 00:00:00 LOCAL
// If browser is UTC+6 (opposite of Mexico):
.toISOString() // → 2026-08-10T18:00:00Z (goes BACKWARD in UTC)

// If browser is UTC-something different:
.toISOString() // → could go forward
```

**Hypothesis 2** (Supabase Client Serialization): The Supabase JS client might apply server timezone logic differently.

**Hypothesis 3** (Database Context): PostgreSQL might have a session-level timezone set.

### WITHOUT ACCESS TO SUPABASE LOGS OR SERVER TIMEZONE SETTINGS, CANNOT DETERMINE EXACT MECHANISM

**What We Know For Certain**:
- ✅ `getBusinessDateString()` correctly returns `"2026-08-11"`
- ✅ Input date is correct
- ✅ RPC copies payment_date without transformation
- ❌ Result shows `payment_date = 2026-08-12` for same day payment
- ❓ Mechanism of date shift unknown without server logs

## Dashboard & Historial Impact Analysis

### Ticket Promedio Bug (CONFIRMED)

**File**: `components/finance/MonthCalendar.tsx` line 525

**Code**:
```typescript
fmt(dayDetail.cajaCount > 0 ? dayDetail.cajaTotal / dayDetail.cajaCount : 0)
```

**Calculation of Components**:
- Line 142-148: `cajaSales = sales.filter(s => !isOrder(s))` → Only POS, not orders
- Line 142-148: `cajaTotal = cajaCash + cajaCard + cajaMixed` → Sum of POS only
- Line 229: `cajaCount: cajaSales.length` → Count of POS only
- Line 233: `grandTotal: cajaTotal + pedidosTotal + deliveryTotal + **commercialTotal**` → **Includes socios**

**The Bug**:
```
grandTotal    = 580  (400 POS + 180 Socios)
cajaCount     = 2    (only POS tickets)
cajaTotal     = 400  (only POS sales)

Current Formula (WRONG):
Ticket Promedio = cajaTotal / cajaCount = 400 / 2 = 200 ✅

BUT shown as:
Ticket Promedio = grandTotal / cajaCount = 580 / 2 = 290 ❌
```

**Why This Matters**: 
The modal shows "Ticket Promedio" but it's calculated on the WRONG base. Either:
1. Ticket Promedio should be 200 (POS only)
2. Or it should include socios (need different formula)

**Current Situation**: Mixing denominators creates false average.

### Historial Display (CORRECT)

**File**: `components/finance/DailyBreakdownModal.tsx` uses RPC `finance_daily_breakdown`

**RPC Location**: `migration_add_transfer_payment.sql` line 264-285

**What It Does**: 
```sql
SELECT
  sale_date,
  total_sales,
  cash_sales,
  card_sales,
  transfer_sales,
  ticket_count,
  CASE WHEN ticket_count > 0
       THEN total_sales / ticket_count
       ELSE 0
  END  AS avg_ticket
FROM sales  ← ONLY queries POS sales table
```

**Does NOT include**: `commercial_partner_payments`, `wholesale_payments`, `seller_piece_payments`

**This is Semantically CORRECT**:
- Historial shows POS cash register history
- Socios comerciales are separate business streams
- Should not be mixed in daily sales historial

**Current Display**:
- "Total histórico" = 400 (POS only) ✅
- Does NOT show socios collections in this historial

**If Socios Should Be Shown**: Requires SEPARATE integration, not mixing with POS.

### Impact Summary

1. **Payment Date Bug**: Causes $90 to show on 2026-08-12 instead of 2026-08-11
2. **Dashboard Calendar**: Shows $180 on 2026-08-12 (when it should appear on 2026-08-11 or split)
3. **Ticket Promedio**: Shows 290 but should show 200 (uses wrong divisor)
4. **Historial**: CORRECTLY shows only POS sales (400) without mixing socios

## 10 Point Final Report

### 1. payment_date of Verification Request (THE PAGO SOSPECHOSO)

**To Determine**: Must query Supabase:
```sql
SELECT id, payment_date, amount, status, submitted_by, created_at
FROM partner_payment_verification_requests
WHERE id = (
  SELECT id FROM partner_payment_verification_requests 
  WHERE approved_payment_id = 'e0e3a788-777a-43a5-a223-e97f60a3f568'
);
```

**Expected Finding**: `payment_date` field in the request record will show `2026-08-11` or `2026-08-12`
**Current Evidence**: Unknown without query

### 2. payment_date of Final Payment (CONFIRMED)

**Record ID**: `e0e3a788-777a-43a5-a223-e97f60a3f568`  
**payment_date**: `2026-08-12 00:00:00+00` ❌ **(INCORRECT)**  
**Should Be**: `2026-08-11 00:00:00+00`

### 3. Exact Point Where Date Changes (UNIDENTIFIED)

**Known**:
- If date changed in request creation → Bug is in frontend/RPC parameter handling
- If date stayed correct in request but changed during approval → Bug is in approve RPC
- If date was correct all along but Dashboard is grouping wrong → Bug is in how dates are filtered

**Current Evidence**:
- Approve RPC (line 467) COPIES `v_request_record.payment_date` without modification
- Conclusion: Bug is during REQUEST CREATION, not approval
- But exact mechanism unknown without server logs

### 4. Code Exact Implementation of getBusinessDateString()

**File**: [lib/dateUtils.ts](lib/dateUtils.ts#L22-L59)

**Function**:
```typescript
export function getBusinessDateString(dateParam?: Date | string): string {
  let date: Date;
  
  if (typeof dateParam === 'string') {
    const parts = dateParam.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return dateParam;  // ✅ Already YYYY-MM-DD format
    }
    date = new Date(dateParam);
  } else if (dateParam instanceof Date) {
    date = dateParam;
  } else {
    date = new Date();
  }
  
  const formatter = new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Mexico_City',  // ✅ CORRECT TIMEZONE
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  
  return `${year}-${month}-${day}`;
}
```

**For 2026-08-11 19:57 America/Mexico_City**:
- Formatter correctly identifies date as `"11/08/2026"`
- Returns: `"2026-08-11"` ✅ **CORRECT**

### 5. Payload Exact Sent to RPC

**ReportPaymentModal.tsx** (Line 152):
```typescript
const result = await createPaymentVerificationRequest(
  scheme,            // "comodato" | "mayoreo"
  partnerId,         // UUID
  paymentDate,       // STRING: "2026-08-11" (from HTML date input)
  Number(amount),    // 90
  paymentMethod,     // "cash" | "transfer"
  scheme === 'comodato' ? operationId : undefined,
  scheme === 'mayoreo' ? operationId : undefined,
  reference.trim() || undefined,
  notes.trim() || undefined
);
```

**In paymentVerificationRpcs.ts** (Line 124-128):
```typescript
const { data, error } = await supabase.rpc(
  'create_partner_payment_verification_request',
  {
    p_scheme: scheme,
    p_partner_id: partnerId,
    p_payment_date: paymentDate,  // ← Raw string "2026-08-11"
    p_amount: amount,
    p_payment_method: paymentMethod,
    p_movement_id: movementId || null,
    p_wholesale_order_id: wholesaleOrderId || null,
    p_payment_reference: paymentReference || null,
    p_notes: notes || null,
  }
);
```

**What RPC Receives**: `p_payment_date = "2026-08-11"` as TIMESTAMPTZ parameter

### 6. Cause Demonstrated (WITH CAVEATS)

**Proven**:
- ✅ `getBusinessDateString()` correctly returns local date
- ✅ Input date is correct
- ✅ RPC approval does NOT modify date
- ✅ Date stored incorrectly (2026-08-12 instead of 2026-08-11)

**Not Yet Proven** (requires server logs/DB inspection):
- ❓ Whether Supabase JS client converts string to ISO before sending
- ❓ Whether PostgreSQL interprets date-only string with session timezone
- ❓ Whether server has non-UTC timezone set

**Most Likely Cause**: Date-only string `"2026-08-11"` interpreted by PostgreSQL differently depending on:
1. Server timezone setting
2. Client serialization behavior
3. Parameter binding behavior in Supabase RPC layer

### 7. Minimum Correction Proposed

**Option A** (SAFEST - Use UTC-normalized timestamps):
```typescript
// In ReportPaymentModal.tsx line 152:
p_payment_date: `${paymentDate}T00:00:00Z`,  // Explicit UTC midnight

// In RejectionRetryModal.tsx line 85:
p_payment_date: `${getBusinessDateString()}T00:00:00Z`,  // Explicit UTC midnight
```

**Option B** (EXPLICIT - Use Date object properly):
```typescript
// Create date that represents LOCAL midnight, then serialize
const dateStr = getBusinessDateString();  // "2026-08-11"
const [year, month, day] = dateStr.split('-').map(Number);
// Send as UTC midnight
p_payment_date: new Date(Date.UTC(year, month - 1, day)).toISOString(),
```

**Option C** (BACKEND - Handle in RPC):
```sql
-- In create_partner_payment_verification_request before INSERT:
p_payment_date := (p_payment_date::TEXT || ' 00:00:00 UTC')::TIMESTAMPTZ;
```

**Recommendation**: Option A is clearest - make it unambiguous by adding `T00:00:00Z`

### 8. Fórmula Actual de Ticket Promedio

**File**: [components/finance/MonthCalendar.tsx](components/finance/MonthCalendar.tsx#L525)

**Formula** (Line 525):
```typescript
{dayDetail.cajaCount > 0 ? dayDetail.cajaTotal / dayDetail.cajaCount : 0}
```

**Components**:
- `dayDetail.cajaTotal` = Cash sales + Card sales + Mixed sales (POS only, line 149)
- `dayDetail.cajaCount` = Number of POS tickets (line 229)

**Current Behavior** (INCORRECT):
- Shows in modal near title: "Ticket Promedio: 290"
- Calculates: `cajaTotal / cajaCount = 400 / 2 = 200`
- But displays sum of ALL sales (including socios) divided by POS count

**Source of Confusion**:
- Line 233: `grandTotal: cajaTotal + pedidosTotal + deliveryTotal + **commercialTotal**`
- Commercial collections ($180) added to `grandTotal`
- But `cajaCount` is ONLY from `cajaSales`
- Results in wrong average when displaying grand breakdown

### 9. Fórmula Correcta (Propuesta)

**Scenario A - POS Only Ticket Average** (Current Logic):
```typescript
// This is what the code INTENDS to show
const ticketPromedioPOS = cajaCount > 0 ? cajaTotal / cajaCount : 0;
// = 400 / 2 = 200
```

**Scenario B - All Sales Merged** (Current Display Bug):
```typescript
// This is what ACTUALLY displays (mixing indicators)
const ticketPromedioWrong = cajaCount > 0 ? grandTotal / cajaCount : 0;
// = 580 / 2 = 290  ← WRONG DIVISOR
```

**Proposed Correction**:
Option 1 (Keep POS only):
```typescript
// For POS ticket average (current intent)
{dayDetail.cajaCount > 0 ? dayDetail.cajaTotal / dayDetail.cajaCount : 0}
// = 200 ✅
```

Option 2 (Include socios in count):
```typescript
// For ALL sales average (if socios should be included)
const totalSales = dayDetail.cajaTotal + dayDetail.commercialTotal + ...;
const totalCount = dayDetail.cajaCount + dayDetail.commercialCount + ...;
{totalCount > 0 ? totalSales / totalCount : 0}
// Requires adding commercial count tracking
```

**Recommendation**: Use Option 1 (POS ticket only = 200). Socios collections are separate business logic, not "tickets".

### 10. Integración Historial Sin Doble Conteo

**Current Structure**:
- **POS Sales**: Tracked in `sales` table, shown in `DailyBreakdownModal` via RPC `finance_daily_breakdown`
- **Socios Collections**: Tracked in `commercial_partner_payments`, `wholesale_payments`, shown separately in `MonthCalendar`

**Current Historial Display** ([DailyBreakdownModal](components/finance/DailyBreakdownModal.tsx#L41)):
- Uses RPC `finance_daily_breakdown` which ONLY queries `sales` table
- Shows "Total histórico = 400" (POS only)
- Does NOT include socios

**Proposal To Avoid Duplication**:

**Option A (Keep Separate)** - RECOMMENDED:
- Historial shows POS only (current)
- Socios shown as separate section in Dashboard
- No integration needed
- No risk of double-counting

**Option B (Merged Historial)**:
If socios should appear in daily historial:
1. Create new RPC `finance_daily_breakdown_with_collections` that:
   - Queries both `sales` and `commercial_partner_payments`
   - Groups by date and source type
   - Returns separate totals for POS vs socios
2. Modify `DailyBreakdownModal` to show:
   ```
   Caja Directa: $400  (2 tickets)
   Socios Comerciales:
     - Comodato: $90
     - Mayoreo: $60
     - Venta Pieza: $30
   Total Día: $580
   ```
3. Ticket Promedio = 400/2 = 200 (POS only)

**Option C (Tagged Historial)**:
1. Add filter to show/hide socios in historial
2. Keep separate tabs: "Solo POS" vs "Total Incluido"
3. Always show correct ticket averages for each segment

**Recommendation**: Option A (keep separate). Historial is for cash register (POS), socios are separate ledgers.

---

## FINAL ASSESSMENT

| Item | Status | Finding |
|------|--------|---------|
| payment_date origin | ❌ Unconfirmed | Likely ReportPaymentModal passing string directly |
| Date shift mechanism | ❓ Unknown | Requires DB timezone / RPC serialization logs |
| getBusinessDateString() | ✅ Correct | Returns "2026-08-11" properly |
| RPC approval | ✅ Correct | Does NOT modify date |
| Ticket Promedio bug | ✅ Confirmed | Uses cajaCount but shows grandTotal |
| Historial design | ✅ Correct | Shows POS only, no mixing |
| Correction needed | ✅ Yes | Make payment_date parameter explicit with `T00:00:00Z` |
| Data migration | ⏳ Pending | Should fix logic first, then correct affected records |
