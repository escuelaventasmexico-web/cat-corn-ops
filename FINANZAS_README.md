# Finanzas Module - Cat Corn OPS

Complete finance management module for Cat Corn OPS application.

## Features Implemented

### 1. **Main Dashboard** (`/finanzas`)
- Grid of 7 clickable module cards
- Real-time income vs expenses chart for current month
- Dark UI with gold accents consistent with the app

### 2. **Resumen del Mes** (Month Summary)
- Total sales, expenses, and net income
- Fixed vs variable costs breakdown
- Profit margin calculation
- Fixed costs coverage status
- Monthly target achievement percentage
- Data source: RPC `finance_month_summary(p_month_start)`

### 3. **Gastos del Mes** (Monthly Expenses CRUD)
- Full CRUD operations for expenses
- Filter by current month
- Fields: date, amount, type (FIXED/VARIABLE/OTHER), category, vendor, invoice status, payment method, notes
- Expense type badges with color coding
- Total expenses summary

### 4. **Gastos Fijos** (Fixed Costs CRUD)
- Manage recurring monthly costs
- Fields: name, amount, active status, notes
- Active/inactive toggle
- Total active fixed costs summary

### 5. **Meta Mensual** (Monthly Sales Targets)
- Set and track monthly sales goals
- Historical targets view (last 12 months)
- Target achievement percentage calculated automatically
- Notes field for strategies and objectives

### 6. **Income vs Expenses Chart**
- Daily series visualization using Recharts
- Green line for sales, red line for expenses
- Responsive design
- Data source: RPC `finance_daily_series(p_month_start)`

### 7. **Stub Modules** (Ready for expansion)
- Gastos Fijos vs Ventas (Coverage analysis)
- P&L Detallado (Detailed profit & loss)
- Documentos (Invoice/document management with file upload)

## Database Schema

### Tables Created
- `expenses` - All expense records
- `fixed_costs` - Recurring cost definitions
- `monthly_targets` - Sales targets by month
- `expense_documents` - Document metadata (linked to expenses)

### RPC Functions
- `finance_month_summary(p_month_start DATE)` - Returns JSON summary
- `finance_daily_series(p_month_start DATE)` - Returns daily sales/expenses rows

### Storage Bucket
- `expense-documents` (private) - For invoice/receipt uploads

## Installation & Setup

### 1. Run Database Migration
```bash
# Execute the migration SQL in Supabase SQL Editor
psql -f migration_finance_module.sql
```

Or copy the contents of `migration_finance_module.sql` into Supabase Dashboard → SQL Editor

### 2. Create Storage Bucket (Supabase Dashboard)
1. Go to Storage → Create Bucket
2. Name: `expense-documents`
3. Public: **No** (private)
4. Add policies for authenticated users (see migration file comments)

### 3. Install Dependencies (if needed)
```bash
npm install recharts
```

## File Structure

```
pages/
  └── Finanzas.tsx                    # Main finance page with card grid

components/finance/
  ├── FinanceChart.tsx                # Income vs Expenses chart
  ├── FinanceSummaryPanel.tsx         # Month summary view
  ├── ExpensesManager.tsx             # Expenses CRUD table
  ├── ExpenseFormModal.tsx            # Expense create/edit form
  ├── FixedCostsManager.tsx           # Fixed costs CRUD table
  ├── FixedCostFormModal.tsx          # Fixed cost create/edit form
  ├── MonthlyTargetsEditor.tsx        # Monthly target configuration
  ├── FixedCostsVsSales.tsx           # Stub - Coverage analysis
  ├── PLDetailedView.tsx              # Stub - Detailed P&L
  └── ExpenseDocumentsManager.tsx     # Stub - Document uploads
```

## Usage

### Accessing the Module
1. Navigate to `/finanzas` or click "Finanzas" in the sidebar
2. Click any card to open that module
3. Each module has a close (X) button to return to overview

### Adding an Expense
1. Click "Gastos del Mes" card
2. Click "+ Nuevo Gasto" button
3. Fill in expense details
4. Click "Guardar"

