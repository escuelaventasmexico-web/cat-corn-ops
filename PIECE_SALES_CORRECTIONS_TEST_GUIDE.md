# Piece Sale Corrections - Test Execution Guide

## Prerequisites
- ✅ Backend RPC `correct_piece_sale_item` deployed in Supabase
- ✅ Views created: `v_piece_sale_products`, `v_piece_sale_correction_history`
- ✅ Frontend compiled: `npm run build` successful
- ✅ Database has sample piece sales in test statuses

## Test Scenarios

### Test A: Product Change in Draft (Basic Correction)

**Setup:**
```
- Create piece sale with status='draft'
- Add item: Maíz Blanco 1000g @ $10 x 2 units
- Item subtotal: $20
- Commission per unit: $2 (total $4)
- Sale total: $20
- Commission total: $4
```

**Steps:**
1. Open piece sale detail (seller view)
2. Click "Corregir" button on Maíz Blanco item
3. In modal form:
   - Product selector: search and select "Maíz Amarillo 1000g" @ $15
   - Quantity: keep as 2
   - Reason: "Se capturó producto incorrecto, cliente pidió amarillo"
4. Click "Ver cambios" button
5. In preview:
   - Verify ANTES shows: Maíz Blanco, 2 units, $10 each, $20 subtotal, $4 commission
   - Verify DESPUÉS shows: Maíz Amarillo, 2 units, $15 each, $30 subtotal
   - Verify "Diferencia de venta": ↑ $10 (green)
   - Verify total sale impact: $20 → $30
   - Verify commission impact: check if $2/unit applies
6. Click "Confirmar corrección"
7. Wait for green success screen
8. Verify "Los cambios se han registrado"
9. Close modal

**Expected Results:**
```
✅ Correction applied successfully
✅ Sale detail reloaded (total updated to $30)
✅ Correction visible in admin history panel
✅ Admin can see: before_snapshot, after_snapshot, totals
✅ Seller does NOT see button anymore (but sale still correctable)
✅ No payment_request_reset warning (draft status)
✅ Commission correctly recalculated
```

**Verification Queries:**
```sql
SELECT * FROM seller_piece_sale_corrections 
WHERE sale_id = <test_sale_id> 
ORDER BY corrected_at DESC;

SELECT * FROM v_piece_sale_correction_history 
WHERE sale_id = <test_sale_id>;

SELECT total_amount, total_commission FROM v_piece_sale_history 
WHERE sale_id = <test_sale_id>;
```

---

### Test B: Quantity Increase in Pending Review

**Setup:**
```
- Create piece sale with status='pending_review'
- Payment method: cash (no payment request)
- Add item: Maíz Blanco @ $10 x 1 unit
- Item subtotal: $10
- Commission: $2 (per unit)
- Sale total: $10
- Commission total: $2
```

**Steps:**
1. Open piece sale detail
2. Click "Corregir" on the item
3. In form:
   - Keep same product (Maíz Blanco)
   - Change quantity to 5 units
   - Reason: "Cliente compró 5 unidades, no 1"
4. Preview:
   - ANTES: 1 × Maíz Blanco, $10
   - DESPUÉS: 5 × Maíz Blanco, $50
   - Diferencia: ↑ $40 (green)
   - Commission: $2 → $10
5. Confirm

**Expected Results:**
```
✅ Quantity multiplied correctly (1 → 5 units)
✅ Subtotal: $10 → $50
✅ Commission: $2 → $10
✅ Total sale: $10 → $50
✅ No payment warning (cash method)
✅ Correction recorded with correct snapshots
✅ corrections_count updated in history
```

---

### Test C: Both Product and Quantity Change

**Setup:**
```
- Create piece sale (any correctable status)
- Item: Producto A @ $5 x 2 units = $10 subtotal, $1 commission/unit = $2 total
```

**Steps:**
1. Open detail and click "Corregir"
2. Form:
   - Change product to: Producto B @ $8
   - Change quantity to: 3 units
   - Reason: "Incorrect product and wrong count"
