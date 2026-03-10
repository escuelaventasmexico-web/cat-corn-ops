-- ============================================================================
-- FIX: "multiple assignments to same column 'stamps'"
-- ============================================================================
-- The existing trigger function handle_loyalty_after_sale (or similar) was
-- updating the customers table with TWO separate SET clauses for "stamps":
--
--   UPDATE customers
--   SET stamps      = stamps + 1,             ← earn stamp
--       stamps      = 0,                      ← consume stamps on reward
--       reward_available = ...
--   WHERE id = ...;
--
-- PostgreSQL does not allow the same column name to appear more than once in a
-- single SET clause. The fix combines both operations (earn + consume) into a
-- single expression.
-- ============================================================================

-- 1) Drop the old trigger so we can recreate the function cleanly
DROP TRIGGER IF EXISTS trg_loyalty_after_sale ON sales;
DROP TRIGGER IF EXISTS trg_handle_loyalty_after_sale ON sales;
DROP TRIGGER IF EXISTS loyalty_on_sale_insert ON sales;
DROP TRIGGER IF EXISTS handle_loyalty_on_sale ON sales;

-- 2) Replace the function with a corrected version
CREATE OR REPLACE FUNCTION handle_loyalty_after_sale()
RETURNS TRIGGER AS $$
DECLARE
  v_customer_id UUID;
  v_reward_applied BOOLEAN;
  v_current_stamps INT;
  v_new_stamps INT;
  v_new_reward BOOLEAN;
BEGIN
  -- Only process if sale has a customer
  v_customer_id := NEW.customer_id;
  IF v_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_reward_applied := COALESCE(NEW.loyalty_reward_applied, FALSE);

  -- Get current stamps
  SELECT COALESCE(stamps, 0)
    INTO v_current_stamps
    FROM customers
   WHERE id = v_customer_id;

  -- If customer not found, nothing to do
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Calculate new stamps in a single expression:
  --   • Always earn +1 for the purchase
  --   • If reward was redeemed, subtract 3 (the threshold)
  IF v_reward_applied THEN
    -- Earn 1, consume 3  →  net change = -2
    -- But stamps should not go below 0, and after redeem we typically reset
    v_new_stamps := GREATEST(0, v_current_stamps + 1 - 3);
  ELSE
    v_new_stamps := v_current_stamps + 1;
  END IF;

  -- Determine if the customer now qualifies for a reward (threshold = 3)
  v_new_reward := (v_new_stamps >= 3);

  -- Single UPDATE with stamps assigned exactly once
  UPDATE customers
     SET stamps           = v_new_stamps,
         reward_available = v_new_reward,
         last_purchase_at = NOW(),
         updated_at       = NOW()
   WHERE id = v_customer_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3) Re-create the trigger
CREATE TRIGGER trg_loyalty_after_sale
  AFTER INSERT ON sales
  FOR EACH ROW
  EXECUTE FUNCTION handle_loyalty_after_sale();
