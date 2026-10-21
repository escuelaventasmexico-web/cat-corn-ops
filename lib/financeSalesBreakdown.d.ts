export type FinanceChannelKey = 'pos' | 'orders' | 'delivery';
export type FinanceBranchKey = 'chipitlan' | 'aurrera' | 'other';
export type FinanceSellerKey = 'angelica' | 'gerardo' | 'administrator' | 'unattributed';

export interface FinanceSaleSourceRow {
  id: string;
  total: number | string | null;
  payment_method: string | null;
  promotion_code: string | null;
  sale_origin: string | null;
  created_at: string;
  branch_id: string | null;
  cashier_id: string | null;
  pos_commission_attribution: string | null;
  pos_commission_recipient_id: string | null;
}

export interface FinanceSaleOperation {
  id: string;
  createdAt: string;
  total: number;
  paymentMethod: string;
  channel: FinanceChannelKey;
  branchKey: FinanceBranchKey | null;
  sellerKey: FinanceSellerKey | null;
}

export interface FinanceSummaryRow {
  total: number;
  tickets: number;
  averageTicket: number;
}

export interface FinanceBranchSummary extends FinanceSummaryRow {
  key: FinanceBranchKey;
  label: string;
  branchId: string | null;
}

export interface FinanceSellerSummary extends FinanceSummaryRow {
  key: FinanceSellerKey;
  label: string;
  sharePercent: number;
}

export interface FinanceSalesBreakdown {
  operations: FinanceSaleOperation[];
  branches: FinanceBranchSummary[];
  sellers: FinanceSellerSummary[];
  channels: Record<FinanceChannelKey, FinanceSummaryRow>;
  salesTotal: number;
  reconciliation: {
    inputRows: number;
    uniqueRows: number;
    duplicateRows: number;
    posTotal: number;
    sellersTotal: number;
    sellersMatchPos: boolean;
  };
}

export interface FinanceParticipationItem {
  key: string;
  label: string;
  amount: number;
  percentage: number;
}

export interface FinanceParticipation {
  total: number;
  items: FinanceParticipationItem[];
  amountMatchesTotal: boolean;
}

export const CHIPITLAN_BRANCH_ID: string;
export const FINANCE_BRANCHES: readonly Array<{ key: FinanceBranchKey; label: string; branchId: string | null }>;
export const FINANCE_AURRERA_SELLERS: readonly Array<{ key: FinanceSellerKey; label: string }>;
export function calculateGeneratedGrandTotal(salesGenerated: number, b2bGenerated: number): number;
export function buildSalesParticipation(salesBreakdown: FinanceSalesBreakdown, b2bGenerated: number): FinanceParticipation;
export function buildFinanceSalesBreakdown(
  rows: FinanceSaleSourceRow[],
  options?: { administratorUserIds?: string[] },
): FinanceSalesBreakdown;
