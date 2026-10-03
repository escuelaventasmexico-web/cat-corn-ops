BEGIN;

DO $$
BEGIN
  IF to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.commercial_partners') IS NULL
     OR to_regclass('public.commercial_partner_movements') IS NULL
     OR to_regclass('public.commercial_partner_movement_items') IS NULL
     OR to_regclass('public.commercial_partner_payments') IS NULL
     OR to_regclass('public.commission_rules') IS NULL
     OR to_regclass('public.commission_events') IS NULL
     OR to_regclass('public.commission_settlements') IS NULL
     OR to_regclass('public.commission_settlement_items') IS NULL THEN
    RAISE EXCEPTION 'Commercial prospects requires the deployed B2B and commission schema';
  END IF;

  IF to_regprocedure('public.get_comodato_movement_pending_balance(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing get_comodato_movement_pending_balance(uuid)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND lower(auth_user.email) = 'biancapan@catcorn.com.mx'
  ) THEN
    RAISE EXCEPTION 'The expected Bianca Auth identity does not match the deployed project';
  END IF;
END;
$$;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS commercial_alias TEXT;

UPDATE public.user_profiles
SET commercial_alias = 'BIANCA',
    updated_at = now()
WHERE id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
  AND commercial_alias IS DISTINCT FROM 'BIANCA';

CREATE OR REPLACE FUNCTION public.current_commercial_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT profile.role
  FROM public.user_profiles AS profile
  WHERE profile.id = auth.uid()
    AND profile.is_active
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_access_commercial_partners()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    public.current_commercial_role() IN ('admin', 'socios_comerciales'),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_commercial_prospects()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    public.current_commercial_role() IN ('admin', 'socios_comerciales', 'vendedora'),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.can_convert_commercial_prospects()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    public.current_commercial_role() IN ('admin', 'socios_comerciales'),
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.current_commercial_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_commercial_partners() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_commercial_prospects() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_convert_commercial_prospects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_commercial_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_commercial_partners() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_commercial_prospects() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_convert_commercial_prospects() TO authenticated;

CREATE TABLE public.commercial_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL CHECK (length(btrim(business_name)) > 0),
  normalized_business_name TEXT NOT NULL,
  business_type TEXT NOT NULL DEFAULT 'otro'
    CHECK (business_type IN ('tienda', 'bar', 'restaurante', 'cafeteria', 'otro')),
  phone TEXT NOT NULL CHECK (length(btrim(phone)) > 0),
  normalized_phone TEXT NOT NULL,
  address TEXT,
  location_reference TEXT,
  normalized_location_reference TEXT,
  contact_name TEXT,
  sells_snacks TEXT NOT NULL DEFAULT 'unknown'
    CHECK (sells_snacks IN ('yes', 'no', 'unknown')),
  status TEXT NOT NULL DEFAULT 'nuevo'
    CHECK (status IN ('nuevo', 'seguimiento', 'visita_programada', 'convertido', 'no_interesado', 'archivado')),
  latest_result TEXT
    CHECK (latest_result IS NULL OR latest_result IN (
      'no_contesto', 'numero_incorrecto', 'encargado_ausente', 'pidio_informacion',
      'llamar_despues', 'interesado', 'solicito_visita', 'no_interesado'
    )),
  next_follow_up_at TIMESTAMPTZ,
  proposed_visit_at TIMESTAMPTZ,
  general_notes TEXT,
  created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  originator_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  origin_channel TEXT NOT NULL DEFAULT 'captura_directa',
  converted_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  commercial_partner_id UUID REFERENCES public.commercial_partners(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commercial_prospects_visit_requires_address CHECK (
    (
      status <> 'visita_programada'
      AND latest_result IS DISTINCT FROM 'solicito_visita'
      AND proposed_visit_at IS NULL
    )
    OR length(btrim(COALESCE(address, ''))) > 0
  ),
  CONSTRAINT commercial_prospects_conversion_consistent CHECK (
    (status = 'convertido' AND converted_by IS NOT NULL AND converted_at IS NOT NULL AND commercial_partner_id IS NOT NULL)
    OR
    (status <> 'convertido' AND converted_by IS NULL AND converted_at IS NULL AND commercial_partner_id IS NULL)
  )
);

CREATE INDEX commercial_prospects_originator_idx
  ON public.commercial_prospects(originator_user_id, created_at DESC);
CREATE INDEX commercial_prospects_assigned_idx
  ON public.commercial_prospects(assigned_to, status, next_follow_up_at);
CREATE INDEX commercial_prospects_phone_idx
  ON public.commercial_prospects(normalized_phone);
CREATE INDEX commercial_prospects_name_location_idx
  ON public.commercial_prospects(normalized_business_name, normalized_location_reference);

CREATE TABLE public.commercial_prospect_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES public.commercial_prospects(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  performed_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  result TEXT NOT NULL CHECK (result IN (
    'no_contesto', 'numero_incorrecto', 'encargado_ausente', 'pidio_informacion',
    'llamar_despues', 'interesado', 'solicito_visita', 'no_interesado'
  )),
  notes TEXT,
  next_follow_up_at TIMESTAMPTZ,
  proposed_visit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX commercial_prospect_interactions_history_idx
  ON public.commercial_prospect_interactions(prospect_id, occurred_at DESC, id DESC);

CREATE TABLE public.commercial_prospect_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL UNIQUE REFERENCES public.commercial_prospects(id) ON DELETE RESTRICT,
  commercial_partner_id UUID NOT NULL UNIQUE REFERENCES public.commercial_partners(id) ON DELETE RESTRICT,
  originator_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  converted_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  responsible_seller_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  converted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE OR REPLACE FUNCTION public.set_commercial_prospect_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_commercial_prospect_updated_at
BEFORE UPDATE ON public.commercial_prospects
FOR EACH ROW EXECUTE FUNCTION public.set_commercial_prospect_updated_at();

CREATE OR REPLACE FUNCTION public.protect_commercial_prospect_attribution()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.originator_user_id IS DISTINCT FROM OLD.originator_user_id
     OR NEW.origin_channel IS DISTINCT FROM OLD.origin_channel
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Prospect origin attribution is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_commercial_prospect_attribution
BEFORE UPDATE ON public.commercial_prospects
FOR EACH ROW EXECUTE FUNCTION public.protect_commercial_prospect_attribution();

CREATE OR REPLACE FUNCTION public.reject_commercial_prospect_interaction_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Commercial prospect interactions are append-only';
END;
$$;

CREATE TRIGGER reject_commercial_prospect_interaction_update
BEFORE UPDATE ON public.commercial_prospect_interactions
FOR EACH ROW EXECUTE FUNCTION public.reject_commercial_prospect_interaction_changes();
CREATE TRIGGER reject_commercial_prospect_interaction_delete
BEFORE DELETE ON public.commercial_prospect_interactions
FOR EACH ROW EXECUTE FUNCTION public.reject_commercial_prospect_interaction_changes();

ALTER TABLE public.commercial_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_prospect_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_prospect_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY commercial_prospects_authorized_read
ON public.commercial_prospects
FOR SELECT TO authenticated
USING (
  public.current_commercial_role() = 'admin'
  OR public.current_commercial_role() = 'socios_comerciales'
  OR (
    public.current_commercial_role() = 'vendedora'
    AND (originator_user_id = auth.uid() OR assigned_to = auth.uid())
  )
);

CREATE POLICY commercial_prospect_interactions_authorized_read
ON public.commercial_prospect_interactions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.commercial_prospects AS prospect
    WHERE prospect.id = commercial_prospect_interactions.prospect_id
  )
);

CREATE POLICY commercial_prospect_conversions_authorized_read
ON public.commercial_prospect_conversions
FOR SELECT TO authenticated
USING (
  public.current_commercial_role() = 'admin'
  OR public.current_commercial_role() = 'socios_comerciales'
  OR (
    public.current_commercial_role() = 'vendedora'
    AND originator_user_id = auth.uid()
  )
);

