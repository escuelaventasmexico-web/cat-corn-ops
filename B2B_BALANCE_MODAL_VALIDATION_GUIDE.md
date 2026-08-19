# 🧪 B2B Balance Modal - Data Validation Guide

## Overview

This guide helps you validate that the redesigned B2B Balance Detail Modal correctly displays the distinction between:
1. **SALDO POR COBRAR** (Debt: money owed from sales)
2. **PRODUCTO EN POSESIÓN** (Inventory: product in possession)

---

## Testing Steps

### Step 1: Open B2B Summary Report
1. Navigate to Commercial Partners → B2B Summary Report
2. Click on the "PENDIENTE" card to open the B2B Balance Detail Modal

### Step 2: Verify Resumen Superior (Summary Cards)
Look at the top summary cards and verify:

```
✓ 💰 Total Pendiente: Should show ONLY monetary sums
✓ Saldo Comodato: Should show ONLY pending from sales (not inventory value)
✓ 📦 Producto en Posesión: Should show total pieces AND total Cat Corn value
✓ Mayoreo: Should show wholesale debt
✓ Socios Pendientes: Should show count of partners with debt > 0
```

**Expected Value Check:**
- `Total Pendiente` should still be **$370** (unchanged from original)
- `Saldo Comodato` should still be **$240** (unchanged from original)
- `📦 Producto en Posesión` should be **XX piezas** / **$XXXX** value (new metric)

---

## Test Case: Abarrotes Mary

### Scenario
Abarrotes Mary has:
- No money owed (comodato.pending = $0)
- 8 pieces in stock
- Each piece valued at $30 Cat Corn (last_price_to_catcorn)

### Validation Checklist

#### ✓ Partner Card Header Display
When scrolling through the TODOS tab, find "Abarrotes Mary" and verify:

```
Partner Card Header should show:
┌────────────────────────────────────────┐
│ Abarrotes Mary                   [123] │
│                                        │
│ [💰 Por cobrar: $0    ]                │ ← Green (no debt)
│ [📦 En posesión: 8 pz ]                │ ← Yellow inventory count
│ [💵 Valor: $240       ]                │ ← Cat Corn value
│ [📊 Exposición: $240  ]                │ ← Total (0 + 240)
│                                        │
│ [Ver detalle ▼]                        │
└────────────────────────────────────────┘
```

#### ✓ PENDIENTES Tab Test
Behavior: Abarrotes Mary should **NOT** appear in PENDIENTES tab
Reason: `comodato.pending = $0` (not > 0)

```
Check:
1. Click on "PENDIENTES" tab
2. Scan the list of partners
3. ✓ Abarrotes Mary should NOT be visible
4. Reason: pending = $0, so filtered out
```

#### ✓ LIQUIDADOS Tab Test
Behavior: Abarrotes Mary appearance depends on financial_status
```
Check:
1. Click on "LIQUIDADOS" tab
2. If Abarrotes Mary appears here, financial_status = 'liquidated'
3. If not, financial_status ≠ 'liquidated'
4. Either result is correct (depends on data)
```

#### ✓ TODOS Tab Test
Behavior: Abarrotes Mary should **ALWAYS** appear in TODOS
```
Check:
1. Click on "TODOS" tab
2. ✓ Abarrotes Mary should be visible
3. Card should show metrics as above
```

#### ✓ "Con producto en posesión" Filter Test
Behavior: Filter should show Abarrotes Mary (has 8 pieces)

```
Check:
1. Click the checkbox: "☐ 📦 Solo con producto en posesión"
2. ✓ Abarrotes Mary should be visible
3. ✓ Should be sorted by stock value (descending)
4. The 8 piezas × $30 = $240 is its sort key
```

#### ✓ Expanded Card Detail Test
When you click on Abarrotes Mary's card to expand:

