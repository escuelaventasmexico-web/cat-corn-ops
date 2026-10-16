export interface B2BPaymentBusinessDateInput {
  businessDate?: string | null;
  paymentDate: string | Date;
  createdAt?: string | Date | null;
}

export function assertBusinessDate(value: string): string;
export function getMexicoCityDate(value: string | Date): string;
export function resolveLegacyB2BPaymentBusinessDate(input: B2BPaymentBusinessDateInput): string;