REVOKE ALL ON public.commercial_prospects FROM PUBLIC, anon;
REVOKE ALL ON public.commercial_prospect_interactions FROM PUBLIC, anon;
REVOKE ALL ON public.commercial_prospect_conversions FROM PUBLIC, anon;
GRANT SELECT ON public.commercial_prospects TO authenticated;
GRANT SELECT ON public.commercial_prospect_interactions TO authenticated;
GRANT SELECT ON public.commercial_prospect_conversions TO authenticated;

CREATE OR REPLACE VIEW public.v_commercial_prospect_details
WITH (security_invoker = true)
AS
SELECT
  prospect.*,
  COALESCE(originator.commercial_alias, originator.full_name) AS originator_name,
  COALESCE(assignee.commercial_alias, assignee.full_name) AS assigned_to_name,
  COALESCE(converter.commercial_alias, converter.full_name) AS converted_by_name,
  partner.folio AS commercial_partner_folio,
  interaction_count.total AS interaction_count,
  last_interaction.occurred_at AS last_interaction_at
FROM public.commercial_prospects AS prospect
LEFT JOIN public.user_profiles AS originator ON originator.id = prospect.originator_user_id
LEFT JOIN public.user_profiles AS assignee ON assignee.id = prospect.assigned_to
LEFT JOIN public.user_profiles AS converter ON converter.id = prospect.converted_by
LEFT JOIN public.commercial_partners AS partner ON partner.id = prospect.commercial_partner_id
LEFT JOIN LATERAL (
  SELECT count(*)::INTEGER AS total
  FROM public.commercial_prospect_interactions AS interaction
  WHERE interaction.prospect_id = prospect.id
) AS interaction_count ON TRUE
LEFT JOIN LATERAL (
  SELECT interaction.occurred_at
  FROM public.commercial_prospect_interactions AS interaction
  WHERE interaction.prospect_id = prospect.id
  ORDER BY interaction.occurred_at DESC, interaction.id DESC
  LIMIT 1
) AS last_interaction ON TRUE;

CREATE OR REPLACE VIEW public.v_commercial_partner_directory
WITH (security_invoker = true)
AS
SELECT
  partner.id,
  'socio'::TEXT AS record_type,
  partner.folio,
  partner.business_name,
  partner.responsible_name,
  partner.phone,
  partner.business_type,
  partner.partner_model,
  partner.status,
  partner.assigned_to,
  NULL::UUID AS originator_user_id,
  NULL::TEXT AS originator_name,
  partner.created_at,
  partner.updated_at
FROM public.commercial_partners AS partner
UNION ALL
SELECT
  prospect.id,
  'prospecto'::TEXT AS record_type,
  NULL::TEXT AS folio,
  prospect.business_name,
  COALESCE(prospect.contact_name, 'Sin contacto') AS responsible_name,
  prospect.phone,
  prospect.business_type,
  'prospecto'::TEXT AS partner_model,
  prospect.status,
  prospect.assigned_to,
  prospect.originator_user_id,
  COALESCE(originator.commercial_alias, originator.full_name) AS originator_name,
  prospect.created_at,
  prospect.updated_at
FROM public.commercial_prospects AS prospect
LEFT JOIN public.user_profiles AS originator ON originator.id = prospect.originator_user_id;

REVOKE ALL ON public.v_commercial_prospect_details FROM PUBLIC, anon;
REVOKE ALL ON public.v_commercial_partner_directory FROM PUBLIC, anon;
GRANT SELECT ON public.v_commercial_prospect_details TO authenticated;
GRANT SELECT ON public.v_commercial_partner_directory TO authenticated;

CREATE OR REPLACE FUNCTION public.commercial_prospect_duplicate_warnings(
  p_business_name TEXT,
  p_phone TEXT,
  p_location_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := public.current_commercial_role();
  v_name TEXT := lower(regexp_replace(btrim(COALESCE(p_business_name, '')), '[^[:alnum:]]+', '', 'g'));
  v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '[^0-9]+', '', 'g');
  v_location TEXT := lower(regexp_replace(btrim(COALESCE(p_location_reference, '')), '[^[:alnum:]]+', '', 'g'));
  v_result JSONB;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'socios_comerciales', 'vendedora') THEN
    RAISE EXCEPTION 'Insufficient permissions to review prospect duplicates';
  END IF;

  SELECT COALESCE(jsonb_agg(candidate.payload ORDER BY candidate.priority, candidate.label), '[]'::JSONB)
  INTO v_result
  FROM (
    SELECT
      1 AS priority,
      prospect.business_name AS label,
      jsonb_build_object(
        'source', 'prospecto',
        'match_type', CASE
          WHEN prospect.normalized_phone = v_phone AND v_phone <> '' THEN 'telefono_exacto'
          WHEN prospect.normalized_business_name = v_name
               AND COALESCE(prospect.normalized_location_reference, '') = v_location THEN 'nombre_ubicacion_exacto'
          ELSE 'nombre_aproximado'
        END,
        'id', prospect.id,
        'label', prospect.business_name,
        'status', prospect.status,
        'phone_hint', right(prospect.normalized_phone, 4)
      ) AS payload
    FROM public.commercial_prospects AS prospect
    WHERE (v_phone <> '' AND prospect.normalized_phone = v_phone)
       OR (
         v_name <> ''
         AND prospect.normalized_business_name = v_name
         AND COALESCE(prospect.normalized_location_reference, '') = v_location
       )
       OR (
         length(v_name) >= 5
         AND (
           prospect.normalized_business_name LIKE '%' || v_name || '%'
           OR v_name LIKE '%' || prospect.normalized_business_name || '%'
         )
       )

    UNION ALL

    SELECT
      2 AS priority,
      partner.business_name AS label,
      jsonb_build_object(
        'source', 'socio',
        'match_type', CASE
          WHEN regexp_replace(COALESCE(partner.phone, ''), '[^0-9]+', '', 'g') = v_phone
               AND v_phone <> '' THEN 'telefono_exacto'
          WHEN lower(regexp_replace(btrim(partner.business_name), '[^[:alnum:]]+', '', 'g')) = v_name
               AND lower(regexp_replace(btrim(COALESCE(partner.location_notes, partner.address, '')), '[^[:alnum:]]+', '', 'g')) = v_location
               THEN 'nombre_ubicacion_exacto'
          ELSE 'nombre_aproximado'
        END,
        'id', CASE WHEN v_role = 'vendedora' THEN NULL ELSE partner.id END,
        'label', CASE WHEN v_role = 'vendedora' THEN 'Posible socio existente' ELSE partner.business_name END,
        'status', CASE WHEN v_role = 'vendedora' THEN NULL ELSE partner.status END,
        'phone_hint', right(regexp_replace(COALESCE(partner.phone, ''), '[^0-9]+', '', 'g'), 4)
      ) AS payload
    FROM public.commercial_partners AS partner
    WHERE (v_phone <> '' AND regexp_replace(COALESCE(partner.phone, ''), '[^0-9]+', '', 'g') = v_phone)
       OR (
         v_name <> ''
         AND lower(regexp_replace(btrim(partner.business_name), '[^[:alnum:]]+', '', 'g')) = v_name
         AND lower(regexp_replace(btrim(COALESCE(partner.location_notes, partner.address, '')), '[^[:alnum:]]+', '', 'g')) = v_location
       )
       OR (
         length(v_name) >= 5
         AND (
           lower(regexp_replace(btrim(partner.business_name), '[^[:alnum:]]+', '', 'g')) LIKE '%' || v_name || '%'
           OR v_name LIKE '%' || lower(regexp_replace(btrim(partner.business_name), '[^[:alnum:]]+', '', 'g')) || '%'
         )
       )
  ) AS candidate;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_commercial_prospect(
  p_business_name TEXT,
  p_business_type TEXT,
  p_phone TEXT,
  p_location_reference TEXT DEFAULT NULL,
  p_contact_name TEXT DEFAULT NULL,
  p_sells_snacks TEXT DEFAULT 'unknown',
  p_general_notes TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_origin_channel TEXT DEFAULT 'captura_directa'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_name TEXT := lower(regexp_replace(btrim(COALESCE(p_business_name, '')), '[^[:alnum:]]+', '', 'g'));
  v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '[^0-9]+', '', 'g');
  v_location TEXT := NULLIF(lower(regexp_replace(btrim(COALESCE(p_location_reference, '')), '[^[:alnum:]]+', '', 'g')), '');
  v_warnings JSONB;
  v_prospect public.commercial_prospects;
