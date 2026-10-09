/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * High-Density Daily Report Table with:
 * - All 16 required columns:
 *   Property, Date, Task Status, Completed At,
 *   Breakfast Ordered, Breakfast Consumed, Breakfast Scanned, Breakfast Difference,
 *   Lunch Ordered, Lunch Consumed, Lunch Scanned, Lunch Difference,
 *   Dinner Ordered, Dinner Consumed, Dinner Scanned, Dinner Difference
 * - Explicit distinction between 0 ("0") and Blank ("BLANK"), Invalid ("INVALID"), Negative ("NEG"), or Unavailable ("UNAVAIL")
 * - Column visibility controls, sorting, pagination, and property drill-down
 */

import React, { useState, useMemo } from 'react';
import { DailyReportRecord, TrackedMetricValue } from '../types/domain';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns,
  Download,
  ExternalLink,
  Printer,
} from 'lucide-react';

interface DailyReportTableProps {
  records: DailyReportRecord[];
  onSelectProperty: (propertyNormalized: string) => void;
  onInspectRecord: (record: DailyReportRecord) => void;
  onExportCsv: () => void;
  isExporting: boolean;
}

type SortField =
  | 'propertyDisplay'
  | 'reportingDate'
  | 'taskStatus'
  | 'breakfastOrdered'
  | 'breakfastConsumed'
  | 'breakfastScanned'
  | 'breakfastDifference'
  | 'lunchOrdered'
  | 'lunchConsumed'
  | 'lunchScanned'
  | 'lunchDifference'
  | 'dinnerOrdered'
  | 'dinnerConsumed'
  | 'dinnerScanned'
  | 'dinnerDifference';

export function renderTrackedCell(metric: TrackedMetricValue): React.ReactNode {
  if (metric.status === 'valid_zero') {
    return <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">0</span>;
  }
  if (metric.status === 'valid_number' && metric.value !== null) {
    return (
      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
        {metric.value.toLocaleString()}
      </span>
    );
  }
  if (metric.status === 'blank' || metric.status === 'missing') {
    return (
      <span
        title={`Cell ${metric.sourceCell || ''} is blank or missing. Never converted to zero.`}
        className="font-mono text-[11px] text-amber-700 dark:text-amber-400 underline decoration-dotted cursor-help"
      >
        Blank Cell
      </span>
    );
  }
  if (metric.status === 'negative') {
    return (
      <span
        title={`Unexpected negative value (${metric.raw}) at ${metric.sourceCell || ''}`}
        className="font-mono text-[11px] font-semibold text-rose-600 dark:text-rose-400 underline decoration-wavy cursor-help"
      >
        Negative ({String(metric.raw)})
      </span>
    );
  }
  if (metric.status === 'invalid') {
    return (
      <span
        title={`Non-numeric value ("${metric.raw}") at ${metric.sourceCell || ''}`}
        className="font-mono text-[11px] font-semibold text-rose-600 dark:text-rose-400 underline decoration-dotted cursor-help"
      >
        Invalid Value
      </span>
    );
  }
  return (
    <span
      title="No matching Scanning sheet record found for this property and reporting date"
      className="font-mono text-[11px] text-slate-400 dark:text-slate-500 cursor-help"
    >
      Not Scanned
    </span>
  );
}

export function renderVarianceCell(variance: number | null): React.ReactNode {
  if (variance === null) {
    return (
      <span
        title="Difference (Ordered minus Consumed) cannot be calculated because Ordered or Consumed is blank or invalid"
        className="font-mono text-[11px] text-slate-400 dark:text-slate-500"
      >
        Not Available
      </span>
    );
  }
  if (variance === 0) {
    return <span className="font-mono tabular-nums text-slate-500">0</span>;
  }
  if (variance < 0) {
    return (
      <span
        title="Consumed exceeded Ordered"
        className="font-mono tabular-nums font-semibold text-rose-600 dark:text-rose-400"
      >
        {variance.toLocaleString()}
      </span>
    );
  }
  return (
    <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
      +{variance.toLocaleString()}
    </span>
  );
}

