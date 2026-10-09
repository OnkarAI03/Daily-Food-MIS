/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure, Deterministic Domain Engine for Daily Food MIS.
 * Enforces all data integrity rules:
 * - Zero vs blank, missing, invalid, negative, and unavailable values
 * - Explicit business timezone boundary handling
 * - Normalized property identity (trimmed, case-folded, collapsed whitespace) while retaining display names
 * - Task Name === "Daily Ops Report" filtering
 * - Duplicate detection for Task Raw reports and Scanning records (never silently summing duplicates)
 * - Variance strictly defined as Ordered minus Consumed
 * - Scanning kept strictly distinct from Consumption
 * - CSV formula injection sanitization (OWASP CSV Injection mitigation)
 */

import {
  DailyReportRecord,
  ExecutiveKpiSummary,
  MealAggregateSummary,
  MealMetrics,
  PropertyEntity,
  RawTaskRecord,
  ScanningRecord,
  TaskStatus,
  TrackedMetricValue,
  ValidationFinding,
} from '../types/domain';

/**
 * Normalizes a property name for deterministic joining across Task Raw and Scanning tabs.
 * Trims leading/trailing whitespace, collapses internal whitespace runs, and lowercases.
 * Never mutates the original display name.
 */
export function normalizePropertyId(rawName: string | null | undefined): string {
  if (rawName === null || rawName === undefined) return '';
  return String(rawName)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Formats a normalized property ID or raw string into a clean display name if needed,
 * while preserving the first seen clean original display name.
 */
export function cleanDisplayPropertyName(rawName: string | null | undefined): string {
  if (!rawName) return 'Unnamed Property';
  return String(rawName).trim().replace(/\s+/g, ' ');
}

/**
 * Converts a 0-based column index to Excel/Sheets A1 column letters (e.g., 0 -> A, 1 -> B, 44 -> AS, 49 -> AX).
 */
export function colIndexToLetter(index: number): string {
  let temp = index + 1;
  let letter = '';
  while (temp > 0) {
    const rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

/**
 * Exact 0-based column indices per specification:
 * Task Raw:
 * B (1): Task Name
 * D (3): Property
 * K (10): Created At
 * N (13): Status
 * O (14): Completed At
 * AS (44): Breakfast Ordered
 * AT (45): Breakfast Consumed
 * AU (46): Lunch Ordered
 * AV (47): Lunch Consumed
 * AW (48): Dinner Ordered
 * AX (49): Dinner Consumed
 */
export const TASK_RAW_COLS = {
  TASK_NAME: 1,          // B
  PROPERTY: 3,           // D
  CREATED_AT: 10,        // K
  STATUS: 13,            // N
  COMPLETED_AT: 14,      // O
  BREAKFAST_ORDERED: 44, // AS
  BREAKFAST_CONSUMED: 45,// AT
  LUNCH_ORDERED: 46,     // AU
  LUNCH_CONSUMED: 47,    // AV
  DINNER_ORDERED: 48,    // AW
  DINNER_CONSUMED: 49,   // AX
} as const;

/**
 * Scanning Sheet 0-based column indices:
 * C (2): Property Name
 * D (3): Date
 * E (4): Breakfast Scanned
 * F (5): Lunch Scanned
 * G (6): Dinner Scanned
 */
export const SCANNING_COLS = {
  PROPERTY: 2,          // C
  DATE: 3,              // D
  BREAKFAST_SCANNED: 4, // E
  LUNCH_SCANNED: 5,     // F
  DINNER_SCANNED: 6,    // G
} as const;

/**
 * Parses a spreadsheet cell into a TrackedMetricValue.
 * Strictly distinguishes 0 from blank (""), missing (undefined), invalid ("N/A", "abc"),
 * negative (-5), and unavailable (missing scan record).
 * Never silently converts unknown or missing values to 0.
 */
export function parseTrackedMetric(
  rawCell: string | number | null | undefined,
  sourceCell?: string
): TrackedMetricValue {
  if (rawCell === undefined) {
    return { value: null, raw: undefined, status: 'missing', sourceCell };
  }
  if (rawCell === null) {
    return { value: null, raw: null, status: 'blank', sourceCell };
  }
  if (typeof rawCell === 'number') {
    if (Number.isNaN(rawCell) || !Number.isFinite(rawCell)) {
      return { value: null, raw: String(rawCell), status: 'invalid', sourceCell };
    }
    if (rawCell < 0) {
      return { value: null, raw: rawCell, status: 'negative', sourceCell };
    }
    if (rawCell === 0) {
      return { value: 0, raw: 0, status: 'valid_zero', sourceCell };
    }
    return { value: rawCell, raw: rawCell, status: 'valid_number', sourceCell };
  }

  const trimmed = String(rawCell).trim();
  if (trimmed === '') {
    return { value: null, raw: '', status: 'blank', sourceCell };
  }

  // Reject strings that contain non-numeric characters (allow optional leading +/-, digits, and single decimal point)
  const normalizedNumStr = trimmed.replace(/,/g, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalizedNumStr)) {
    return { value: null, raw: rawCell, status: 'invalid', sourceCell };
  }

  const parsed = Number(normalizedNumStr);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return { value: null, raw: rawCell, status: 'invalid', sourceCell };
  }
  if (parsed < 0) {
    return { value: null, raw: rawCell, status: 'negative', sourceCell };
  }
  if (parsed === 0) {
    return { value: 0, raw: rawCell, status: 'valid_zero', sourceCell };
  }
  return { value: parsed, raw: rawCell, status: 'valid_number', sourceCell };
}

/**
 * Creates an unavailable TrackedMetricValue (used when no scan record exists for a property+date).
 */
export function createUnavailableMetric(reasonRef?: string): TrackedMetricValue {
  return {
    value: null,
    raw: undefined,
    status: 'unavailable',
    sourceCell: reasonRef,
  };
}

/**
 * Resolves a raw date or timestamp cell into a canonical YYYY-MM-DD reporting date
 * in the explicitly configured business timezone (e.g. "Asia/Kolkata" or "America/New_York").
 * Handles:
 * 1. Date-only strings ("2026-10-05", "05/10/2026", "05-10-2026", "2026/10/05")
 * 2. Google Sheets / Excel numeric serial dates (e.g. 46304 -> days since 1899-12-30)
 * 3. Full ISO timestamps and common regional date-time strings
 * 4. Invalid dates (returns null)
 */
export function resolveReportingDateInTimezone(
  rawDateValue: string | number | null | undefined,
  businessTimezone: string = 'Asia/Kolkata'
): { reportingDate: string | null; isoTimestamp: string | null } {
  if (rawDateValue === null || rawDateValue === undefined) {
    return { reportingDate: null, isoTimestamp: null };
  }

  // Case 0: Google Sheets / Excel numeric serial date (between 20000 [1954] and 80000 [2119])
  if (typeof rawDateValue === 'number' && Number.isFinite(rawDateValue)) {
    if (rawDateValue > 20000 && rawDateValue < 80000) {
      // Excel/Sheets epoch is 1899-12-30T00:00:00Z
      const epochMs = Date.UTC(1899, 11, 30);
      const ms = epochMs + Math.round(rawDateValue * 86400000);
      const dObj = new Date(ms);
      const iso = dObj.toISOString();
      return {
        reportingDate: iso.slice(0, 10),
        isoTimestamp: iso,
      };
    }
    return { reportingDate: null, isoTimestamp: null };
  }

  const str = String(rawDateValue).trim();
  if (!str) {
    return { reportingDate: null, isoTimestamp: null };
  }

  // Check if string is a pure numeric serial date
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const numSerial = Number(str);
    if (numSerial > 20000 && numSerial < 80000) {
      const epochMs = Date.UTC(1899, 11, 30);
      const dObj = new Date(epochMs + Math.round(numSerial * 86400000));
      const iso = dObj.toISOString();
      return { reportingDate: iso.slice(0, 10), isoTimestamp: iso };
    }
  }

  // Case 1: Strict YYYY-MM-DD or YYYY/MM/DD date-only cell (no time component)
  const dateOnlyMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(str);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { reportingDate: null, isoTimestamp: null };
    }
    const checkDate = new Date(Date.UTC(year, month - 1, day));
    if (
      checkDate.getUTCFullYear() !== year ||
      checkDate.getUTCMonth() + 1 !== month ||
      checkDate.getUTCDate() !== day
    ) {
      return { reportingDate: null, isoTimestamp: null };
    }
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return {
      reportingDate: `${year}-${mm}-${dd}`,
      isoTimestamp: `${year}-${mm}-${dd}T00:00:00.000Z`,
    };
  }

  // Case 1B: DD/MM/YYYY or DD-MM-YYYY (with optional HH:mm[:ss] time suffix common in India/UK sheets)
  const dmyMatch =
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm))?)?$/.exec(
      str
    );
  if (dmyMatch) {
    let p1 = Number(dmyMatch[1]);
    let p2 = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    // In Asia/Kolkata or Europe, DD/MM/YYYY is standard unless p2 > 12 (which means MM/DD/YYYY)
    let day = p1;
    let month = p2;
    if (p1 <= 12 && p2 > 12) {
      month = p1;
      day = p2;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990 && year <= 2100) {
      const checkDate = new Date(Date.UTC(year, month - 1, day));
      if (
        checkDate.getUTCFullYear() === year &&
        checkDate.getUTCMonth() + 1 === month &&
        checkDate.getUTCDate() === day
      ) {
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        let hh = dmyMatch[4] ? Number(dmyMatch[4]) : 0;
        const min = dmyMatch[5] ? Number(dmyMatch[5]) : 0;
        const sec = dmyMatch[6] ? Number(dmyMatch[6]) : 0;
        const ampm = dmyMatch[7]?.toUpperCase();
        if (ampm === 'PM' && hh < 12) hh += 12;
        if (ampm === 'AM' && hh === 12) hh = 0;
        const isoDate = `${year}-${mm}-${dd}`;
        const isoTime = `${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.000Z`;
        return {
          reportingDate: isoDate,
          isoTimestamp: `${isoDate}T${isoTime}`,
        };
      }
    }
  }

  // Case 2: Timestamp or locale date string
  const parsedMs = Date.parse(str);
  if (Number.isNaN(parsedMs)) {
    return { reportingDate: null, isoTimestamp: null };
  }

  const dateObj = new Date(parsedMs);
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: businessTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(dateObj);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) {
      return {
        reportingDate: `${y}-${m}-${d}`,
        isoTimestamp: dateObj.toISOString(),
      };
    }
  } catch {
    // Fallback to UTC if an invalid timezone identifier was passed
    const iso = dateObj.toISOString();
    return {
      reportingDate: iso.slice(0, 10),
      isoTimestamp: iso,
    };
  }

  return { reportingDate: null, isoTimestamp: null };
}

