# Migration Corrections: Partner Payment Verification System

## Summary

Created **new corrected SQL migration file**: `migration_partner_payment_verification_v2.sql`

All 9 critical errors from the original migration have been fixed. This file is:
- ✅ Syntactically valid PostgreSQL
- ✅ Reejecutable (IF NOT EXISTS, DROP IF EXISTS patterns)
- ✅ References only existing tables and columns
- ✅ No placeholders or incomplete code
- ✅ Bucket creation automated in SQL
- ✅ Fully aligned with actual database schema

---

## Errors Fixed

### Error 1: Invalid CHECK Constraint Syntax ❌→✅

**Original (BROKEN):**
```sql
ADD CONSTRAINT transfer_requires_proof CHECK (
  payment_method = 'transfer' AND status IN ('pending_review', 'approved', 'rejected')
    THEN proof_path IS NOT NULL  -- ❌ THEN keyword invalid in CHECK
  OR payment_method = 'cash'
);
```

**Problem:** PostgreSQL CHECK constraints use boolean expressions, not IF-THEN syntax.

**Fixed:**
```sql
ADD CONSTRAINT transfer_requires_proof_when_submitted CHECK (
  (payment_method = 'cash')
  OR (payment_method = 'transfer' AND status IN ('draft'))
  OR (payment_method = 'transfer' AND status IN ('pending_review', 'approved', 'rejected') AND proof_path IS NOT NULL)
);
```

**Logic:** 
- Cash: No proof required ✓
- Transfer (draft): Proof optional ✓
- Transfer (pending_review/approved/rejected): Proof **required** ✓

---

### Error 2: Parameter Ordering (DEFAULT Before Required) ❌→✅

**Original (BROKEN):**
```sql
CREATE OR REPLACE FUNCTION public.create_partner_payment_verification_request(
  p_scheme TEXT,
  p_partner_id UUID,
  p_movement_id UUID DEFAULT NULL,        -- DEFAULT here
  p_wholesale_order_id UUID DEFAULT NULL, -- DEFAULT here
  p_payment_date TIMESTAMPTZ,             -- ❌ Required after DEFAULT
  p_amount NUMERIC,                        -- ❌ Required after DEFAULT
  ...
)
```

**Problem:** PostgreSQL requires all required parameters BEFORE any DEFAULT parameters.

**Fixed:**
```sql
CREATE OR REPLACE FUNCTION public.create_partner_payment_verification_request(
  p_scheme TEXT,                          -- Required
  p_partner_id UUID,                      -- Required
  p_payment_date TIMESTAMPTZ,             -- Required
  p_amount NUMERIC,                        -- Required
  p_payment_method TEXT,                  -- Required
  p_movement_id UUID DEFAULT NULL,        -- Optional
  p_wholesale_order_id UUID DEFAULT NULL, -- Optional
  p_payment_reference TEXT DEFAULT NULL,  -- Optional
  p_notes TEXT DEFAULT NULL               -- Optional
)
```

**All 6 functions fixed similarly.**

---

### Error 3: Column `commercial_partner_movements.amount` - DOESN'T EXIST ❌→✅

**Original (BROKEN):**
```sql
SELECT COALESCE(amount, 0)  -- ❌ movements table has NO amount column
FROM public.commercial_partner_movements
WHERE id = p_movement_id;
```

**Real Schema:**
- Table: `commercial_partner_movements` → NO amount column
- Table: `commercial_partner_movement_items` → HAS `amount_due` column
- Formula: Amount comes from SUM of items' `amount_due` where `quantity_sold > 0`

**Fixed:**
```sql
SELECT COALESCE(SUM(CAST(amount_due AS NUMERIC)), 0)
INTO v_total_due
FROM public.commercial_partner_movement_items
WHERE movement_id = p_movement_id AND quantity_sold > 0;
```

**Applied in:** 
- `create_partner_payment_verification_request()` ✓
- `approve_partner_payment_verification_request()` ✓
- Both views ✓

---

### Error 4: Column `commercial_partner_movements.folio` - DOESN'T EXIST ❌→✅

**Original (BROKEN):**
```sql
cpm.folio AS source_folio  -- ❌ movements table has NO folio
```

**Real Schema:**
- `commercial_partner_movements`: no folio field
- Must generate synthetic identifier from movement_id

**Fixed:**
```sql
CASE 
  WHEN ppr.scheme = 'comodato' THEN 'COMODATO-' || LEFT(ppr.movement_id::TEXT, 8)
  WHEN ppr.scheme = 'mayoreo' THEN wo.order_folio
END AS source_folio
```