```
Should see TWO clear sections:

━━━━━ 💰 SALDO POR COBRAR ━━━━━
  Generado: $0 (or whatever sales were reported)
  Pagado: $0
  Pendiente: $0 ← This is the key number

  [Transacciones reportadas]
  (Should be empty or show past sales with their payment status)

━━━━━ 📦 PRODUCTO EN POSESIÓN ━━━━━
  Total de piezas: 8
  Valor Cat Corn: $240

  [Productos en detalle]
  - Product A
    Cantidad: 2 piezas
    Precio unitario: $60
    Valor total: $120
    Movimientos: Entregadas 2 · Vendidas 0 · ...
    Primera entrega: [date]
    Última entrega: [date]

  - Product B
    Cantidad: 6 piezas
    Precio unitario: $20
    Valor total: $120
    Movimientos: Entregadas 6 · Vendidas 0 · ...
    Primera entrega: [date]
    Última entrega: [date]
```

✓ **Critical Validation**: Stock value should be:
- Product A: 2 × $60 = $120 (NOT using suggested_retail_price)
- Product B: 6 × $20 = $120 (NOT using suggested_retail_price)
- Total: $240

---

## Test Case: Marea Terraza

### Scenario
Marea Terraza has:
- Money owed (comodato.pending = $60)
- Some pieces in stock (comodato.stock_units > 0)

### Validation Checklist

#### ✓ Partner Card Header Display
Find "Marea Terraza" and verify:

```
Partner Card Header should show:
┌────────────────────────────────────────┐
│ Marea Terraza                    [456] │
│                                        │
│ [💰 Por cobrar: $60   ]                │ ← Red (has debt)
│ [📦 En posesión: Y pz ]                │ ← Yellow inventory count
│ [💵 Valor: $XXXX      ]                │ ← Cat Corn value
│ [📊 Exposición: $XXXX ]                │ ← Total ($60 + value)
│                                        │
│ [Ver detalle ▼]                        │
└────────────────────────────────────────┘
```

Note: 
- "Por cobrar" displays in RED because $60 > 0
- Exposición = $60 + (stock value)

#### ✓ PENDIENTES Tab Test
Behavior: Marea Terraza should **APPEAR** in PENDIENTES tab
Reason: `comodato.pending = $60` (> 0)

```
Check:
1. Click on "PENDIENTES" tab
2. Scan the list
3. ✓ Marea Terraza should be visible
4. Verify amount shown is $60 (or pending_amount)
```

#### ✓ LIQUIDADOS Tab Test
Behavior: Depends on financial_status
```
Check:
1. Click on "LIQUIDADOS" tab
2. If Marea Terraza appears, financial_status = 'liquidated'
   (Note: Odd if it appears here since pending = $60, but depends on data logic)
```

#### ✓ TODOS Tab Test
Behavior: Marea Terraza should **ALWAYS** appear
```
Check:
1. Click on "TODOS" tab
2. ✓ Marea Terraza should be visible
```

#### ✓ "Con producto en posesión" Filter Test
Behavior: Filter depends on whether Marea Terraza has stock_units > 0

```
IF Marea Terraza has stock (stock_units > 0):
  1. Click the checkbox: "☐ 📦 Solo con producto en posesión"
  2. ✓ Marea Terraza should be visible
  3. ✓ Sorted by stock value (descending)

IF Marea Terraza has NO stock (stock_units = 0):
  1. Click the checkbox: "☐ 📦 Solo con producto en posesión"
  2. ✓ Marea Terraza should be HIDDEN
  3. (Because it doesn't have inventory)
```

#### ✓ Expanded Card Detail Test
When expanding Marea Terraza:

```
━━━━━ 💰 SALDO POR COBRAR ━━━━━
  Generado: $X (total sales reported)
  Pagado: $Y (amount paid)
  Pendiente: $60 ← Key number (DIFFERENT from stock value)

  [Transacciones reportadas]
  - Date1: Productos vendidos
    - Product A × 5 = $150
    - Product B × 2 = $80
    Monto: $230
    Pagado: $200
    Status: ✓ Liquidado / ⏳ Pendiente

  - Date2: ...

━━━━━ 📦 PRODUCTO EN POSESIÓN ━━━━━
  Total de piezas: Z
  Valor Cat Corn: $V

  [Productos en detalle]
  (Show all products with current_quantity > 0)
```

✓ **Critical Validation**: 
- The $60 in "Pendiente" is NOT part of the stock value
- Stock value is calculated from pieces × unit prices (NOT from the pending amount)
- Exposición = $60 (pending) + $V (stock value)

---

## Critical Validation: Dashboard Numbers Unchanged

After using the modal, verify these numbers on the main dashboard remain **UNCHANGED**:

