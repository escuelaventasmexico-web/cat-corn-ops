# 🧪 Testing Guide: Enriquecimiento Modal Desglose Comercial

## Pre-Test Verification

### ✅ Build Status
```bash
npm run build
# Expected: ✓ built in 4.23s
# Status: 0 errors, 0 warnings
```

### ✅ Files Modified
- [x] services/commercialCollectionsService.ts (621 lines)
- [x] components/finance/CommercialCollectionsDetailModal.tsx (474 lines)

### ✅ No Breaking Changes
- Backward compatible
- Fallback mechanism included
- All existing functionality preserved

---

## 🧬 Testing Scenarios

### Test 1: Modal Opens with Loading State
**Steps**:
1. Navigate to: Finanzas → Calendario → Agosto 2024
2. Find: Día 20 (should have daily summary with tarjetas)
3. Click: "Ventas Socios Comerciales" tarjeta ($480)

**Expected**:
- [ ] Modal opens
- [ ] Spinner appears with text "Cargando información del socio y operación..."
- [ ] Spinner visible for 2-3 seconds
- [ ] Spinner disappears after data loads

**Result**: _______________

---

### Test 2: Enriquecimiento de Datos - Comodato Payment 1
**Prerequisites**: Modal abierto, data loaded

**Steps**:
1. Find: First payment card "Mini super el nuevo paraíso | $120"
2. Click: Chevron/expand icon to reveal details

**Expected Content**:

**SOCIO Section**:
- [ ] Nombre: "Mini super el nuevo paraíso" (resolved from DB)
- [ ] Folio: "MSP-001-2024" (resolved from DB)
- [ ] Responsable: "Juan Pérez García" (resolved from DB)

**PAGO Section**:
- [ ] Cobrado: "$120.00" (preserved, not changed)
- [ ] Método: "Efectivo" (preserved)
- [ ] Fecha: "Viernes, 20 de agosto" (preserved)
- [ ] Referencia: "CH-4521" (from DB)
- [ ] Notas: "Pago en especie" (from DB)

**LIQUIDACIÓN VINCULADA Section**:
- [ ] Fecha: Displays (if exists)
- [ ] Tipo: Displays (if exists)
- [ ] Status: Displays (if exists)

**PRODUCTOS VENDIDOS Section**:
- [ ] Product 1: "Elote c/ queso"
  - [ ] Variant: "Grande"
  - [ ] Size: "Bolsa"
  - [ ] Quantity: 25
  - [ ] Price: "$5.00"
  - [ ] Amount: "$125.00"
- [ ] Product 2: "Esquites"
  - [ ] Variant: "Regular"
  - [ ] Size: "Vaso"
  - [ ] Quantity: 15
  - [ ] Price: "$3.50"
  - [ ] Amount: "$52.50"

**Result**: _______________

---

### Test 3: Enriquecimiento de Datos - Comodato Payment 2
**Steps**:
1. Find: Second payment "Mini super san pancho | $210"
2. Click: Expand

**Expected**:
- [ ] Partner name resolves: "Mini super san pancho"
- [ ] Payment amount preserved: "$210.00"
- [ ] Products display (if any)
- [ ] No errors in console

**Result**: _______________

---

### Test 4: Enriquecimiento de Datos - Comodato Payment 3
**Steps**:
1. Find: Third payment "Aguas frescas | $150"
2. Click: Expand

**Expected**:
- [ ] Partner name resolves: "Aguas frescas Doña Rosa" (or similar)
- [ ] Payment amount preserved: "$150.00"
- [ ] All details display correctly
- [ ] No errors in console

**Result**: _______________

---

### Test 5: Data Integrity - Totals Preserved
**Steps**:
1. Calculate sum: $120 + $210 + $150 = $480
2. Compare with modal header

**Expected**:
- [ ] Modal shows: "Total: $480.00"
- [ ] Equals sum of individual payments
- [ ] Day 20 overall total: $815.00 (unchanged)
- [ ] All other totals: Unchanged

**Result**: _______________

---

### Test 6: Collapse/Expand Functionality
**Steps**:
1. Open modal
2. Expand payment 1
3. Collapse payment 1
4. Expand payment 2

**Expected**:
- [ ] Only one card expanded at a time
- [ ] Chevron icon rotates correctly
- [ ] Data persists when re-expanding
- [ ] No console errors

**Result**: _______________

---

### Test 7: Error Handling - Network Failure Simulation
**Steps**:
1. Open DevTools (F12)
2. Go to Network tab
3. Throttle to "Slow 3G"
4. Click modal tarjeta