3. Preview:
   - Old: 2 × Producto A @ $5 = $10, commission $2
   - New: 3 × Producto B @ $8 = $24, commission varies
   - Impact: ↑ $14 (green)
4. Confirm

**Expected Results:**
```
✅ Both changes applied
✅ Financial impact correctly calculated
✅ Snapshots show both products
✅ Before/After clearly differentiated
```

---

### Test D: Quantity Decrease (Negative Impact)

**Setup:**
```
- Item: Producto C @ $20 x 5 units = $100, commission $100
```

**Steps:**
1. Correct to 3 units (same product)
2. Preview:
   - Diferencia: ↓ $40 (red)
   - Commission: $100 → $60, Diferencia: ↓ $40 (red)
3. Confirm

**Expected Results:**
```
✅ Negative diff shows in red with ↓
✅ Total sale decreases correctly
✅ Commission decreases correctly
✅ Correction still recorded
```

---

### Test E: Transfer Payment with Total Change

**Setup:**
```
- Create piece sale with status='pending_review'
- Payment method: transfer
- Initial total: $100
- Has payment_request_id with uploaded proof
```

**Steps:**
1. Correct an item that changes total (e.g., $100 → $150)
2. In result screen:
   - Should see amber warning: "El comprobante de transferencia fue invalidado porque cambió el total"
   - Message: "Tendrás que re-enviar el comprobante de transferencia"
3. Close modal

**Expected Results:**
```
✅ payment_request_reset = true in RPC response
✅ Warning banner appears in result screen
✅ Sale returns to draft status
✅ Admin can see payment_request_reset=true in history
✅ User knows they must re-upload proof
```

**Database Verification:**
```sql
SELECT payment_request_reset, payment_request_id 
FROM seller_piece_sale_corrections 
WHERE sale_id = <test_sale_id>;
```

---

### Test F: Cannot Correct Confirmed Sale

**Setup:**
```
- Create piece sale with status='confirmed'
```

**Steps:**
1. Open detail modal
2. Look for "Corregir" buttons
3. Buttons should NOT be visible

**If user manually tries to call RPC:**
```
- RPC should reject with error message
- Modal shows error: "No se puede corregir venta con estado: confirmed"
```

**Expected Results:**
```
✅ Buttons hidden (isAdmin || !canCorrect)
✅ Modal doesn't render if status='confirmed'
✅ RPC validation rejects the change
```

---

### Test G: Cannot Correct to Identical Values

**Setup:**
```
- Item: Maíz Blanco @ $10 x 2 units
```

**Steps:**
1. Click "Corregir"
2. In form:
   - Select "Maíz Blanco" (same product)
   - Keep quantity as 2
   - Enter reason
3. Click "Ver cambios"

**Expected Results:**
```
✅ Button is disabled (grayed out)
✅ Cannot proceed to preview
✅ Form validation catches: no changes detected
```

---

### Test H: Reason Field Validation

**Setup:**
- Correction modal open with form step

**Steps:**
1. Enter reason with 9 characters: "Test abc"
2. "Ver cambios" should be DISABLED
3. Add one more character: "Test abc2"
4. "Ver cambios" should be ENABLED
5. Clear reason
6. "Ver cambios" should be DISABLED again

**Expected Results:**
```
✅ Character counter shows 0/10+
✅ Button disabled when < 10 characters
✅ Button enabled when >= 10 characters
✅ User cannot submit invalid form
```

---

### Test I: Product Search

**Setup:**
- Correction modal open
- Products loaded from `v_piece_sale_products`

**Steps:**
1. Click product input
2. Search "Maíz": should show Maíz Blanco, Maíz Amarillo, etc.
3. Search "1000": should show products with 1000g size
4. Search "SKU123": should show product with that SKU
5. Search "no_existe": should show no results
6. Click on a product in dropdown: should select it and close dropdown