```
Dashboard → B2B Summary Report

Expected values:
✓ Total Pendiente: $370
✓ Saldo Comodato: $240
✓ Mayoreo: $[X]
✓ Venta por Pieza: $[Y]
✓ Socios Pendientes: 4
```

**Reason**: Modal display only changes HOW data is presented, not the underlying data.

---

## Filtering Logic Validation

### Scenario 1: Default View (No Filters)
```
Tab: PENDIENTES
Filter: None

Expected:
✓ Shows all partners where comodato.pending > 0 OR wholesale.pending > 0
✓ Sorted by pending_amount (descending, default)
✓ Should see: Abarrotes Mary (NO if pending=0), Marea Terraza (YES if pending=$60), etc.
```

### Scenario 2: With "Con producto" Filter Active
```
Tab: PENDIENTES (or any)
Filter: ☑ 📦 Solo con producto en posesión

Expected:
✓ Shows only partners where comodato.stock_units > 0
✓ Sorted by stock value (descending, not pending)
✓ Example: If partner A has $240 stock and partner B has $100 stock
           Partner A should appear above Partner B (regardless of pending)
```

### Scenario 3: Filter Unchecked
```
Tab: PENDIENTES
Filter: ☐ (unchecked)

Expected:
✓ Shows partners by pending > 0 (for this tab)
✓ Sorted by pending_amount (descending)
```

---

## Color Coding Verification

When viewing Partner Cards, verify colors:

| Metric | Color When = $0 | Color When > $0 | Color When Inventory |
|--------|-----------------|-----------------|----------------------|
| 💰 Por cobrar | 🟢 Green | 🔴 Red | - |
| 📦 En posesión | - | - | 🟡 Yellow (count) |
| 💵 Valor Cat Corn | - | - | 🟡 Cream (money) |
| 📊 Exposición | - | - | 🟠 Orange |

Example:
- Abarrotes Mary: $0 pending = 🟢 Green, 8 pieces = 🟡 Yellow
- Marea Terraza: $60 pending = 🔴 Red, N pieces = 🟡 Yellow

---

## Data Integrity Checks

### Check 1: Stock Values Use Correct Price
```
For each product in inventory:
  Displayed Value = current_quantity × last_price_to_catcorn
  
  ✓ Should NOT use: suggested_retail_price
  ✓ Should NOT use: purchase_price
  ✓ Should ALWAYS use: last_price_to_catcorn
```

**How to verify:**
1. In modal, find a partner's inventory section
2. Find any product with quantity > 0
3. Check if: displayed_value = quantity × last_price_to_catcorn
4. ✓ Value should match exactly

### Check 2: Exposición Formula
```
For each partner's comodato:
  Exposición = comodato.pending + SUM(inventory_value)
  
  Where: inventory_value = current_quantity × last_price_to_catcorn
```

**How to verify:**
1. Open partner card (e.g., Abarrotes Mary)
2. Note the "Exposición" value shown in header ($240)
3. Calculate: pending + stock_value
   - Abarrotes Mary: $0 + $240 = $240 ✓
4. Compare with displayed value
5. ✓ Should match exactly

### Check 3: Resumen Totals Accuracy
```
Resumen Superior:
  Producto total piezas = SUM(all partners' comodato.stock_units)
  Producto total value = SUM(all partners' stock value)
```

**How to verify:**
1. Note total pieces in Resumen (e.g., 8 + N + ... = total)
2. Note total value in Resumen (e.g., $240 + $X + ... = total)
3. Manually add up from each partner card when expanded
4. ✓ Resumen totals should match sum of all partners

---

## Common Test Scenarios

### Scenario A: New Partner (No History)
```
Setup: Partner with 0 pending, 5 pieces in stock

Expected in Modal:
✓ Card shows: $0 pending (green), 5 piezas, $100 value (5×$20), $100 exposición
✓ Doesn't appear in PENDIENTES tab
✓ Appears in TODOS tab
✓ Appears when "Con producto" filter active
✓ ComodatoDetail shows:
  - Pendiente section: $0 in each field
  - Producto section: 5 piezas, $100, with product breakdown
```

