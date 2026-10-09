/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Enterprise Domain Types & Data Contracts for Daily Food MIS
 */

export type UserRole = 'Administrator' | 'Analyst' | 'Viewer';

export type DataSourceMode = 'mock_synthetic' | 'google_sheets_live';

export type ValueQualityStatus =
  | 'valid_number' // Explicitly > 0
  | 'valid_zero'   // Explicitly 0 ("0" or 0)
  | 'blank'        // Empty cell ""
  | 'missing'      // Undefined / row truncated before column
  | 'invalid'      // Non-numeric text e.g. "N/A", "TBD", "abc"
  | 'negative'     // Unexpected negative number e.g. -5
  | 'unavailable'; // Unmatched scan record or source tab unavailable

export interface TrackedMetricValue {
  /** Null when status is blank, missing, invalid, negative (flagged), or unavailable */
  value: number | null;
  raw: string | number | null | undefined;
  status: ValueQualityStatus;
  sourceCell?: string;
}

export interface MealMetrics {
  mealType: 'Breakfast' | 'Lunch' | 'Dinner';
  ordered: TrackedMetricValue;
  consumed: TrackedMetricValue;
  scanned: TrackedMetricValue;
  /**
   * Variance is strictly defined as Ordered minus Consumed.
   * Scanning is never claimed to equal consumption; it is displayed as a distinct metric.
   * Null if either ordered or consumed is not a valid non-negative number.
   */
  variance: number | null;
  /**
   * Secondary operational gap: Consumed minus Scanned (only when both valid),
   * kept distinct from Ordered-minus-Consumed variance.
   */
  consumedVsScannedGap: number | null;
  isComplete: boolean;
}

export type TaskStatus = 'Completed' | 'Pending' | 'In Progress' | 'Overdue' | 'Unknown';

export interface PropertyEntity {
  normalizedId: string;
  displayName: string;
  rawVariants: string[];
  totalReportsInPeriod: number;
  completedReportsInPeriod: number;
  hasUnmatchedScans: boolean;
  dataQualityScore: number;
}

export interface RawTaskRecord {
  rowNumber: number;
  taskName: string;            // Col B
  propertyRaw: string;         // Col D
  propertyNormalized: string;
  createdAtRaw: string;        // Col K
  createdAtIso: string | null;
  reportingDate: string | null; // YYYY-MM-DD in configured business timezone
  statusRaw: string;           // Col N
  statusNormalized: TaskStatus;
  completedAtRaw: string;      // Col O
  completedAtIso: string | null;
  breakfastOrderedRaw: string | number | null | undefined;  // Col AS
  breakfastConsumedRaw: string | number | null | undefined; // Col AT
  lunchOrderedRaw: string | number | null | undefined;      // Col AU
  lunchConsumedRaw: string | number | null | undefined;     // Col AV
  dinnerOrderedRaw: string | number | null | undefined;     // Col AW
  dinnerConsumedRaw: string | number | null | undefined;    // Col AX
}

export interface ScanningRecord {
  rowNumber: number;
  propertyRaw: string;         // Col C
  propertyNormalized: string;
  dateRaw: string;             // Col D
  reportingDate: string | null; // YYYY-MM-DD in configured business timezone
  breakfastScanned: TrackedMetricValue; // Col E
  lunchScanned: TrackedMetricValue;     // Col F
  dinnerScanned: TrackedMetricValue;    // Col G
}

export type ValidationSeverity = 'critical' | 'high' | 'medium' | 'low';

export type ValidationCategory =
  | 'MISSING_VALUE'
  | 'UNMATCHED_PROPERTY'
  | 'MISSING_SCAN_RECORD'
  | 'DUPLICATE_TASK_REPORT'
  | 'DUPLICATE_SCAN_RECORD'
  | 'INVALID_DATE'
  | 'NEGATIVE_VALUE'
  | 'INVALID_NUMERIC'
  | 'HIGH_VARIANCE_ANOMALY'
  | 'INCONSISTENT_COMPLETION';

export interface ValidationFinding {
  id: string;
  severity: ValidationSeverity;
  category: ValidationCategory;
  propertyNormalized: string;
  propertyDisplay: string;
  reportingDate: string | null;
  sourceSheet: 'Task Raw' | 'Scanning' | 'Cross-Sheet Join';
  sourceLocation: string; // e.g. "Task Raw!AS14" or "Scanning!Row 22"
  message: string;
  rawValue?: string;
  remediation: string;
}