BEGIN
  IF NOT public.can_access_commercial_prospects() THEN
    RAISE EXCEPTION 'Insufficient permissions to create prospects';
  END IF;
  IF v_name = '' OR length(v_phone) < 7 THEN
    RAISE EXCEPTION 'Business name and a valid phone are required';
  END IF;
  IF p_business_type NOT IN ('tienda', 'bar', 'restaurante', 'cafeteria', 'otro') THEN
    RAISE EXCEPTION 'Invalid prospect business type';
  END IF;
  IF p_sells_snacks NOT IN ('yes', 'no', 'unknown') THEN
    RAISE EXCEPTION 'Invalid sells_snacks value';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('prospect-phone:' || v_phone, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'prospect-name-location:' || v_name || '|' || COALESCE(v_location, ''),
    0
  ));
  v_warnings := public.commercial_prospect_duplicate_warnings(p_business_name, p_phone, p_location_reference);

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_warnings) AS warning
    WHERE warning->>'match_type' IN ('telefono_exacto', 'nombre_ubicacion_exacto')
  ) THEN
    RAISE EXCEPTION 'Possible duplicate detected. Review duplicate warnings before creating the prospect.';
  END IF;

  INSERT INTO public.commercial_prospects (
    business_name, normalized_business_name, business_type, phone, normalized_phone,
    address, location_reference, normalized_location_reference, contact_name,
    sells_snacks, general_notes, created_by, originator_user_id, assigned_to, origin_channel
  )
  VALUES (
    btrim(p_business_name), v_name, p_business_type, btrim(p_phone), v_phone,
    NULLIF(btrim(p_address), ''), NULLIF(btrim(p_location_reference), ''), v_location,
    NULLIF(btrim(p_contact_name), ''), p_sells_snacks, NULLIF(btrim(p_general_notes), ''),
    v_actor, v_actor, v_actor, COALESCE(NULLIF(btrim(p_origin_channel), ''), 'captura_directa')
  )
  RETURNING * INTO v_prospect;

  RETURN jsonb_build_object('prospect', to_jsonb(v_prospect), 'duplicate_warnings', v_warnings);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_commercial_prospect(
  p_prospect_id UUID,
  p_changes JSONB
)
RETURNS public.commercial_prospects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := public.current_commercial_role();
  v_prospect public.commercial_prospects;
  v_status TEXT;
