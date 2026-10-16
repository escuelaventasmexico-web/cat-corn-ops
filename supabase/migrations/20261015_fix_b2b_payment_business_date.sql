-- CAT CORN - FASE 1: compatibilidad entre el frontend y Supabase.
-- Crea la fecha comercial explicita, resolvedor, triggers para NUEVAS operaciones
-- y la vista de cobros confirmados. NO modifica pagos historicos.
-- IMPORTANTE: NO cambia aun las dos RPC mensuales. Sus definiciones exactas se
-- versionan en la migracion posterior aplicada en produccion.
BEGIN;

ALTER TABLE public.commercial_partner_payments
  ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE public.wholesale_payments
  ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE public.seller_piece_payments
  ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE public.partner_payment_verification_requests
  ADD COLUMN IF NOT EXISTS business_date DATE;

COMMENT ON COLUMN public.commercial_partner_payments.business_date IS
  'Fecha comercial efectiva del cobro, independiente de los timestamps tecnicos.';
COMMENT ON COLUMN public.wholesale_payments.business_date IS
  'Fecha comercial efectiva del cobro, independiente de los timestamps tecnicos.';
COMMENT ON COLUMN public.seller_piece_payments.business_date IS
  'Fecha comercial efectiva del cobro, independiente de los timestamps tecnicos.';
COMMENT ON COLUMN public.partner_payment_verification_requests.business_date IS
  'Fecha efectiva declarada para el pago sujeto a verificacion.';

