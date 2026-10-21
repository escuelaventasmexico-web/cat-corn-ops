-- READ ONLY. Run in Supabase SQL Editor and return the complete result before
-- applying 20261020_gato_mayor_3x2_promotion.sql.
SELECT
  p.oid::regprocedure::text AS signature,
  md5(pg_get_functiondef(p.oid)) AS definition_md5,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'recalculate_sale_total';

