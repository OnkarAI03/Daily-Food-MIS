/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive SVG Analytics Charts & Drill-Down Visualizations for Daily Food MIS
 */

import React, { useState, useMemo } from 'react';
import { DailyReportRecord, ExecutiveKpiSummary, MealMetrics } from '../types/domain';
import {
  downloadPropertySnapshotPng,
  downloadPropertySummaryCsv,
  formatReadableDateRange,
} from '../utils/snapshotExport';
import {
  BarChart3,
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  Camera,
  Download,
  Filter,
  Layers,
  Printer,
  Search,
} from 'lucide-react';

interface AnalyticsChartsProps {
  records: DailyReportRecord[];
  kpis: ExecutiveKpiSummary;
  mealFocus: 'ALL' | 'Breakfast' | 'Lunch' | 'Dinner';
  startDate?: string;
  endDate?: string;
  onChangeMealFocus?: (meal: 'ALL' | 'Breakfast' | 'Lunch' | 'Dinner') => void;
  onOpenManagementWorkbench?: () => void;
  onSelectProperty: (propertyNormalized: string) => void;
  onSelectDateFilter: (dateStr: string) => void;
  onSelectStatusFilter: (status: DailyReportRecord['taskStatus']) => void;
  onInspectRecord: (record: DailyReportRecord) => void;
}

