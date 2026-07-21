# Migration v2 - Execution Checklist

## What Changed?

### File Status
- ❌ `migration_partner_payment_verification.sql` — OLD (broken, do NOT use)
- ✅ `migration_partner_payment_verification_v2.sql` — NEW (corrected, ready to use)

### Summary of Fixes
- ✅ Fixed 9 critical errors
- ✅ Removed all invalid SQL syntax
- ✅ Corrected all column/table references
- ✅ Made re-executable (IF NOT EXISTS patterns)
- ✅ Automated bucket creation in SQL
- ✅ No placeholders or incomplete code
- ✅ All functions have parameters in correct order

---

## Execution Steps

### Step 1: Backup (Optional but Recommended)
```sql
-- If you already ran the old migration, back up the table first:
CREATE TABLE partner_payment_verification_requests_backup_backup AS
SELECT * FROM partner_payment_verification_requests;
```

### Step 2: Copy the New Migration File

1. Open: `/migration_partner_payment_verification_v2.sql` in VS Code
2. Select all: `Cmd+A` (Mac) or `Ctrl+A` (Windows)
3. Copy: `Cmd+C` or `Ctrl+C`

### Step 3: Execute in Supabase

1. Go to: https://app.supabase.com
2. Select your project
3. Click: **SQL Editor** (left sidebar)
4. Click: **New Query**
5. Paste the migration: `Cmd+V` or `Ctrl+V`
6. Click: **Execute** (or `Cmd+Enter`)

### Step 4: Wait for Completion

You should see:
```
Query executed successfully in 2.3s
```

**No errors** = Success ✓

### Step 5: Verify in Supabase Dashboard

Check these to confirm:
- **Tables:** Look for `partner_payment_verification_requests` (25 columns)
- **Functions:** Look for `create_partner_payment_verification_request`, etc. (6 functions)
- **Views:** Look for `v_pending_payment_verifications`, `v_partner_payment_verification_history` (2 views)
- **Storage:** Look for `customer-payment-proofs` bucket in Storage tab

---

## What if Something Goes Wrong?

### If you get an error like "table already exists"

This means the old broken migration partially ran. Solution:

```sql
-- Drop everything from the old migration:
DROP TABLE IF EXISTS partner_payment_verification_requests CASCADE;
DROP FUNCTION IF EXISTS public.create_partner_payment_verification_request(...) CASCADE;
DROP FUNCTION IF EXISTS public.submit_partner_payment_verification_request(...) CASCADE;
DROP FUNCTION IF EXISTS public.approve_partner_payment_verification_request(...) CASCADE;
DROP FUNCTION IF EXISTS public.reject_partner_payment_verification_request(...) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_partner_payment_verification_request(...) CASCADE;
DROP FUNCTION IF EXISTS public.generate_payment_verification_folio() CASCADE;
DROP SEQUENCE IF EXISTS partner_payment_verification_folio_seq CASCADE;
DROP VIEW IF EXISTS v_pending_payment_verifications CASCADE;
DROP VIEW IF EXISTS v_partner_payment_verification_history CASCADE;

-- Then run the v2 migration
```

### If you get "Unauthorized" or permission errors

Make sure you're logged in as a user with admin permissions in Supabase.

### If you get "Extension not found"

The migration creates required extensions. Should be automatic, but if you get an error:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

Then run the v2 migration.

---

## Verification Queries

Run these in Supabase SQL Editor to confirm everything worked:

### Check Table Exists
```sql
SELECT COUNT(*) as column_count 
FROM information_schema.columns 
WHERE table_name = 'partner_payment_verification_requests';
-- Should return: 25
```

### Check Functions Exist
```sql
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name LIKE 'create_partner_%'
  OR routine_name LIKE 'approve_%'
  OR routine_name LIKE 'reject_%'
  OR routine_name LIKE 'submit_%'
  OR routine_name LIKE 'cancel_%'
  OR routine_name = 'generate_payment_verification_folio'
ORDER BY routine_name;
-- Should return: 6 functions
```

### Check Views Exist
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_type = 'VIEW' 
  AND table_name LIKE 'v_pending_%'
  OR table_name LIKE 'v_partner_%'
ORDER BY table_name;
-- Should return: 2 views
```

### Check Bucket Exists
```sql
SELECT id, name, public 
FROM storage.buckets 
WHERE id = 'customer-payment-proofs';
-- Should return: 1 row, public = false
```

### Check RLS Policies
```sql
SELECT policyname, qual, with_check 
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename = 'partner_payment_verification_requests'
ORDER BY policyname;
-- Should return: 4 policies (vendors_can_see_own_requests + 3 no_direct_*)
```

---

## Next Steps After Migration

### ✅ Build & Test
```bash
npm run build
# Should complete with 0 TypeScript errors
```

### ✅ Frontend Components (Optional)

The TypeScript utilities are ready:
- `/types/paymentVerification.ts` ✓
- `/lib/paymentVerification.ts` ✓

No changes needed to these files.

### ✅ Ready for Frontend Development

Once SQL is executed, you can:
1. Create React components for the payment verification workflow
2. Use the RPC functions via TypeScript wrappers
3. Deploy to production

---

## Troubleshooting Reference

| Issue | Solution |
|-------|----------|
| "UNIQUE constraint failed: folio" | Sequence reset. Run: `ALTER SEQUENCE partner_payment_verification_folio_seq RESTART WITH 1;` |
| "permission denied for schema public" | Need admin role in Supabase |
| "function does not exist" | Not all 6 functions were created. Check for errors in SQL execution. |
| "table does not exist" | Table creation failed. Check for errors in SQL execution. |
| "bucket not found" | Storage bucket creation failed. Check storage.buckets table. |

---

## Timeline

- **Copy & paste migration:** < 1 minute
- **Execute in Supabase:** < 30 seconds
- **Verification:** < 2 minutes
- **Total:** ~3 minutes

---

## Support

If you need to see all 9 fixes in detail, check: `MIGRATION_PARTNER_PAYMENT_VERIFICATION_FIXES.md`

---

**Status:** 🟢 **READY TO EXECUTE**