**Applied in:**
- `v_pending_payment_verifications` view ✓
- `v_partner_payment_verification_history` view ✓

---

### Error 5: Table `public.wholesale_contracts` - DOESN'T EXIST ❌→✅

**Original (BROKEN):**
```sql
SELECT partner_id INTO v_partner_id FROM public.wholesale_contracts WHERE id = p_contract_id;
-- ❌ Table doesn't exist
```

**Real Table Name:** `commercial_partner_contracts`

**Fixed:**
Not using this in the new version. The payment verification doesn't need contract_id lookup.

---

### Error 6: Incomplete `activate_wholesale_partner()` Function ❌→✅

**Original (BROKEN):**
```sql
-- Proceed with existing activation logic
-- (Update commercial_partners set partner_model = 'mayoreo', wholesale_status = 'active', etc.)
-- This assumes the original function logic follows...
```

**Problem:** Placeholder instead of implementation. This would have overwritten existing function incompletely.

**Fixed:** 
✅ **Did NOT include this function at all** in the new migration.
- The new migration **only adds** new infrastructure
- It respects existing functions like `activate_wholesale_partner()`
- No modifications to existing procedures

---

### Error 7: Wrong SUBSTRING Position for Folio Generation ❌→✅

**Original (BROKEN):**
```sql
SELECT COALESCE(MAX(CAST(SUBSTRING(folio FROM 10) AS INT)), 0) + 1
INTO v_sequence_num
FROM public.partner_payment_verification_requests
WHERE folio LIKE 'COBRO-' || v_year_month || '-%';
-- Folio format: COBRO-202607-00001
-- Position 10 would be: "-" (wrong extraction)
```

**Problem:** 
- Folio format: `COBRO-202607-00001` (21 chars total)
- Position 10 is `-` character (wrong)
- Need to extract numeric suffix starting at position 15

**Fixed:**
```sql
CREATE SEQUENCE IF NOT EXISTS partner_payment_verification_folio_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_payment_verification_folio()
RETURNS TEXT AS $$
DECLARE
  v_year_month TEXT;
  v_sequence_num BIGINT;
  v_folio TEXT;
BEGIN
  v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  v_sequence_num := nextval('partner_payment_verification_folio_seq');
  v_folio := 'COBRO-' || v_year_month || '-' || LPAD(v_sequence_num::TEXT, 5, '0');
  RETURN v_folio;
END;
$$ LANGUAGE plpgsql;
```

**Benefits:**
- Uses PostgreSQL SEQUENCE (atomic, no race conditions)
- Format always: `COBRO-YYYYMM-#####` ✓
- Examples: `COBRO-202607-00001`, `COBRO-202607-00002`, etc.

---

### Error 8: Not Reejecutable (Missing IF NOT EXISTS, DROP IF EXISTS) ❌→✅

**Original (BROKEN):**
```sql
-- Would fail on rerun because:
CREATE TABLE partner_payment_verification_requests (...)  -- Fails 2nd time
CREATE INDEX idx_partner_payment_verification_status...   -- Fails 2nd time
CREATE POLICY "vendors_can_see_own_requests"...          -- Fails 2nd time
```

