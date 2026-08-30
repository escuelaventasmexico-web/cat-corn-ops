-- Migration: Exclude rejected piece sales from informational seller stock
-- Date: 2026-08-23
-- Scope: v_seller_piece_stock only; no historical data is modified

BEGIN;

DO $migration$
DECLARE
  v_view_oid regclass := TO_REGCLASS('public.v_seller_piece_stock');
  v_current_definition text;
  v_updated_definition text;
BEGIN
  IF v_view_oid IS NULL THEN
    RAISE EXCEPTION 'Required view public.v_seller_piece_stock does not exist';
  END IF;

  SELECT PG_GET_VIEWDEF(v_view_oid, true)
  INTO v_current_definition;

  -- Re-running the migration must not alter an already-correct definition.
  IF v_current_definition ~* 'payment_rejected' THEN
    RETURN;
  END IF;

  -- Preserve the complete live view definition and replace only the verified
  -- sold_totals predicate. PostgreSQL may render the text literal with ::text.
  v_updated_definition := REGEXP_REPLACE(
    v_current_definition,
    's\.status[[:space:]]*<>[[:space:]]*''cancelled''(::text)?',
    's.status NOT IN (''cancelled'', ''payment_rejected'')',
    'gi'
  );

  IF v_updated_definition = v_current_definition THEN
    RAISE EXCEPTION
      'Expected predicate s.status <> cancelled was not found in public.v_seller_piece_stock';
  END IF;

  IF v_updated_definition !~* 's\.status[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*payment_rejected' THEN
    RAISE EXCEPTION
      'Updated public.v_seller_piece_stock definition does not exclude payment_rejected';
  END IF;

  EXECUTE FORMAT(
    'CREATE OR REPLACE VIEW public.v_seller_piece_stock AS %s',
    v_updated_definition
  );
END;
$migration$;

NOTIFY pgrst, 'reload schema';

COMMIT;