**Expected**:
- [ ] Loading spinner shows (possibly longer)
- [ ] Modal eventually loads (with fallback data if needed)
- [ ] No crashes or console errors
- [ ] Graceful degradation

**Result**: _______________

---

### Test 8: Responsive Design - Mobile View
**Steps**:
1. Open DevTools (F12)
2. Toggle device toolbar (Cmd+Shift+M)
3. Set to iPhone 12 (375px width)
4. Open modal

**Expected**:
- [ ] Modal content readable
- [ ] All text fits without overflow
- [ ] Expanded details visible
- [ ] No horizontal scrolling

**Result**: _______________

---

### Test 9: Browser Compatibility
**Test on**:
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)

**Expected**:
- [ ] Modal opens correctly on all browsers
- [ ] Data displays correctly
- [ ] No TypeScript errors
- [ ] Loading spinner animates smoothly

**Result**: _______________

---

### Test 10: Performance Check
**Steps**:
1. Open DevTools
2. Go to Performance tab
3. Click record
4. Open modal
5. Expand all 3 payments
6. Stop recording

**Expected**:
- [ ] Time to first paint: < 1s
- [ ] Time to interactive: < 2s
- [ ] No jank or frame drops
- [ ] 3 queries logged in Network tab

**Result**: _______________

---

## 📋 Checklist de Verification

### Data Integrity
- [ ] Payment 1: $120.00 ✓
- [ ] Payment 2: $210.00 ✓
- [ ] Payment 3: $150.00 ✓
- [ ] Commercial Total: $480.00 ✓
- [ ] Day 20 Total: $815.00 ✓
- [ ] Day 19 Total: $675.00 ✓
- [ ] All other totals: Unchanged ✓

### Functionality
- [ ] Modal opens on click
- [ ] Loading state displays
- [ ] Enriched data loads correctly
- [ ] All sections visible (SOCIO, PAGO, LIQUIDACIÓN, PRODUCTOS)
- [ ] Expand/collapse works
- [ ] Error handling works

### User Experience
- [ ] Loading spinner is clear
- [ ] Data is well-organized
- [ ] Text is readable
- [ ] Colors/contrast are good
- [ ] No console errors
- [ ] Responsive on mobile

### Performance
- [ ] Modal loads in <3 seconds
- [ ] No unnecessary queries
- [ ] No memory leaks
- [ ] Smooth animations
- [ ] No lag on interactions

### Compatibility
- [ ] Works in Chrome
- [ ] Works in Firefox
- [ ] Works in Safari
- [ ] Works on mobile
- [ ] Works on tablet

---

## 🐛 Known Issues to Watch For

### Potential Issues
1. **sellerName undefined**: PieceSaleCard uses seller_id pattern (different)
   - **Expected**: Shows "Vendedor [ID]" with note about products
   - **Action**: Not enriquecimiento for sellers yet (future PR)

2. **Slow loading**: If database is slow
   - **Expected**: Spinner shows for longer (but completes)
   - **Action**: Verify batch queries are actually in parallel

3. **Products not showing**: If movement has no items or quantity_sold = 0
   - **Expected**: Products section hidden (not error)
   - **Action**: Check database has quantity_sold > 0

---

## 📊 Expected Query Pattern

**Network Tab Should Show**:
```
POST /graphql  (Batch Query 1: commercial_partners)
POST /graphql  (Batch Query 2: commercial_partner_movements)
POST /graphql  (Batch Query 3: commercial_partner_movement_items)

Total: 3 queries (not 9 or more)
```

---

## ✅ Sign-Off Checklist

After all tests pass:

- [ ] All data integrity tests passed
- [ ] All functionality tests passed
- [ ] All UX tests passed
- [ ] All performance tests passed
- [ ] All compatibility tests passed
- [ ] No console errors
- [ ] No warnings
- [ ] Ready for production

**Tester Name**: _______________
**Date**: _______________
**Sign-off**: _______________

---

## 🚀 Deployment After Testing

Once all tests pass:

1. **Commit** (if applicable):
   ```bash
   git add .
   git commit -m "feat: Enrich commercial collections modal with partner, movement, and product data"
   ```

2. **Deploy to staging**:
   ```bash
   npm run build
   npm run deploy:staging
   ```

3. **Test in staging** (repeat tests)

4. **Deploy to production**:
   ```bash
   npm run deploy:prod
   ```

5. **Monitor** for errors (1 hour post-deploy)

---

**Testing Guide Complete** ✅
