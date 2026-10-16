-- Read-only export of the two deployed monthly B2B RPC definitions.
--
-- Run this in the Supabase SQL Editor for the production project, then export
-- or copy both complete `function_definition` values. These definitions are
-- required to version the already-deployed follow-up migration without
-- reconstructing it from an earlier local proposal.

BEGIN READ ONLY;

SELECT
  procedure_row.oid::REGPROCEDURE::TEXT AS function_signature,
  pg_get_functiondef(procedure_row.oid) AS function_definition
FROM pg_proc AS procedure_row
JOIN pg_namespace AS namespace_row
  ON namespace_row.oid = procedure_row.pronamespace
WHERE namespace_row.nspname = 'public'
  AND procedure_row.oid IN (
    'public.get_b2b_monthly_analysis(date,date)'::REGPROCEDURE,
    'public.get_b2b_monthly_collections_report(date,date)'::REGPROCEDURE
  )
ORDER BY function_signature;

ROLLBACK;
