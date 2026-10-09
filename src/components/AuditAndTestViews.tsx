/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Security Audit Logs, Automated Test Center, and Operations & Settings Views
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  AuditEvent,
  DataSourceMode,
  TestSuiteRunReport,
  UserRole,
} from '../types/domain';
import {
  discoverSpreadsheetTabs,
  fetchAuditLogs,
  triggerAutomatedTestSuite,
  updateAdminConfig,
} from '../services/apiClient';
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  Play,
  RefreshCw,
  Server,
  Shield,
  Terminal,
} from 'lucide-react';

interface AuditLogsViewProps {
  currentRole: UserRole;
  rbacDowngradeRole: UserRole | null;
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({
  currentRole,
  rbacDowngradeRole,
}) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [storageDisclosure, setStorageDisclosure] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionFilter, setActionFilter] = useState('ALL');
  const [outcomeFilter, setOutcomeFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [actorSearch, setActorSearch] = useState('');
  const [deleteAttemptMessage, setDeleteAttemptMessage] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuditLogs({
        action: actionFilter,
        outcome: outcomeFilter,
        severity: severityFilter,
        actor: actorSearch,
        rbacDowngradeRole,
      });
      setEvents(data.events);
      setStorageDisclosure(data.storageDisclosure);
    } catch (err: any) {
      setError(err?.message || 'Failed to load security audit logs.');
    } finally {
      setLoading(false);
    }
  }, [actionFilter, outcomeFilter, severityFilter, actorSearch, rbacDowngradeRole]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleTestImmutableDelete = async () => {
    setDeleteAttemptMessage(null);
    try {
      const res = await fetch('/api/audit/logs', {
        method: 'DELETE',
        headers: {
          'X-Workspace-Session': 'authenticated-workspace-owner',
          ...(rbacDowngradeRole ? { 'X-Rbac-Downgrade-Role': rbacDowngradeRole } : {}),
        },
      });
      const body = await res.json();
      setDeleteAttemptMessage(
        `HTTP ${res.status}: ${body.error} (Correlation ID: ${body.correlationId}) — Logged to Audit Trail.`
      );
      loadLogs();
    } catch (err: any) {
      setDeleteAttemptMessage(err?.message || 'Delete blocked.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Architecture & Tamper-Evidence Disclosure Banner */}
      <div className="glass-panel rounded-xl p-5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600" />
            Server-Side Security Audit Trail (SHA-256 Hash-Chained)
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestImmutableDelete}
              className="px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-md hover:bg-rose-100 transition-colors"
            >
              Verify Immutability (Attempt DELETE)
            </button>
            <button
              type="button"
              onClick={loadLogs}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-md hover:bg-slate-200"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          <strong>UI Event Log vs. Security Audit Log:</strong> Client-side filter interactions are transient UI state. Security audit events below are written exclusively by trusted server-side code on authentication, permission denials, spreadsheet syncs, configuration updates, and exports. Each event includes a cryptographic SHA-256 chain link (<code className="font-mono">hashChainPrev → hashSignature</code>).
        </p>
        {storageDisclosure && (
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            Disclosure: {storageDisclosure}
          </p>
        )}
        {deleteAttemptMessage && (
          <div className="p-2.5 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs font-mono text-amber-800 dark:text-amber-300">
            {deleteAttemptMessage}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="glass-panel rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200"
          >
            <option value="ALL">All Actions</option>
            <option value="AUTH_VERIFY_SUCCESS">AUTH_VERIFY_SUCCESS</option>
            <option value="AUTH_VERIFY_FAILURE">AUTH_VERIFY_FAILURE</option>
            <option value="PERMISSION_DENIED">PERMISSION_DENIED</option>
            <option value="SHEETS_SYNC_STARTED">SHEETS_SYNC_STARTED</option>
            <option value="SHEETS_SYNC_SUCCESS">SHEETS_SYNC_SUCCESS</option>
            <option value="SHEETS_SYNC_FAILURE">SHEETS_SYNC_FAILURE</option>
            <option value="DATA_VALIDATION_RUN">DATA_VALIDATION_RUN</option>
            <option value="CSV_EXPORT_GENERATED">CSV_EXPORT_GENERATED</option>
            <option value="CONFIG_UPDATED">CONFIG_UPDATED</option>
            <option value="ROLE_CHANGED">ROLE_CHANGED</option>
            <option value="SECURITY_TEST_SUITE_RUN">SECURITY_TEST_SUITE_RUN</option>
          </select>

          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200"
          >
            <option value="ALL">All Outcomes</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="WARNING">WARNING</option>
            <option value="DENIED">DENIED</option>
            <option value="FAILURE">FAILURE</option>
          </select>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200"
          >
            <option value="ALL">All Severities</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>

        <input
          type="text"
          value={actorSearch}
          onChange={(e) => setActorSearch(e.target.value)}
          placeholder="Filter by actor email or correlation ID..."
          className="w-full sm:w-64 px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
        />
      </div>

      {error ? (
        <div className="border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 rounded-lg p-6 text-xs text-rose-800 dark:text-rose-300 space-y-2">
          <div className="font-semibold flex items-center gap-2 text-sm">
            <Lock className="w-4 h-4" />
            Server-Side Authorization Enforced (HTTP 403 Forbidden)
          </div>
          <p>{error}</p>
          <p className="text-slate-600 dark:text-slate-400">
            Your active role (<strong className="font-mono">{currentRole}</strong>) is denied access to <code className="font-mono">GET /api/audit/logs</code> on the backend. Switch back to <strong>Administrator</strong> in the top bar RBAC verifier to inspect audit records.
          </p>
        </div>
      ) : (
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-3">Timestamp (UTC)</th>
                  <th className="py-2.5 px-3">Event ID</th>
                  <th className="py-2.5 px-3">Actor &amp; Role</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Outcome</th>
                  <th className="py-2.5 px-3">Resource</th>
                  <th className="py-2.5 px-3">Correlation ID</th>
                  <th className="py-2.5 px-3">Metadata / Reason &amp; SHA-256 Signature</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      Loading server-side audit ledger...
                    </td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No matching audit events found.
                    </td>
                  </tr>
                ) : (
                  events.map((ev) => (
                    <tr key={ev.eventId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {ev.timestampUtc.replace('T', ' ').slice(0, 19)}Z
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-500">
                        {ev.eventId}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{ev.actorEmail}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{ev.actorRole}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap font-medium text-slate-800 dark:text-slate-200">
                        {ev.action}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                        <span
                          className={`font-semibold ${
                            ev.outcome === 'SUCCESS'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : ev.outcome === 'DENIED' || ev.outcome === 'FAILURE'
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {ev.outcome} ({ev.severity})
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {ev.resourceType}:{ev.resourceId}
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-500">
                        {ev.correlationId}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 max-w-md">
                        {ev.failureReason && (
                          <div className="text-rose-600 dark:text-rose-400 mb-0.5">
                            Reason: {ev.failureReason}
                          </div>
                        )}
                        <div className="truncate" title={JSON.stringify(ev.metadata)}>
                          Meta: {JSON.stringify(ev.metadata)}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate" title={`Prev: ${ev.hashChainPrev} -> Sig: ${ev.hashSignature}`}>
                          SHA256: {ev.hashSignature.slice(0, 24)}...
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

interface TestCenterViewProps {
  rbacDowngradeRole: UserRole | null;
}

export const TestCenterView: React.FC<TestCenterViewProps> = ({ rbacDowngradeRole }) => {
  const [report, setReport] = useState<TestSuiteRunReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suiteFilter, setSuiteFilter] = useState<'ALL' | 'Unit' | 'Integration' | 'Security'>('ALL');

  const executeTests = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await triggerAutomatedTestSuite(rbacDowngradeRole);
      setReport(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to run automated test suite.');
    } finally {
      setRunning(false);
    }
  }, [rbacDowngradeRole]);

  useEffect(() => {
    executeTests();
  }, [executeTests]);

  const filteredResults =
    report?.results.filter((r) => suiteFilter === 'ALL' || r.suite === suiteFilter) || [];

  return (
    <div className="space-y-6">
      {/* Header & Execution Controls */}
      <div className="glass-panel rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-blue-600" />
            Automated Unit, Integration &amp; OWASP Security Verification Center
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-3xl">
            Executes real, deterministic verification against the domain engine, property normalization, timezone boundaries, CSV formula injection protections, and RBAC security controls using synthetic fixtures (never touching live production spreadsheets).
            <strong> Note:</strong> Automated verification does not replace an independent human penetration test or formal compliance certification.
          </p>
        </div>

        <button
          type="button"
          disabled={running}
          onClick={executeTests}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          {running ? 'Running Verification Suite...' : 'Run All Automated Tests'}
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Test Summary Metrics (Only displayed after real execution) */}
      {report && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div className="glass-panel rounded-xl p-4">
            <div className="text-xs text-slate-500">Total Executed</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {report.totalTests}
            </div>
            <div className="mt-1 text-[11px] font-mono text-slate-500">Run ID: {report.runId}</div>
          </div>

          <div className="glass-panel rounded-xl p-4">
            <div className="text-xs text-slate-500">Passed</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {report.passed}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Verified assertions</div>
          </div>

          <div className="glass-panel rounded-xl p-4">
            <div className="text-xs text-slate-500">Failed</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
              {report.failed}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Mandatory CI gate</div>
          </div>

          <div className="glass-panel rounded-xl p-4">
            <div className="text-xs text-slate-500">Skipped</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-600 dark:text-slate-400">
              {report.skipped}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Zero skipped checks</div>
          </div>

          <div className="glass-panel rounded-xl p-4">
            <div className="text-xs text-slate-500">Last Run (UTC)</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {report.executedAtUtc.slice(11, 19)} UTC
            </div>
            <div className="mt-1 text-[11px] font-mono text-slate-500">
              Duration: {report.durationMs}ms
            </div>
          </div>
        </div>
      )}

      {/* Suite Filter & Results Table */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
            {(['ALL', 'Unit', 'Integration', 'Security'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSuiteFilter(s)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  suiteFilter === s
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {s === 'ALL' ? 'All Suites (13)' : `${s} Suite`}
              </button>
            ))}
          </div>

          <div className="text-xs font-mono text-slate-500">
            Local &amp; CI Command: <code className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">npm test &amp;&amp; npm run lint &amp;&amp; npm run build</code>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <th className="py-2.5 px-3">ID</th>
                <th className="py-2.5 px-3">Suite</th>
                <th className="py-2.5 px-3">Severity</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Test Specification &amp; Verification Output</th>
                <th className="py-2.5 px-3 text-right">Assertions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredResults.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-500">{t.id}</td>
                  <td className="py-2.5 px-3 font-medium whitespace-nowrap">{t.suite}</td>
                  <td className="py-2.5 px-3 font-mono uppercase whitespace-nowrap">
                    <span
                      className={
                        t.severity === 'critical'
                          ? 'text-rose-600 dark:text-rose-400 font-semibold'
                          : t.severity === 'high'
                          ? 'text-amber-600 dark:text-amber-400 font-semibold'
                          : 'text-slate-600 dark:text-slate-400'
                      }
                    >
                      {t.severity}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                    {t.status === 'passed' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> PASSED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                        <AlertCircle className="w-3.5 h-3.5" /> FAILED
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 space-y-1">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {t.name}
                      {t.owaspRef && (
                        <span className="ml-2 font-mono text-[11px] text-blue-600 dark:text-blue-400">
                          [{t.owaspRef}]
                        </span>
                      )}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                      {t.details}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {t.assertionCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface SettingsAndOpsViewProps {
  currentMode: DataSourceMode;
  spreadsheetId: string;
  taskSheetName: string;
  scanningSheetName: string;
  businessTimezone: string;
  currentRole: UserRole;
  rbacDowngradeRole: UserRole | null;
  onSaveConfig: (newConfig: {
    mode: DataSourceMode;
    spreadsheetId: string;
    taskSheetName: string;
    scanningSheetName: string;
    businessTimezone: string;
  }) => Promise<void>;
}

export const SettingsAndOpsView: React.FC<SettingsAndOpsViewProps> = ({
  currentMode,
  spreadsheetId,
  taskSheetName,
  scanningSheetName,
  businessTimezone,
  currentRole,
  rbacDowngradeRole,
  onSaveConfig,
}) => {
  const [mode, setMode] = useState<DataSourceMode>(currentMode);
  const [sheetId, setSheetId] = useState(spreadsheetId);
  const [taskTab, setTaskTab] = useState(taskSheetName);
  const [scanTab, setScanTab] = useState(scanningSheetName);
  const [tz, setTz] = useState(businessTimezone);
  const [discoveredTabs, setDiscoveredTabs] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const handleDiscoverTabs = async () => {
    if (!sheetId.trim()) {
      setStatusMsg({ type: 'err', text: 'Paste a Google Spreadsheet URL or ID first.' });
      return;
    }
    setDiscovering(true);
    setStatusMsg(null);
    try {
      const meta = await discoverSpreadsheetTabs({
        spreadsheetId: sheetId,
        rbacDowngradeRole,
      });
      setSheetId(meta.spreadsheetId);
      setDiscoveredTabs(meta.sheetNames);
      setTaskTab(meta.suggestedTaskTab);
      setScanTab(meta.suggestedScanTab);
      setMode('google_sheets_live');
      setStatusMsg({
        type: 'ok',
        text: `Connected to "${meta.title}". Discovered tabs: ${meta.sheetNames.join(', ')}`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Failed to discover tabs from Google Sheet.',
      });
    } finally {
      setDiscovering(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      await updateAdminConfig({
        dataSourceMode: mode,
        defaultSpreadsheetId: sheetId,
        taskRawSheetName: taskTab,
        scanningSheetName: scanTab,
        businessTimezone: tz,
        rbacDowngradeRole,
      });
      await onSaveConfig({
        mode,
        spreadsheetId: sheetId,
        taskSheetName: taskTab,
        scanningSheetName: scanTab,
        businessTimezone: tz,
      });
      setStatusMsg({
        type: 'ok',
        text: 'Configuration saved on server and logged to Audit Trail.',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Failed to update configuration.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: Configuration Form */}
      <div className="lg:col-span-6 glass-panel rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-600" />
            Data Source &amp; Business Timezone Configuration
          </h3>
          <span className="text-xs font-mono text-slate-500">Role: {currentRole}</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Data Source Mode
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as DataSourceMode)}
              className="w-full px-3 py-2 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
            >
              <option value="mock_synthetic">
                Synthetic Enterprise Fixture Mode (Auditable Mock Data)
              </option>
              <option value="google_sheets_live">
                Live Google Sheets Read-Only Integration (sheets.googleapis.com)
              </option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Google Spreadsheet URL or ID (Read-Only Source)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={sheetId}
                onChange={(e) => {
                  setSheetId(e.target.value);
                  if (e.target.value.trim()) setMode('google_sheets_live');
                }}
                placeholder="Paste full https://docs.google.com/spreadsheets/d/... URL or ID"
                className="flex-1 px-3 py-2 font-mono bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                disabled={discovering}
                onClick={handleDiscoverTabs}
                className="px-3 py-2 text-xs font-medium bg-slate-800 dark:bg-slate-700 text-white rounded-md hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                {discovering ? 'Checking...' : 'Auto-Discover Tabs'}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Accepts either a full Google Sheets URL or Spreadsheet ID. Click &ldquo;Auto-Discover Tabs&rdquo; after signing in with Google to verify access and list worksheet tabs.
            </p>
          </div>

          {discoveredTabs.length > 0 && (
            <div className="p-2.5 rounded-md glass-subtle text-[11px] text-slate-700 dark:text-slate-300">
              <strong>Discovered Tabs in Spreadsheet:</strong>{' '}
              <span className="font-mono">{discoveredTabs.join(' · ')}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Task Raw Tab Name
              </label>
              <input
                type="text"
                value={taskTab}
                onChange={(e) => setTaskTab(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Scanning Tab Name
              </label>
              <input
                type="text"
                value={scanTab}
                onChange={(e) => setScanTab(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Explicit Business Timezone (IANA)
            </label>
            <select
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
            >
              <option value="Asia/Kolkata">Asia/Kolkata (IST UTC+05:30)</option>
              <option value="UTC">UTC (Coordinated Universal Time)</option>
              <option value="America/New_York">America/New_York (ET)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
            </select>
          </div>

          {statusMsg && (
            <div
              className={`p-3 rounded-md border ${
                statusMsg.type === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
              }`}
            >
              {statusMsg.text}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md transition-colors"
          >
            {saving ? 'Updating Server Config...' : 'Save Configuration (Admin Only)'}
          </button>
        </form>
      </div>

      {/* Right: Architecture, Privacy, & Cloud Run Deployment Runbook */}
      <div className="lg:col-span-6 glass-panel rounded-xl p-5 space-y-4 text-xs">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Security Architecture, Privacy &amp; Cloud Run Go-Live Runbook
        </h3>

        <div className="space-y-3 text-slate-600 dark:text-slate-400">
          <div>
            <strong className="text-slate-900 dark:text-slate-200 block">
              1. Trust Boundaries &amp; Least-Privilege OAuth
            </strong>
            Client obtains <code className="font-mono">spreadsheets.readonly</code> OAuth access token via Google Sign-In and caches it strictly in memory (never <code className="font-mono">localStorage</code>). Backend validates tokens against Google TokenInfo, enforces RBAC (<code className="font-mono">Administrator</code>, <code className="font-mono">Analyst</code>, <code className="font-mono">Viewer</code>), and reads only <code className="font-mono">Task Raw!A1:AX2500</code> and <code className="font-mono">Scanning!A1:G2500</code>.
          </div>

          <div>
            <strong className="text-slate-900 dark:text-slate-200 block">
              2. Privacy &amp; Zero AI Data Leakage Policy
            </strong>
            Source spreadsheet data is never persisted to a third-party database and is <strong>never sent to any LLM/Gemini model</strong>. All domain calculations, joins, and anomaly detections run deterministically in TypeScript.
          </div>

          <div>
            <strong className="text-slate-900 dark:text-slate-200 block">
              3. Production Build &amp; Cloud Run Deployment Checklist
            </strong>
            <ul className="list-disc pl-4 space-y-1 mt-1 font-mono text-[11px]">
              <li>Build &amp; Verify: <code>npm run lint &amp;&amp; npm test &amp;&amp; npm run build</code></li>
              <li>Start Server: <code>NODE_ENV=production npm start</code> (Port 3000)</li>
              <li>Health Probe: <code>GET /api/health</code> returns HTTP 200 JSON</li>
              <li>Secrets: Inject <code>ADMIN_EMAILS</code>, <code>DEFAULT_SPREADSHEET_ID</code>, and <code>ALLOWED_CORS_ORIGINS</code> via Google Cloud Secret Manager.</li>
              <li>Rollback: Pin Cloud Run revision tags and route 100% traffic to previous healthy digest on anomaly.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
