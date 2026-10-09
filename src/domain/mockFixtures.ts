/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Realistic Synthetic Enterprise Fixture Generator for Task Raw and Scanning sheets.
 * Produces 2D cell arrays matching the exact Google Sheets column layout:
 * - Task Raw: B (Task Name), D (Property), K (Created At), N (Status), O (Completed At), AS..AX (Meals)
 * - Scanning: C (Property Name), D (Date), E..G (Breakfast/Lunch/Dinner Scanned)
 * Includes realistic operational patterns AND deliberate edge cases for Data Quality validation:
 * - Case/whitespace property variations ("Aaalay Koramangala Hub" vs "  aaalay koramangala hub ")
 * - Explicit zeroes (0) vs Blank ("") vs Invalid ("N/A") vs Negative (-4)
 * - Duplicate Daily Ops Report row & duplicate Scanning row
 * - Unmatched property scan ("Aaalay Ghost Annex")
 * - Non-"Daily Ops Report" task ("Weekly Deep Clean Audit") to verify task filtering
 */

import { SCANNING_COLS, TASK_RAW_COLS } from './foodMisEngine';

export interface SyntheticSheetsFixture {
  taskRawRows: (string | number | null | undefined)[][];
  scanningRows: (string | number | null | undefined)[][];
  defaultStartDate: string;
  defaultEndDate: string;
  businessTimezone: string;
}

const PROPERTIES = [
  { name: 'Aaalay Koramangala Flagship', basePax: 140 },
  { name: 'Aaalay Indiranagar Suites', basePax: 95 },
  { name: 'Aaalay HSR Layout Residency', basePax: 180 },
  { name: 'Aaalay Whitefield Tech Hub', basePax: 220 },
  { name: 'Aaalay Electronic City Campus', basePax: 160 },
  { name: 'Aaalay Bellandur Executive', basePax: 115 },
  { name: 'Aaalay Manyata Park Vista', basePax: 130 },
  { name: 'Aaalay Marathahalli Commons', basePax: 85 },
];

function makeTaskRow(fields: {
  taskName: string;
  property: string;
  createdAt: string;
  status: string;
  completedAt: string;
  bOrd: string | number | undefined;
  bCon: string | number | undefined;
  lOrd: string | number | undefined;
  lCon: string | number | undefined;
  dOrd: string | number | undefined;
  dCon: string | number | undefined;
}): (string | number | null | undefined)[] {
  const row: (string | number | null | undefined)[] = new Array(50).fill('');
  row[0] = 'TSK-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  row[TASK_RAW_COLS.TASK_NAME] = fields.taskName;
  row[TASK_RAW_COLS.PROPERTY] = fields.property;
  row[TASK_RAW_COLS.CREATED_AT] = fields.createdAt;
  row[TASK_RAW_COLS.STATUS] = fields.status;
  row[TASK_RAW_COLS.COMPLETED_AT] = fields.completedAt;
  row[TASK_RAW_COLS.BREAKFAST_ORDERED] = fields.bOrd;
  row[TASK_RAW_COLS.BREAKFAST_CONSUMED] = fields.bCon;
  row[TASK_RAW_COLS.LUNCH_ORDERED] = fields.lOrd;
  row[TASK_RAW_COLS.LUNCH_CONSUMED] = fields.lCon;
  row[TASK_RAW_COLS.DINNER_ORDERED] = fields.dOrd;
  row[TASK_RAW_COLS.DINNER_CONSUMED] = fields.dCon;
  return row;
}

function makeScanRow(fields: {
  property: string;
  date: string;
  bScan: string | number | undefined;
  lScan: string | number | undefined;
  dScan: string | number | undefined;
}): (string | number | null | undefined)[] {
  const row: (string | number | null | undefined)[] = new Array(8).fill('');
  row[0] = 'SCN';
  row[SCANNING_COLS.PROPERTY] = fields.property;
  row[SCANNING_COLS.DATE] = fields.date;
  row[SCANNING_COLS.BREAKFAST_SCANNED] = fields.bScan;
  row[SCANNING_COLS.LUNCH_SCANNED] = fields.lScan;
  row[SCANNING_COLS.DINNER_SCANNED] = fields.dScan;
  return row;
}

