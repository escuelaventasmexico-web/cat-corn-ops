/* ═════════════════════════════════════════════════════════════════════════════════
   MIGRATION: Corregir Cálculo y Visualización de Tasa de Conversión B2B
   Version: 20260721
   Purpose: Fijar vista v_b2b_conversion_summary para:
            1. Calcular correctamente total_registered (socios únicos)
            2. Clasificar socios activos como aquellos con comodato O mayoreo
            3. Evitar conteo duplicado de socios en múltiples estados
            4. Calcular tasa de conversión: activos / registrados
            5. Nunca devolver NaN o Infinity, siempre usar 0 para división por cero
   ═════════════════════════════════════════════════════════════════════════════════ */

-- ═════════════════════════════════════════════════════════════════════════════
-- VIEW: v_b2b_conversion_summary
-- 
-- Calcula métricas de conversión de prospecto a cliente activo.
-- 
-- DEFINICIONES:
-- - Registrado: Socio que existe en commercial_partners
-- - Activo: Socio con active=true Y (partner_model='comodato' OR partner_model='mayoreo')
-- - Prospecto: Socio registrado pero no activo
-- - En negociación: (Ocupación para futuros estados)
-- - Rechazado: Socio con status en ('rejected', 'cancelled')
--
-- IMPORTANTE: Estos estados deben ser MUTUAMENTE EXCLUYENTES
-- Prioridad: Rechazado > Activo > Negociación > Prospecto
-- ═════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.v_b2b_conversion_summary CASCADE;

CREATE VIEW public.v_b2b_conversion_summary WITH (security_invoker = true) AS
WITH partner_counts AS (
  SELECT
    -- Total de socios registrados (únicos)
    COUNT(DISTINCT id) AS total_registered_count,
    
    -- Socios activos: active=true Y (comodato O mayoreo)
    COUNT(DISTINCT CASE 
      WHEN active = true 
        AND partner_model IN ('comodato', 'mayoreo')
      THEN id 
      ELSE NULL 
    END) AS active_count,
    
    -- Socios rechazados o cancelados
    COUNT(DISTINCT CASE 
      WHEN status IN ('rejected', 'cancelled')
      THEN id 
      ELSE NULL 
    END) AS rejected_count,
    
    -- Socios en estado prospecto: registrados pero no activos y no rechazados
    COUNT(DISTINCT CASE 
      WHEN active = false 
        AND status NOT IN ('rejected', 'cancelled')
        AND partner_model NOT IN ('comodato', 'mayoreo')
      THEN id 
      ELSE NULL 
    END) AS prospect_count
    
  FROM public.commercial_partners
  WHERE deleted_at IS NULL
)
SELECT
  total_registered_count::BIGINT AS total_registered,
  prospect_count::BIGINT AS prospects,
  0::BIGINT AS in_negotiation,  -- Por ahora sin datos, mantener para compatibilidad
  active_count::BIGINT AS active,
  rejected_count::BIGINT AS rejected,
  
  -- Tasa de conversión: activos / registrados
  -- Usar CASE para evitar división por cero y NaN
  CASE
    WHEN total_registered_count > 0
    THEN ROUND(
      (active_count::NUMERIC / total_registered_count::NUMERIC),
      4
    )
    ELSE 0::NUMERIC
  END AS conversion_rate
  
FROM partner_counts;

-- ═════════════════════════════════════════════════════════════════════════════
-- GRANTS
-- ═════════════════════════════════════════════════════════════════════════════

GRANT SELECT ON public.v_b2b_conversion_summary TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- NOTIFICATION
-- ═════════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

/* 

NOTA IMPORTANTE:

La tasa de conversión se devuelve como FRACCIÓN (0.0 a 1.0), NO como porcentaje (0-100).

Ejemplo:
- Si hay 1 registrado y 1 activo: conversion_rate = 1.0 (que formatPercent convertirá a 100%)
- Si hay 2 registrados y 1 activo: conversion_rate = 0.5 (que formatPercent convertirá a 50%)
- Si hay 0 registrados: conversion_rate = 0 (que formatPercent mostrará como 0%)

El TypeScript hará:
  const conversionData = {
    total_registered: 1,
    active: 1,
    conversion_rate: 1.0  // De la base de datos
  };
  
  formatPercent(1.0)  // 1.0 * 100 = "100%"
  formatPercent(0.5)  // 0.5 * 100 = "50%"
  formatPercent(0)    // 0 * 100 = "0%"

*/