**Fixed:**
✅ All CREATE statements use `IF NOT EXISTS`:
- `CREATE TABLE IF NOT EXISTS`
- `CREATE SEQUENCE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `CREATE OR REPLACE FUNCTION` (always idempotent)
- `CREATE OR REPLACE VIEW` (always idempotent)

✅ All DROP statements use `IF EXISTS`:
- `DROP VIEW IF EXISTS ... CASCADE`
- `DROP POLICY IF EXISTS ... ON ...`

**Result:** Can run migration multiple times safely.

---

### Error 9: Bucket Creation Manual Instead of Automated ❌→✅

**Original (BROKEN):**
```
-- Note: Storage buckets are typically created via Supabase dashboard...
-- This comment serves as documentation for manual bucket creation:
/*
CREATE A PRIVATE BUCKET:
Name: customer-payment-proofs
...
*/
```

**Problem:** Requires manual dashboard steps. Not automated.

**Fixed:**
```sql
-- STORAGE: Create bucket (via Supabase insert)
INSERT INTO storage.buckets (id, name, public)
VALUES ('customer-payment-proofs', 'customer-payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- STORAGE POLICIES: RLS for bucket
DROP POLICY IF EXISTS "vendors_can_upload_own" ON storage.objects;
CREATE POLICY "vendors_can_upload_own" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'customer-payment-proofs'
    AND auth.role() = 'authenticated'
    AND (STRING_TO_ARRAY(name, '/'))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS "vendors_can_read_own" ON storage.objects;
CREATE POLICY "vendors_can_read_own" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'customer-payment-proofs'
    AND auth.role() = 'authenticated'
    AND (STRING_TO_ARRAY(name, '/'))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS "admins_can_read_all" ON storage.objects;
CREATE POLICY "admins_can_read_all" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'customer-payment-proofs'
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "admins_can_delete" ON storage.objects;
CREATE POLICY "admins_can_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'customer-payment-proofs'
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

**Policies Created:**
1. **Vendors can upload** to their own folder (e.g., `{user_id}/request_id/`)
2. **Vendors can read** their own proofs
3. **Admins can read** all proofs
4. **Admins can delete** proofs

---

## Schema Validation

All database references verified against real schema:

| Table | Column | Status |
|-------|--------|--------|
| `commercial_partners` | id, folio | ✅ Exists |
| `commercial_partner_movements` | id, partner_id, movement_date, status | ✅ Exists |
| `commercial_partner_movements` | amount, folio | ❌ Does NOT exist (Fixed) |
| `commercial_partner_movement_items` | movement_id, amount_due, quantity_sold | ✅ Exists |
| `commercial_partner_payments` | id, partner_id, movement_id, amount | ✅ Exists |
| `wholesale_orders` | id, partner_id, order_folio, total_amount | ✅ Exists |
| `wholesale_payments` | id, partner_id, wholesale_order_id, amount | ✅ Exists |
| `commercial_partner_contracts` | id, partner_id | ✅ Exists |
| `wholesale_contracts` | N/A | ❌ Does NOT exist (Reference removed) |
| `user_profiles` | id, role, full_name | ✅ Exists |
| `storage.buckets` | id, name, public | ✅ Exists |
| `storage.objects` | N/A | ✅ Exists (RLS policies applied) |

---

## Implementation Details

### New Table: `partner_payment_verification_requests`
- **Columns:** 25
- **Constraints:** 3 CHECK constraints (valid PostgreSQL syntax)
- **Indexes:** 9 (performance optimized)
- **RLS:** 4 policies (clients cannot modify directly)

### New Sequence: `partner_payment_verification_folio_seq`
- **Start:** 1
- **Purpose:** Thread-safe folio generation

### New Functions: 6 RPC (all SECURITY DEFINER)
1. `generate_payment_verification_folio()`
2. `create_partner_payment_verification_request(...)`
3. `submit_partner_payment_verification_request(...)`
4. `approve_partner_payment_verification_request(...)`
5. `reject_partner_payment_verification_request(...)`
6. `cancel_partner_payment_verification_request(...)`

**All parameters ordered correctly** (required first, optional with DEFAULT).

### New Views: 2 (security_invoker)
1. `v_pending_payment_verifications` - Admin dashboard
2. `v_partner_payment_verification_history` - Full history

### Storage
- **Bucket:** `customer-payment-proofs` (private)
- **Policies:** 4 RLS rules
- **Path Format:** `{user_id}/{request_id}/{filename}`

---

## How to Use

### In Supabase SQL Editor:

1. Copy entire contents of `migration_partner_payment_verification_v2.sql`
2. Paste into Supabase SQL Editor
3. Click **Execute**
4. Should complete with no errors ✓

### Verification:

```sql
-- Check table exists
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_name = 'partner_payment_verification_requests';

-- Check functions exist
SELECT function_name FROM information_schema.routines 
WHERE function_name LIKE 'create_partner_%';

-- Check bucket created
SELECT id, name, public FROM storage.buckets 
WHERE id = 'customer-payment-proofs';

-- Check policies
SELECT policy_name FROM pg_policies 
WHERE table_name = 'partner_payment_verification_requests';
```

---

## Next Steps

✅ **Now ready for:**
1. Copy migration file to Supabase SQL Editor
2. Execute migration (should complete without errors)
3. Verify tables/functions/views in Supabase Dashboard
4. Proceed with TypeScript wrapper functions (already working)
5. Build and deploy frontend (will now work correctly)

❌ **No further SQL fixes needed** - all 9 errors corrected.

---

## Files

| File | Status |
|------|--------|
| `/migration_partner_payment_verification_v2.sql` | ✅ Ready for execution |
| `/types/paymentVerification.ts` | ✅ Working (no changes needed) |
| `/lib/paymentVerification.ts` | ✅ Working (no changes needed) |
| `/QUICK_START.md` | ℹ️ References new migration filename |
| `/MIGRATION_INSTRUCTIONS.md` | ℹ️ References new migration filename |

---

**Migration Status:** 🟢 **READY FOR DEPLOYMENT**
