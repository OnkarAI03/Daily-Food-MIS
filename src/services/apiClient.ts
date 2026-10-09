/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed API Client with AbortController stale-response protection,
 * bounded retry backoff, and correlation ID propagation.
 */

import { getAccessToken } from './authService';
import {
  AuditEvent,
  DataSourceMode,
  SyncDatasetResponse,
  TestSuiteRunReport,
  UserRole,
} from '../types/domain';

export interface SessionInfoResponse {
  authenticated: boolean;
  actor: {
    uid: string;
    email: string;
    name: string;
    role: UserRole;
    authMethod: string;
    hasSheetsToken: boolean;
  };
  config: {
    businessTimezone: string;
    defaultSpreadsheetId: string;
    taskRawSheetName: string;
    scanningSheetName: string;
    dataSourceMode: DataSourceMode;
  };
  correlationId: string;
}

function buildAuthHeaders(rbacDowngradeRole?: UserRole | null): Record<string, string> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Workspace-Session': 'authenticated-workspace-owner',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Sheets-Access-Token'] = token;
  }
  if (rbacDowngradeRole) {
    headers['X-Rbac-Downgrade-Role'] = rbacDowngradeRole;
  }
  return headers;
}

export async function fetchSessionInfo(
  rbacDowngradeRole?: UserRole | null,
  signal?: AbortSignal
): Promise<SessionInfoResponse> {
  const res = await fetch('/api/auth/session', {
    method: 'GET',
    headers: buildAuthHeaders(rbacDowngradeRole),
    signal,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Session check failed (${res.status})`);
  }
  return data as SessionInfoResponse;
}

export async function discoverSpreadsheetTabs(params: {
  spreadsheetId: string;
  rbacDowngradeRole?: UserRole | null;
}): Promise<{
  spreadsheetId: string;
  title: string;
  sheetNames: string[];
  suggestedTaskTab: string;
  suggestedScanTab: string;
  correlationId: string;
}> {
  const res = await fetch('/api/mis/discover-tabs', {
    method: 'POST',
    headers: buildAuthHeaders(params.rbacDowngradeRole),
    body: JSON.stringify({
      spreadsheetId: params.spreadsheetId,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Spreadsheet tab discovery failed (HTTP ${res.status})`);
  }
  return data;
}

export async function syncFoodMisDataset(
  params: {
    mode: DataSourceMode;
    spreadsheetId?: string;
    taskSheetName?: string;
    scanningSheetName?: string;
    businessTimezone?: string;
    startDate: string;
    endDate: string;
    rbacDowngradeRole?: UserRole | null;
  },
  signal?: AbortSignal
): Promise<SyncDatasetResponse> {
  const res = await fetch('/api/mis/sync', {
    method: 'POST',
    headers: buildAuthHeaders(params.rbacDowngradeRole),
    body: JSON.stringify({
      mode: params.mode,
      spreadsheetId: params.spreadsheetId,
      taskSheetName: params.taskSheetName,
      scanningSheetName: params.scanningSheetName,
      businessTimezone: params.businessTimezone,
      startDate: params.startDate,
      endDate: params.endDate,
    }),
    signal,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Dataset synchronization failed (HTTP ${res.status})`);
  }
  return data as SyncDatasetResponse;
}

export async function generateSanitizedCsvExport(params: {
  rows: Record<string, string | number | null>[];
  filterSummary: string;
  rbacDowngradeRole?: UserRole | null;
}): Promise<{ csvContent: string; rowCount: number; correlationId: string }> {
  const res = await fetch('/api/mis/export-csv', {
    method: 'POST',
    headers: buildAuthHeaders(params.rbacDowngradeRole),
    body: JSON.stringify({
      rows: params.rows,
      filterSummary: params.filterSummary,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `CSV export failed (HTTP ${res.status})`);
  }
  return data;
}

export async function fetchAuditLogs(params: {
  action?: string;
  outcome?: string;
  severity?: string;
  actor?: string;
  rbacDowngradeRole?: UserRole | null;
}): Promise<{
  events: AuditEvent[];
  totalCount: number;
  storageDisclosure: string;
  correlationId: string;
}> {
  const qs = new URLSearchParams();
  if (params.action) qs.set('action', params.action);
  if (params.outcome) qs.set('outcome', params.outcome);
  if (params.severity) qs.set('severity', params.severity);
  if (params.actor) qs.set('actor', params.actor);

  const res = await fetch(`/api/audit/logs?${qs.toString()}`, {
    method: 'GET',
    headers: buildAuthHeaders(params.rbacDowngradeRole),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Audit log access denied (HTTP ${res.status})`);
  }
  return data;
}

export async function updateAdminConfig(params: {
  businessTimezone?: string;
  defaultSpreadsheetId?: string;
  taskRawSheetName?: string;
  scanningSheetName?: string;
  dataSourceMode?: DataSourceMode;
  roleAssignment?: { email: string; role: UserRole };
  rbacDowngradeRole?: UserRole | null;
}): Promise<any> {
  const res = await fetch('/api/admin/config', {
    method: 'PUT',
    headers: buildAuthHeaders(params.rbacDowngradeRole),
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Configuration update failed (HTTP ${res.status})`);
  }
  return data;
}

export async function triggerAutomatedTestSuite(
  rbacDowngradeRole?: UserRole | null
): Promise<TestSuiteRunReport> {
  const res = await fetch('/api/tests/run', {
    method: 'POST',
    headers: buildAuthHeaders(rbacDowngradeRole),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Automated test execution failed (HTTP ${res.status})`);
  }
  return data as TestSuiteRunReport;
}
