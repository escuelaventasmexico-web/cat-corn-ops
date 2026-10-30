-- Read-only export of the financial RPC definitions currently deployed.
-- Run in the Supabase SQL Editor before reviewing/applying the corresponding
-- local migration. This script does not change schema or data.

SELECT
  function_row.oid::REGPROCEDURE::TEXT AS signature,
  function_row.prosecdef AS security_definer,
  function_row.provolatile AS volatility,
  function_row.proconfig AS configuration,
  pg_get_functiondef(function_row.oid) AS definition
FROM pg_proc AS function_row
JOIN pg_namespace AS namespace_row
  ON namespace_row.oid = function_row.pronamespace
WHERE namespace_row.nspname = 'public'
  AND function_row.proname IN (
    'finance_month_summary',
    'finance_daily_series',
    'finance_daily_breakdown',
    'finance_calendar_with_yoy'
  )
ORDER BY function_row.oid::REGPROCEDURE::TEXT;