### Setting Monthly Target
1. Click "Meta Mensual" card
2. Select month and enter target amount
3. Add optional notes
4. Click "Guardar Meta"

### Viewing Month Summary
1. Click "Resumen del Mes" card
2. View all financial metrics for current month
3. Metrics update automatically based on sales and expenses

## Data Flow

### Sales Data
- Pulled from existing `sales` table
- Aggregated by day/month for charts and summaries

### Expenses Data
- New `expenses` table tracks all costs
- Type field distinguishes FIXED/VARIABLE/OTHER
- Links to `fixed_costs` table for recurring items

### Monthly Targets
- Independent table `monthly_targets`
- One record per month
- Used to calculate achievement percentage

## RPC Functions Details

### finance_month_summary
**Input:** `p_month_start` (DATE)
**Returns:** JSON object with:
```json
{
  "total_sales": 50000.00,
  "total_expenses": 35000.00,
  "fixed_costs": 15000.00,
  "variable_costs": 20000.00,
  "net_income": 15000.00,
  "profit_margin": 30.00,
  "fixed_costs_covered": true,
  "monthly_target": 60000.00,
  "target_achievement": 83.33
}
```

### finance_daily_series
**Input:** `p_month_start` (DATE)
**Returns:** TABLE with columns:
- `day` (TEXT) - Day of month "01", "02", etc.
- `sales_mxn` (NUMERIC) - Total sales for that day
- `expenses_mxn` (NUMERIC) - Total expenses for that day

## Security

### Row Level Security (RLS)
- All tables have RLS enabled
- Policies allow authenticated users full CRUD access
- Storage bucket is private with authenticated-only access

### Authentication
- Uses existing Supabase auth from app
- All queries check for authenticated session
- RPC functions use SECURITY DEFINER for controlled access

## Future Enhancements

### Planned Features
1. **Fixed Costs vs Sales Coverage Analysis**
   - Visual progress bar showing coverage
   - Break-even point calculation
   - Days needed to cover fixed costs

2. **Detailed P&L Report**
   - Complete income statement
   - Cost of goods sold (COGS) integration
   - Gross profit vs net profit
   - Export to PDF

3. **Document Management**
   - File upload to storage bucket
   - Link documents to specific expenses
   - OCR for invoice data extraction
   - Document preview and download

4. **Advanced Analytics**
   - Expense trends and forecasting
   - Category-wise expense breakdown
   - Vendor spending analysis
   - Budget vs actual comparisons

5. **Expense Categorization**
   - Predefined category list
   - Category-wise reports
   - Budget allocation by category

## Troubleshooting

### Chart Not Loading
- Verify `finance_daily_series` RPC function exists
- Check browser console for errors
- Ensure sales table has data for current month

### Summary Shows Zero
- Verify `finance_month_summary` RPC function exists
- Check that expenses and sales exist for current month
- Ensure RLS policies allow reading from sales table

### Can't Add Expense
- Verify expenses table exists with correct schema
- Check RLS policies allow INSERT
- Ensure required fields are filled (date, amount, type, payment_method)

### Import Errors
- Run `npm install recharts` if chart component fails
- Verify all finance component files are in correct directory
- Check that Finanzas route is added to App.tsx

## Maintenance

### Monthly Tasks
1. Review and verify expense entries
2. Update monthly sales target
3. Check fixed costs for changes
4. Generate month-end summary report

### Data Cleanup
- Old expense documents can be archived after 2 years
- Inactive fixed costs can be deleted if no longer relevant
- Monthly targets older than 2 years can be archived

## Performance

### Optimizations
- Indexes on expense_date, type, and month_start
- RPC functions use efficient aggregations
- Chart data limited to current month
- Expenses manager limited to current month by default

### Caching
- Consider adding client-side caching for summary data
- Chart data can be cached for 1 hour
- Fixed costs rarely change, can be cached longer

## License
Part of Cat Corn OPS - Internal use only