/**
 * Normalizes task status string into typed TaskStatus
 */
export function normalizeTaskStatus(
  rawStatus: string | null | undefined,
  completedAtIso: string | null,
  reportingDate: string | null,
  currentBusinessDate: string
): TaskStatus {
  const s = String(rawStatus ?? '').trim().toLowerCase();
  if (s === 'completed' || s === 'complete' || s === 'done' || s === 'closed') {
    return 'Completed';
  }
  if (s === 'overdue' || s === 'late' || s === 'missed') {
    return 'Overdue';
  }
  if (s === 'in progress' || s === 'in_progress' || s === 'started' || s === 'working') {
    return 'In Progress';
  }
  if (s === 'pending' || s === 'open' || s === 'todo' || s === 'new') {
    // Check if reportingDate is strictly before currentBusinessDate and not completed -> Overdue
    if (reportingDate && reportingDate < currentBusinessDate && !completedAtIso) {
      return 'Overdue';
    }
    return 'Pending';
  }
  return 'Unknown';
}

/**
 * Computes MealMetrics for a single meal (Breakfast, Lunch, or Dinner).
 * Variance is strictly Ordered minus Consumed when both Ordered and Consumed are valid non-negative numbers.
 * Never claims scanning equals consumption.
 */
export function computeMealMetrics(
  mealType: 'Breakfast' | 'Lunch' | 'Dinner',
  ordered: TrackedMetricValue,
  consumed: TrackedMetricValue,
  scanned: TrackedMetricValue
): MealMetrics {
  const isOrderedValid = ordered.status === 'valid_number' || ordered.status === 'valid_zero';
  const isConsumedValid = consumed.status === 'valid_number' || consumed.status === 'valid_zero';
  const isScannedValid = scanned.status === 'valid_number' || scanned.status === 'valid_zero';

  const variance =
    isOrderedValid && isConsumedValid && ordered.value !== null && consumed.value !== null
      ? Number((ordered.value - consumed.value).toFixed(2))
      : null;

  const consumedVsScannedGap =
    isConsumedValid && isScannedValid && consumed.value !== null && scanned.value !== null
      ? Number((consumed.value - scanned.value).toFixed(2))
      : null;

  return {
    mealType,
    ordered,
    consumed,
    scanned,
    variance,
    consumedVsScannedGap,
    isComplete: isOrderedValid && isConsumedValid && isScannedValid,
  };
}