CREATE OR REPLACE FUNCTION public.resolve_b2b_payment_business_date(
  p_payment_date TIMESTAMPTZ,
  p_created_at TIMESTAMPTZ,
  p_business_date DATE
)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_business_date IS NOT NULL THEN p_business_date
    WHEN p_payment_date IS NULL THEN NULL
    WHEN p_payment_date = DATE_TRUNC('day', p_payment_date AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AND p_created_at IS NOT NULL
      AND (p_payment_date AT TIME ZONE 'UTC')::DATE = (p_created_at AT TIME ZONE 'UTC')::DATE
      THEN (p_created_at AT TIME ZONE 'America/Mexico_City')::DATE
    WHEN p_payment_date = DATE_TRUNC('day', p_payment_date AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      THEN (p_payment_date AT TIME ZONE 'UTC')::DATE
    ELSE (p_payment_date AT TIME ZONE 'America/Mexico_City')::DATE
  END;
$$;

REVOKE ALL ON FUNCTION public.resolve_b2b_payment_business_date(TIMESTAMPTZ, TIMESTAMPTZ, DATE)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_b2b_payment_business_date(TIMESTAMPTZ, TIMESTAMPTZ, DATE)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_b2b_payment_business_date(TIMESTAMPTZ, TIMESTAMPTZ, DATE)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_b2b_verification_business_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.business_date IS NULL AND NEW.payment_date IS NOT NULL THEN
    NEW.business_date := (NEW.payment_date AT TIME ZONE 'UTC')::DATE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_b2b_payment_business_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_business_date DATE;
  v_request_id UUID;
BEGIN
  IF NEW.business_date IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'seller_piece_payments' THEN
    v_request_id := NULLIF(TO_JSONB(NEW)->>'request_id', '')::UUID;
  END IF;

  IF v_request_id IS NOT NULL THEN
    SELECT request.business_date
      INTO v_request_business_date
    FROM public.partner_payment_verification_requests AS request
    WHERE request.id = v_request_id;
  END IF;

  NEW.business_date := COALESCE(
    v_request_business_date,
    public.resolve_b2b_payment_business_date(
      NEW.payment_date,
      COALESCE(NEW.created_at, clock_timestamp()),
      NULL
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_approved_b2b_payment_business_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status::TEXT <> 'approved'
     OR NEW.approved_payment_id IS NULL
     OR NEW.business_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- No repetir trabajo sobre una solicitud ya aprobada que no cambio de fecha/ID.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status::TEXT = 'approved'
       AND OLD.business_date IS NOT DISTINCT FROM NEW.business_date
       AND OLD.approved_payment_id IS NOT DISTINCT FROM NEW.approved_payment_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.scheme::TEXT = 'comodato' THEN
    UPDATE public.commercial_partner_payments
    SET business_date = NEW.business_date
    WHERE id = NEW.approved_payment_id
      AND business_date IS DISTINCT FROM NEW.business_date;
  ELSIF NEW.scheme::TEXT = 'mayoreo' THEN
    UPDATE public.wholesale_payments
    SET business_date = NEW.business_date
    WHERE id = NEW.approved_payment_id
      AND business_date IS DISTINCT FROM NEW.business_date;
  ELSIF NEW.scheme::TEXT = 'venta_pieza' THEN
    UPDATE public.seller_piece_payments
    SET business_date = NEW.business_date
    WHERE id = NEW.approved_payment_id
      AND business_date IS DISTINCT FROM NEW.business_date;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_b2b_verification_business_date
  ON public.partner_payment_verification_requests;
CREATE TRIGGER trg_set_b2b_verification_business_date
BEFORE INSERT OR UPDATE OF payment_date, business_date
ON public.partner_payment_verification_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_b2b_verification_business_date();

DROP TRIGGER IF EXISTS trg_sync_approved_b2b_payment_business_date
  ON public.partner_payment_verification_requests;
CREATE TRIGGER trg_sync_approved_b2b_payment_business_date
AFTER INSERT OR UPDATE OF status, approved_payment_id, business_date
ON public.partner_payment_verification_requests
FOR EACH ROW
EXECUTE FUNCTION public.sync_approved_b2b_payment_business_date();

DROP TRIGGER IF EXISTS trg_set_comodato_payment_business_date
  ON public.commercial_partner_payments;
CREATE TRIGGER trg_set_comodato_payment_business_date
BEFORE INSERT ON public.commercial_partner_payments
FOR EACH ROW
EXECUTE FUNCTION public.set_b2b_payment_business_date();

DROP TRIGGER IF EXISTS trg_set_wholesale_payment_business_date
  ON public.wholesale_payments;
CREATE TRIGGER trg_set_wholesale_payment_business_date
BEFORE INSERT ON public.wholesale_payments
FOR EACH ROW
EXECUTE FUNCTION public.set_b2b_payment_business_date();

DROP TRIGGER IF EXISTS trg_set_piece_payment_business_date
  ON public.seller_piece_payments;
CREATE TRIGGER trg_set_piece_payment_business_date
BEFORE INSERT ON public.seller_piece_payments
FOR EACH ROW
EXECUTE FUNCTION public.set_b2b_payment_business_date();

-- Una nueva vista, sin tocar cobros ni liquidaciones anteriores.
CREATE OR REPLACE VIEW public.v_b2b_confirmed_payments
WITH (security_invoker = true)
AS
SELECT
  payment.id,
  'comodato'::TEXT AS source_type,
  payment.partner_id,
  NULL::UUID AS seller_id,
  payment.movement_id,
  NULL::UUID AS wholesale_order_id,
  payment.payment_date,
  public.resolve_b2b_payment_business_date(
    payment.payment_date,
    payment.created_at,
    payment.business_date
  ) AS business_date,
  payment.created_at,
  payment.amount,
  payment.payment_method::TEXT AS payment_method,
  payment.reference,
  payment.notes
FROM public.commercial_partner_payments AS payment
WHERE payment.status IN ('completed', 'paid')
UNION ALL
SELECT
  payment.id,
  'mayoreo'::TEXT,
  payment.partner_id,
  NULL::UUID,
  NULL::UUID,
  payment.wholesale_order_id,
  payment.payment_date,
  public.resolve_b2b_payment_business_date(
    payment.payment_date,
    payment.created_at,
    payment.business_date
  ),
  payment.created_at,
  payment.amount,
  payment.payment_method::TEXT,
  payment.reference,
  payment.notes
FROM public.wholesale_payments AS payment
WHERE payment.status IN ('completed', 'paid')
UNION ALL
SELECT
  payment.id,
  'venta_pieza'::TEXT,
  NULL::UUID,
  payment.seller_id,
  NULL::UUID,
  NULL::UUID,
  payment.payment_date,
  public.resolve_b2b_payment_business_date(
    payment.payment_date,
    payment.created_at,
    payment.business_date
  ),
  payment.created_at,
  payment.amount,
  payment.payment_method::TEXT,
  payment.reference,
  payment.notes
FROM public.seller_piece_payments AS payment
WHERE payment.status = 'completed';

REVOKE ALL ON TABLE public.v_b2b_confirmed_payments FROM PUBLIC;
REVOKE ALL ON TABLE public.v_b2b_confirmed_payments FROM anon;
GRANT SELECT ON TABLE public.v_b2b_confirmed_payments TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