export const DailyReportTable: React.FC<DailyReportTableProps> = ({
  records,
  onSelectProperty,
  onInspectRecord,
  onExportCsv,
  isExporting,
}) => {
  const [sortField, setSortField] = useState<SortField>('reportingDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const [visibleMealGroups, setVisibleMealGroups] = useState<{
    meta: boolean;
    breakfast: boolean;
    lunch: boolean;
    dinner: boolean;
  }>({
    meta: true,
    breakfast: true,
    lunch: true,
    dinner: true,
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(1);
  };

  const sortedRecords = useMemo(() => {
    const copy = [...records];
    const getVal = (r: DailyReportRecord, f: SortField): string | number => {
      switch (f) {
        case 'propertyDisplay':
          return r.propertyDisplay;
        case 'reportingDate':
          return r.reportingDate;
        case 'taskStatus':
          return r.taskStatus;
        case 'breakfastOrdered':
          return r.breakfast.ordered.value ?? -999999;
        case 'breakfastConsumed':
          return r.breakfast.consumed.value ?? -999999;
        case 'breakfastScanned':
          return r.breakfast.scanned.value ?? -999999;
        case 'breakfastDifference':
          return r.breakfast.variance ?? -999999;
        case 'lunchOrdered':
          return r.lunch.ordered.value ?? -999999;
        case 'lunchConsumed':
          return r.lunch.consumed.value ?? -999999;
        case 'lunchScanned':
          return r.lunch.scanned.value ?? -999999;
        case 'lunchDifference':
          return r.lunch.variance ?? -999999;
        case 'dinnerOrdered':
          return r.dinner.ordered.value ?? -999999;
        case 'dinnerConsumed':
          return r.dinner.consumed.value ?? -999999;
        case 'dinnerScanned':
          return r.dinner.scanned.value ?? -999999;
        case 'dinnerDifference':
          return r.dinner.variance ?? -999999;
      }
    };

    copy.sort((a, b) => {
      const va = getVal(a, sortField);
      const vb = getVal(b, sortField);
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return copy;
  }, [records, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRecords.slice(start, start + pageSize);
  }, [sortedRecords, currentPage, pageSize]);

  const tableTotals = useMemo(() => {
    let bOrd = 0,
      bCon = 0,
      bScn = 0,
      bPairOrd = 0,
      bPairCon = 0;
    let lOrd = 0,
      lCon = 0,
      lScn = 0,
      lPairOrd = 0,
      lPairCon = 0;
    let dOrd = 0,
      dCon = 0,
      dScn = 0,
      dPairOrd = 0,
      dPairCon = 0;

    for (const r of sortedRecords) {
      if (r.breakfast.ordered.value !== null) bOrd += r.breakfast.ordered.value;
      if (r.breakfast.consumed.value !== null) bCon += r.breakfast.consumed.value;
      if (r.breakfast.scanned.value !== null) bScn += r.breakfast.scanned.value;
      if (r.breakfast.ordered.value !== null && r.breakfast.consumed.value !== null) {
        bPairOrd += r.breakfast.ordered.value;
        bPairCon += r.breakfast.consumed.value;
      }

      if (r.lunch.ordered.value !== null) lOrd += r.lunch.ordered.value;
      if (r.lunch.consumed.value !== null) lCon += r.lunch.consumed.value;
      if (r.lunch.scanned.value !== null) lScn += r.lunch.scanned.value;
      if (r.lunch.ordered.value !== null && r.lunch.consumed.value !== null) {
        lPairOrd += r.lunch.ordered.value;
        lPairCon += r.lunch.consumed.value;
      }

      if (r.dinner.ordered.value !== null) dOrd += r.dinner.ordered.value;
      if (r.dinner.consumed.value !== null) dCon += r.dinner.consumed.value;
      if (r.dinner.scanned.value !== null) dScn += r.dinner.scanned.value;
      if (r.dinner.ordered.value !== null && r.dinner.consumed.value !== null) {
        dPairOrd += r.dinner.ordered.value;
        dPairCon += r.dinner.consumed.value;
      }
    }

    return {
      bOrd,
      bCon,
      bScn,
      bDiff: bPairOrd - bPairCon,
      lOrd,
      lCon,
      lScn,
      lDiff: lPairOrd - lPairCon,
      dOrd,
      dCon,
      dScn,
      dDiff: dPairOrd - dPairCon,
    };
  }, [sortedRecords]);

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      {/* Table Header Toolbar */}
      <div className="px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Daily Operations Report Full Ledger
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Difference is calculated strictly as <strong>Ordered minus Consumed</strong>. Zeroes (0) are explicitly distinguished from Blank Cell, Invalid Value, Negative, and Not Scanned records.
          </p>
        </div>

        <div className="flex items-center gap-2 no-print relative">
          {/* Column Visibility Toggle */}
          <button
            type="button"
            onClick={() => setShowColumnMenu((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Columns className="w-3.5 h-3.5" />
            Show / Hide Columns
          </button>

          {showColumnMenu && (
            <div className="absolute right-0 top-10 z-30 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-3 space-y-2 text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100 pb-1 border-b border-slate-100 dark:border-slate-800">
                Toggle Column Groups
              </div>
              {(['meta', 'breakfast', 'lunch', 'dinner'] as const).map((grp) => (
                <label
                  key={grp}
                  className="flex items-center justify-between py-1 cursor-pointer text-slate-700 dark:text-slate-300"
                >
                  <span className="capitalize">
                    {grp === 'meta' ? 'Task Status & Completed Time' : `${grp} Columns (4)`}
                  </span>
                  <input
                    type="checkbox"
                    checked={visibleMealGroups[grp]}
                    onChange={(e) =>
                      setVisibleMealGroups((prev) => ({
                        ...prev,
                        [grp]: e.target.checked,
                      }))
                    }
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </label>
              ))}
            </div>
          )}

          {/* Printable Report Action */}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Full Report
          </button>

          {/* Sanitized CSV Export */}
          <button
            type="button"
            disabled={isExporting || records.length === 0}
            onClick={onExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {isExporting ? 'Exporting CSV...' : 'Export CSV Report'}
          </button>
        </div>
      </div>

      {/* Scrollable Data Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              <th className="py-2.5 px-3 whitespace-nowrap sticky left-0 bg-slate-50 dark:bg-slate-900 z-10 border-r border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => handleSort('propertyDisplay')}
                  className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                >
                  Property Name <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="py-2.5 px-3 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => handleSort('reportingDate')}
                  className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                >
                  Reporting Date <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              {visibleMealGroups.meta && (
                <>
                  <th className="py-2.5 px-3 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('taskStatus')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Task Status <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap border-r border-slate-200 dark:border-slate-800">
                    Completed At
                  </th>
                </>
              )}

              {visibleMealGroups.breakfast && (
                <>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('breakfastOrdered')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Breakfast Ordered <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('breakfastConsumed')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Breakfast Consumed <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('breakfastScanned')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Breakfast QR Scanned <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap border-r border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleSort('breakfastDifference')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Breakfast Difference <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                </>
              )}

              {visibleMealGroups.lunch && (
                <>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('lunchOrdered')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Lunch Ordered <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('lunchConsumed')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Lunch Consumed <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('lunchScanned')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Lunch QR Scanned <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap border-r border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleSort('lunchDifference')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Lunch Difference <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                </>
              )}

              {visibleMealGroups.dinner && (
                <>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('dinnerOrdered')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Dinner Ordered <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('dinnerConsumed')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Dinner Consumed <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('dinnerScanned')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Dinner QR Scanned <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('dinnerDifference')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      Dinner Difference <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                </>
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {pagedRecords.length === 0 ? (
              <tr>
                <td colSpan={16} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  No Daily Ops Report records match the active filter selection.
                </td>
              </tr>
            ) : (
              pagedRecords.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => onInspectRecord(r)}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  <td className="py-2 px-3 whitespace-nowrap sticky left-0 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 font-medium text-slate-900 dark:text-slate-100">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProperty(r.propertyNormalized);
                        }}
                        className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline inline-flex items-center gap-1 text-left"
                      >
                        {r.propertyDisplay}
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </button>
                      {r.findingsCount > 0 && (
                        <span
                          title={`${r.findingsCount} data quality finding(s) on this row`}
                          className="font-mono text-[10px] text-amber-600 dark:text-amber-400"
                        >
                          !{r.findingsCount}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-2 px-3 whitespace-nowrap font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {r.reportingDate}
                  </td>

                  {visibleMealGroups.meta && (
                    <>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span
                          className={`font-medium ${
                            r.taskStatus === 'Completed'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : r.taskStatus === 'Overdue'
                              ? 'text-rose-600 dark:text-rose-400 font-semibold'
                              : r.taskStatus === 'In Progress'
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {r.taskStatus}
                        </span>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap font-mono tabular-nums text-slate-500 dark:text-slate-400 border-r border-slate-100 dark:border-slate-800">
                        {r.completedAtDisplay}
                      </td>
                    </>
                  )}

                  {visibleMealGroups.breakfast && (
                    <>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        {renderTrackedCell(r.breakfast.ordered)}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        {renderTrackedCell(r.breakfast.consumed)}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        {renderTrackedCell(r.breakfast.scanned)}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap border-r border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20">
                        {renderVarianceCell(r.breakfast.variance)}
                      </td>
                    </>
                  )}

                  {visibleMealGroups.lunch && (
                    <>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        {renderTrackedCell(r.lunch.ordered)}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        {renderTrackedCell(r.lunch.consumed)}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        {renderTrackedCell(r.lunch.scanned)}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap border-r border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20">
                        {renderVarianceCell(r.lunch.variance)}
                      </td>
                    </>
                  )}

                  {visibleMealGroups.dinner && (
                    <>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        {renderTrackedCell(r.dinner.ordered)}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        {renderTrackedCell(r.dinner.consumed)}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        {renderTrackedCell(r.dinner.scanned)}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap bg-slate-50/40 dark:bg-slate-800/20">
                        {renderVarianceCell(r.dinner.variance)}
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
          {sortedRecords.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/80 text-xs font-mono tabular-nums font-semibold">
              <tr>
                <td className="py-2.5 px-3 sticky left-0 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 font-sans text-slate-900 dark:text-white">
                  Grand Total ({sortedRecords.length} Reports)
                </td>
                <td className="py-2.5 px-3 text-slate-500 font-sans">All Filtered Dates</td>
                {visibleMealGroups.meta && (
                  <>
                    <td className="py-2.5 px-3 text-slate-500 font-sans">—</td>
                    <td className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 text-slate-500">
                      —
                    </td>
                  </>
                )}
                {visibleMealGroups.breakfast && (
                  <>
                    <td className="py-2.5 px-2.5 text-right">{tableTotals.bOrd.toLocaleString()}</td>
                    <td className="py-2.5 px-2.5 text-right text-blue-600 dark:text-blue-400">
                      {tableTotals.bCon.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2.5 text-right text-teal-600 dark:text-teal-400">
                      {tableTotals.bScn.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2.5 text-right border-r border-slate-200 dark:border-slate-700">
                      {renderVarianceCell(tableTotals.bDiff)}
                    </td>
                  </>
                )}
                {visibleMealGroups.lunch && (
                  <>
                    <td className="py-2.5 px-2.5 text-right">{tableTotals.lOrd.toLocaleString()}</td>
                    <td className="py-2.5 px-2.5 text-right text-blue-600 dark:text-blue-400">
                      {tableTotals.lCon.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2.5 text-right text-teal-600 dark:text-teal-400">
                      {tableTotals.lScn.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2.5 text-right border-r border-slate-200 dark:border-slate-700">
                      {renderVarianceCell(tableTotals.lDiff)}
                    </td>
                  </>
                )}
                {visibleMealGroups.dinner && (
                  <>
                    <td className="py-2.5 px-2.5 text-right">{tableTotals.dOrd.toLocaleString()}</td>
                    <td className="py-2.5 px-2.5 text-right text-blue-600 dark:text-blue-400">
                      {tableTotals.dCon.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2.5 text-right text-teal-600 dark:text-teal-400">
                      {tableTotals.dScn.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2.5 text-right">
                      {renderVarianceCell(tableTotals.dDiff)}
                    </td>
                  </>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600 dark:text-slate-400 no-print">
        <div className="flex items-center gap-3 font-mono tabular-nums">
          <span>
            Showing {sortedRecords.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, sortedRecords.length)} of {sortedRecords.length} records
          </span>
          <span aria-hidden="true">·</span>
          <label className="inline-flex items-center gap-1.5">
            <span>Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-800 dark:text-slate-200"
            >
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={500}>All in One Page</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <span className="font-mono tabular-nums px-2">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