BEGIN
  SELECT * INTO v_prospect
  FROM public.commercial_prospects
  WHERE id = p_prospect_id
  FOR UPDATE;

  IF v_prospect.id IS NULL THEN
    RAISE EXCEPTION 'Prospect not found';
  END IF;
  IF v_role IS NULL OR (
    v_role = 'vendedora'
    AND v_prospect.originator_user_id <> auth.uid()
    AND v_prospect.assigned_to IS DISTINCT FROM auth.uid()
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to update this prospect';
  END IF;
  IF v_role <> 'admin' AND (p_changes ? 'assigned_to' OR p_changes ? 'status' AND p_changes->>'status' = 'archivado') THEN
    RAISE EXCEPTION 'Only an administrator can reassign or archive prospects';
  END IF;
  IF p_changes ?| ARRAY['created_by', 'originator_user_id', 'origin_channel', 'converted_by', 'converted_at', 'commercial_partner_id'] THEN
    RAISE EXCEPTION 'Protected prospect attribution cannot be edited';
  END IF;

  v_status := COALESCE(p_changes->>'status', v_prospect.status);
  IF v_status NOT IN ('nuevo', 'seguimiento', 'visita_programada', 'no_interesado', 'archivado') THEN
    RAISE EXCEPTION 'Invalid editable prospect status';
  END IF;

  UPDATE public.commercial_prospects
  SET business_name = CASE WHEN p_changes ? 'business_name' THEN btrim(p_changes->>'business_name') ELSE business_name END,
      normalized_business_name = CASE WHEN p_changes ? 'business_name' THEN lower(regexp_replace(btrim(p_changes->>'business_name'), '[^[:alnum:]]+', '', 'g')) ELSE normalized_business_name END,
      business_type = CASE WHEN p_changes ? 'business_type' THEN p_changes->>'business_type' ELSE business_type END,
      phone = CASE WHEN p_changes ? 'phone' THEN btrim(p_changes->>'phone') ELSE phone END,
      normalized_phone = CASE WHEN p_changes ? 'phone' THEN regexp_replace(p_changes->>'phone', '[^0-9]+', '', 'g') ELSE normalized_phone END,
      address = CASE WHEN p_changes ? 'address' THEN NULLIF(btrim(p_changes->>'address'), '') ELSE address END,
      location_reference = CASE WHEN p_changes ? 'location_reference' THEN NULLIF(btrim(p_changes->>'location_reference'), '') ELSE location_reference END,
      normalized_location_reference = CASE WHEN p_changes ? 'location_reference' THEN NULLIF(lower(regexp_replace(btrim(p_changes->>'location_reference'), '[^[:alnum:]]+', '', 'g')), '') ELSE normalized_location_reference END,
      contact_name = CASE WHEN p_changes ? 'contact_name' THEN NULLIF(btrim(p_changes->>'contact_name'), '') ELSE contact_name END,
      sells_snacks = CASE WHEN p_changes ? 'sells_snacks' THEN p_changes->>'sells_snacks' ELSE sells_snacks END,
      general_notes = CASE WHEN p_changes ? 'general_notes' THEN NULLIF(btrim(p_changes->>'general_notes'), '') ELSE general_notes END,
      status = v_status,
      next_follow_up_at = CASE WHEN p_changes ? 'next_follow_up_at' THEN NULLIF(p_changes->>'next_follow_up_at', '')::TIMESTAMPTZ ELSE next_follow_up_at END,
      proposed_visit_at = CASE WHEN p_changes ? 'proposed_visit_at' THEN NULLIF(p_changes->>'proposed_visit_at', '')::TIMESTAMPTZ ELSE proposed_visit_at END,
      assigned_to = CASE WHEN p_changes ? 'assigned_to' THEN NULLIF(p_changes->>'assigned_to', '')::UUID ELSE assigned_to END
  WHERE id = p_prospect_id
  RETURNING * INTO v_prospect;

  RETURN v_prospect;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_commercial_prospect_interaction(
  p_prospect_id UUID,
  p_result TEXT,
  p_notes TEXT DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT now(),
  p_next_follow_up_at TIMESTAMPTZ DEFAULT NULL,
  p_proposed_visit_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.commercial_prospect_interactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := public.current_commercial_role();
  v_prospect public.commercial_prospects;
  v_interaction public.commercial_prospect_interactions;
  v_status TEXT;
BEGIN
  SELECT * INTO v_prospect
  FROM public.commercial_prospects
  WHERE id = p_prospect_id
  FOR UPDATE;

  IF v_prospect.id IS NULL THEN
    RAISE EXCEPTION 'Prospect not found';
  END IF;
  IF v_prospect.status IN ('convertido', 'archivado') THEN
    RAISE EXCEPTION 'Converted or archived prospects cannot receive interactions';
  END IF;
  IF v_role IS NULL OR (
    v_role = 'vendedora'
    AND v_prospect.originator_user_id <> auth.uid()
    AND v_prospect.assigned_to IS DISTINCT FROM auth.uid()
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to contact this prospect';
  END IF;
  IF p_result NOT IN (
    'no_contesto', 'numero_incorrecto', 'encargado_ausente', 'pidio_informacion',
    'llamar_despues', 'interesado', 'solicito_visita', 'no_interesado'
  ) THEN
    RAISE EXCEPTION 'Invalid interaction result';
  END IF;
  IF (p_result = 'solicito_visita' OR p_proposed_visit_at IS NOT NULL)
     AND length(btrim(COALESCE(v_prospect.address, ''))) = 0 THEN
    RAISE EXCEPTION 'An address is required before requesting or scheduling a visit';
  END IF;

  INSERT INTO public.commercial_prospect_interactions (
    prospect_id, occurred_at, performed_by, result, notes, next_follow_up_at, proposed_visit_at
  )
  VALUES (
    p_prospect_id, COALESCE(p_occurred_at, now()), auth.uid(), p_result,
    NULLIF(btrim(p_notes), ''), p_next_follow_up_at, p_proposed_visit_at
  )
  RETURNING * INTO v_interaction;

  v_status := CASE
    WHEN p_result = 'no_interesado' THEN 'no_interesado'
    WHEN p_result = 'solicito_visita' OR p_proposed_visit_at IS NOT NULL THEN 'visita_programada'
    ELSE 'seguimiento'
  END;

  UPDATE public.commercial_prospects
  SET latest_result = p_result,
      status = v_status,
      next_follow_up_at = p_next_follow_up_at,
      proposed_visit_at = p_proposed_visit_at
  WHERE id = p_prospect_id;

  RETURN v_interaction;
END;
$$;

REVOKE ALL ON FUNCTION public.commercial_prospect_duplicate_warnings(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_commercial_prospect(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_commercial_prospect(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.append_commercial_prospect_interaction(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_prospect_duplicate_warnings(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_commercial_prospect(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_commercial_prospect(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_commercial_prospect_interaction(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.convert_commercial_prospect(
  p_prospect_id UUID,
  p_responsible_seller_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_prospect public.commercial_prospects;
  v_partner public.commercial_partners;
  v_conversion public.commercial_prospect_conversions;
BEGIN
  IF NOT public.can_convert_commercial_prospects() THEN
    RAISE EXCEPTION 'Only active administrators and commercial-partner users can convert prospects';
  END IF;

  SELECT * INTO v_prospect
  FROM public.commercial_prospects
  WHERE id = p_prospect_id
  FOR UPDATE;

  IF v_prospect.id IS NULL THEN
    RAISE EXCEPTION 'Prospect not found';
  END IF;
  IF v_prospect.status = 'convertido' OR v_prospect.commercial_partner_id IS NOT NULL THEN
    RAISE EXCEPTION 'Prospect was already converted';
  END IF;
  IF v_prospect.status = 'archivado' THEN
    RAISE EXCEPTION 'Archived prospects cannot be converted';
  END IF;
  IF length(btrim(COALESCE(v_prospect.address, ''))) = 0 THEN
    RAISE EXCEPTION 'A complete address is required before conversion';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile
    WHERE profile.id = p_responsible_seller_id
      AND profile.role = 'socios_comerciales'
      AND profile.is_active
  ) THEN
    RAISE EXCEPTION 'The responsible salesperson must be an active commercial-partner user';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('prospect-conversion:' || p_prospect_id::TEXT, 0));

  IF EXISTS (
    SELECT 1
    FROM public.commercial_prospect_conversions AS conversion
    WHERE conversion.prospect_id = p_prospect_id
  ) THEN
    RAISE EXCEPTION 'Prospect was already converted';
  END IF;

  INSERT INTO public.commercial_partners (
    business_name,
    responsible_name,
    phone,
    whatsapp,
    business_type,
    partner_model,
    status,
    address,
    location_notes,
    assigned_to,
    created_by,
    notes,
    active,
    activated_at
  )
  VALUES (
    v_prospect.business_name,
    COALESCE(NULLIF(v_prospect.contact_name, ''), v_prospect.business_name),
    v_prospect.phone,
    v_prospect.phone,
    v_prospect.business_type,
    'comodato',
    'activo',
    v_prospect.address,
    v_prospect.location_reference,
    p_responsible_seller_id,
    v_actor,
    concat_ws(E'\n', NULLIF(v_prospect.general_notes, ''), NULLIF(btrim(p_notes), '')),
    TRUE,
    now()
  )
  RETURNING * INTO v_partner;

  INSERT INTO public.commercial_prospect_conversions (
    prospect_id,
    commercial_partner_id,
    originator_user_id,
    converted_by,
    responsible_seller_id,
    metadata
  )
  VALUES (
    v_prospect.id,
    v_partner.id,
    v_prospect.originator_user_id,
    v_actor,
    p_responsible_seller_id,
    jsonb_build_object(
      'origin_channel', v_prospect.origin_channel,
      'prospect_status_before_conversion', v_prospect.status,
      'partner_folio', v_partner.folio
    )
  )
  RETURNING * INTO v_conversion;

  UPDATE public.commercial_prospects
  SET status = 'convertido',
      converted_by = v_actor,
      converted_at = v_conversion.converted_at,
      commercial_partner_id = v_partner.id,
      assigned_to = p_responsible_seller_id,
      next_follow_up_at = NULL,
      proposed_visit_at = NULL
  WHERE id = v_prospect.id;

  RETURN jsonb_build_object(
    'prospect_id', v_prospect.id,
    'commercial_partner_id', v_partner.id,
    'partner_folio', v_partner.folio,
    'conversion_id', v_conversion.id,
    'converted_at', v_conversion.converted_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_commercial_prospect(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_commercial_prospect(UUID, UUID, TEXT) TO authenticated;

ALTER TABLE public.commission_rules
  DROP CONSTRAINT commission_rules_scheme_check;
ALTER TABLE public.commission_rules
  ADD CONSTRAINT commission_rules_scheme_check
  CHECK (scheme IN ('comodato', 'mayoreo', 'conversion', 'venta_pieza', 'prospect_conversion'));

ALTER TABLE public.commission_events
  DROP CONSTRAINT commission_events_source_type_check;
ALTER TABLE public.commission_events
  ADD CONSTRAINT commission_events_source_type_check
  CHECK (source_type IN (
    'comodato_sale', 'wholesale_sale', 'conversion_bonus', 'piece_sale',
    'adjustment', 'pos_sale', 'prospect_conversion_bonus'
  ));

INSERT INTO public.commission_rules (
  scheme,
  product_key,
  product_name,
  commission_type,
  commission_amount,
  currency,
  valid_from,
  active,
  notes
)
VALUES (
  'prospect_conversion',
  'first_paid_comodato_settlement',
  'Bono por prospecto convertido y primer corte pagado',
  'fixed_bonus',
  50.00,
  'MXN',
  DATE '2026-09-29',
  TRUE,
  'Se libera al liquidarse totalmente el primer corte válido de Comodato posterior a la conversión.'
)
ON CONFLICT (scheme, product_key, valid_from) DO UPDATE
SET product_name = EXCLUDED.product_name,
    commission_type = EXCLUDED.commission_type,
    commission_amount = EXCLUDED.commission_amount,
    currency = EXCLUDED.currency,
    active = EXCLUDED.active,
    notes = EXCLUDED.notes,
    updated_at = now();

CREATE UNIQUE INDEX uq_commission_prospect_conversion_partner
  ON public.commission_events(partner_id, source_type)
  WHERE source_type = 'prospect_conversion_bonus';

CREATE OR REPLACE FUNCTION public.is_valid_prospect_bonus_recipient(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile
    WHERE profile.id = p_user_id
      AND profile.role = 'vendedora'
      AND profile.is_active
  );
$$;

REVOKE ALL ON FUNCTION public.is_valid_prospect_bonus_recipient(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_prospect_bonus_recipient(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_prospect_conversion_bonus(p_partner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversion public.commercial_prospect_conversions;
  v_rule public.commission_rules;
  v_movement RECORD;
  v_event public.commission_events;
  v_paid NUMERIC := 0;
  v_reserved NUMERIC := 0;
  v_status TEXT;
  v_available_at TIMESTAMPTZ;
BEGIN
  IF p_partner_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('prospect-bonus:' || p_partner_id::TEXT, 0));

  SELECT conversion.* INTO v_conversion
  FROM public.commercial_prospect_conversions AS conversion
  JOIN public.commercial_prospects AS prospect ON prospect.id = conversion.prospect_id
  JOIN public.commercial_partners AS partner ON partner.id = conversion.commercial_partner_id
  WHERE conversion.commercial_partner_id = p_partner_id
    AND partner.partner_model = 'comodato'
    AND partner.status = 'activo'
    AND partner.active
    AND public.is_valid_prospect_bonus_recipient(conversion.originator_user_id)
  FOR UPDATE OF conversion;

  IF v_conversion.id IS NULL THEN
    RETURN;
  END IF;

  SELECT rule.* INTO v_rule
  FROM public.commission_rules AS rule
  WHERE rule.scheme = 'prospect_conversion'
    AND rule.product_key = 'first_paid_comodato_settlement'
    AND rule.active
    AND rule.valid_from <= v_conversion.converted_at::DATE
    AND (rule.valid_to IS NULL OR rule.valid_to >= v_conversion.converted_at::DATE)
  ORDER BY rule.valid_from DESC, rule.created_at DESC
  LIMIT 1;

  IF v_rule.id IS NULL THEN
    PERFORM public.log_commission_sync_issue(
      'other', p_partner_id, v_conversion.originator_user_id,
      'prospect_conversion_bonus', NULL, v_conversion.id,
      'No active prospect-conversion bonus rule was found.',
      jsonb_build_object('conversion_id', v_conversion.id)
    );
    RETURN;
  END IF;

  SELECT
    movement.id,
    movement.movement_date,
    movement.adjustment_folio,
    due.effective_due,
    public.get_comodato_movement_pending_balance(movement.id) AS pending_balance
  INTO v_movement
  FROM public.commercial_partner_movements AS movement
  CROSS JOIN LATERAL (
    SELECT
      COALESCE((
        SELECT sum(COALESCE(item.amount_due, 0))
        FROM public.commercial_partner_movement_items AS item
        WHERE item.movement_id = movement.id
          AND COALESCE(item.quantity_sold, 0) > 0
      ), 0)
      - COALESCE((
        SELECT sum(COALESCE(adjustment.amount_adjusted, 0))
        FROM public.commercial_partner_movement_items AS adjustment
        JOIN public.commercial_partner_movements AS adjustment_movement
          ON adjustment_movement.id = adjustment.movement_id
        JOIN public.commercial_partner_movement_items AS original
          ON original.id = adjustment.adjusts_movement_item_id
        WHERE original.movement_id = movement.id
          AND adjustment_movement.movement_type = 'adjustment'
          AND adjustment_movement.status = 'completed'
      ), 0) AS effective_due
  ) AS due
  WHERE movement.partner_id = p_partner_id
    AND movement.movement_type = 'settlement'
    AND movement.status = 'completed'
    AND movement.movement_date >= v_conversion.converted_at
    AND due.effective_due > 0.005
  ORDER BY movement.movement_date, movement.created_at, movement.id
  LIMIT 1
  FOR UPDATE OF movement;

  SELECT event.* INTO v_event
  FROM public.commission_events AS event
  WHERE event.partner_id = p_partner_id
    AND event.source_type = 'prospect_conversion_bonus'
  FOR UPDATE;

  IF v_event.id IS NOT NULL THEN
    SELECT balance.paid_amount, balance.reserved_amount
    INTO v_paid, v_reserved
    FROM public.v_commission_event_payment_balances AS balance
    WHERE balance.commission_event_id = v_event.id;
  END IF;

  IF v_movement.id IS NULL THEN
    IF v_event.id IS NOT NULL AND (COALESCE(v_paid, 0) > 0.005 OR COALESCE(v_reserved, 0) > 0.005 OR v_event.status = 'paid') THEN
      PERFORM public.log_commission_sync_issue(
        'other', p_partner_id, v_event.seller_id,
        'prospect_conversion_bonus', v_event.source_id, v_conversion.id,
        'The qualifying settlement no longer has an effective balance, but the bonus is reserved or paid.',
        jsonb_build_object('event_id', v_event.id, 'paid_amount', v_paid, 'reserved_amount', v_reserved)
      );
    ELSIF v_event.id IS NOT NULL THEN
      UPDATE public.commission_events
      SET status = 'cancelled',
          cancelled_at = now(),
          cancellation_reason = 'No valid post-conversion settlement remains',
          available_at = NULL,
          updated_at = now()
      WHERE id = v_event.id;
    END IF;
    RETURN;
  END IF;

  v_status := CASE WHEN v_movement.pending_balance <= 0.005 THEN 'available' ELSE 'pending' END;
  v_available_at := CASE WHEN v_status = 'available' THEN now() ELSE NULL END;

  IF v_event.id IS NULL THEN
    INSERT INTO public.commission_events (
      seller_id, partner_id, source_type, source_id, source_item_id, source_folio,
      rule_id, product_key, product_name, quantity, unit_commission, commission_amount,
      release_condition, status, earned_at, available_at, metadata, created_by
    )
    VALUES (
      v_conversion.originator_user_id, p_partner_id, 'prospect_conversion_bonus',
      v_movement.id, v_conversion.id, v_movement.adjustment_folio,
      v_rule.id, v_rule.product_key, v_rule.product_name, 1, v_rule.commission_amount,
      v_rule.commission_amount, 'full_payment', v_status, v_movement.movement_date,
      v_available_at,
      jsonb_build_object(
        'prospect_id', v_conversion.prospect_id,
        'conversion_id', v_conversion.id,
        'converted_at', v_conversion.converted_at,
        'qualifying_settlement_id', v_movement.id,
        'effective_due', v_movement.effective_due
      ),
      v_conversion.converted_by
    );
  ELSIF COALESCE(v_paid, 0) > 0.005 OR COALESCE(v_reserved, 0) > 0.005 OR v_event.status = 'paid' THEN
    IF v_event.source_id IS DISTINCT FROM v_movement.id
       OR v_event.seller_id IS DISTINCT FROM v_conversion.originator_user_id
       OR v_event.commission_amount IS DISTINCT FROM v_rule.commission_amount THEN
      PERFORM public.log_commission_sync_issue(
        'other', p_partner_id, v_event.seller_id,
        'prospect_conversion_bonus', v_event.source_id, v_conversion.id,
        'A reserved or paid prospect bonus requires review and was not rewritten.',
        jsonb_build_object(
          'event_id', v_event.id,
          'current_settlement_id', v_event.source_id,
          'expected_settlement_id', v_movement.id,
          'paid_amount', v_paid,
          'reserved_amount', v_reserved
        )
      );
    END IF;
  ELSE
    UPDATE public.commission_events
    SET seller_id = v_conversion.originator_user_id,
        source_id = v_movement.id,
        source_item_id = v_conversion.id,
        source_folio = v_movement.adjustment_folio,
        rule_id = v_rule.id,
        product_key = v_rule.product_key,
        product_name = v_rule.product_name,
        quantity = 1,
        unit_commission = v_rule.commission_amount,
        commission_amount = v_rule.commission_amount,
        status = v_status,
        earned_at = v_movement.movement_date,
        available_at = v_available_at,
        cancelled_at = NULL,
        cancellation_reason = NULL,
        metadata = jsonb_build_object(
          'prospect_id', v_conversion.prospect_id,
          'conversion_id', v_conversion.id,
          'converted_at', v_conversion.converted_at,
          'qualifying_settlement_id', v_movement.id,
          'effective_due', v_movement.effective_due
        ),
        updated_at = now()
    WHERE id = v_event.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_prospect_bonus_from_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sync_prospect_conversion_bonus(COALESCE(NEW.partner_id, OLD.partner_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_prospect_bonus_from_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_movement_id UUID := COALESCE(NEW.movement_id, OLD.movement_id);
  v_partner_id UUID;
  v_original_partner_id UUID;
BEGIN
  SELECT movement.partner_id INTO v_partner_id
  FROM public.commercial_partner_movements AS movement
  WHERE movement.id = v_movement_id;

  IF v_partner_id IS NOT NULL THEN
    PERFORM public.sync_prospect_conversion_bonus(v_partner_id);
  END IF;

  SELECT movement.partner_id INTO v_original_partner_id
  FROM public.commercial_partner_movement_items AS original
  JOIN public.commercial_partner_movements AS movement ON movement.id = original.movement_id
  WHERE original.id = COALESCE(NEW.adjusts_movement_item_id, OLD.adjusts_movement_item_id);

  IF v_original_partner_id IS NOT NULL AND v_original_partner_id IS DISTINCT FROM v_partner_id THEN
    PERFORM public.sync_prospect_conversion_bonus(v_original_partner_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_prospect_bonus_from_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sync_prospect_conversion_bonus(COALESCE(NEW.partner_id, OLD.partner_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER sync_prospect_bonus_from_movement
AFTER INSERT OR UPDATE OF partner_id, movement_type, movement_date, status
ON public.commercial_partner_movements
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_prospect_bonus_from_movement();

CREATE TRIGGER sync_prospect_bonus_from_item
AFTER INSERT OR UPDATE OR DELETE
ON public.commercial_partner_movement_items
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_prospect_bonus_from_item();

CREATE TRIGGER sync_prospect_bonus_from_payment
AFTER INSERT OR UPDATE OR DELETE
ON public.commercial_partner_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_prospect_bonus_from_payment();

REVOKE ALL ON FUNCTION public.sync_prospect_conversion_bonus(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_prospect_bonus_from_movement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_prospect_bonus_from_item() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_prospect_bonus_from_payment() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_view_commissions()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    public.current_commercial_role() IN ('admin', 'socios_comerciales', 'vendedora'),
    FALSE
  );
$$;

CREATE OR REPLACE VIEW public.v_commissions_available_for_payment
WITH (security_invoker = true)
AS
WITH available_events AS (
  SELECT
    event.seller_id,
    event.id,
    event.available_at,
    balance.allocatable_amount
  FROM public.v_commission_events_effective AS event
  JOIN public.v_commission_event_payment_balances AS balance
    ON balance.commission_event_id = event.id
  WHERE event.status = 'available'
    AND abs(balance.allocatable_amount) > 0.005
), available_totals AS (
  SELECT
    seller_id,
    count(*)::INTEGER AS available_events,
    COALESCE(sum(allocatable_amount), 0::NUMERIC) AS available_amount,
    min(available_at) AS oldest_available_at,
    max(available_at) AS latest_available_at
  FROM available_events
  GROUP BY seller_id
), drafts AS (
  SELECT
    settlement.seller_id,
    (array_agg(settlement.id ORDER BY settlement.created_at, settlement.id))[1] AS draft_settlement_id
  FROM public.commission_settlements AS settlement
  WHERE settlement.status = 'draft'
  GROUP BY settlement.seller_id
)
SELECT
  profile.id AS seller_id,
  COALESCE(available.available_events, 0) AS available_events,
  COALESCE(available.available_amount, 0::NUMERIC) AS available_amount,
  available.oldest_available_at,
  available.latest_available_at,
  COALESCE(available.available_events, 0) AS available_event_count,
  draft.draft_settlement_id IS NOT NULL AS has_draft_settlement,
  draft.draft_settlement_id
FROM public.user_profiles AS profile
LEFT JOIN available_totals AS available ON available.seller_id = profile.id
LEFT JOIN drafts AS draft ON draft.seller_id = profile.id
WHERE profile.is_active
  AND (
    profile.role = 'socios_comerciales'
    OR (
      profile.role = 'vendedora'
      AND EXISTS (
        SELECT 1
        FROM public.commission_events AS event
        WHERE event.seller_id = profile.id
          AND event.source_type = 'prospect_conversion_bonus'
      )
    )
  );

CREATE OR REPLACE VIEW public.v_commercial_prospect_bonus_movements
WITH (security_invoker = true)
AS
SELECT
  event.id AS commission_event_id,
  event.seller_id,
  prospect.business_name,
  conversion.commercial_partner_id,
  conversion.metadata->>'partner_folio' AS partner_folio,
  conversion.id AS conversion_id,
  conversion.converted_at,
  event.source_id AS qualifying_settlement_id,
  event.commission_amount,
  event.status,
  event.earned_at,
  event.available_at,
  event.paid_at,
  balance.payment_status,
  balance.paid_amount,
  balance.remaining_amount,
  balance.reserved_amount,
  balance.allocatable_amount
FROM public.commission_events AS event
JOIN public.commercial_prospect_conversions AS conversion
  ON conversion.id = event.source_item_id
JOIN public.commercial_prospects AS prospect
  ON prospect.id = conversion.prospect_id
JOIN public.v_commission_event_payment_balances AS balance
  ON balance.commission_event_id = event.id
WHERE event.source_type = 'prospect_conversion_bonus';

REVOKE ALL ON public.v_commercial_prospect_bonus_movements FROM PUBLIC, anon;
GRANT SELECT ON public.v_commercial_prospect_bonus_movements TO authenticated;

CREATE OR REPLACE FUNCTION public.create_commission_settlement(
  p_seller_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_amount NUMERIC DEFAULT NULL
)
RETURNS TABLE(settlement_id UUID, folio TEXT, total_amount NUMERIC, event_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settlement_id UUID;
  v_folio TEXT;
  v_seller_role TEXT;
  v_available_total NUMERIC := 0;
  v_target_amount NUMERIC := 0;
  v_amount_left NUMERIC := 0;
  v_item_amount NUMERIC := 0;
  v_total NUMERIC := 0;
  v_count INTEGER := 0;
  v_pay_all BOOLEAN := FALSE;
  r_event RECORD;
BEGIN
  IF public.is_commission_admin() = FALSE THEN
    RAISE EXCEPTION 'Solo un administrador puede preparar pagos de comisiones.';
  END IF;
  IF p_seller_id IS NULL THEN
    RAISE EXCEPTION 'El vendedor es obligatorio.';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'El periodo indicado no es válido.';
  END IF;

  SELECT profile.role INTO v_seller_role
  FROM public.user_profiles AS profile
  WHERE profile.id = p_seller_id
    AND profile.is_active
    AND profile.role IN ('socios_comerciales', 'vendedora');

  IF v_seller_role IS NULL THEN
    RAISE EXCEPTION 'El usuario seleccionado no es un vendedor activo ni una receptora de bonos válida.';
  END IF;
  IF v_seller_role = 'vendedora'
     AND NOT public.is_valid_prospect_bonus_recipient(p_seller_id) THEN
    RAISE EXCEPTION 'La vendedora no es una receptora de bonos válida.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commission_settlements AS settlement
    WHERE settlement.seller_id = p_seller_id AND settlement.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'El vendedor ya tiene una liquidación en preparación.';
  END IF;
  IF p_amount IS NOT NULL AND (p_amount <= 0 OR p_amount <> round(p_amount, 2)) THEN
    RAISE EXCEPTION 'El monto a pagar debe ser positivo y tener hasta dos decimales.';
  END IF;

  PERFORM event.id
  FROM public.commission_events AS event
  WHERE event.seller_id = p_seller_id
    AND event.status = 'available'
    AND (event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE BETWEEN p_period_start AND p_period_end
    AND (v_seller_role <> 'vendedora' OR event.source_type = 'prospect_conversion_bonus')
  ORDER BY event.earned_at, event.id
  FOR UPDATE;

  SELECT COALESCE(sum(balance.allocatable_amount), 0)
  INTO v_available_total
  FROM public.v_commission_events_effective AS event
  JOIN public.v_commission_event_payment_balances AS balance
    ON balance.commission_event_id = event.id
  WHERE event.seller_id = p_seller_id
    AND event.status = 'available'
    AND (event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE BETWEEN p_period_start AND p_period_end
    AND abs(balance.allocatable_amount) > 0.005
    AND (v_seller_role <> 'vendedora' OR event.source_type = 'prospect_conversion_bonus');

  IF v_available_total <= 0.005 THEN
    RAISE EXCEPTION 'No existen comisiones disponibles para pagar en este periodo.';
  END IF;

  v_target_amount := round(COALESCE(p_amount, v_available_total), 2);
  IF v_target_amount > v_available_total + 0.005 THEN
    RAISE EXCEPTION 'El monto solicitado (%) supera el saldo disponible (%).', v_target_amount, v_available_total;
  END IF;
  v_pay_all := abs(v_target_amount - v_available_total) <= 0.005;
  v_amount_left := v_target_amount;

  INSERT INTO public.commission_settlements (
    seller_id, period_start, period_end, status, created_by
  )
  VALUES (p_seller_id, p_period_start, p_period_end, 'draft', auth.uid())
  RETURNING id, commission_settlements.folio INTO v_settlement_id, v_folio;

  FOR r_event IN
    SELECT event.id, event.earned_at, balance.allocatable_amount
    FROM public.v_commission_events_effective AS event
    JOIN public.v_commission_event_payment_balances AS balance
      ON balance.commission_event_id = event.id
    WHERE event.seller_id = p_seller_id
      AND event.status = 'available'
      AND (event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE BETWEEN p_period_start AND p_period_end
      AND abs(balance.allocatable_amount) > 0.005
      AND (v_seller_role <> 'vendedora' OR event.source_type = 'prospect_conversion_bonus')
    ORDER BY event.earned_at, event.id
  LOOP
    EXIT WHEN NOT v_pay_all AND v_amount_left <= 0.005;
    IF v_pay_all THEN
      v_item_amount := r_event.allocatable_amount;
    ELSIF r_event.allocatable_amount < 0 THEN
      v_item_amount := r_event.allocatable_amount;
    ELSE
      v_item_amount := least(r_event.allocatable_amount, v_amount_left);
    END IF;

    IF abs(v_item_amount) > 0.005 THEN
      INSERT INTO public.commission_settlement_items (
        settlement_id, commission_event_id, amount
      ) VALUES (v_settlement_id, r_event.id, v_item_amount);
      v_count := v_count + 1;
      v_amount_left := v_amount_left - v_item_amount;
    END IF;
  END LOOP;

  IF v_count = 0 OR abs(v_amount_left) > 0.005 THEN
    RAISE EXCEPTION 'No fue posible distribuir exactamente el monto solicitado. Diferencia: %.', v_amount_left;
  END IF;

  SELECT settlement.total_amount INTO v_total
  FROM public.commission_settlements AS settlement
  WHERE settlement.id = v_settlement_id;

  IF abs(v_total - v_target_amount) > 0.005 THEN
    RAISE EXCEPTION 'El total de la liquidación (%) no coincide con el monto solicitado (%).', v_total, v_target_amount;
  END IF;

  RETURN QUERY SELECT v_settlement_id, v_folio, v_total, v_count;
END;
$$;

DO $$
DECLARE
  v_policy RECORD;
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'commercial_partners',
    'commercial_partner_movements',
    'commercial_partner_movement_items',
    'commercial_partner_payments',
    'commercial_partner_contracts',
    'commercial_partner_documents',
    'wholesale_orders',
    'wholesale_order_items',
    'wholesale_payments',
    'wholesale_price_catalog'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    FOR v_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_access_commercial_partners())',
      v_table || '_commercial_read', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_access_commercial_partners())',
      v_table || '_commercial_insert', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_access_commercial_partners()) WITH CHECK (public.can_access_commercial_partners())',
      v_table || '_commercial_update', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.current_commercial_role() = ''admin'')',
      v_table || '_admin_delete', v_table
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS commission_events_read ON public.commission_events;
DROP POLICY IF EXISTS commission_events_admin_write ON public.commission_events;
CREATE POLICY commission_events_authorized_read
ON public.commission_events
FOR SELECT TO authenticated
USING (
  public.current_commercial_role() = 'admin'
  OR (public.current_commercial_role() = 'socios_comerciales' AND seller_id = auth.uid())
  OR (
    public.current_commercial_role() = 'vendedora'
    AND seller_id = auth.uid()
    AND source_type = 'prospect_conversion_bonus'
  )
);
CREATE POLICY commission_events_admin_write
ON public.commission_events
FOR ALL TO authenticated
USING (public.current_commercial_role() = 'admin')
WITH CHECK (public.current_commercial_role() = 'admin');

DROP POLICY IF EXISTS commission_settlements_read ON public.commission_settlements;
DROP POLICY IF EXISTS commission_settlements_admin_write ON public.commission_settlements;
CREATE POLICY commission_settlements_authorized_read
ON public.commission_settlements
FOR SELECT TO authenticated
USING (
  public.current_commercial_role() = 'admin'
  OR (public.current_commercial_role() = 'socios_comerciales' AND seller_id = auth.uid())
  OR (
    public.current_commercial_role() = 'vendedora'
    AND seller_id = auth.uid()
  )
);
CREATE POLICY commission_settlements_admin_write
ON public.commission_settlements
FOR ALL TO authenticated
USING (public.current_commercial_role() = 'admin')
WITH CHECK (public.current_commercial_role() = 'admin');

DROP POLICY IF EXISTS commission_settlement_items_read ON public.commission_settlement_items;
DROP POLICY IF EXISTS commission_settlement_items_admin_write ON public.commission_settlement_items;
CREATE POLICY commission_settlement_items_authorized_read
ON public.commission_settlement_items
FOR SELECT TO authenticated
USING (
  public.current_commercial_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.commission_settlements AS settlement
    JOIN public.commission_events AS event ON event.id = commission_settlement_items.commission_event_id
    WHERE settlement.id = commission_settlement_items.settlement_id
      AND settlement.seller_id = auth.uid()
      AND (
        public.current_commercial_role() = 'socios_comerciales'
        OR (
          public.current_commercial_role() = 'vendedora'
          AND event.source_type = 'prospect_conversion_bonus'
        )
      )
  )
);
CREATE POLICY commission_settlement_items_admin_write
ON public.commission_settlement_items
FOR ALL TO authenticated
USING (public.current_commercial_role() = 'admin')
WITH CHECK (public.current_commercial_role() = 'admin');

DROP POLICY IF EXISTS commission_rules_read ON public.commission_rules;
DROP POLICY IF EXISTS commission_rules_admin_write ON public.commission_rules;
CREATE POLICY commission_rules_commercial_read
ON public.commission_rules
FOR SELECT TO authenticated
USING (public.can_view_commissions());
CREATE POLICY commission_rules_admin_write
ON public.commission_rules
FOR ALL TO authenticated
USING (public.current_commercial_role() = 'admin')
WITH CHECK (public.current_commercial_role() = 'admin');

DROP POLICY IF EXISTS commission_issues_admin ON public.commission_sync_issues;
CREATE POLICY commission_issues_admin
ON public.commission_sync_issues
FOR ALL TO authenticated
USING (public.current_commercial_role() = 'admin')
WITH CHECK (public.current_commercial_role() = 'admin');

DO $$
DECLARE
  v_view RECORD;
BEGIN
  FOR v_view IN
    SELECT class_row.relname
    FROM pg_class AS class_row
    JOIN pg_namespace AS namespace_row ON namespace_row.oid = class_row.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND class_row.relkind = 'v'
      AND (
        class_row.relname LIKE 'v_b2b_%'
        OR class_row.relname LIKE 'v_commission_%'
        OR class_row.relname LIKE 'v_commissions_%'
        OR class_row.relname LIKE 'v_seller_commission_%'
        OR class_row.relname LIKE 'v_commercial_partner_%'
        OR class_row.relname IN (
          'comodato_expired', 'conversion_summary', 'dashboard_summary', 'map',
          'ranking', 'rollup', 'pending_balances', 'pipeline_by_status',
          'sales_by_zone', 'upcoming_visits', 'operational_summary'
        )
      )
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v_view.relname);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.export_commercial_prospects()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := public.current_commercial_role();
  v_prospects JSONB;
  v_interactions JSONB;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'socios_comerciales', 'vendedora') THEN
    RAISE EXCEPTION 'Insufficient permissions to export prospects';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(export_row) ORDER BY export_row.created_at DESC), '[]'::JSONB)
  INTO v_prospects
  FROM (
    SELECT
      prospect.id,
      prospect.business_name,
      prospect.business_type,
      prospect.phone,
      prospect.address,
      prospect.location_reference,
      prospect.contact_name,
      prospect.sells_snacks,
      prospect.status,
      prospect.latest_result,
      prospect.next_follow_up_at,
      prospect.proposed_visit_at,
      prospect.general_notes,
      COALESCE(originator.commercial_alias, originator.full_name) AS originator,
      COALESCE(assignee.commercial_alias, assignee.full_name) AS assigned_to,
      prospect.origin_channel,
      prospect.converted_at,
      partner.folio AS commercial_partner_folio,
      prospect.created_at,
      prospect.updated_at
    FROM public.commercial_prospects AS prospect
    LEFT JOIN public.user_profiles AS originator ON originator.id = prospect.originator_user_id
    LEFT JOIN public.user_profiles AS assignee ON assignee.id = prospect.assigned_to
    LEFT JOIN public.commercial_partners AS partner ON partner.id = prospect.commercial_partner_id
    WHERE v_role IN ('admin', 'socios_comerciales')
       OR prospect.originator_user_id = auth.uid()
       OR prospect.assigned_to = auth.uid()
  ) AS export_row;

  SELECT COALESCE(jsonb_agg(to_jsonb(history_row) ORDER BY history_row.occurred_at DESC), '[]'::JSONB)
  INTO v_interactions
  FROM (
    SELECT
      interaction.id,
      interaction.prospect_id,
      prospect.business_name,
      interaction.occurred_at,
      COALESCE(performer.commercial_alias, performer.full_name) AS performed_by,
      interaction.result,
      interaction.notes,
      interaction.next_follow_up_at,
      interaction.proposed_visit_at,
      interaction.created_at
    FROM public.commercial_prospect_interactions AS interaction
    JOIN public.commercial_prospects AS prospect ON prospect.id = interaction.prospect_id
    LEFT JOIN public.user_profiles AS performer ON performer.id = interaction.performed_by
    WHERE v_role IN ('admin', 'socios_comerciales')
       OR prospect.originator_user_id = auth.uid()
       OR prospect.assigned_to = auth.uid()
  ) AS history_row;

  RETURN jsonb_build_object(
    'prospects', v_prospects,
    'interactions', v_interactions,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_commissions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_commission_settlement(UUID, DATE, DATE, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.export_commercial_prospects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_commissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_commission_settlement(UUID, DATE, DATE, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_commercial_prospects() TO authenticated;

REVOKE ALL ON public.v_commissions_available_for_payment FROM PUBLIC, anon;
GRANT SELECT ON public.v_commissions_available_for_payment TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public._restricted_create_comodato_delivery_with_units(uuid,date,date,text,text,jsonb)') IS NULL THEN
    ALTER FUNCTION public.create_comodato_delivery_with_units(UUID, DATE, DATE, TEXT, TEXT, JSONB)
      RENAME TO _restricted_create_comodato_delivery_with_units;
  END IF;
  IF to_regprocedure('public._restricted_create_wholesale_order_with_units(uuid,date,text,jsonb,integer)') IS NULL THEN
    ALTER FUNCTION public.create_wholesale_order_with_units(UUID, DATE, TEXT, JSONB, INTEGER)
      RENAME TO _restricted_create_wholesale_order_with_units;
  END IF;
  IF to_regprocedure('public._restricted_get_comodato_movement_pending_balance(uuid)') IS NULL THEN
    ALTER FUNCTION public.get_comodato_movement_pending_balance(UUID)
      RENAME TO _restricted_get_comodato_movement_pending_balance;
  END IF;
  IF to_regprocedure('public._restricted_get_partner_comodato_pending_balance(uuid)') IS NULL THEN
    ALTER FUNCTION public.get_partner_comodato_pending_balance(UUID)
      RENAME TO _restricted_get_partner_comodato_pending_balance;
  END IF;
  IF to_regprocedure('public._restricted_get_partner_comodato_stock_units(uuid)') IS NULL THEN
    ALTER FUNCTION public.get_partner_comodato_stock_units(UUID)
      RENAME TO _restricted_get_partner_comodato_stock_units;
  END IF;
  IF to_regprocedure('public._restricted_get_wholesale_order_pending_balance(uuid)') IS NULL THEN
    ALTER FUNCTION public.get_wholesale_order_pending_balance(UUID)
      RENAME TO _restricted_get_wholesale_order_pending_balance;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_comodato_delivery_with_units(
  p_partner_id UUID,
  p_movement_date DATE,
  p_next_visit_date DATE,
  p_next_visit_reason TEXT,
  p_notes TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access_commercial_partners() THEN
    RAISE EXCEPTION 'Insufficient permissions for Comodato deliveries';
  END IF;
  RETURN public._restricted_create_comodato_delivery_with_units(
    p_partner_id, p_movement_date, p_next_visit_date, p_next_visit_reason, p_notes, p_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_wholesale_order_with_units(
  p_partner_id UUID,
  p_order_date DATE,
  p_notes TEXT,
  p_items JSONB,
  p_payment_terms_hours INTEGER DEFAULT 72
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access_commercial_partners() THEN
    RAISE EXCEPTION 'Insufficient permissions for wholesale orders';
  END IF;
  RETURN public._restricted_create_wholesale_order_with_units(
    p_partner_id, p_order_date, p_notes, p_items, p_payment_terms_hours
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_comodato_movement_pending_balance(p_movement_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access_commercial_partners() THEN
    RAISE EXCEPTION 'Insufficient permissions for B2B balances';
  END IF;
  RETURN public._restricted_get_comodato_movement_pending_balance(p_movement_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_partner_comodato_pending_balance(p_partner_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access_commercial_partners() THEN
    RAISE EXCEPTION 'Insufficient permissions for B2B balances';
  END IF;
  RETURN public._restricted_get_partner_comodato_pending_balance(p_partner_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_partner_comodato_stock_units(p_partner_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access_commercial_partners() THEN
    RAISE EXCEPTION 'Insufficient permissions for B2B stock';
  END IF;
  RETURN public._restricted_get_partner_comodato_stock_units(p_partner_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_wholesale_order_pending_balance(p_order_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access_commercial_partners() THEN
    RAISE EXCEPTION 'Insufficient permissions for B2B balances';
  END IF;
  RETURN public._restricted_get_wholesale_order_pending_balance(p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public._restricted_create_comodato_delivery_with_units(UUID, DATE, DATE, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._restricted_create_wholesale_order_with_units(UUID, DATE, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._restricted_get_comodato_movement_pending_balance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._restricted_get_partner_comodato_pending_balance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._restricted_get_partner_comodato_stock_units(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._restricted_get_wholesale_order_pending_balance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_comodato_delivery_with_units(UUID, DATE, DATE, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_wholesale_order_with_units(UUID, DATE, TEXT, JSONB, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_comodato_movement_pending_balance(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_partner_comodato_pending_balance(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_partner_comodato_stock_units(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_wholesale_order_pending_balance(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_comodato_delivery_with_units(UUID, DATE, DATE, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_wholesale_order_with_units(UUID, DATE, TEXT, JSONB, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_comodato_movement_pending_balance(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_comodato_pending_balance(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_comodato_stock_units(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_wholesale_order_pending_balance(UUID) TO authenticated;

DO $$
DECLARE
  v_relation RECORD;
BEGIN
  FOR v_relation IN
    SELECT class_row.relname, class_row.relkind
    FROM pg_class AS class_row
    JOIN pg_namespace AS namespace_row ON namespace_row.oid = class_row.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND class_row.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND (
        class_row.relname LIKE 'commercial_partner%'
        OR class_row.relname LIKE 'wholesale_%'
        OR class_row.relname LIKE 'commission_%'
        OR class_row.relname LIKE 'v_b2b_%'
        OR class_row.relname LIKE 'v_commission_%'
        OR class_row.relname LIKE 'v_commissions_%'
        OR class_row.relname LIKE 'v_seller_commission_%'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON %s public.%I FROM anon',
      CASE WHEN v_relation.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      v_relation.relname
    );
  END LOOP;
END;
$$;

COMMIT;
