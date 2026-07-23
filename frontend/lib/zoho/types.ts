// Zoho module types — isolated from lib/types.ts on purpose.
// Records are dynamic until backend mappers get explicit field whitelists;
// once they do, replace ZohoRecord with per-module interfaces.

export type ZohoModuleKey =
  | 'patients'
  | 'invoices'
  | 'appointments'
  | 'receipts'
  | 'cycles'
  | 'leads'
  | 'crm-leads';

export const ZOHO_MODULES: { key: ZohoModuleKey; label: string }[] = [
  { key: 'leads', label: 'Leads' },
  { key: 'crm-leads', label: 'CRM Leads' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'receipts', label: 'Receipts' },
  { key: 'patients', label: 'Patients' },
  { key: 'cycles', label: 'Cycles' },
];

export interface ZohoRecord {
  id: string | null;
  [field: string]: unknown;
}

export interface ZohoListResponse {
  source: 'zoho';
  module: ZohoModuleKey;
  asOf: string;
  stale: boolean;
  total: number;
  limit: number;
  offset: number;
  data: ZohoRecord[];
}

export interface ZohoSummaryEntry {
  count: number | null;
  asOf?: string;
  warming?: boolean;
}

export interface ZohoSummaryResponse {
  source: 'zoho';
  summary: Record<ZohoModuleKey, ZohoSummaryEntry>;
}