### Scenario B: Sold Out But Still Owes
```
Setup: Partner with $100 pending, 0 pieces in stock

Expected in Modal:
✓ Card shows: $100 pending (red), 0 piezas, $0 value, $100 exposición
✓ Appears in PENDIENTES tab
✓ Appears in TODOS tab
✓ Does NOT appear when "Con producto" filter active (stock_units = 0)
✓ ComodatoDetail shows:
  - Pendiente section: $100 with transaction history
  - Producto section: 0 piezas, $0 (empty inventory)
```

### Scenario C: Mixed (Owes + Has Stock)
```
Setup: Partner with $50 pending, 3 pieces valued at $60 each

Expected in Modal:
✓ Card shows: $50 pending (red), 3 piezas, $180 value, $230 exposición
✓ Appears in PENDIENTES tab (pending > 0)
✓ Appears in TODOS tab
✓ Appears when "Con producto" filter active (stock_units = 3)
✓ ComodatoDetail shows:
  - Pendiente section: $50 with transaction history
  - Producto section: 3 piezas, $180 with product breakdown
✓ Exposición formula: $50 + $180 = $230 ✓
```

---

## Quick Validation Checklist

Use this checklist for quick validation:

```
STRUCTURE VALIDATION:
☐ Resumen superior shows 5 cards (not 4)
☐ 📦 Producto card shows pieces AND value
☐ Checkbox "Con producto en posesión" exists below tabs
☐ Partner cards show 4 metrics in 2×2 grid

DATA VALIDATION (Abarrotes Mary):
☐ Card shows: $0 pending (green)
☐ Card shows: 8 piezas (yellow)
☐ Card shows: $240 value (cream)
☐ Card shows: $240 exposición (orange)
☐ NOT in PENDIENTES tab (pending = $0)
☐ IS in TODOS tab
☐ IS when "Con producto" checked

DATA VALIDATION (Marea Terraza):
☐ Card shows: $60 pending (red)
☐ Card shows: N piezas (yellow)
☐ Card shows: $V value (cream)
☐ Card shows: $(60+V) exposición (orange)
☐ IS in PENDIENTES tab
☐ IS in TODOS tab
☐ IS when "Con producto" checked (if stock_units > 0)

SECTION SEPARATION (In expanded card):
☐ 💰 Section: Generado/Pagado/Pendiente + transactions
☐ 📦 Section: Total piezas + Valor Cat Corn + product details
☐ Clear visual separation between sections

FORMULA VALIDATION:
☐ Stock values use last_price_to_catcorn (verify 2-3 products)
☐ Exposición = pending + stock_value (verify 1-2 partners)
☐ Resumen totals = sum of all partners (verify)

DASHBOARD UNCHANGED:
☐ Dashboard $370 total still shows
☐ Dashboard $240 B2B still shows
☐ Dashboard 4 socios still shows
```

---

## Troubleshooting

### Issue: Partner not appearing where expected
```
Cause: Wrong filter or tab
Solution:
  1. Check which tab is active
  2. If PENDIENTES: Partner needs pending > 0
  3. If TODOS: Should always appear
  4. If filter active: Partner needs stock_units > 0
```

### Issue: Stock value doesn't match expected calculation
```
Cause: Wrong price field used
Solution:
  1. Verify you're using last_price_to_catcorn
  2. Check quantity is current_quantity (not total_delivered)
  3. Calculate: quantity × price = should match displayed value
```

### Issue: Exposición number seems wrong
```
Cause: Incorrect formula or calculation
Solution:
  1. Note the pending amount ($X)
  2. Note the stock value ($Y)
  3. Calculate: $X + $Y should equal Exposición
  4. Verify in the expanded detail section
```

### Issue: Colors not showing correctly
```
Cause: CSS not applied or terminal color mode
Solution:
  1. Ensure you're viewing in browser (not terminal)
  2. Clear browser cache (Ctrl+Shift+Delete)
  3. Refresh page (Ctrl+R)
  4. Colors should render: red for debt, yellow for inventory
```

---

## Sign-Off

Once all validations pass, confirm:

```
✓ All structure elements present
✓ All metrics calculate correctly
✓ All filtering works as expected
✓ All colors display correctly
✓ All formulas verified
✓ Dashboard numbers unchanged
✓ Build completes without errors
```

**Modal is ready for production use.**

---

Generated: 2025