/**
 * Sanitizes a cell value before exporting to CSV to prevent Spreadsheet Formula Injection (CSV Injection).
 * Per OWASP guidelines, any value starting with `=`, `+`, `-`, `@`, `\t`, or `\r`
 * (even after leading spaces) is prefixed with a single quote `'`.
 */
export function sanitizeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) return '';
    return String(value);
  }
  const str = String(value);
  const trimmedLeading = str.trimStart();
  let safe = str;
  if (
    trimmedLeading.length > 0 &&
    ['=', '+', '-', '@', '\t', '\r'].includes(trimmedLeading[0])
  ) {
    safe = `'${str}`;
  }
  // Escape double quotes and wrap in quotes if needed
  if (safe.includes('"') || safe.includes(',') || safe.includes('\n') || safe.includes('\r') || safe.startsWith("'")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export interface PipelineInput {
  /** 2D array of rows from Task Raw sheet (including header row at index 0) */
  taskRawRows: (string | number | null | undefined)[][];
  /** 2D array of rows from Scanning sheet (including header row at index 0) */
  scanningRows: (string | number | null | undefined)[][];
  /** Reporting period start (YYYY-MM-DD inclusive) */
  startDate: string;
  /** Reporting period end (YYYY-MM-DD inclusive) */
  endDate: string;
  /** Explicit business timezone (e.g. "Asia/Kolkata") */
  businessTimezone: string;
  /** Current business date YYYY-MM-DD for overdue calculation */
  currentBusinessDate?: string;
}

export interface PipelineOutput {
  records: DailyReportRecord[];
  unmatchedScans: ScanningRecord[];
  properties: PropertyEntity[];
  findings: ValidationFinding[];
  kpis: ExecutiveKpiSummary;
  availableDateRange: {
    minDate: string | null;
    maxDate: string | null;
    totalDailyOpsTasksFound: number;
  };
}

/**
 * Full deterministic ETL & Validation pipeline for Task Raw and Scanning sheets.
 */
export function processDailyFoodMisData(input: PipelineInput): PipelineOutput {
  const {
    taskRawRows,
    scanningRows,
    startDate,
    endDate,
    businessTimezone,
    currentBusinessDate = endDate,
  } = input;

  const findings: ValidationFinding[] = [];
  let findingSeq = 1;
  const nextFindingId = () => `VAL-${String(findingSeq++).padStart(4, '0')}`;

  // Track property display names & raw variants
  const propertyDisplayMap = new Map<string, string>();
  const propertyVariantsMap = new Map<string, Set<string>>();

  const registerProperty = (rawName: string): string => {
    const norm = normalizePropertyId(rawName);
    if (!norm) return '';
    const cleaned = cleanDisplayPropertyName(rawName);
    if (!propertyDisplayMap.has(norm)) {
      propertyDisplayMap.set(norm, cleaned);
    }
    if (!propertyVariantsMap.has(norm)) {
      propertyVariantsMap.set(norm, new Set());
    }
    propertyVariantsMap.get(norm)!.add(String(rawName));
    return norm;
  };

  // 1. Parse Scanning rows (skipping header row 0)
  const validScansByKey = new Map<string, ScanningRecord>();
  const allScansInPeriod: ScanningRecord[] = [];
  let duplicateScansExcluded = 0;

  for (let i = 1; i < scanningRows.length; i++) {
    const row = scanningRows[i];
    if (!row || row.length === 0) continue;
    const rowNumber = i + 1; // 1-indexed sheet row

    const propRaw = String(row[SCANNING_COLS.PROPERTY] ?? '');
    const dateRaw = String(row[SCANNING_COLS.DATE] ?? '');

    // Ignore completely blank trailing rows
    if (!propRaw.trim() && !dateRaw.trim()) continue;

    const propNorm = registerProperty(propRaw);
    const { reportingDate } = resolveReportingDateInTimezone(dateRaw, businessTimezone);

    if (!propNorm) {
      findings.push({
        id: nextFindingId(),
        severity: 'high',
        category: 'MISSING_VALUE',
        propertyNormalized: 'unknown',
        propertyDisplay: 'Missing Property Name',
        reportingDate: reportingDate,
        sourceSheet: 'Scanning',
        sourceLocation: `Scanning!C${rowNumber}`,
        message: `Scanning row ${rowNumber} is missing a Property Name in Column C.`,
        rawValue: propRaw,
        remediation: 'Populate Column C in the Scanning worksheet with a valid property name.',
      });
      continue;
    }

    if (!reportingDate) {
      findings.push({
        id: nextFindingId(),
        severity: 'high',
        category: 'INVALID_DATE',
        propertyNormalized: propNorm,
        propertyDisplay: propertyDisplayMap.get(propNorm) || propRaw,
        reportingDate: null,
        sourceSheet: 'Scanning',
        sourceLocation: `Scanning!D${rowNumber}`,
        message: `Scanning row ${rowNumber} has an invalid or unparseable Date in Column D ("${dateRaw}").`,
        rawValue: dateRaw,
        remediation: 'Format Column D in Scanning as YYYY-MM-DD or a valid timestamp.',
      });
      continue;
    }

    const bScan = parseTrackedMetric(row[SCANNING_COLS.BREAKFAST_SCANNED], `Scanning!E${rowNumber}`);
    const lScan = parseTrackedMetric(row[SCANNING_COLS.LUNCH_SCANNED], `Scanning!F${rowNumber}`);
    const dScan = parseTrackedMetric(row[SCANNING_COLS.DINNER_SCANNED], `Scanning!G${rowNumber}`);

    const scanRecord: ScanningRecord = {
      rowNumber,
      propertyRaw: propRaw,
      propertyNormalized: propNorm,
      dateRaw,
      reportingDate,
      breakfastScanned: bScan,
      lunchScanned: lScan,
      dinnerScanned: dScan,
    };

    // Only index scans within or relevant to the period (keep all valid scans in map for joining, filter period for unmatched reporting)
    const joinKey = `${propNorm}__${reportingDate}`;
    const inSelectedPeriod = reportingDate >= startDate && reportingDate <= endDate;

    if (validScansByKey.has(joinKey)) {
      if (inSelectedPeriod) {
        duplicateScansExcluded++;
        const firstRow = validScansByKey.get(joinKey)!.rowNumber;
        findings.push({
          id: nextFindingId(),
          severity: 'high',
          category: 'DUPLICATE_SCAN_RECORD',
          propertyNormalized: propNorm,
          propertyDisplay: propertyDisplayMap.get(propNorm)!,
          reportingDate,
          sourceSheet: 'Scanning',
          sourceLocation: `Scanning!Row ${rowNumber} (duplicates Row ${firstRow})`,
          message: `Duplicate Scanning record detected for ${propertyDisplayMap.get(propNorm)} on ${reportingDate}. First record at row ${firstRow} retained; row ${rowNumber} excluded from summation per data integrity policy.`,
          remediation: 'Deduplicate rows in the Scanning worksheet for this property and date.',
        });
      }
      continue;
    }

    validScansByKey.set(joinKey, scanRecord);
    if (inSelectedPeriod) {
      allScansInPeriod.push(scanRecord);

      // Validate individual scan cells for negative or invalid values
      for (const [mealLabel, metric] of [
        ['Breakfast Scanned', bScan],
        ['Lunch Scanned', lScan],
        ['Dinner Scanned', dScan],
      ] as const) {
        if (metric.status === 'negative') {
          findings.push({
            id: nextFindingId(),
            severity: 'critical',
            category: 'NEGATIVE_VALUE',
            propertyNormalized: propNorm,
            propertyDisplay: propertyDisplayMap.get(propNorm)!,
            reportingDate,
            sourceSheet: 'Scanning',
            sourceLocation: metric.sourceCell || `Scanning!Row ${rowNumber}`,
            message: `${mealLabel} contains an unexpected negative value (${metric.raw}).`,
            rawValue: String(metric.raw),
            remediation: 'Correct the negative scan count in the Scanning sheet.',
          });
        } else if (metric.status === 'invalid') {
          findings.push({
            id: nextFindingId(),
            severity: 'high',
            category: 'INVALID_NUMERIC',
            propertyNormalized: propNorm,
            propertyDisplay: propertyDisplayMap.get(propNorm)!,
            reportingDate,
            sourceSheet: 'Scanning',
            sourceLocation: metric.sourceCell || `Scanning!Row ${rowNumber}`,
            message: `${mealLabel} contains non-numeric text ("${metric.raw}").`,
            rawValue: String(metric.raw),
            remediation: 'Replace text placeholders with numeric scan counts or leave blank if unrecorded.',
          });
        } else if (metric.status === 'blank' || metric.status === 'missing') {
          findings.push({
            id: nextFindingId(),
            severity: 'medium',
            category: 'MISSING_VALUE',
            propertyNormalized: propNorm,
            propertyDisplay: propertyDisplayMap.get(propNorm)!,
            reportingDate,
            sourceSheet: 'Scanning',
            sourceLocation: metric.sourceCell || `Scanning!Row ${rowNumber}`,
            message: `${mealLabel} is blank/missing for ${propertyDisplayMap.get(propNorm)} on ${reportingDate}. Kept distinct from zero.`,
            remediation: 'Enter 0 if zero scans occurred, or update with actual scan count.',
          });
        }
      }
    }
  }

  // 2. Parse Task Raw rows (skipping header row 0)
  // Filter strictly by Task Name === "Daily Ops Report" (case-insensitive & whitespace-normalized)
  const allDailyOpsTasks: RawTaskRecord[] = [];
  for (let i = 1; i < taskRawRows.length; i++) {
    const row = taskRawRows[i];
    if (!row || row.length === 0) continue;
    const rowNumber = i + 1;

    const taskNameRaw = String(row[TASK_RAW_COLS.TASK_NAME] ?? '').trim().replace(/\s+/g, ' ');
    if (taskNameRaw.toLowerCase() !== 'daily ops report') {
      continue; // Specification: Only include tasks whose Task Name equals "Daily Ops Report"
    }

    const propRaw = String(row[TASK_RAW_COLS.PROPERTY] ?? '');
    const createdAtRaw = String(row[TASK_RAW_COLS.CREATED_AT] ?? '');
    const statusRaw = String(row[TASK_RAW_COLS.STATUS] ?? '');
    const completedAtRaw = String(row[TASK_RAW_COLS.COMPLETED_AT] ?? '');

    const propNorm = registerProperty(propRaw);
    const { reportingDate, isoTimestamp: createdAtIso } = resolveReportingDateInTimezone(
      createdAtRaw,
      businessTimezone
    );
    const { isoTimestamp: completedAtIso } = resolveReportingDateInTimezone(
      completedAtRaw,
      businessTimezone
    );

    if (!propNorm) {
      findings.push({
        id: nextFindingId(),
        severity: 'high',
        category: 'MISSING_VALUE',
        propertyNormalized: 'unknown',
        propertyDisplay: 'Missing Property Name',
        reportingDate,
        sourceSheet: 'Task Raw',
        sourceLocation: `Task Raw!D${rowNumber}`,
        message: `Daily Ops Report at row ${rowNumber} is missing a Property in Column D.`,
        rawValue: propRaw,
        remediation: 'Assign a valid property name in Column D of Task Raw.',
      });
      continue;
    }

    if (!reportingDate || !createdAtIso) {
      findings.push({
        id: nextFindingId(),
        severity: 'critical',
        category: 'INVALID_DATE',
        propertyNormalized: propNorm,
        propertyDisplay: propertyDisplayMap.get(propNorm) || propRaw,
        reportingDate: null,
        sourceSheet: 'Task Raw',
        sourceLocation: `Task Raw!K${rowNumber}`,
        message: `Daily Ops Report at row ${rowNumber} has an invalid Created At timestamp in Column K ("${createdAtRaw}").`,
        rawValue: createdAtRaw,
        remediation: 'Provide a valid ISO timestamp or date in Column K of Task Raw.',
      });
      continue;
    }

    const statusNormalized = normalizeTaskStatus(
      statusRaw,
      completedAtIso,
      reportingDate,
      currentBusinessDate
    );

    allDailyOpsTasks.push({
      rowNumber,
      taskName: taskNameRaw,
      propertyRaw: propRaw,
      propertyNormalized: propNorm,
      createdAtRaw,
      createdAtIso,
      reportingDate,
      statusRaw,
      statusNormalized,
      completedAtRaw,
      completedAtIso,
      breakfastOrderedRaw: row[TASK_RAW_COLS.BREAKFAST_ORDERED],
      breakfastConsumedRaw: row[TASK_RAW_COLS.BREAKFAST_CONSUMED],
      lunchOrderedRaw: row[TASK_RAW_COLS.LUNCH_ORDERED],
      lunchConsumedRaw: row[TASK_RAW_COLS.LUNCH_CONSUMED],
      dinnerOrderedRaw: row[TASK_RAW_COLS.DINNER_ORDERED],
      dinnerConsumedRaw: row[TASK_RAW_COLS.DINNER_CONSUMED],
    });
  }

  // 3. Filter tasks for the selected reporting period & join with Scanning
  const matchedScanKeys = new Set<string>();
  const seenReportKeysInPeriod = new Map<string, number>(); // key -> first rowNumber
  let duplicateReportsExcluded = 0;
  const records: DailyReportRecord[] = [];

  for (const task of allDailyOpsTasks) {
    const repDate = task.reportingDate!;
    if (repDate < startDate || repDate > endDate) {
      continue;
    }

    const joinKey = `${task.propertyNormalized}__${repDate}`;
    const propDisplay = propertyDisplayMap.get(task.propertyNormalized) || task.propertyRaw;

    // Check for duplicate Daily Ops Report for same property + calendar date
    if (seenReportKeysInPeriod.has(joinKey)) {
      duplicateReportsExcluded++;
      const firstRow = seenReportKeysInPeriod.get(joinKey)!;
      findings.push({
        id: nextFindingId(),
        severity: 'high',
        category: 'DUPLICATE_TASK_REPORT',
        propertyNormalized: task.propertyNormalized,
        propertyDisplay: propDisplay,
        reportingDate: repDate,
        sourceSheet: 'Task Raw',
        sourceLocation: `Task Raw!Row ${task.rowNumber} (duplicates Row ${firstRow})`,
        message: `Duplicate "Daily Ops Report" found for ${propDisplay} on ${repDate}. Row ${firstRow} retained; row ${task.rowNumber} excluded to prevent double-counting.`,
        remediation: 'Remove or archive duplicate Daily Ops Report rows in Task Raw.',
      });
      continue;
    }
    seenReportKeysInPeriod.set(joinKey, task.rowNumber);

    const recordFindings: string[] = [];
    const addRecordFinding = (f: Omit<ValidationFinding, 'id'>) => {
      const id = nextFindingId();
      findings.push({ ...f, id });
      recordFindings.push(id);
    };

    // Check completion consistency
    if (task.statusNormalized === 'Completed' && !task.completedAtIso) {
      addRecordFinding({
        severity: 'medium',
        category: 'INCONSISTENT_COMPLETION',
        propertyNormalized: task.propertyNormalized,
        propertyDisplay: propDisplay,
        reportingDate: repDate,
        sourceSheet: 'Task Raw',
        sourceLocation: `Task Raw!O${task.rowNumber}`,
        message: `Task status is marked "Completed" in Column N, but Completed At (Column O) is blank or invalid.`,
        rawValue: task.completedAtRaw,
        remediation: 'Populate the Completed At timestamp in Column O when marking a task Completed.',
      });
    }

    // Parse Task Raw meal metrics
    const bOrd = parseTrackedMetric(task.breakfastOrderedRaw, `Task Raw!AS${task.rowNumber}`);
    const bCon = parseTrackedMetric(task.breakfastConsumedRaw, `Task Raw!AT${task.rowNumber}`);
    const lOrd = parseTrackedMetric(task.lunchOrderedRaw, `Task Raw!AU${task.rowNumber}`);
    const lCon = parseTrackedMetric(task.lunchConsumedRaw, `Task Raw!AV${task.rowNumber}`);
    const dOrd = parseTrackedMetric(task.dinnerOrderedRaw, `Task Raw!AW${task.rowNumber}`);
    const dCon = parseTrackedMetric(task.dinnerConsumedRaw, `Task Raw!AX${task.rowNumber}`);

    // Validate Task Raw meal cells
    const mealCellChecks = [
      { label: 'Breakfast Ordered', metric: bOrd },
      { label: 'Breakfast Consumed', metric: bCon },
      { label: 'Lunch Ordered', metric: lOrd },
      { label: 'Lunch Consumed', metric: lCon },
      { label: 'Dinner Ordered', metric: dOrd },
      { label: 'Dinner Consumed', metric: dCon },
    ];

    for (const { label, metric } of mealCellChecks) {
      if (metric.status === 'negative') {
        addRecordFinding({
          severity: 'critical',
          category: 'NEGATIVE_VALUE',
          propertyNormalized: task.propertyNormalized,
          propertyDisplay: propDisplay,
          reportingDate: repDate,
          sourceSheet: 'Task Raw',
          sourceLocation: metric.sourceCell!,
          message: `${label} has an unexpected negative value (${metric.raw}) at ${metric.sourceCell}.`,
          rawValue: String(metric.raw),
          remediation: 'Replace negative meal count with a valid non-negative integer.',
        });
      } else if (metric.status === 'invalid') {
        addRecordFinding({
          severity: 'high',
          category: 'INVALID_NUMERIC',
          propertyNormalized: task.propertyNormalized,
          propertyDisplay: propDisplay,
          reportingDate: repDate,
          sourceSheet: 'Task Raw',
          sourceLocation: metric.sourceCell!,
          message: `${label} contains an invalid non-numeric value ("${metric.raw}") at ${metric.sourceCell}.`,
          rawValue: String(metric.raw),
          remediation: 'Replace text with a valid number or 0.',
        });
      } else if (
        (metric.status === 'blank' || metric.status === 'missing') &&
        task.statusNormalized === 'Completed'
      ) {
        addRecordFinding({
          severity: 'medium',
          category: 'MISSING_VALUE',
          propertyNormalized: task.propertyNormalized,
          propertyDisplay: propDisplay,
          reportingDate: repDate,
          sourceSheet: 'Task Raw',
          sourceLocation: metric.sourceCell!,
          message: `Completed report is missing ${label} at ${metric.sourceCell}. Preserved as blank (not converted to zero).`,
          remediation: 'Enter 0 if zero portions were ordered/consumed, or enter the actual count.',
        });
      }
    }

    // Join with Scanning record by normalized property + reportingDate
    const matchedScan = validScansByKey.get(joinKey);
    let bScan: TrackedMetricValue;
    let lScan: TrackedMetricValue;
    let dScan: TrackedMetricValue;

    if (matchedScan) {
      matchedScanKeys.add(joinKey);
      bScan = matchedScan.breakfastScanned;
      lScan = matchedScan.lunchScanned;
      dScan = matchedScan.dinnerScanned;
    } else {
      bScan = createUnavailableMetric('No matching Scanning row');
      lScan = createUnavailableMetric('No matching Scanning row');
      dScan = createUnavailableMetric('No matching Scanning row');
      addRecordFinding({
        severity: 'medium',
        category: 'MISSING_SCAN_RECORD',
        propertyNormalized: task.propertyNormalized,
        propertyDisplay: propDisplay,
        reportingDate: repDate,
        sourceSheet: 'Cross-Sheet Join',
        sourceLocation: `Task Raw!Row ${task.rowNumber} -> Scanning (Missing)`,
        message: `No Scanning record found for ${propDisplay} on ${repDate}. Scanned metrics marked unavailable.`,
        remediation: 'Verify whether scanning hardware synced for this property and date, or check property spelling in Scanning Column C.',
      });
    }

    const breakfast = computeMealMetrics('Breakfast', bOrd, bCon, bScan);
    const lunch = computeMealMetrics('Lunch', lOrd, lCon, lScan);
    const dinner = computeMealMetrics('Dinner', dOrd, dCon, dScan);

    // Check high variance anomalies (e.g., Consumed > Ordered or |Variance| > 25% of Ordered when Ordered >= 20)
    for (const meal of [breakfast, lunch, dinner]) {
      if (meal.variance !== null && meal.ordered.value !== null && meal.consumed.value !== null) {
        if (meal.variance < 0) {
          addRecordFinding({
            severity: 'medium',
            category: 'HIGH_VARIANCE_ANOMALY',
            propertyNormalized: task.propertyNormalized,
            propertyDisplay: propDisplay,
            reportingDate: repDate,
            sourceSheet: 'Task Raw',
            sourceLocation: `Task Raw!Row ${task.rowNumber} (${meal.mealType})`,
            message: `${meal.mealType} Consumed (${meal.consumed.value}) exceeds Ordered (${meal.ordered.value}), producing a negative Ordered-minus-Consumed variance of ${meal.variance}.`,
            remediation: 'Audit kitchen buffer replenishment or verify ordered vs consumed counts with the property manager.',
          });
        } else if (meal.ordered.value >= 25 && meal.variance / meal.ordered.value > 0.3) {
          addRecordFinding({
            severity: 'low',
            category: 'HIGH_VARIANCE_ANOMALY',
            propertyNormalized: task.propertyNormalized,
            propertyDisplay: propDisplay,
            reportingDate: repDate,
            sourceSheet: 'Task Raw',
            sourceLocation: `Task Raw!Row ${task.rowNumber} (${meal.mealType})`,
            message: `High wastage alert: ${meal.mealType} Ordered-minus-Consumed variance is +${meal.variance} (${Math.round(
              (meal.variance / meal.ordered.value) * 100
            )}% unconsumed).`,
            remediation: 'Review meal forecasting baseline for this property to reduce unconsumed buffer.',
          });
        }
      }
    }

    records.push({
      id: `REP-${repDate}-${task.propertyNormalized.replace(/[^a-z0-9]/g, '-')}-${task.rowNumber}`,
      propertyNormalized: task.propertyNormalized,
      propertyDisplay: propDisplay,
      reportingDate: repDate,
      taskName: task.taskName,
      taskStatus: task.statusNormalized,
      createdAtIso: task.createdAtIso!,
      completedAtIso: task.completedAtIso,
      completedAtDisplay: task.completedAtIso
        ? new Intl.DateTimeFormat('en-GB', {
            timeZone: businessTimezone,
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(new Date(task.completedAtIso))
        : '—',
      taskRowNumber: task.rowNumber,
      scanRowNumber: matchedScan ? matchedScan.rowNumber : null,
      hasMatchedScan: Boolean(matchedScan),
      isDuplicateReport: false,
      isDuplicateScan: false,
      breakfast,
      lunch,
      dinner,
      findingsCount: recordFindings.length,
      findingIds: recordFindings,
    });
  }

  // 4. Identify unmatched Scanning records in the period (orphaned scans with no Daily Ops Report)
  const unmatchedScans: ScanningRecord[] = [];
  const taskPropertiesKnown = new Set(allDailyOpsTasks.map((t) => t.propertyNormalized));

  for (const scan of allScansInPeriod) {
    const joinKey = `${scan.propertyNormalized}__${scan.reportingDate}`;
    if (!matchedScanKeys.has(joinKey)) {
      unmatchedScans.push(scan);
      const isCompletelyUnknownProperty = !taskPropertiesKnown.has(scan.propertyNormalized);
      const propDisplay = propertyDisplayMap.get(scan.propertyNormalized) || scan.propertyRaw;

      findings.push({
        id: nextFindingId(),
        severity: isCompletelyUnknownProperty ? 'high' : 'medium',
        category: 'UNMATCHED_PROPERTY',
        propertyNormalized: scan.propertyNormalized,
        propertyDisplay: propDisplay,
        reportingDate: scan.reportingDate,
        sourceSheet: 'Cross-Sheet Join',
        sourceLocation: `Scanning!Row ${scan.rowNumber} ("${scan.propertyRaw}")`,
        message: isCompletelyUnknownProperty
          ? `Unmatched Property "${scan.propertyRaw}" in Scanning row ${scan.rowNumber} does not match any known property in Task Raw.`
          : `Scanning record for ${propDisplay} on ${scan.reportingDate} (row ${scan.rowNumber}) has no corresponding "Daily Ops Report" in Task Raw.`,
        rawValue: scan.propertyRaw,
        remediation: isCompletelyUnknownProperty
          ? 'Standardize the property name in Scanning Column C to match Task Raw Column D.'
          : 'Confirm why the Daily Ops Report was not created in Task Raw for this date.',
      });
    }
  }

  // Sort records descending by date, then ascending by property display name
  records.sort((a, b) => {
    if (a.reportingDate !== b.reportingDate) {
      return b.reportingDate.localeCompare(a.reportingDate);
    }
    return a.propertyDisplay.localeCompare(b.propertyDisplay);
  });

  // 5. Build PropertyEntities
  const properties: PropertyEntity[] = [];
  for (const [normId, display] of propertyDisplayMap.entries()) {
    const propRecords = records.filter((r) => r.propertyNormalized === normId);
    const propFindings = findings.filter((f) => f.propertyNormalized === normId);
    const hasUnmatched = unmatchedScans.some((s) => s.propertyNormalized === normId);
    const completedCount = propRecords.filter((r) => r.taskStatus === 'Completed').length;

    const penalty = propFindings.reduce((acc, f) => {
      if (f.severity === 'critical') return acc + 18;
      if (f.severity === 'high') return acc + 10;
      if (f.severity === 'medium') return acc + 4;
      return acc + 1;
    }, 0);

    properties.push({
      normalizedId: normId,
      displayName: display,
      rawVariants: Array.from(propertyVariantsMap.get(normId) || [display]),
      totalReportsInPeriod: propRecords.length,
      completedReportsInPeriod: completedCount,
      hasUnmatchedScans: hasUnmatched,
      dataQualityScore: Math.max(0, Math.min(100, 100 - penalty)),
    });
  }
  properties.sort((a, b) => a.displayName.localeCompare(b.displayName));

  // 6. Compute Executive KPIs and Period-over-Period Comparison
  const aggregateMeal = (
    recs: DailyReportRecord[],
    selector: (r: DailyReportRecord) => MealMetrics
  ): MealAggregateSummary => {
    let orderedTotal = 0;
    let consumedTotal = 0;
    let scannedTotal = 0;
    let pairedOrderedTotal = 0;
    let pairedConsumedTotal = 0;
    let validOrderedCount = 0;
    let validConsumedCount = 0;
    let validScannedCount = 0;
    let missingOrInvalidCount = 0;

    for (const r of recs) {
      const m = selector(r);
      const ordValid = m.ordered.status === 'valid_number' || m.ordered.status === 'valid_zero';
      const conValid = m.consumed.status === 'valid_number' || m.consumed.status === 'valid_zero';
      const scnValid = m.scanned.status === 'valid_number' || m.scanned.status === 'valid_zero';

      if (ordValid && m.ordered.value !== null) {
        orderedTotal += m.ordered.value;
        validOrderedCount++;
      } else {
        missingOrInvalidCount++;
      }

      if (conValid && m.consumed.value !== null) {
        consumedTotal += m.consumed.value;
        validConsumedCount++;
      } else {
        missingOrInvalidCount++;
      }

      if (scnValid && m.scanned.value !== null) {
        scannedTotal += m.scanned.value;
        validScannedCount++;
      } else {
        missingOrInvalidCount++;
      }

      if (ordValid && conValid && m.ordered.value !== null && m.consumed.value !== null) {
        pairedOrderedTotal += m.ordered.value;
        pairedConsumedTotal += m.consumed.value;
      }
    }

    return {
      orderedTotal: Number(orderedTotal.toFixed(2)),
      consumedTotal: Number(consumedTotal.toFixed(2)),
      scannedTotal: Number(scannedTotal.toFixed(2)),
      varianceTotal: Number((pairedOrderedTotal - pairedConsumedTotal).toFixed(2)),
      validOrderedCount,
      validConsumedCount,
      validScannedCount,
      missingOrInvalidCount,
    };
  };

  const breakfastAgg = aggregateMeal(records, (r) => r.breakfast);
  const lunchAgg = aggregateMeal(records, (r) => r.lunch);
  const dinnerAgg = aggregateMeal(records, (r) => r.dinner);

  // Period-over-period calculation based on equal day span immediately preceding startDate
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const daySpan = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);
  const prevEndMs = startMs - 1000 * 60 * 60 * 24;
  const prevStartMs = prevEndMs - (daySpan - 1) * 1000 * 60 * 60 * 24;
  const previousPeriodStart = new Date(prevStartMs).toISOString().slice(0, 10);
  const previousPeriodEnd = new Date(prevEndMs).toISOString().slice(0, 10);

  const prevTasks = allDailyOpsTasks.filter(
    (t) =>
      t.reportingDate &&
      t.reportingDate >= previousPeriodStart &&
      t.reportingDate <= previousPeriodEnd
  );

  let prevOrdered = 0;
  let prevConsumed = 0;
  let prevScanned = 0;
  const seenPrevKeys = new Set<string>();
  let prevCompleted = 0;
  let prevTotalValid = 0;

  for (const t of prevTasks) {
    const k = `${t.propertyNormalized}__${t.reportingDate}`;
    if (seenPrevKeys.has(k)) continue;
    seenPrevKeys.add(k);
    prevTotalValid++;
    if (t.statusNormalized === 'Completed') prevCompleted++;

    const bo = parseTrackedMetric(t.breakfastOrderedRaw).value ?? 0;
    const bc = parseTrackedMetric(t.breakfastConsumedRaw).value ?? 0;
    const lo = parseTrackedMetric(t.lunchOrderedRaw).value ?? 0;
    const lc = parseTrackedMetric(t.lunchConsumedRaw).value ?? 0;
    const doVal = parseTrackedMetric(t.dinnerOrderedRaw).value ?? 0;
    const dc = parseTrackedMetric(t.dinnerConsumedRaw).value ?? 0;

    prevOrdered += bo + lo + doVal;
    prevConsumed += bc + lc + dc;

    const sc = validScansByKey.get(k);
    if (sc) {
      prevScanned +=
        (sc.breakfastScanned.value ?? 0) +
        (sc.lunchScanned.value ?? 0) +
        (sc.dinnerScanned.value ?? 0);
    }
  }

  const currOrdered = breakfastAgg.orderedTotal + lunchAgg.orderedTotal + dinnerAgg.orderedTotal;
  const currConsumed = breakfastAgg.consumedTotal + lunchAgg.consumedTotal + dinnerAgg.consumedTotal;
  const currScanned = breakfastAgg.scannedTotal + lunchAgg.scannedTotal + dinnerAgg.scannedTotal;

  const pctChange = (curr: number, prev: number): number | null => {
    if (prev <= 0) return null;
    return Number((((curr - prev) / prev) * 100).toFixed(1));
  };

  const hasComparableHistory = prevTotalValid > 0;
  const currCompletionRate =
    records.length > 0
      ? (records.filter((r) => r.taskStatus === 'Completed').length / records.length) * 100
      : 0;
  const prevCompletionRate = prevTotalValid > 0 ? (prevCompleted / prevTotalValid) * 100 : 0;

  const propertiesReportingSet = new Set(records.map((r) => r.propertyNormalized));

  const kpis: ExecutiveKpiSummary = {
    reportingPeriodStart: startDate,
    reportingPeriodEnd: endDate,
    businessTimezone,
    totalPropertiesReporting: propertiesReportingSet.size,
    totalPropertiesKnown: properties.length,
    reportsCompleted: records.filter((r) => r.taskStatus === 'Completed').length,
    reportsPending: records.filter((r) => r.taskStatus === 'Pending').length,
    reportsOverdue: records.filter((r) => r.taskStatus === 'Overdue').length,
    reportsInProgress: records.filter((r) => r.taskStatus === 'In Progress').length,
    totalValidReports: records.length,
    duplicateReportsExcluded,
    duplicateScansExcluded,
    unmatchedScanRecordsCount: unmatchedScans.length,
    dataQualityWarningCount: findings.length,
    criticalFindingsCount: findings.filter(
      (f) => f.severity === 'critical' || f.severity === 'high'
    ).length,
    breakfast: breakfastAgg,
    lunch: lunchAgg,
    dinner: dinnerAgg,
    periodOverPeriod: {
      hasComparableHistory,
      previousPeriodStart,
      previousPeriodEnd,
      orderedChangePct: hasComparableHistory ? pctChange(currOrdered, prevOrdered) : null,
      consumedChangePct: hasComparableHistory ? pctChange(currConsumed, prevConsumed) : null,
      scannedChangePct: hasComparableHistory ? pctChange(currScanned, prevScanned) : null,
      completionRateDeltaPct: hasComparableHistory
        ? Number((currCompletionRate - prevCompletionRate).toFixed(1))
        : null,
    },
  };

  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const t of allDailyOpsTasks) {
    if (t.reportingDate) {
      if (!minDate || t.reportingDate < minDate) minDate = t.reportingDate;
      if (!maxDate || t.reportingDate > maxDate) maxDate = t.reportingDate;
    }
  }

  return {
    records,
    unmatchedScans,
    properties,
    findings,
    kpis,
    availableDateRange: {
      minDate,
      maxDate,
      totalDailyOpsTasksFound: allDailyOpsTasks.length,
    },
  };
}