**Expected Results:**
```
✅ Dropdown opens on focus
✅ Search filters by name, variant, size, SKU
✅ Filtered products display correctly
✅ Can select from dropdown
✅ Selected product shown in input and marked with ✓
```

---

### Test J: Admin Sees Correction History

**Setup:**
- Admin opens piece sale that has corrections
- Sales with multiple corrections preferred

**Steps:**
1. Open piece sale detail (admin view)
2. Scroll to "Historial de Correcciones" section
3. Verify section shows count: "Historial de Correcciones (N)"
4. For each correction, verify:
   - Date and time displayed
   - "X corrigió esta venta" (corrected_by_name)
   - Reason in gray box
   - Before/After grid with side-by-side display
   - Before: old product, quantity, prices, commission
   - After: new product, quantity, prices, commission
   - Total de venta affected: antes/después
   - If payment_request_reset: amber warning shown

**Expected Results:**
```
✅ Correction history section visible (admin only)
✅ All corrections displayed chronologically (most recent first)
✅ Each correction shows complete before/after
✅ Financial impact clear for each correction
✅ Payment reset warning appears when applicable
```

---

### Test K: Multiple Corrections on Same Sale

**Setup:**
- Execute Test A through completion
- Same sale still in correctable status

**Steps:**
1. Correct another item in the same sale
2. Again correct the same item to different product
3. Open admin view

**Expected Results:**
```
✅ corrections_count = 2 in sale header
✅ Admin history shows all 2 corrections
✅ latest_correction_* fields show MOST RECENT
✅ Badge still shows "Corregida"
✅ Each correction has complete snapshot
✅ Chronological order maintained
```

---

### Test L: Mobile Responsiveness

**Setup:**
- Open piece sale correction on mobile device (or responsive browser)
- Viewport: 375px (iPhone) or 430px (larger mobile)

**Steps:**
1. Open correction modal
   - ✅ Modal takes full screen (100% width minus padding)
   - ✅ No horizontal scroll
   - ✅ Can scroll vertically through content

2. Product dropdown
   - ✅ Dropdown stays within viewport
   - ✅ Can scroll through products without parent scrolling
   - ✅ Tap to select works smoothly

3. Before/After cards
   - ✅ Stack vertically (grid-cols-1)
   - ✅ Full width, easy to read
   - ✅ All text visible, no truncation

4. Buttons
   - ✅ Full width with padding
   - ✅ ≥ 44px height (easy to tap)
   - ✅ Proper spacing between buttons

5. Preview impacts
   - ✅ Impact summary readable
   - ✅ Color codes visible
   - ✅ Amounts fully displayed

**Expected Results:**
```
✅ All content fits without horizontal scroll
✅ Touch targets ≥ 44px
✅ Vertical scrolling works smoothly
✅ No layout breaks on mobile
✅ Typography remains readable
✅ Colors and icons clear
```

---

### Test M: Error Scenarios

**Scenario M1: Products Won't Load**
```
Steps:
1. Mock Supabase to fail on v_piece_sale_products query
2. Open correction modal
Expected: Error message "No se pudieron cargar los productos disponibles"
```

**Scenario M2: RPC Fails**
```
Steps:
1. Mock RPC to return error
2. Submit correction
Expected: Error message from RPC (not generic "Error desconocido")
Verification: User can go back to form and try again
```

**Scenario M3: Missing Commission Event**
```
Backend RPC returns: "Evento de comisión faltante para esta venta. Contacta soporte."
Frontend shows: Same error message in red box
```

**Scenario M4: Product Not Found**
```
Backend RPC returns: "Producto no encontrado en catálogo"
Frontend shows: Same error message
```

---

## Test Execution Checklist

### Before Running Tests
- [ ] Supabase project accessible
- [ ] Backend RPC deployed and working
- [ ] Views created and populated
- [ ] Frontend built successfully (`npm run build`)
- [ ] Test sales created in database
- [ ] Authentication working (test with seller and admin accounts)

