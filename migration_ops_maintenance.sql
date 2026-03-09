-- ============================================================
-- Migration: Mantenimiento de Máquinas (Ops)
-- Tables: ops_machines, ops_machine_maintenance
-- ============================================================

-- 1) Tabla de máquinas / equipos
CREATE TABLE IF NOT EXISTS ops_machines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  machine_type  text NOT NULL,            -- e.g. Horno, Batidora, Refrigerador
  serial_number text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2) Tabla de registros de mantenimiento
CREATE TABLE IF NOT EXISTS ops_machine_maintenance (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id        uuid NOT NULL REFERENCES ops_machines(id) ON DELETE CASCADE,
  maintenance_date  date NOT NULL DEFAULT CURRENT_DATE,
  maintenance_type  text NOT NULL CHECK (maintenance_type IN ('PREVENTIVO', 'CORRECTIVO')),
  technician        text NOT NULL,
  cost_mxn          numeric(12,2) NOT NULL DEFAULT 0,
  next_due_date     date,                -- nullable, fecha del próximo mantenimiento
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ops_maint_machine   ON ops_machine_maintenance(machine_id);
CREATE INDEX IF NOT EXISTS idx_ops_maint_next_due  ON ops_machine_maintenance(next_due_date);
CREATE INDEX IF NOT EXISTS idx_ops_maint_date      ON ops_machine_maintenance(maintenance_date DESC);

-- 3) RLS policies (allow all for authenticated users)
ALTER TABLE ops_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_machine_maintenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access on ops_machines"
  ON ops_machines FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated full access on ops_machine_maintenance"
  ON ops_machine_maintenance FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4) Optional: auto-update updated_at on ops_machine_maintenance
CREATE OR REPLACE FUNCTION update_ops_maint_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ops_maint_updated_at
  BEFORE UPDATE ON ops_machine_maintenance
  FOR EACH ROW
  EXECUTE FUNCTION update_ops_maint_updated_at();