export interface DailyReportRecord {
  id: string;
  propertyNormalized: string;
  propertyDisplay: string;
  reportingDate: string; // YYYY-MM-DD in Business Timezone
  taskName: string;
  taskStatus: TaskStatus;
  createdAtIso: string;
  completedAtIso: string | null;
  completedAtDisplay: string;
  taskRowNumber: number;
  scanRowNumber: number | null;
  hasMatchedScan: boolean;
  isDuplicateReport: boolean;
  isDuplicateScan: boolean;
  breakfast: MealMetrics;
  lunch: MealMetrics;
  dinner: MealMetrics;
  findingsCount: number;
  findingIds: string[];
}

export interface MealAggregateSummary {
  orderedTotal: number;
  consumedTotal: number;
  scannedTotal: number;
  /** Strictly OrderedTotal minus ConsumedTotal across records with valid pairs */
  varianceTotal: number;
  validOrderedCount: number;
  validConsumedCount: number;
  validScannedCount: number;
  missingOrInvalidCount: number;
}

export interface ExecutiveKpiSummary {
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  businessTimezone: string;
  totalPropertiesReporting: number;
  totalPropertiesKnown: number;
  reportsCompleted: number;
  reportsPending: number;
  reportsOverdue: number;
  reportsInProgress: number;
  totalValidReports: number;
  duplicateReportsExcluded: number;
  duplicateScansExcluded: number;
  unmatchedScanRecordsCount: number;
  dataQualityWarningCount: number;
  criticalFindingsCount: number;
  breakfast: MealAggregateSummary;
  lunch: MealAggregateSummary;
  dinner: MealAggregateSummary;
  periodOverPeriod: {
    hasComparableHistory: boolean;
    previousPeriodStart: string;
    previousPeriodEnd: string;
    orderedChangePct: number | null;
    consumedChangePct: number | null;
    scannedChangePct: number | null;
    completionRateDeltaPct: number | null;
  };
}

export type AuditAction =
  | 'AUTH_VERIFY_SUCCESS'
  | 'AUTH_VERIFY_FAILURE'
  | 'PERMISSION_DENIED'
  | 'ROLE_CHANGED'
  | 'CONFIG_UPDATED'
  | 'SHEETS_SYNC_STARTED'
  | 'SHEETS_SYNC_SUCCESS'
  | 'SHEETS_SYNC_FAILURE'
  | 'DATA_VALIDATION_RUN'
  | 'CSV_EXPORT_GENERATED'
  | 'SECURITY_TEST_SUITE_RUN'
  | 'RATE_LIMIT_TRIGGERED';

export interface AuditEvent {
  eventId: string;
  timestampUtc: string;
  actorId: string;
  actorEmail: string;
  actorRole: UserRole | 'Unauthenticated';
  action: AuditAction;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED' | 'WARNING';
  severity: 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';
  resourceType: 'AUTH' | 'SPREADSHEET' | 'DATASET' | 'EXPORT' | 'SETTINGS' | 'TEST_CENTER' | 'API';
  resourceId: string;
  correlationId: string;
  ipHash?: string;
  metadata: Record<string, string | number | boolean | null>;
  failureReason?: string;
  hashChainPrev: string;
  hashSignature: string;
}

export interface FilterState {
  startDate: string;
  endDate: string;
  preset: '7d' | '14d' | '30d' | 'mtd' | 'all' | 'custom';
  properties: string[]; // normalized property IDs
  statuses: TaskStatus[];
  mealFocus: 'ALL' | 'Breakfast' | 'Lunch' | 'Dinner';
  searchQuery: string;
  onlyWithAnomalies: boolean;
}

export interface SavedFilterView {
  id: string;
  name: string;
  createdAt: string;
  filter: FilterState;
}

export interface SyncDatasetResponse {
  mode: DataSourceMode;
  lastSyncedAtUtc: string;
  businessTimezone: string;
  spreadsheetIdMasked: string;
  spreadsheetTitle?: string;
  discoveredTabs?: string[];
  availableDateRange?: { minDate: string | null; maxDate: string | null; totalDailyOpsTasksFound: number };
  taskSheetName: string;
  scanningSheetName: string;
  correlationId: string;
  kpis: ExecutiveKpiSummary;
  properties: PropertyEntity[];
  records: DailyReportRecord[];
  unmatchedScans: ScanningRecord[];
  findings: ValidationFinding[];
}

export interface AutomatedTestResult {
  id: string;
  suite: 'Unit' | 'Integration' | 'Security';
  name: string;
  owaspRef?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  assertionCount: number;
  details: string;
  remediationIfFailed?: string;
}

export interface TestSuiteRunReport {
  runId: string;
  executedAtUtc: string;
  correlationId: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  results: AutomatedTestResult[];
}