### During Tests
- [ ] Browser console clear (no JavaScript errors)
- [ ] Network tab shows successful RPC calls
- [ ] Response data includes all expected fields
- [ ] Modal state transitions smoothly
- [ ] Calculations match expected values

### After Tests
- [ ] All scenarios passed
- [ ] No unhandled errors in console
- [ ] Database state consistent
- [ ] Admin history reflects all changes
- [ ] Mobile experience smooth

---

## Known Limitations & Future Improvements

### Current Scope
- ✅ Single item correction per modal open
- ✅ No batch corrections
- ✅ Seller can correct items in their own sales
- ✅ Admin can view but not directly correct (uses same workflow)

### Future Enhancements (Out of Scope)
- [ ] Batch item corrections (multiple items at once)
- [ ] Admin override for confirmed sales (with audit)
- [ ] Correction reason templates/suggestions
- [ ] Auto-detection of duplicate corrections
- [ ] Integration with financial reports
- [ ] Correction approval workflow

---

## Test Report Template

```markdown
# Test Execution Report - [DATE]

## Tester: [NAME]
## Device: [Desktop/iPhone/Android]
## Browser: [Chrome/Safari/Firefox]

### Scenario A: Product Change
- [ ] Form validation working
- [ ] Dropdown searches correctly
- [ ] Preview shows impact
- [ ] Correction submitted successfully
- [ ] Admin history updated
- **Result**: PASS / FAIL
- **Notes**: [Any issues]

### Scenario B: Quantity Increase
- [ ] Quantity input validates > 0
- [ ] Calculations correct
- [ ] Commission updated
- **Result**: PASS / FAIL
- **Notes**: [Any issues]

### Scenario C: Both Changes
- [ ] Multiple changes handled
- [ ] Snapshots complete
- **Result**: PASS / FAIL

### Scenario D: Quantity Decrease
- [ ] Negative impact in red
- [ ] Total decreases correctly
- **Result**: PASS / FAIL

### Scenario E: Transfer Payment
- [ ] Payment reset warning shown
- [ ] Clear message to user
- **Result**: PASS / FAIL

### Scenario F: Confirmed Sale
- [ ] Button not visible
- [ ] RPC rejects if bypassed
- **Result**: PASS / FAIL

### Scenario G: Same Values
- [ ] "Ver cambios" disabled
- [ ] Validation prevents submission
- **Result**: PASS / FAIL

### Scenario H: Reason Validation
- [ ] Counter shows 0/10
- [ ] Button disabled < 10 chars
- [ ] Button enabled >= 10 chars
- **Result**: PASS / FAIL

### Scenario I: Search
- [ ] Dropdown filters correctly
- [ ] Selection works smoothly
- **Result**: PASS / FAIL

### Scenario J: Admin History
- [ ] Corrections displayed
- [ ] Before/After shown
- [ ] Financial impact clear
- **Result**: PASS / FAIL

### Scenario K: Multiple Corrections
- [ ] Count increments
- [ ] All corrections visible
- [ ] Latest shown in header
- **Result**: PASS / FAIL

### Scenario L: Mobile
- [ ] No horizontal scroll
- [ ] Touch targets adequate
- [ ] Vertical scroll smooth
- [ ] Layout responsive
- **Result**: PASS / FAIL

### Scenario M: Errors
- [ ] Load failures handled
- [ ] RPC errors shown clearly
- [ ] Recovery possible
- **Result**: PASS / FAIL

## Summary
- **Total Scenarios**: 13
- **Passed**: __/13
- **Failed**: __/13
- **Critical Issues**: [List any]
- **Overall**: PASS / FAIL

## Sign-Off
Tester: _________________ Date: _________
```

---

## Quick Start Commands

```bash
# Build project
npm run build

# Run in development
npm run dev

# Check for errors
npm run type-check

# Format code
npm run format
```

## Environment Variables Needed
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Good luck with testing! 🚀