export function buildSyntheticSheetsDataset(): SyntheticSheetsFixture {
  const taskHeader = new Array(50).fill('');
  taskHeader[TASK_RAW_COLS.TASK_NAME] = 'Task Name (B)';
  taskHeader[TASK_RAW_COLS.PROPERTY] = 'Property (D)';
  taskHeader[TASK_RAW_COLS.CREATED_AT] = 'Created At (K)';
  taskHeader[TASK_RAW_COLS.STATUS] = 'Status (N)';
  taskHeader[TASK_RAW_COLS.COMPLETED_AT] = 'Completed At (O)';
  taskHeader[TASK_RAW_COLS.BREAKFAST_ORDERED] = 'Breakfast Ordered (AS)';
  taskHeader[TASK_RAW_COLS.BREAKFAST_CONSUMED] = 'Breakfast Consumed (AT)';
  taskHeader[TASK_RAW_COLS.LUNCH_ORDERED] = 'Lunch Ordered (AU)';
  taskHeader[TASK_RAW_COLS.LUNCH_CONSUMED] = 'Lunch Consumed (AV)';
  taskHeader[TASK_RAW_COLS.DINNER_ORDERED] = 'Dinner Ordered (AW)';
  taskHeader[TASK_RAW_COLS.DINNER_CONSUMED] = 'Dinner Consumed (AX)';

  const scanHeader = new Array(8).fill('');
  scanHeader[SCANNING_COLS.PROPERTY] = 'Property Name (C)';
  scanHeader[SCANNING_COLS.DATE] = 'Date (D)';
  scanHeader[SCANNING_COLS.BREAKFAST_SCANNED] = 'Breakfast Scanned (E)';
  scanHeader[SCANNING_COLS.LUNCH_SCANNED] = 'Lunch Scanned (F)';
  scanHeader[SCANNING_COLS.DINNER_SCANNED] = 'Dinner Scanned (G)';

  const taskRawRows: (string | number | null | undefined)[][] = [taskHeader];
  const scanningRows: (string | number | null | undefined)[][] = [scanHeader];

  // Generate 28 days of data ending at 2026-10-09 (so 14d current period + 14d previous period for PoP comparison)
  const dates: string[] = [];
  const baseMs = Date.parse('2026-10-09T00:00:00Z');
  for (let offset = 27; offset >= 0; offset--) {
    const d = new Date(baseMs - offset * 86400000).toISOString().slice(0, 10);
    dates.push(d);
  }

  for (let dIdx = 0; dIdx < dates.length; dIdx++) {
    const dateStr = dates[dIdx];
    const isToday = dateStr === '2026-10-09';
    const isYesterday = dateStr === '2026-10-08';
    const dayWave = Math.sin(dIdx * 0.55) * 0.08 + 1;

    for (let pIdx = 0; pIdx < PROPERTIES.length; pIdx++) {
      const prop = PROPERTIES[pIdx];
      const seed = (dIdx * 13 + pIdx * 7) % 19;

      const bOrd = Math.round(prop.basePax * 0.85 * dayWave + (seed - 8));
      const bCon = Math.max(0, bOrd - ((seed % 7) + 2));
      const bScan = Math.max(0, bCon - ((seed % 5) + 1));

      // Explicit zero lunch ordered/consumed on one specific weekend maintenance slot
      const isZeroLunchDay = dateStr === '2026-10-04' && pIdx === 7;
      const lOrd = isZeroLunchDay ? 0 : Math.round(prop.basePax * 0.65 * dayWave + (seed - 5));
      const lCon = isZeroLunchDay ? 0 : Math.max(0, lOrd - ((seed % 6) + 1));
      const lScan = isZeroLunchDay ? 0 : Math.max(0, lCon - (seed % 4));

      const dOrd = Math.round(prop.basePax * 0.95 * dayWave + (seed - 4));
      // Deliberate over-consumption anomaly on 2026-10-07 at Indiranagar Suites (pIdx === 1)
      const dCon =
        dateStr === '2026-10-07' && pIdx === 1
          ? dOrd + 14
          : Math.max(0, dOrd - ((seed % 8) + 3));
      const dScan = Math.max(0, dCon - ((seed % 6) + 2));

      let status = 'Completed';
      let completedAt = `${dateStr}T17:15:00.000Z`; // 22:45 IST

      if (isToday && pIdx >= 5) {
        status = pIdx === 5 ? 'In Progress' : 'Pending';
        completedAt = '';
      } else if (isYesterday && pIdx === 6) {
        status = 'Pending'; // Will trigger Overdue detection because reportingDate < currentBusinessDate
        completedAt = '';
      }

      // Edge Case 1: Blank Dinner Consumed cell on 2026-10-06 at Bellandur Executive (pIdx === 5)
      const finalDCon: string | number | undefined =
        dateStr === '2026-10-06' && pIdx === 5 ? '' : dCon;

      // Edge Case 2: Invalid non-numeric text "N/A - Vendor Delay" on 2026-10-05 at Marathahalli (pIdx === 7)
      const finalLCon: string | number | undefined =
        dateStr === '2026-10-05' && pIdx === 7 ? 'N/A - Pending Count' : lCon;

      // Edge Case 3: Negative value in Task Raw on 2026-10-03 at Manyata Park (pIdx === 6)
      const finalBCon: string | number | undefined =
        dateStr === '2026-10-03' && pIdx === 6 ? -6 : bCon;

      taskRawRows.push(
        makeTaskRow({
          taskName: 'Daily Ops Report',
          property: prop.name,
          createdAt: `${dateStr}T04:00:00.000Z`, // 09:30 IST in Asia/Kolkata
          status,
          completedAt,
          bOrd,
          bCon: finalBCon,
          lOrd,
          lCon: finalLCon,
          dOrd,
          dCon: finalDCon,
        })
      );

      // Edge Case 4: Missing scan record on 2026-10-08 for HSR Layout Residency (pIdx === 2)
      if (dateStr === '2026-10-08' && pIdx === 2) {
        continue;
      }

      // Use normalized case/whitespace variation in Scanning to prove case-insensitive trimmed join works seamlessly
      const scanPropName =
        pIdx === 0 && dIdx % 2 === 0
          ? `  ${prop.name.toUpperCase()} `
          : prop.name;

      scanningRows.push(
        makeScanRow({
          property: scanPropName,
          date: dateStr,
          bScan,
          lScan,
          dScan,
        })
      );
    }
  }

  // Deliberate Edge Case 5: Non-"Daily Ops Report" task row (should be ignored by domain engine)
  taskRawRows.push(
    makeTaskRow({
      taskName: 'Weekly Deep Clean Audit',
      property: 'Aaalay Koramangala Flagship',
      createdAt: '2026-10-08T05:00:00.000Z',
      status: 'Completed',
      completedAt: '2026-10-08T12:00:00.000Z',
      bOrd: 999,
      bCon: 999,
      lOrd: 999,
      lCon: 999,
      dOrd: 999,
      dCon: 999,
    })
  );

  // Deliberate Edge Case 6: Duplicate Daily Ops Report for Aaalay Koramangala Flagship on 2026-10-07
  taskRawRows.push(
    makeTaskRow({
      taskName: 'Daily Ops Report',
      property: 'Aaalay Koramangala Flagship',
      createdAt: '2026-10-07T08:30:00.000Z',
      status: 'Completed',
      completedAt: '2026-10-07T18:00:00.000Z',
      bOrd: 120,
      bCon: 110,
      lOrd: 90,
      lCon: 85,
      dOrd: 135,
      dCon: 130,
    })
  );

  // Deliberate Edge Case 7: Unmatched Property Scan in Scanning sheet ("Aaalay Sarjapur Annex" not in Task Raw)
  scanningRows.push(
    makeScanRow({
      property: 'Aaalay Sarjapur Annex (Unmapped)',
      date: '2026-10-08',
      bScan: 64,
      lScan: 48,
      dScan: 72,
    })
  );

  // Deliberate Edge Case 8: Duplicate Scanning Record for Aaalay Whitefield Tech Hub on 2026-10-06
  scanningRows.push(
    makeScanRow({
      property: 'Aaalay Whitefield Tech Hub',
      date: '2026-10-06',
      bScan: 185,
      lScan: 140,
      dScan: 205,
    })
  );

  return {
    taskRawRows,
    scanningRows,
    defaultStartDate: '2026-09-26',
    defaultEndDate: '2026-10-09',
    businessTimezone: 'Asia/Kolkata',
  };
}
