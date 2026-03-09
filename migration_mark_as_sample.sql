-- Migration: Agregar función para marcar restante como muestra

-- FUNCTION: mark_batch_as_sample
-- Marks the remaining grams in a batch as sample (sets grams_remaining to 0)
-- This is useful when the remaining amount is too small to pack any product
CREATE OR REPLACE FUNCTION mark_batch_as_sample(
  p_batch_id UUID
) RETURNS VOID AS $$
BEGIN
  -- Update batch to set grams_remaining to 0
  UPDATE batches
  SET grams_remaining = 0,
      notes = COALESCE(notes || ' | ', '') || 'Restante marcado como muestra ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI')
  WHERE id = p_batch_id;

  -- Verify batch exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch % no encontrado', p_batch_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Test: Ver tandas con grams_remaining > 0
SELECT 
  id,
  batch_type,
  grams_total,
  grams_remaining,
  produced_at,
  notes
FROM batches
WHERE grams_remaining > 0
ORDER BY produced_at DESC
LIMIT 10;