export const AnalyticsChartsSection: React.FC<AnalyticsChartsProps> = ({
  records,
  kpis,
  mealFocus,
  startDate,
  endDate,
  onChangeMealFocus,
  onOpenManagementWorkbench,
  onSelectProperty,
  onSelectDateFilter,
  onSelectStatusFilter,
  onInspectRecord,
}) => {
  const [localMealTab, setLocalMealTab] = useState<'ALL' | 'Breakfast' | 'Lunch' | 'Dinner'>('ALL');
  const [propSearch, setPropSearch] = useState('');
  const [propVarianceFilter, setPropVarianceFilter] = useState<
    'ALL' | 'SURPLUS' | 'DEFICIT' | 'MISSING_SCAN'
  >('ALL');
  const [propSortBy, setPropSortBy] = useState<
    'ordered_desc' | 'consumed_desc' | 'scanned_desc' | 'diff_desc' | 'diff_asc' | 'name_asc'
  >('ordered_desc');
  const [compactGridMode, setCompactGridMode] = useState<'auto' | '1col' | '2col'>('auto');

  const activePropertyMealTab = onChangeMealFocus ? mealFocus : localMealTab;

  const handleSelectMealTab = (meal: 'ALL' | 'Breakfast' | 'Lunch' | 'Dinner') => {
    setLocalMealTab(meal);
    if (onChangeMealFocus) {
      onChangeMealFocus(meal);
    }
  };
  // 1. Meal Comparison Data (Ordered vs Consumed vs Scanned — kept explicitly distinct)
  const mealGroups = useMemo(() => {
    return [
      {
        meal: 'Breakfast' as const,
        ordered: kpis.breakfast.orderedTotal,
        consumed: kpis.breakfast.consumedTotal,
        scanned: kpis.breakfast.scannedTotal,
        variance: kpis.breakfast.varianceTotal,
        missingCount: kpis.breakfast.missingOrInvalidCount,
      },
      {
        meal: 'Lunch' as const,
        ordered: kpis.lunch.orderedTotal,
        consumed: kpis.lunch.consumedTotal,
        scanned: kpis.lunch.scannedTotal,
        variance: kpis.lunch.varianceTotal,
        missingCount: kpis.lunch.missingOrInvalidCount,
      },
      {
        meal: 'Dinner' as const,
        ordered: kpis.dinner.orderedTotal,
        consumed: kpis.dinner.consumedTotal,
        scanned: kpis.dinner.scannedTotal,
        variance: kpis.dinner.varianceTotal,
        missingCount: kpis.dinner.missingOrInvalidCount,
      },
    ];
  }, [kpis]);

  const maxMealVal = useMemo(() => {
    let m = 100;
    for (const g of mealGroups) {
      m = Math.max(m, g.ordered, g.consumed, g.scanned);
    }
    return m;
  }, [mealGroups]);

  // 2. Daily Trend Aggregation by Date
  const dailyTrend = useMemo(() => {
    const byDate = new Map<
      string,
      {
        date: string;
        ordered: number;
        consumed: number;
        scanned: number;
        missingPoints: number;
        reportCount: number;
      }
    >();

    for (const r of records) {
      if (!byDate.has(r.reportingDate)) {
        byDate.set(r.reportingDate, {
          date: r.reportingDate,
          ordered: 0,
          consumed: 0,
          scanned: 0,
          missingPoints: 0,
          reportCount: 0,
        });
      }
      const bucket = byDate.get(r.reportingDate)!;
      bucket.reportCount += 1;

      const mealsToInclude: MealMetrics[] =
        mealFocus === 'Breakfast'
          ? [r.breakfast]
          : mealFocus === 'Lunch'
          ? [r.lunch]
          : mealFocus === 'Dinner'
          ? [r.dinner]
          : [r.breakfast, r.lunch, r.dinner];

      for (const m of mealsToInclude) {
        if (m.ordered.value !== null) bucket.ordered += m.ordered.value;
        else bucket.missingPoints += 1;

        if (m.consumed.value !== null) bucket.consumed += m.consumed.value;
        else bucket.missingPoints += 1;

        if (m.scanned.value !== null) bucket.scanned += m.scanned.value;
        else bucket.missingPoints += 1;
      }
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [records, mealFocus]);

  const maxDailyVal = useMemo(() => {
    let m = 50;
    for (const d of dailyTrend) {
      m = Math.max(m, d.ordered, d.consumed, d.scanned);
    }
    return m;
  }, [dailyTrend]);

  // 3. Property-Level Full Meal Breakdown (Breakfast, Lunch, Dinner: Ordered, Consumed, QR Scanned, Difference)
  const propertyFullBreakdown = useMemo(() => {
    const byProp = new Map<
      string,
      {
        propertyNormalized: string;
        propertyDisplay: string;
        reportDays: number;
        minDate: string;
        maxDate: string;
        reportingDateRange: string;
        breakfastOrdered: number;
        breakfastConsumed: number;
        breakfastScanned: number;
        breakfastDifference: number;
        lunchOrdered: number;
        lunchConsumed: number;
        lunchScanned: number;
        lunchDifference: number;
        dinnerOrdered: number;
        dinnerConsumed: number;
        dinnerScanned: number;
        dinnerDifference: number;
        totalOrdered: number;
        totalConsumed: number;
        totalScanned: number;
        totalDifference: number;
        missingCount: number;
      }
    >();

    for (const r of records) {
      if (!byProp.has(r.propertyNormalized)) {
        byProp.set(r.propertyNormalized, {
          propertyNormalized: r.propertyNormalized,
          propertyDisplay: r.propertyDisplay,
          reportDays: 0,
          minDate: r.reportingDate,
          maxDate: r.reportingDate,
          reportingDateRange: r.reportingDate,
          breakfastOrdered: 0,
          breakfastConsumed: 0,
          breakfastScanned: 0,
          breakfastDifference: 0,
          lunchOrdered: 0,
          lunchConsumed: 0,
          lunchScanned: 0,
          lunchDifference: 0,
          dinnerOrdered: 0,
          dinnerConsumed: 0,
          dinnerScanned: 0,
          dinnerDifference: 0,
          totalOrdered: 0,
          totalConsumed: 0,
          totalScanned: 0,
          totalDifference: 0,
          missingCount: 0,
        });
      }
      const p = byProp.get(r.propertyNormalized)!;
      p.reportDays += 1;
      if (r.reportingDate < p.minDate) p.minDate = r.reportingDate;
      if (r.reportingDate > p.maxDate) p.maxDate = r.reportingDate;
      p.reportingDateRange =
        p.minDate === p.maxDate ? p.minDate : `${p.minDate} to ${p.maxDate}`;

      // Breakfast
      if (r.breakfast.ordered.value !== null) p.breakfastOrdered += r.breakfast.ordered.value;
      else p.missingCount += 1;
      if (r.breakfast.consumed.value !== null) p.breakfastConsumed += r.breakfast.consumed.value;
      else p.missingCount += 1;
      if (r.breakfast.scanned.value !== null) p.breakfastScanned += r.breakfast.scanned.value;
      else p.missingCount += 1;
      if (r.breakfast.variance !== null) p.breakfastDifference += r.breakfast.variance;

      // Lunch
      if (r.lunch.ordered.value !== null) p.lunchOrdered += r.lunch.ordered.value;
      else p.missingCount += 1;
      if (r.lunch.consumed.value !== null) p.lunchConsumed += r.lunch.consumed.value;
      else p.missingCount += 1;
      if (r.lunch.scanned.value !== null) p.lunchScanned += r.lunch.scanned.value;
      else p.missingCount += 1;
      if (r.lunch.variance !== null) p.lunchDifference += r.lunch.variance;

      // Dinner
      if (r.dinner.ordered.value !== null) p.dinnerOrdered += r.dinner.ordered.value;
      else p.missingCount += 1;
      if (r.dinner.consumed.value !== null) p.dinnerConsumed += r.dinner.consumed.value;
      else p.missingCount += 1;
      if (r.dinner.scanned.value !== null) p.dinnerScanned += r.dinner.scanned.value;
      else p.missingCount += 1;
      if (r.dinner.variance !== null) p.dinnerDifference += r.dinner.variance;

      // Active meal focus totals
      const meals: MealMetrics[] =
        mealFocus === 'Breakfast'
          ? [r.breakfast]
          : mealFocus === 'Lunch'
          ? [r.lunch]
          : mealFocus === 'Dinner'
          ? [r.dinner]
          : [r.breakfast, r.lunch, r.dinner];

      for (const m of meals) {
        if (m.ordered.value !== null) p.totalOrdered += m.ordered.value;
        if (m.consumed.value !== null) p.totalConsumed += m.consumed.value;
        if (m.scanned.value !== null) p.totalScanned += m.scanned.value;
        if (m.variance !== null) p.totalDifference += m.variance;
      }
    }

    let list = Array.from(byProp.values()).filter((p) => {
      if (propSearch.trim()) {
        const q = propSearch.toLowerCase();
        if (!p.propertyDisplay.toLowerCase().includes(q)) return false;
      }
      if (propVarianceFilter === 'SURPLUS' && p.totalDifference <= 0) return false;
      if (propVarianceFilter === 'DEFICIT' && p.totalDifference >= 0) return false;
      if (propVarianceFilter === 'MISSING_SCAN' && p.totalScanned >= p.totalConsumed) return false;
      return true;
    });

    list.sort((a, b) => {
      switch (propSortBy) {
        case 'ordered_desc':
          return b.totalOrdered - a.totalOrdered;
        case 'consumed_desc':
          return b.totalConsumed - a.totalConsumed;
        case 'scanned_desc':
          return b.totalScanned - a.totalScanned;
        case 'diff_desc':
          return b.totalDifference - a.totalDifference;
        case 'diff_asc':
          return a.totalDifference - b.totalDifference;
        case 'name_asc':
          return a.propertyDisplay.localeCompare(b.propertyDisplay);
      }
    });

    return list;
  }, [records, mealFocus, propSearch, propVarianceFilter, propSortBy]);

  const maxPropMealVal = useMemo(() => {
    let m = 50;
    for (const p of propertyFullBreakdown) {
      m = Math.max(
        m,
        p.breakfastOrdered,
        p.breakfastConsumed,
        p.breakfastScanned,
        p.lunchOrdered,
        p.lunchConsumed,
        p.lunchScanned,
        p.dinnerOrdered,
        p.dinnerConsumed,
        p.dinnerScanned
      );
    }
    return m;
  }, [propertyFullBreakdown]);

  // 4. Variance Ranking & Exception Analysis (Top record-level Ordered - Consumed exceptions)
  const varianceExceptions = useMemo(() => {
    const items: {
      record: DailyReportRecord;
      mealType: 'Breakfast' | 'Lunch' | 'Dinner';
      ordered: number;
      consumed: number;
      scanned: number | null;
      variance: number;
      absVariance: number;
    }[] = [];

    for (const r of records) {
      const meals: MealMetrics[] =
        mealFocus === 'Breakfast'
          ? [r.breakfast]
          : mealFocus === 'Lunch'
          ? [r.lunch]
          : mealFocus === 'Dinner'
          ? [r.dinner]
          : [r.breakfast, r.lunch, r.dinner];

      for (const m of meals) {
        if (m.variance !== null && m.ordered.value !== null && m.consumed.value !== null) {
          items.push({
            record: r,
            mealType: m.mealType,
            ordered: m.ordered.value,
            consumed: m.consumed.value,
            scanned: m.scanned.value,
            variance: m.variance,
            absVariance: Math.abs(m.variance),
          });
        }
      }
    }

    return items.sort((a, b) => b.absVariance - a.absVariance).slice(0, 7);
  }, [records, mealFocus]);

  // 5. Task Status Distribution
  const statusDist = useMemo(() => {
    const total = Math.max(1, records.length);
    const counts = {
      Completed: records.filter((r) => r.taskStatus === 'Completed').length,
      'In Progress': records.filter((r) => r.taskStatus === 'In Progress').length,
      Pending: records.filter((r) => r.taskStatus === 'Pending').length,
      Overdue: records.filter((r) => r.taskStatus === 'Overdue').length,
    };
    return [
      { status: 'Completed' as const, count: counts.Completed, pct: Math.round((counts.Completed / total) * 100), color: 'bg-emerald-600' },
      { status: 'In Progress' as const, count: counts['In Progress'], pct: Math.round((counts['In Progress'] / total) * 100), color: 'bg-blue-600' },
      { status: 'Pending' as const, count: counts.Pending, pct: Math.round((counts.Pending / total) * 100), color: 'bg-amber-500' },
      { status: 'Overdue' as const, count: counts.Overdue, pct: Math.round((counts.Overdue / total) * 100), color: 'bg-rose-600' },
    ];
  }, [records]);

  // Resolved readable date range for header & snapshot
  const resolvedDateRangeLabel = useMemo(() => {
    if (startDate && endDate) {
      return formatReadableDateRange(startDate, endDate);
    }
    if (dailyTrend.length > 0) {
      const first = dailyTrend[0].date;
      const last = dailyTrend[dailyTrend.length - 1].date;
      return formatReadableDateRange(first, last);
    }
    return 'All Filtered Dates';
  }, [startDate, endDate, dailyTrend]);

  const useTwoColGrid =
    compactGridMode === '2col' ||
    (compactGridMode === 'auto' && propertyFullBreakdown.length > 8);

  return (
    <div className="space-y-6">
      {/* Row 1: Grouped Bar Chart (Ordered vs Consumed vs Scanned) + Daily Trend SVG Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Grouped Bar Chart: Ordered vs Consumed vs QR Scanned */}
        <div className="lg:col-span-5 glass-panel rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4 mb-1">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Ordered vs. Consumed vs. QR Scanned by Meal
              </h3>
              <span className="text-xs text-indigo-600 dark:text-indigo-400 font-mono tabular-nums font-medium">
                {resolvedDateRangeLabel}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Variance is strictly Ordered minus Consumed. QR Scanned is tracked independently from kitchen consumption.
            </p>

            {/* Legend (Zero Black — Indigo, Blue, Teal) */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-400 mb-5">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-indigo-600 inline-block" />
                Ordered (Columns AS / AU / AW)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" />
                Consumed (Columns AT / AV / AX)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-teal-500 inline-block" />
                QR Scanned (Columns E / F / G)
              </span>
            </div>

            <div className="space-y-5">
              {mealGroups.map((g) => {
                const ordPct = Math.round((g.ordered / maxMealVal) * 100);
                const conPct = Math.round((g.consumed / maxMealVal) * 100);
                const scnPct = Math.round((g.scanned / maxMealVal) * 100);
                return (
                  <div key={g.meal} className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{g.meal}</span>
                      <div className="flex items-center gap-2 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        <span>
                          Difference (Ordered − Consumed):{' '}
                          <strong className={g.variance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-700 dark:text-indigo-300'}>
                            {g.variance >= 0 ? `+${g.variance.toLocaleString()}` : g.variance.toLocaleString()}
                          </strong>
                        </span>
                        {g.missingCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-600 dark:text-amber-400">
                              {g.missingCount} Missing / Unavailable Cells
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Three grouped horizontal bars */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-28 text-[11px] text-slate-500 dark:text-slate-400">Ordered</span>
                        <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-600 transition-all duration-150 rounded-full"
                            style={{ width: `${Math.max(2, ordPct)}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-xs font-mono tabular-nums font-semibold text-indigo-700 dark:text-indigo-300">
                          {g.ordered.toLocaleString()}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="w-28 text-[11px] text-slate-500 dark:text-slate-400">Consumed</span>
                        <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 transition-all duration-150 rounded-full"
                            style={{ width: `${Math.max(2, conPct)}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-xs font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                          {g.consumed.toLocaleString()}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="w-28 text-[11px] text-slate-500 dark:text-slate-400">QR Scanned</span>
                        <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-teal-500 transition-all duration-150 rounded-full"
                            style={{ width: `${Math.max(2, scnPct)}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-xs font-mono tabular-nums font-semibold text-teal-600 dark:text-teal-400">
                          {g.scanned.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Missing or invalid cells are excluded from sums (never converted to zero)</span>
            <span className="font-mono tabular-nums">{records.length} Daily Reports</span>
          </div>
        </div>

        {/* Daily Trend Chart by Date (Click bar to filter date) */}
        <div className="lg:col-span-7 glass-panel rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4 mb-1">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Daily Meal Trend ({mealFocus === 'ALL' ? 'All Meals Combined' : mealFocus})
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Click any date bar to filter that reporting day
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Chronological daily comparison of Ordered, Consumed, and QR Scanned portions in {kpis.businessTimezone}.
            </p>

            {dailyTrend.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-md">
                No daily trend records match the active filter criteria.
              </div>
            ) : (
              <div className="h-56 flex items-end gap-2 pt-6 pb-2 px-2 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
                {dailyTrend.map((day) => {
                  const ordH = Math.max(4, Math.round((day.ordered / maxDailyVal) * 150));
                  const conH = Math.max(4, Math.round((day.consumed / maxDailyVal) * 150));
                  const scnH = Math.max(4, Math.round((day.scanned / maxDailyVal) * 150));
                  const shortDate = day.date.slice(5); // MM-DD
                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => onSelectDateFilter(day.date)}
                      title={`${day.date} — Ordered: ${day.ordered.toLocaleString()} | Consumed: ${day.consumed.toLocaleString()} | QR Scanned: ${day.scanned.toLocaleString()} | Difference (Ordered − Consumed): ${(day.ordered - day.consumed).toLocaleString()}`}
                      className="group flex-1 min-w-[42px] flex flex-col items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-xs py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                    >
                      <div className="flex items-end gap-0.5 h-[155px]">
                        <div
                          style={{ height: `${ordH}px` }}
                          className="w-2.5 bg-indigo-600 rounded-t-xs transition-all"
                        />
                        <div
                          style={{ height: `${conH}px` }}
                          className="w-2.5 bg-blue-600 rounded-t-xs transition-all"
                        />
                        <div
                          style={{ height: `${scnH}px` }}
                          className="w-2.5 bg-teal-500 rounded-t-xs transition-all"
                        />
                      </div>
                      <span className="mt-2 text-[10px] font-mono tabular-nums text-slate-600 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        {shortDate}
                      </span>
                      {day.missingPoints > 0 && (
                        <span
                          className="text-[9px] font-mono text-amber-600 dark:text-amber-400"
                          title={`${day.missingPoints} missing or unavailable data points on ${day.date}`}
                        >
                          {day.missingPoints} Missing
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Any date showing <strong className="font-mono text-amber-600 dark:text-amber-400">Missing</strong> indicates blank or unrecorded cells preserved without zero-coercion.
            </span>
            <span className="font-mono tabular-nums">{dailyTrend.length} Reporting Days</span>
          </div>
        </div>
      </div>

      {/* Row 2: Unified Single-Page Property-Wise Meal Operations Chart & Full Report (Breakfast, Lunch & Dinner) */}
      <div className="glass-panel rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/70 dark:border-slate-800/70 pb-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-600" />
                Property-Wise Meal Operations Chart &amp; Full Report (Breakfast, Lunch &amp; Dinner)
              </h3>
              {/* Explicit Reporting Date Badge */}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-xs font-mono font-semibold text-blue-700 dark:text-blue-300">
                <Calendar className="w-3.5 h-3.5" />
                Reporting Date: {resolvedDateRangeLabel}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Complete property-by-property breakdown showing <strong>Ordered</strong>, <strong>Consumed</strong>, <strong>QR Scanned</strong>, and <strong>Difference (Ordered minus Consumed)</strong> for Breakfast, Lunch, and Dinner on a single page. Click any property to open its full historical profile.
            </p>
          </div>

          {/* Snapshot Download, CSV Download & Open 2-Graph Management Report Actions */}
          <div className="flex flex-wrap items-center gap-2 no-print">
            <button
              type="button"
              onClick={() =>
                downloadPropertySnapshotPng({
                  title: 'Property-Wise Meal Operations Chart & Full Report',
                  subtitle:
                    'Complete property-by-property breakdown showing Ordered, Consumed, QR Scanned, and Difference (Ordered minus Consumed)',
                  mealFilterLabel:
                    activePropertyMealTab === 'ALL'
                      ? 'All Meals (Breakfast, Lunch & Dinner)'
                      : activePropertyMealTab,
                  dateRangeLabel: resolvedDateRangeLabel,
                  rows: propertyFullBreakdown,
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              Download Snapshot (PNG)
            </button>

            <button
              type="button"
              onClick={() => downloadPropertySummaryCsv(propertyFullBreakdown)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-subtle hover:bg-white/90 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-medium transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-blue-600" />
              Export Property CSV
            </button>

            {onOpenManagementWorkbench && (
              <button
                type="button"
                onClick={onOpenManagementWorkbench}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-subtle hover:border-blue-500 text-blue-700 dark:text-blue-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" />
                Open 2-Graph Management Report →
              </button>
            )}
          </div>
        </div>

        {/* Inline Property-Wise Filter, Grid Density Toggle & Meal Selection Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 no-print">
          {/* Interactive Meal Selector */}
          <div className="flex items-center gap-1 p-1 glass-subtle rounded-lg" role="group" aria-label="Select Meal View">
            {(
              [
                { id: 'ALL', label: 'All Meals (Breakfast, Lunch & Dinner)' },
                { id: 'Breakfast', label: 'Breakfast' },
                { id: 'Lunch', label: 'Lunch' },
                { id: 'Dinner', label: 'Dinner' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelectMealTab(m.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activePropertyMealTab === m.id
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Inline Property Search, Difference Filter, Sort Order & 20-Property Grid Layout Toggle */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="relative w-44">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={propSearch}
                onChange={(e) => setPropSearch(e.target.value)}
                placeholder="Filter property name..."
                className="w-full pl-8 pr-2.5 py-1.5 glass-subtle rounded-lg text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <select
              value={propVarianceFilter}
              onChange={(e) => setPropVarianceFilter(e.target.value as any)}
              aria-label="Filter properties by difference"
              className="px-2.5 py-1.5 glass-subtle rounded-lg text-xs text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">All Property Variances</option>
              <option value="SURPLUS">Positive Difference (Ordered &gt; Consumed)</option>
              <option value="DEFICIT">Negative Difference (Consumed &gt; Ordered)</option>
              <option value="MISSING_SCAN">Unscanned Gap (Consumed &gt; QR Scanned)</option>
            </select>

            <select
              value={propSortBy}
              onChange={(e) => setPropSortBy(e.target.value as any)}
              aria-label="Sort properties by metric"
              className="px-2.5 py-1.5 glass-subtle rounded-lg text-xs text-slate-800 dark:text-slate-200"
            >
              <option value="ordered_desc">Sort: Highest Ordered</option>
              <option value="consumed_desc">Sort: Highest Consumed</option>
              <option value="scanned_desc">Sort: Highest QR Scanned</option>
              <option value="diff_desc">Sort: Highest + Difference</option>
              <option value="diff_asc">Sort: Highest − Difference</option>
              <option value="name_asc">Sort: Property Name (A–Z)</option>
            </select>

            <select
              value={compactGridMode}
              onChange={(e) => setCompactGridMode(e.target.value as any)}
              aria-label="Card Grid Density"
              className="px-2.5 py-1.5 glass-subtle rounded-lg text-xs font-medium text-blue-700 dark:text-blue-300"
            >
              <option value="auto">Layout: Auto (2-Col for 9+ Properties)</option>
              <option value="1col">Layout: Full-Width Cards (1 per Row)</option>
              <option value="2col">Layout: Compact 2-Col Grid (20+ Properties)</option>
            </select>

            {/* Legend (Zero Black: Indigo, Blue, Teal) */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400 pl-2 border-l border-slate-200 dark:border-slate-700">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-indigo-600 inline-block" />
                Ordered
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" />
                Consumed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-teal-500 inline-block" />
                QR Scanned
              </span>
            </div>
          </div>
        </div>

        {/* All Properties Unified Visual Comparison Chart on One Page */}
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white/60 dark:bg-slate-900/50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/70 dark:border-slate-800/70 text-xs">
            <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              All Properties Single-Page Visual Comparison —{' '}
              {activePropertyMealTab === 'ALL'
                ? 'Breakfast, Lunch & Dinner Side-by-Side'
                : `${activePropertyMealTab} Operations (Ordered vs. Consumed vs. QR Scanned & Difference)`}
            </span>
            <div className="flex items-center gap-3 font-mono text-slate-600 dark:text-slate-300">
              <span>Date: {resolvedDateRangeLabel}</span>
              <span>·</span>
              <span>Showing all {propertyFullBreakdown.length} properties on one page</span>
            </div>
          </div>

          {propertyFullBreakdown.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No properties match the active filter criteria.
            </div>
          ) : (
            <div
              className={
                useTwoColGrid
                  ? 'grid grid-cols-1 2xl:grid-cols-2 gap-3.5'
                  : 'space-y-3'
              }
            >
              {propertyFullBreakdown.map((prop) => {
                const allMeals = [
                  {
                    title: 'Breakfast' as const,
                    ordered: prop.breakfastOrdered,
                    consumed: prop.breakfastConsumed,
                    scanned: prop.breakfastScanned,
                    difference: prop.breakfastDifference,
                  },
                  {
                    title: 'Lunch' as const,
                    ordered: prop.lunchOrdered,
                    consumed: prop.lunchConsumed,
                    scanned: prop.lunchScanned,
                    difference: prop.lunchDifference,
                  },
                  {
                    title: 'Dinner' as const,
                    ordered: prop.dinnerOrdered,
                    consumed: prop.dinnerConsumed,
                    scanned: prop.dinnerScanned,
                    difference: prop.dinnerDifference,
                  },
                ];

                const visibleSlices =
                  activePropertyMealTab === 'ALL'
                    ? allMeals
                    : allMeals.filter((m) => m.title === activePropertyMealTab);

                return (
                  <div
                    key={prop.propertyNormalized}
                    onClick={() => onSelectProperty(prop.propertyNormalized)}
                    className="p-4 rounded-xl bg-white/95 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800/80 hover:border-blue-500 dark:hover:border-blue-400 shadow-2xs transition-all cursor-pointer group"
                  >
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
                      {/* Left Column: Property Identity, Reporting Date & Clean 2x2 Summary KPI Grid */}
                      <div className="xl:col-span-3 flex flex-col justify-between pr-0 xl:pr-3 xl:border-r border-slate-200/70 dark:border-slate-800/70 space-y-2.5">
                        <div>
                          <div className="text-sm font-bold text-indigo-950 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 inline-flex items-center gap-1.5 leading-snug">
                            <span>{prop.propertyDisplay}</span>
                            <ArrowUpRight className="w-3.5 h-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 font-mono mt-1">
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold">
                              Date: {prop.reportingDateRange}
                            </span>
                            <span>
                              ({prop.reportDays} {prop.reportDays === 1 ? 'Day' : 'Days'})
                            </span>
                          </div>
                        </div>

                        {/* Structured 2x2 Totals Grid (Zero Black — Indigo, Blue, Teal, Emerald/Rose) */}
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                          <div className="bg-indigo-50/70 dark:bg-indigo-950/30 rounded-lg px-2.5 py-1.5 border border-indigo-100 dark:border-indigo-900/50">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                              Ordered
                            </div>
                            <div className="font-mono tabular-nums font-bold text-indigo-900 dark:text-indigo-200 text-sm">
                              {prop.totalOrdered.toLocaleString()}
                            </div>
                          </div>

                          <div className="bg-blue-50/70 dark:bg-blue-950/30 rounded-lg px-2.5 py-1.5 border border-blue-100 dark:border-blue-900/50">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                              Consumed
                            </div>
                            <div className="font-mono tabular-nums font-bold text-blue-700 dark:text-blue-300 text-sm">
                              {prop.totalConsumed.toLocaleString()}
                            </div>
                          </div>

                          <div className="bg-teal-50/70 dark:bg-teal-950/30 rounded-lg px-2.5 py-1.5 border border-teal-100 dark:border-teal-900/50">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                              QR Scanned
                            </div>
                            <div className="font-mono tabular-nums font-bold text-teal-700 dark:text-teal-300 text-sm">
                              {prop.totalScanned.toLocaleString()}
                            </div>
                          </div>

                          <div
                            className={`rounded-lg px-2.5 py-1.5 border ${
                              prop.totalDifference < 0
                                ? 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/50'
                                : 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50'
                            }`}
                          >
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                              Difference
                            </div>
                            <div
                              className={`font-mono tabular-nums font-bold text-sm ${
                                prop.totalDifference < 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {prop.totalDifference >= 0
                                ? `+${prop.totalDifference.toLocaleString()}`
                                : prop.totalDifference.toLocaleString()}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Visual Bars for Selected Meal(s) */}
                      <div
                        className={`xl:col-span-9 grid gap-3 ${
                          visibleSlices.length === 1
                            ? 'grid-cols-1'
                            : 'grid-cols-1 md:grid-cols-3'
                        }`}
                      >
                        {visibleSlices.map((ms) => {
                          const ordW = Math.round((ms.ordered / maxPropMealVal) * 100);
                          const conW = Math.round((ms.consumed / maxPropMealVal) * 100);
                          const scnW = Math.round((ms.scanned / maxPropMealVal) * 100);

                          return (
                            <div
                              key={ms.title}
                              className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/70 flex flex-col justify-between space-y-2.5"
                            >
                              {/* Clean Single-Line Header — No Colliding Text */}
                              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/70 dark:border-slate-700/70">
                                <span className="text-xs font-bold text-indigo-950 dark:text-white tracking-tight">
                                  {ms.title}
                                </span>
                                <span
                                  title="Difference = Ordered minus Consumed"
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono tabular-nums text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                                    ms.difference < 0
                                      ? 'bg-rose-100/90 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                      : 'bg-indigo-100/80 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200'
                                  }`}
                                >
                                  <span>Difference:</span>
                                  <strong>
                                    {ms.difference >= 0
                                      ? `+${ms.difference.toLocaleString()}`
                                      : ms.difference.toLocaleString()}
                                  </strong>
                                </span>
                              </div>

                              {/* Clean 3-Bar Visual Stack (Indigo, Blue, Teal — Zero Black) */}
                              <div className="space-y-2">
                                <div className="grid grid-cols-12 items-center gap-2 text-xs">
                                  <span className="col-span-4 text-[11px] font-medium text-slate-600 dark:text-slate-400 truncate">
                                    Ordered
                                  </span>
                                  <div className="col-span-5 h-2 bg-slate-200/80 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-indigo-600 rounded-full"
                                      style={{ width: `${Math.max(4, ordW)}%` }}
                                    />
                                  </div>
                                  <span className="col-span-3 text-right font-mono tabular-nums font-semibold text-indigo-800 dark:text-indigo-200">
                                    {ms.ordered.toLocaleString()}
                                  </span>
                                </div>

                                <div className="grid grid-cols-12 items-center gap-2 text-xs">
                                  <span className="col-span-4 text-[11px] font-medium text-slate-600 dark:text-slate-400 truncate">
                                    Consumed
                                  </span>
                                  <div className="col-span-5 h-2 bg-slate-200/80 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-600 rounded-full"
                                      style={{ width: `${Math.max(4, conW)}%` }}
                                    />
                                  </div>
                                  <span className="col-span-3 text-right font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                                    {ms.consumed.toLocaleString()}
                                  </span>
                                </div>

                                <div className="grid grid-cols-12 items-center gap-2 text-xs">
                                  <span className="col-span-4 text-[11px] font-medium text-slate-600 dark:text-slate-400 truncate">
                                    QR Scanned
                                  </span>
                                  <div className="col-span-5 h-2 bg-slate-200/80 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-teal-500 rounded-full"
                                      style={{ width: `${Math.max(4, scnW)}%` }}
                                    />
                                  </div>
                                  <span className="col-span-3 text-right font-mono tabular-nums font-semibold text-teal-600 dark:text-teal-400">
                                    {ms.scanned.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Full Property-Wise Consolidated Summary Table (All Properties in One Page + Dynamic Meal Columns) */}
        <div className="pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Property-Wise Consolidated Meal Summary Table (
              {activePropertyMealTab === 'ALL'
                ? 'All Meals: Breakfast, Lunch & Dinner'
                : `${activePropertyMealTab} Only`}
              )
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              All {propertyFullBreakdown.length} properties displayed on one page
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-slate-800/80">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/70 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  <th className="py-2.5 px-3 whitespace-nowrap border-r border-slate-200 dark:border-slate-800">
                    Property Name
                  </th>
                  {(activePropertyMealTab === 'ALL' || activePropertyMealTab === 'Breakfast') && (
                    <>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Breakfast Ordered</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Breakfast Consumed</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Breakfast QR Scanned</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap border-r border-slate-200 dark:border-slate-800 bg-slate-200/40 dark:bg-slate-800">
                        Breakfast Difference (Ordered − Consumed)
                      </th>
                    </>
                  )}
                  {(activePropertyMealTab === 'ALL' || activePropertyMealTab === 'Lunch') && (
                    <>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Lunch Ordered</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Lunch Consumed</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Lunch QR Scanned</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap border-r border-slate-200 dark:border-slate-800 bg-slate-200/40 dark:bg-slate-800">
                        Lunch Difference (Ordered − Consumed)
                      </th>
                    </>
                  )}
                  {(activePropertyMealTab === 'ALL' || activePropertyMealTab === 'Dinner') && (
                    <>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Dinner Ordered</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Dinner Consumed</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Dinner QR Scanned</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap bg-slate-200/40 dark:bg-slate-800">
                        Dinner Difference (Ordered − Consumed)
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                {propertyFullBreakdown.map((p) => (
                  <tr
                    key={p.propertyNormalized}
                    onClick={() => onSelectProperty(p.propertyNormalized)}
                    className="hover:bg-white/80 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap border-r border-slate-100 dark:border-slate-800">
                      {p.propertyDisplay}
                    </td>
                    {(activePropertyMealTab === 'ALL' || activePropertyMealTab === 'Breakfast') && (
                      <>
                        <td className="py-2 px-2.5 text-right">{p.breakfastOrdered.toLocaleString()}</td>
                        <td className="py-2 px-2.5 text-right text-blue-600 dark:text-blue-400">
                          {p.breakfastConsumed.toLocaleString()}
                        </td>
                        <td className="py-2 px-2.5 text-right text-teal-600 dark:text-teal-400">
                          {p.breakfastScanned.toLocaleString()}
                        </td>
                        <td
                          className={`py-2 px-2.5 text-right font-semibold border-r border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 ${
                            p.breakfastDifference < 0 ? 'text-rose-600 dark:text-rose-400' : ''
                          }`}
                        >
                          {p.breakfastDifference >= 0
                            ? `+${p.breakfastDifference.toLocaleString()}`
                            : p.breakfastDifference.toLocaleString()}
                        </td>
                      </>
                    )}

                    {(activePropertyMealTab === 'ALL' || activePropertyMealTab === 'Lunch') && (
                      <>
                        <td className="py-2 px-2.5 text-right">{p.lunchOrdered.toLocaleString()}</td>
                        <td className="py-2 px-2.5 text-right text-blue-600 dark:text-blue-400">
                          {p.lunchConsumed.toLocaleString()}
                        </td>
                        <td className="py-2 px-2.5 text-right text-teal-600 dark:text-teal-400">
                          {p.lunchScanned.toLocaleString()}
                        </td>
                        <td
                          className={`py-2 px-2.5 text-right font-semibold border-r border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 ${
                            p.lunchDifference < 0 ? 'text-rose-600 dark:text-rose-400' : ''
                          }`}
                        >
                          {p.lunchDifference >= 0
                            ? `+${p.lunchDifference.toLocaleString()}`
                            : p.lunchDifference.toLocaleString()}
                        </td>
                      </>
                    )}

                    {(activePropertyMealTab === 'ALL' || activePropertyMealTab === 'Dinner') && (
                      <>
                        <td className="py-2 px-2.5 text-right">{p.dinnerOrdered.toLocaleString()}</td>
                        <td className="py-2 px-2.5 text-right text-blue-600 dark:text-blue-400">
                          {p.dinnerConsumed.toLocaleString()}
                        </td>
                        <td className="py-2 px-2.5 text-right text-teal-600 dark:text-teal-400">
                          {p.dinnerScanned.toLocaleString()}
                        </td>
                        <td
                          className={`py-2 px-2.5 text-right font-semibold bg-slate-50/50 dark:bg-slate-800/30 ${
                            p.dinnerDifference < 0 ? 'text-rose-600 dark:text-rose-400' : ''
                          }`}
                        >
                          {p.dinnerDifference >= 0
                            ? `+${p.dinnerDifference.toLocaleString()}`
                            : p.dinnerDifference.toLocaleString()}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              {propertyFullBreakdown.length > 0 && (
                <tfoot className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/80 text-xs font-mono tabular-nums font-semibold">
                  <tr>
                    <td className="py-2.5 px-3 font-sans text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-700">
                      Grand Total ({propertyFullBreakdown.length} Properties)
                    </td>
                    {(activePropertyMealTab === 'ALL' || activePropertyMealTab === 'Breakfast') && (
                      <>
                        <td className="py-2.5 px-2.5 text-right">
                          {kpis.breakfast.orderedTotal.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2.5 text-right text-blue-600 dark:text-blue-400">
                          {kpis.breakfast.consumedTotal.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2.5 text-right text-teal-600 dark:text-teal-400">
                          {kpis.breakfast.scannedTotal.toLocaleString()}
                        </td>
                        <td
                          className={`py-2.5 px-2.5 text-right border-r border-slate-200 dark:border-slate-700 ${
                            kpis.breakfast.varianceTotal < 0 ? 'text-rose-600 dark:text-rose-400' : ''
                          }`}
                        >
                          {kpis.breakfast.varianceTotal >= 0
                            ? `+${kpis.breakfast.varianceTotal.toLocaleString()}`
                            : kpis.breakfast.varianceTotal.toLocaleString()}
                        </td>
                      </>
                    )}
                    {(activePropertyMealTab === 'ALL' || activePropertyMealTab === 'Lunch') && (
                      <>
                        <td className="py-2.5 px-2.5 text-right">
                          {kpis.lunch.orderedTotal.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2.5 text-right text-blue-600 dark:text-blue-400">
                          {kpis.lunch.consumedTotal.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2.5 text-right text-teal-600 dark:text-teal-400">
                          {kpis.lunch.scannedTotal.toLocaleString()}
                        </td>
                        <td
                          className={`py-2.5 px-2.5 text-right border-r border-slate-200 dark:border-slate-700 ${
                            kpis.lunch.varianceTotal < 0 ? 'text-rose-600 dark:text-rose-400' : ''
                          }`}
                        >
                          {kpis.lunch.varianceTotal >= 0
                            ? `+${kpis.lunch.varianceTotal.toLocaleString()}`
                            : kpis.lunch.varianceTotal.toLocaleString()}
                        </td>
                      </>
                    )}
                    {(activePropertyMealTab === 'ALL' || activePropertyMealTab === 'Dinner') && (
                      <>
                        <td className="py-2.5 px-2.5 text-right">
                          {kpis.dinner.orderedTotal.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2.5 text-right text-blue-600 dark:text-blue-400">
                          {kpis.dinner.consumedTotal.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2.5 text-right text-teal-600 dark:text-teal-400">
                          {kpis.dinner.scannedTotal.toLocaleString()}
                        </td>
                        <td
                          className={`py-2.5 px-2.5 text-right ${
                            kpis.dinner.varianceTotal < 0 ? 'text-rose-600 dark:text-rose-400' : ''
                          }`}
                        >
                          {kpis.dinner.varianceTotal >= 0
                            ? `+${kpis.dinner.varianceTotal.toLocaleString()}`
                            : kpis.dinner.varianceTotal.toLocaleString()}
                        </td>
                      </>
                    )}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      {/* Row 3: Task Status Distribution & Top Variance Exceptions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Task Status Distribution */}
        <div className="lg:col-span-5 glass-panel rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Daily Operations Report Status Distribution
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Click any status to filter records
            </span>
          </div>

          <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-xs overflow-hidden flex mb-4">
            {statusDist.map((s) =>
              s.count > 0 ? (
                <div
                  key={s.status}
                  style={{ width: `${Math.max(3, s.pct)}%` }}
                  className={`${s.color} h-full`}
                  title={`${s.status}: ${s.count} reports (${s.pct}%)`}
                />
              ) : null
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {statusDist.map((s) => (
              <button
                key={s.status}
                type="button"
                onClick={() => onSelectStatusFilter(s.status)}
                className="flex items-center justify-between p-2.5 rounded-md border border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 transition-colors text-left"
              >
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {s.status}
                </span>
                <span className="text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {s.count} ({s.pct}%)
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Variance Ranking & Exception Analysis */}
        <div className="lg:col-span-7 glass-panel rounded-xl p-5 flex-1">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Largest Meal Difference Exceptions (Ordered minus Consumed)
            </h3>
            <span className="text-xs font-mono text-slate-500">Click row to inspect record</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Records with the highest difference between Ordered and Consumed portions, alongside QR Scanned counts.
          </p>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {varianceExceptions.map((ex, idx) => (
              <button
                key={`${ex.record.id}-${ex.mealType}-${idx}`}
                type="button"
                onClick={() => onInspectRecord(ex.record)}
                className="w-full py-2 flex flex-wrap items-center justify-between gap-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 px-2 rounded-xs transition-colors text-left"
              >
                <div className="truncate pr-2">
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {ex.record.propertyDisplay}
                  </span>
                  <span className="text-slate-400 mx-1.5" aria-hidden="true">·</span>
                  <span className="font-mono text-slate-500">{ex.record.reportingDate}</span>
                  <span className="text-slate-400 mx-1.5" aria-hidden="true">·</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{ex.mealType}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                  <span className="text-slate-600 dark:text-slate-400">
                    Ordered: <strong>{ex.ordered}</strong>
                  </span>
                  <span className="text-blue-600 dark:text-blue-400">
                    Consumed: <strong>{ex.consumed}</strong>
                  </span>
                  <span className="text-teal-600 dark:text-teal-400">
                    QR Scanned: <strong>{ex.scanned !== null ? ex.scanned : 'No Scan'}</strong>
                  </span>
                  <span
                    className={`font-semibold ${
                      ex.variance < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    Difference: {ex.variance >= 0 ? `+${ex.variance}` : ex.variance}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
