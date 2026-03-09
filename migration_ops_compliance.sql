-- ============================================================
-- Migration: Fumigación y Limpieza Profunda (Ops Compliance)
-- Tables: ops_fumigation, ops_deep_cleaning
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1) Tabla de fumigación
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops_fumigation (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fumigation_date       date NOT NULL,
  provider              text NOT NULL,
  next_fumigation_date  date,
  document_id           uuid,                     -- referencia futura a módulo documentos
  status                text NOT NULL DEFAULT 'VIGENTE'
                        CHECK (status IN ('VIGENTE', 'VENCIDO')),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_fum_date       ON ops_fumigation(fumigation_date);
CREATE INDEX IF NOT EXISTS idx_ops_fum_next_date  ON ops_fumigation(next_fumigation_date);
CREATE INDEX IF NOT EXISTS idx_ops_fum_status     ON ops_fumigation(status);

-- ────────────────────────────────────────────────────────────
-- 2) Tabla de limpieza profunda
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops_deep_cleaning (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area                 text NOT NULL,              -- PISOS, CORTINAS, VITRINAS, REFRIGERADOR, EXTRACTORES, ALMACEN
  cleaning_date        date NOT NULL,
  responsible          text NOT NULL,
  evidence_url         text,
  next_suggested_date  date,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_dc_date       ON ops_deep_cleaning(cleaning_date);
CREATE INDEX IF NOT EXISTS idx_ops_dc_next_date  ON ops_deep_cleaning(next_suggested_date);
CREATE INDEX IF NOT EXISTS idx_ops_dc_area       ON ops_deep_cleaning(area);

-- ────────────────────────────────────────────────────────────
-- 3) RLS — misma política que maintenance
-- ────────────────────────────────────────────────────────────
ALTER TABLE ops_fumigation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_deep_cleaning ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access on ops_fumigation"
  ON ops_fumigation FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated full access on ops_deep_cleaning"
  ON ops_deep_cleaning FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 4) Triggers updated_at
--    Reuse function if it already exists, otherwise create it.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_ops_compliance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ops_fumigation_updated_at
  BEFORE UPDATE ON ops_fumigation
  FOR EACH ROW
  EXECUTE FUNCTION update_ops_compliance_updated_at();

CREATE TRIGGER trg_ops_deep_cleaning_updated_at
  BEFORE UPDATE ON ops_deep_cleaning
  FOR EACH ROW
  EXECUTE FUNCTION update_ops_compliance_updated_at();
