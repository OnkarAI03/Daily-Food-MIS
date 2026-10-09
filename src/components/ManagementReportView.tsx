/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dedicated Management Report & Dual-Chart Workbench Page
 * Built specifically for Executive & Operations Management:
 * - Every possible operational filter tailored to the Task Raw + Scanning Google Sheet
 * - Selectable 2 Side-by-Side Graph/Table Workbench (Compare any 2 visualizations or tables simultaneously)
 * - One-click PNG Snapshot Download, CSV Summary Export, and Print Executive Report
 * - Smart Management Insights & Actionable Operational Recommendations computed from the sheet
 */

import React, { useState, useMemo } from 'react';
import {
  DailyReportRecord,
  ExecutiveKpiSummary,
  MealMetrics,
  PropertyEntity,
} from '../types/domain';
import {
  downloadPropertySnapshotPng,
  downloadPropertySummaryCsv,
  PropertySnapshotRow,
} from '../utils/snapshotExport';
import {
  ArrowUpDown,
  ArrowUpRight,
  BarChart3,
  Building2,
  Camera,
  CheckCircle2,
  Download,
  Filter,
  Flame,
  Layers,
  Printer,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

interface ManagementReportViewProps {
  records: DailyReportRecord[];
  properties: PropertyEntity[];
  kpis: ExecutiveKpiSummary;
  dateRangeLabel: string;
  onSelectProperty: (propertyNormalized: string) => void;
  onInspectRecord: (record: DailyReportRecord) => void;
}

type WorkbenchModuleId =
  | 'property_meal_bars'
  | 'property_summary_table'
  | 'daily_chronological_trend'
  | 'qr_vs_consumed_gap'
  | 'day_of_week_matrix'
  | 'variance_leaderboard'
  | 'utilization_efficiency'
  | 'daily_full_ledger';

const WORKBENCH_MODULES: { id: WorkbenchModuleId; label: string; category: 'Graph' | 'Table' }[] = [
  {
    id: 'property_meal_bars',
    label: 'Graph 1: Property-Wise Ordered vs. Consumed vs. QR Scanned Bar Chart',
    category: 'Graph',
  },
  {
    id: 'property_summary_table',
    label: 'Table 1: Property-Wise Consolidated Meal Summary Table (Breakfast, Lunch & Dinner)',
    category: 'Table',
  },
  {
    id: 'qr_vs_consumed_gap',
    label: 'Graph 2: QR Scanned vs. Kitchen Consumed Compliance & Gap Analysis',
    category: 'Graph',
  },
  {
    id: 'utilization_efficiency',
    label: 'Graph 3: Property Consumption Efficiency (Consumed ÷ Ordered %) & Wastage',
    category: 'Graph',
  },
  {
    id: 'daily_chronological_trend',
    label: 'Graph 4: Daily Chronological Ordered, Consumed & QR Scanned Trend',
    category: 'Graph',
  },
  {
    id: 'day_of_week_matrix',
    label: 'Table 2: Day-of-Week (Monday–Sunday) Meal Demand & QR Scan Matrix',
    category: 'Table',
  },
  {
    id: 'variance_leaderboard',
    label: 'Table 3: Top Property & Date Difference (Ordered − Consumed) Leaderboard',
    category: 'Table',
  },
  {
    id: 'daily_full_ledger',
    label: 'Table 4: Date-by-Date Property Operations Full Ledger',
    category: 'Table',
  },
];

const DAYS_OF_WEEK = [
  { idx: 1, short: 'Mon', full: 'Monday' },
  { idx: 2, short: 'Tue', full: 'Tuesday' },
  { idx: 3, short: 'Wed', full: 'Wednesday' },
  { idx: 4, short: 'Thu', full: 'Thursday' },
  { idx: 5, short: 'Fri', full: 'Friday' },
  { idx: 6, short: 'Sat', full: 'Saturday' },
  { idx: 0, short: 'Sun', full: 'Sunday' },
];

export const ManagementReportView: React.FC<ManagementReportViewProps> = ({
  records,
  properties,
  kpis,
  dateRangeLabel,
  onSelectProperty,
  onInspectRecord,
}) => {
  // ============================================================================
  // COMPREHENSIVE MANAGEMENT FILTER STATE (Every Possible Sheet Dimension)
  // ============================================================================
  const [selectedMeal, setSelectedMeal] = useState<'ALL' | 'Breakfast' | 'Lunch' | 'Dinner'>('ALL');
  const [selectedProperties, setSelectedProperties] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<DailyReportRecord['taskStatus'][]>([]);
  const [selectedDaysOfWeek, setSelectedDaysOfWeek] = useState<number[]>([]);
  const [varianceDirection, setVarianceDirection] = useState<
    'ALL' | 'POSITIVE_UNCONSUMED' | 'NEGATIVE_OVERCONSUMED' | 'ZERO_EXACT'
  >('ALL');
  const [scanCoverageFilter, setScanCoverageFilter] = useState<
    'ALL' | 'COMPLETE_SCANS' | 'MISSING_SCANS' | 'SCAN_EXCEEDS_CONSUMED'
  >('ALL');
  const [dataHealthFilter, setDataHealthFilter] = useState<
    'ALL' | 'CLEAN_ONLY' | 'WITH_WARNINGS_ONLY'
  >('ALL');
  const [utilizationBand, setUtilizationBand] = useState<
    'ALL' | 'UNDER_80' | 'OPTIMAL_80_100' | 'OVER_100'
  >('ALL');
  const [minOrderedThreshold, setMinOrderedThreshold] = useState<number>(0);
  const [minAbsDifference, setMinAbsDifference] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [propertySortBy, setPropertySortBy] = useState<
    'ordered_desc' | 'consumed_desc' | 'scanned_desc' | 'diff_desc' | 'diff_asc' | 'name_asc'
  >('ordered_desc');

  // Dual 2-Slot Graph / Table Workbench Selection
  const [leftSlotModule, setLeftSlotModule] = useState<WorkbenchModuleId>('property_meal_bars');
  const [rightSlotModule, setRightSlotModule] = useState<WorkbenchModuleId>('property_summary_table');
  const [layoutMode, setLayoutMode] = useState<'side_by_side' | 'stacked_full'>('side_by_side');
  const [showPropertyPicker, setShowPropertyPicker] = useState(false);

  const resetManagementFilters = () => {
    setSelectedMeal('ALL');
    setSelectedProperties([]);
    setSelectedStatuses([]);
    setSelectedDaysOfWeek([]);
    setVarianceDirection('ALL');
    setScanCoverageFilter('ALL');
    setDataHealthFilter('ALL');
    setUtilizationBand('ALL');
    setMinOrderedThreshold(0);
    setMinAbsDifference(0);
    setSearchQuery('');
    setPropertySortBy('ordered_desc');
  };

  // Helper to get active meal metrics for a record
  const getRecordMealTotals = (r: DailyReportRecord) => {
    const meals: MealMetrics[] =
      selectedMeal === 'Breakfast'
        ? [r.breakfast]
        : selectedMeal === 'Lunch'
        ? [r.lunch]
        : selectedMeal === 'Dinner'
        ? [r.dinner]
        : [r.breakfast, r.lunch, r.dinner];

    let ord = 0;
    let con = 0;
    let scn = 0;
    let diff = 0;
    let hasMissingScan = false;

    for (const m of meals) {
      if (m.ordered.value !== null) ord += m.ordered.value;
      if (m.consumed.value !== null) con += m.consumed.value;
      if (m.scanned.value !== null) scn += m.scanned.value;
      else hasMissingScan = true;
      if (m.variance !== null) diff += m.variance;
    }

    const utilPct = ord > 0 ? Math.round((con / ord) * 100) : 100;
    return { ord, con, scn, diff, hasMissingScan, utilPct };
  };

  // Filtered Records applying every management filter
  const mgmtFilteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (selectedProperties.length > 0 && !selectedProperties.includes(r.propertyNormalized)) {
        return false;
      }
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(r.taskStatus)) {
        return false;
      }
      if (selectedDaysOfWeek.length > 0) {
        const dt = new Date(`${r.reportingDate}T00:00:00Z`);
        const dow = dt.getUTCDay();
        if (!selectedDaysOfWeek.includes(dow)) return false;
      }
      if (dataHealthFilter === 'CLEAN_ONLY' && r.findingsCount > 0) return false;
      if (dataHealthFilter === 'WITH_WARNINGS_ONLY' && r.findingsCount === 0) return false;

      const totals = getRecordMealTotals(r);

      if (varianceDirection === 'POSITIVE_UNCONSUMED' && totals.diff <= 0) return false;
      if (varianceDirection === 'NEGATIVE_OVERCONSUMED' && totals.diff >= 0) return false;
      if (varianceDirection === 'ZERO_EXACT' && totals.diff !== 0) return false;

      if (scanCoverageFilter === 'COMPLETE_SCANS' && totals.hasMissingScan) return false;
      if (scanCoverageFilter === 'MISSING_SCANS' && !totals.hasMissingScan) return false;
      if (scanCoverageFilter === 'SCAN_EXCEEDS_CONSUMED' && totals.scn <= totals.con) return false;

      if (utilizationBand === 'UNDER_80' && totals.utilPct >= 80) return false;
      if (utilizationBand === 'OPTIMAL_80_100' && (totals.utilPct < 80 || totals.utilPct > 100)) {
        return false;
      }
      if (utilizationBand === 'OVER_100' && totals.utilPct <= 100) return false;

      if (minOrderedThreshold > 0 && totals.ord < minOrderedThreshold) return false;
      if (minAbsDifference > 0 && Math.abs(totals.diff) < minAbsDifference) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          r.propertyDisplay.toLowerCase().includes(q) ||
          r.reportingDate.includes(q) ||
          r.taskStatus.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [
    records,
    selectedMeal,
    selectedProperties,
    selectedStatuses,
    selectedDaysOfWeek,
    dataHealthFilter,
    varianceDirection,
    scanCoverageFilter,
    utilizationBand,
    minOrderedThreshold,
    minAbsDifference,
    searchQuery,
  ]);

  // Property-Level Aggregated Rows
  const propertyRows = useMemo(() => {
    const map = new Map<
      string,
      PropertySnapshotRow & {
        propertyNormalized: string;
        minDate: string;
        maxDate: string;
        completedReports: number;
        overdueReports: number;
        findingsCount: number;
        consumptionRatePct: number;
        qrCaptureRatePct: number;
        qrVsConsumedGap: number;
      }
    >();

    for (const r of mgmtFilteredRecords) {
      if (!map.has(r.propertyNormalized)) {
        map.set(r.propertyNormalized, {
          propertyNormalized: r.propertyNormalized,
          propertyDisplay: r.propertyDisplay,
          reportDays: 0,
          minDate: r.reportingDate,
          maxDate: r.reportingDate,
          reportingDateRange: '',
          completedReports: 0,
          overdueReports: 0,
          findingsCount: 0,
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
          consumptionRatePct: 0,
          qrCaptureRatePct: 0,
          qrVsConsumedGap: 0,
        });
      }
      const p = map.get(r.propertyNormalized)!;
      p.reportDays += 1;
      if (r.reportingDate < p.minDate) p.minDate = r.reportingDate;
      if (r.reportingDate > p.maxDate) p.maxDate = r.reportingDate;
      if (r.taskStatus === 'Completed') p.completedReports += 1;
      if (r.taskStatus === 'Overdue') p.overdueReports += 1;
      p.findingsCount += r.findingsCount;

      if (r.breakfast.ordered.value !== null) p.breakfastOrdered += r.breakfast.ordered.value;
      if (r.breakfast.consumed.value !== null) p.breakfastConsumed += r.breakfast.consumed.value;
      if (r.breakfast.scanned.value !== null) p.breakfastScanned += r.breakfast.scanned.value;
      if (r.breakfast.variance !== null) p.breakfastDifference += r.breakfast.variance;

      if (r.lunch.ordered.value !== null) p.lunchOrdered += r.lunch.ordered.value;
      if (r.lunch.consumed.value !== null) p.lunchConsumed += r.lunch.consumed.value;
      if (r.lunch.scanned.value !== null) p.lunchScanned += r.lunch.scanned.value;
      if (r.lunch.variance !== null) p.lunchDifference += r.lunch.variance;

      if (r.dinner.ordered.value !== null) p.dinnerOrdered += r.dinner.ordered.value;
      if (r.dinner.consumed.value !== null) p.dinnerConsumed += r.dinner.consumed.value;
      if (r.dinner.scanned.value !== null) p.dinnerScanned += r.dinner.scanned.value;
      if (r.dinner.variance !== null) p.dinnerDifference += r.dinner.variance;

      const activeTotals = getRecordMealTotals(r);
      p.totalOrdered += activeTotals.ord;
      p.totalConsumed += activeTotals.con;
      p.totalScanned += activeTotals.scn;
      p.totalDifference += activeTotals.diff;
    }

    const list = Array.from(map.values()).map((p) => {
      const consumptionRatePct =
        p.totalOrdered > 0 ? Math.round((p.totalConsumed / p.totalOrdered) * 1000) / 10 : 0;
      const qrCaptureRatePct =
        p.totalConsumed > 0 ? Math.round((p.totalScanned / p.totalConsumed) * 1000) / 10 : 0;
      const qrVsConsumedGap = p.totalConsumed - p.totalScanned;
      const reportingDateRange =
        p.minDate === p.maxDate ? p.minDate : `${p.minDate} to ${p.maxDate}`;
      return {
        ...p,
        reportingDateRange,
        consumptionRatePct,
        qrCaptureRatePct,
        qrVsConsumedGap,
      };
    });

    list.sort((a, b) => {
      switch (propertySortBy) {
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
  }, [mgmtFilteredRecords, selectedMeal, propertySortBy]);

  // Executive Totals for Filtered View
  const filteredTotals = useMemo(() => {
    let ord = 0,
      con = 0,
      scn = 0,
      diff = 0;
    for (const p of propertyRows) {
      ord += p.totalOrdered;
      con += p.totalConsumed;
      scn += p.totalScanned;
      diff += p.totalDifference;
    }
    const utilizationPct = ord > 0 ? Math.round((con / ord) * 1000) / 10 : 0;
    const qrCompliancePct = con > 0 ? Math.round((scn / con) * 1000) / 10 : 0;
    return {
      ord,
      con,
      scn,
      diff,
      utilizationPct,
      qrCompliancePct,
      unscannedGap: con - scn,
    };
  }, [propertyRows]);

  // Day-of-Week Aggregation Matrix
  const dayOfWeekMatrix = useMemo(() => {
    const buckets = DAYS_OF_WEEK.map((d) => ({
      ...d,
      reports: 0,
      ordered: 0,
      consumed: 0,
      scanned: 0,
      difference: 0,
    }));

    for (const r of mgmtFilteredRecords) {
      const dt = new Date(`${r.reportingDate}T00:00:00Z`);
      const dow = dt.getUTCDay();
      const target = buckets.find((b) => b.idx === dow);
      if (target) {
        const t = getRecordMealTotals(r);
        target.reports += 1;
        target.ordered += t.ord;
        target.consumed += t.con;
        target.scanned += t.scn;
        target.difference += t.diff;
      }
    }
    return buckets;
  }, [mgmtFilteredRecords, selectedMeal]);

  // Daily Chronological Trend
  const dailyTrendRows = useMemo(() => {
    const byDate = new Map<
      string,
      { date: string; ordered: number; consumed: number; scanned: number; difference: number; reports: number }
    >();
    for (const r of mgmtFilteredRecords) {
      if (!byDate.has(r.reportingDate)) {
        byDate.set(r.reportingDate, {
          date: r.reportingDate,
          ordered: 0,
          consumed: 0,
          scanned: 0,
          difference: 0,
          reports: 0,
        });
      }
      const b = byDate.get(r.reportingDate)!;
      const t = getRecordMealTotals(r);
      b.reports += 1;
      b.ordered += t.ord;
      b.consumed += t.con;
      b.scanned += t.scn;
      b.difference += t.diff;
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [mgmtFilteredRecords, selectedMeal]);

  // Brainstormed Automated Executive Management Insights from the Sheet
  const executiveInsights = useMemo(() => {
    if (propertyRows.length === 0) return [];
    const highestWastageProp = [...propertyRows].sort(
      (a, b) => b.totalDifference - a.totalDifference
    )[0];
    const highestOverConsumedProp = [...propertyRows].sort(
      (a, b) => a.totalDifference - b.totalDifference
    )[0];
    const largestQrGapProp = [...propertyRows].sort(
      (a, b) => b.qrVsConsumedGap - a.qrVsConsumedGap
    )[0];
    const bestEfficiencyProp = [...propertyRows].sort(
      (a, b) => Math.abs(100 - a.consumptionRatePct) - Math.abs(100 - b.consumptionRatePct)
    )[0];

    return [
      {
        title: 'Highest Unconsumed Buffer (Ordered > Consumed)',
        property: highestWastageProp?.propertyDisplay || '—',
        metric:
          highestWastageProp && highestWastageProp.totalDifference > 0
            ? `+${highestWastageProp.totalDifference.toLocaleString()} portions unconsumed`
            : 'Balanced ordering',
        action:
          'Review indent buffer quantities for this property to reduce excess kitchen ordering.',
        tone: 'text-amber-700 dark:text-amber-400',
      },
      {
        title: 'Highest Over-Consumption Alert (Consumed > Ordered)',
        property:
          highestOverConsumedProp && highestOverConsumedProp.totalDifference < 0
            ? highestOverConsumedProp.propertyDisplay
            : 'Zero Over-Consumption',
        metric:
          highestOverConsumedProp && highestOverConsumedProp.totalDifference < 0
            ? `${highestOverConsumedProp.totalDifference.toLocaleString()} deficit portions`
            : 'All within ordered indent',
        action:
          'Verify walk-in headcount vs. scheduled indent cut-off times at this property.',
        tone: 'text-rose-600 dark:text-rose-400',
      },
      {
        title: 'Largest Unscanned Meal Gap (Consumed − QR Scanned)',
        property: largestQrGapProp?.propertyDisplay || '—',
        metric:
          largestQrGapProp && largestQrGapProp.qrVsConsumedGap > 0
            ? `${largestQrGapProp.qrVsConsumedGap.toLocaleString()} meals consumed without QR scan`
            : '100% QR scan capture',
        action:
          'Audit dining hall QR scanner compliance during peak meal service windows.',
        tone: 'text-teal-700 dark:text-teal-400',
      },
      {
        title: 'Most Accurate Indent-to-Consumption Property',
        property: bestEfficiencyProp?.propertyDisplay || '—',
        metric: bestEfficiencyProp
          ? `${bestEfficiencyProp.consumptionRatePct}% Utilization (${bestEfficiencyProp.qrCaptureRatePct}% QR Capture)`
          : '—',
        action: 'Benchmark property for daily meal forecasting accuracy.',
        tone: 'text-emerald-700 dark:text-emerald-400',
      },
    ];
  }, [propertyRows]);

  const maxPropVal = useMemo(() => {
    let m = 50;
    for (const p of propertyRows) {
      m = Math.max(m, p.totalOrdered, p.totalConsumed, p.totalScanned);
    }
    return m;
  }, [propertyRows]);

  // Render any selected Workbench Module (Graph or Table)
  const renderWorkbenchModule = (moduleId: WorkbenchModuleId, slotLabel: string) => {
    const moduleMeta = WORKBENCH_MODULES.find((m) => m.id === moduleId)!;

    return (
      <div className="glass-panel rounded-xl p-5 flex flex-col justify-between space-y-4">
        <div className="space-y-3">
          {/* Module Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 dark:border-slate-800/70 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-600/10 text-blue-700 dark:text-blue-300 font-semibold">
                  {slotLabel} · {moduleMeta.category}
                </span>
                <span className="text-xs font-mono text-slate-500">
                  {selectedMeal === 'ALL' ? 'All Meals Combined' : `${selectedMeal} Only`}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-1">
                {moduleMeta.label}
              </h3>
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
              <span>{propertyRows.length} Properties</span>
              <span>·</span>
              <span>{mgmtFilteredRecords.length} Reports</span>
            </div>
          </div>

          {/* MODULE 1: Property-Wise Ordered vs Consumed vs QR Scanned Visual Bar Chart */}
          {moduleId === 'property_meal_bars' && (
            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400 pb-1">
                <div className="flex items-center gap-4">
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
                <span className="font-mono text-[11px]">Click any property to drill down</span>
              </div>

              {propertyRows.map((p) => {
                const ordW = Math.round((p.totalOrdered / maxPropVal) * 100);
                const conW = Math.round((p.totalConsumed / maxPropVal) * 100);
                const scnW = Math.round((p.totalScanned / maxPropVal) * 100);

                return (
                  <div
                    key={p.propertyNormalized}
                    onClick={() => onSelectProperty(p.propertyNormalized)}
                    className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800/80 hover:border-blue-500 transition-colors cursor-pointer space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 dark:border-slate-800">
                      <div>
                        <span className="text-xs font-bold text-indigo-950 dark:text-white inline-flex items-center gap-1.5">
                          {p.propertyDisplay}
                          <ArrowUpRight className="w-3.5 h-3.5 text-blue-600" />
                        </span>
                        <span className="block text-[10px] font-mono text-indigo-600 dark:text-indigo-400">
                          Date: {p.reportingDateRange} ({p.reportDays} {p.reportDays === 1 ? 'Day' : 'Days'})
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-md font-mono tabular-nums text-[11px] font-semibold whitespace-nowrap ${
                          p.totalDifference < 0
                            ? 'bg-rose-100/90 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                            : 'bg-indigo-100/80 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200'
                        }`}
                      >
                        Difference:{' '}
                        {p.totalDifference >= 0
                          ? `+${p.totalDifference.toLocaleString()}`
                          : p.totalDifference.toLocaleString()}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="grid grid-cols-12 items-center gap-2 text-xs">
                        <span className="col-span-3 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          Ordered
                        </span>
                        <div className="col-span-6 h-2 bg-slate-200/80 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-600 rounded-full"
                            style={{ width: `${Math.max(3, ordW)}%` }}
                          />
                        </div>
                        <span className="col-span-3 text-right font-mono tabular-nums font-semibold text-indigo-800 dark:text-indigo-200">
                          {p.totalOrdered.toLocaleString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-12 items-center gap-2 text-xs">
                        <span className="col-span-3 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          Consumed
                        </span>
                        <div className="col-span-6 h-2 bg-slate-200/80 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 rounded-full"
                            style={{ width: `${Math.max(3, conW)}%` }}
                          />
                        </div>
                        <span className="col-span-3 text-right font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                          {p.totalConsumed.toLocaleString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-12 items-center gap-2 text-xs">
                        <span className="col-span-3 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          QR Scanned
                        </span>
                        <div className="col-span-6 h-2 bg-slate-200/80 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-teal-500 rounded-full"
                            style={{ width: `${Math.max(3, scnW)}%` }}
                          />
                        </div>
                        <span className="col-span-3 text-right font-mono tabular-nums font-semibold text-teal-600 dark:text-teal-400">
                          {p.totalScanned.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* MODULE 2: Property-Wise Consolidated Summary Table */}
          {moduleId === 'property_summary_table' && (
            <div className="overflow-x-auto max-h-[540px] rounded-lg border border-slate-200/80 dark:border-slate-800/80">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3 whitespace-nowrap">Property Name</th>
                    <th className="py-2.5 px-2 text-right whitespace-nowrap">Days</th>
                    {(selectedMeal === 'ALL' || selectedMeal === 'Breakfast') && (
                      <>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap">Breakfast Ordered</th>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap">Breakfast Consumed</th>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap">Breakfast QR Scanned</th>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap border-r border-slate-200 dark:border-slate-700">
                          Breakfast Difference
                        </th>
                      </>
                    )}
                    {(selectedMeal === 'ALL' || selectedMeal === 'Lunch') && (
                      <>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap">Lunch Ordered</th>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap">Lunch Consumed</th>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap">Lunch QR Scanned</th>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap border-r border-slate-200 dark:border-slate-700">
                          Lunch Difference
                        </th>
                      </>
                    )}
                    {(selectedMeal === 'ALL' || selectedMeal === 'Dinner') && (
                      <>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap">Dinner Ordered</th>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap">Dinner Consumed</th>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap">Dinner QR Scanned</th>
                        <th className="py-2.5 px-2 text-right whitespace-nowrap">Dinner Difference</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                  {propertyRows.map((p) => (
                    <tr
                      key={p.propertyNormalized}
                      onClick={() => onSelectProperty(p.propertyNormalized)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                    >
                      <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-white whitespace-nowrap">
                        {p.propertyDisplay}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-500">{p.reportDays}</td>
                      {(selectedMeal === 'ALL' || selectedMeal === 'Breakfast') && (
                        <>
                          <td className="py-2 px-2 text-right">{p.breakfastOrdered.toLocaleString()}</td>
                          <td className="py-2 px-2 text-right text-blue-600 dark:text-blue-400">
                            {p.breakfastConsumed.toLocaleString()}
                          </td>
                          <td className="py-2 px-2 text-right text-teal-600 dark:text-teal-400">
                            {p.breakfastScanned.toLocaleString()}
                          </td>
                          <td
                            className={`py-2 px-2 text-right font-semibold border-r border-slate-100 dark:border-slate-800 ${
                              p.breakfastDifference < 0 ? 'text-rose-600 dark:text-rose-400' : ''
                            }`}
                          >
                            {p.breakfastDifference >= 0
                              ? `+${p.breakfastDifference.toLocaleString()}`
                              : p.breakfastDifference.toLocaleString()}
                          </td>
                        </>
                      )}
                      {(selectedMeal === 'ALL' || selectedMeal === 'Lunch') && (
                        <>
                          <td className="py-2 px-2 text-right">{p.lunchOrdered.toLocaleString()}</td>
                          <td className="py-2 px-2 text-right text-blue-600 dark:text-blue-400">
                            {p.lunchConsumed.toLocaleString()}
                          </td>
                          <td className="py-2 px-2 text-right text-teal-600 dark:text-teal-400">
                            {p.lunchScanned.toLocaleString()}
                          </td>
                          <td
                            className={`py-2 px-2 text-right font-semibold border-r border-slate-100 dark:border-slate-800 ${
                              p.lunchDifference < 0 ? 'text-rose-600 dark:text-rose-400' : ''
                            }`}
                          >
                            {p.lunchDifference >= 0
                              ? `+${p.lunchDifference.toLocaleString()}`
                              : p.lunchDifference.toLocaleString()}
                          </td>
                        </>
                      )}
                      {(selectedMeal === 'ALL' || selectedMeal === 'Dinner') && (
                        <>
                          <td className="py-2 px-2 text-right">{p.dinnerOrdered.toLocaleString()}</td>
                          <td className="py-2 px-2 text-right text-blue-600 dark:text-blue-400">
                            {p.dinnerConsumed.toLocaleString()}
                          </td>
                          <td className="py-2 px-2 text-right text-teal-600 dark:text-teal-400">
                            {p.dinnerScanned.toLocaleString()}
                          </td>
                          <td
                            className={`py-2 px-2 text-right font-semibold ${
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
              </table>
            </div>
          )}

          {/* MODULE 3: QR Scanned vs. Kitchen Consumed Compliance & Gap Analysis */}
          {moduleId === 'qr_vs_consumed_gap' && (
            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Measures dining-hall QR scanning discipline against reported kitchen consumption (<strong>QR Capture % = QR Scanned ÷ Consumed</strong>).
              </p>
              {propertyRows.map((p) => {
                const capturePct = Math.min(100, Math.max(0, p.qrCaptureRatePct));
                return (
                  <div
                    key={p.propertyNormalized}
                    onClick={() => onSelectProperty(p.propertyNormalized)}
                    className="p-3 rounded-lg glass-subtle hover:border-blue-500 cursor-pointer space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {p.propertyDisplay}
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-teal-600 dark:text-teal-400">
                        {p.qrCaptureRatePct}% QR Capture Rate
                      </span>
                    </div>
                    <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-xs overflow-hidden">
                      <div
                        className={`h-full ${
                          p.qrCaptureRatePct >= 90
                            ? 'bg-emerald-500'
                            : p.qrCaptureRatePct >= 75
                            ? 'bg-teal-500'
                            : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.max(3, capturePct)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                      <span>Consumed: {p.totalConsumed.toLocaleString()}</span>
                      <span>QR Scanned: {p.totalScanned.toLocaleString()}</span>
                      <span
                        className={
                          p.qrVsConsumedGap > 0
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-emerald-600'
                        }
                      >
                        Unscanned Gap (Consumed − QR): {p.qrVsConsumedGap.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* MODULE 4: Property Consumption Efficiency (Consumed / Ordered %) */}
          {moduleId === 'utilization_efficiency' && (
            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tracks indent utilization efficiency (<strong>Consumed ÷ Ordered %</strong>). Values above 100% indicate over-consumption beyond ordered indent.
              </p>
              {propertyRows.map((p) => {
                const barW = Math.min(100, Math.max(3, Math.round(p.consumptionRatePct)));
                return (
                  <div
                    key={p.propertyNormalized}
                    onClick={() => onSelectProperty(p.propertyNormalized)}
                    className="p-3 rounded-lg glass-subtle hover:border-blue-500 cursor-pointer space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {p.propertyDisplay}
                      </span>
                      <span
                        className={`font-mono font-semibold ${
                          p.consumptionRatePct > 100
                            ? 'text-rose-600 dark:text-rose-400'
                            : p.consumptionRatePct >= 85
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {p.consumptionRatePct}% Consumed of Ordered
                      </span>
                    </div>
                    <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-xs overflow-hidden">
                      <div
                        className={`h-full ${
                          p.consumptionRatePct > 100
                            ? 'bg-rose-600'
                            : p.consumptionRatePct >= 85
                            ? 'bg-blue-600'
                            : 'bg-amber-500'
                        }`}
                        style={{ width: `${barW}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                      <span>Ordered: {p.totalOrdered.toLocaleString()}</span>
                      <span>Consumed: {p.totalConsumed.toLocaleString()}</span>
                      <span>
                        Difference (Ordered − Consumed):{' '}
                        {p.totalDifference >= 0
                          ? `+${p.totalDifference.toLocaleString()}`
                          : p.totalDifference.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* MODULE 5: Daily Chronological Trend */}
          {moduleId === 'daily_chronological_trend' && (
            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              {dailyTrendRows.map((d) => {
                const maxD = Math.max(
                  1,
                  ...dailyTrendRows.map((x) => Math.max(x.ordered, x.consumed, x.scanned))
                );
                const ordW = Math.round((d.ordered / maxD) * 100);
                const conW = Math.round((d.consumed / maxD) * 100);
                const scnW = Math.round((d.scanned / maxD) * 100);
                return (
                  <div key={d.date} className="p-2.5 rounded-lg glass-subtle space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {d.date} ({d.reports} Reports)
                      </span>
                      <div className="flex items-center gap-3 text-[11px]">
                        <span>Ord: {d.ordered.toLocaleString()}</span>
                        <span className="text-blue-600 dark:text-blue-400">
                          Con: {d.consumed.toLocaleString()}
                        </span>
                        <span className="text-teal-600 dark:text-teal-400">
                          QR: {d.scanned.toLocaleString()}
                        </span>
                        <span
                          className={`font-semibold ${
                            d.difference < 0 ? 'text-rose-600' : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          Diff: {d.difference >= 0 ? `+${d.difference}` : d.difference}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-xs overflow-hidden">
                        <div className="h-full bg-indigo-600" style={{ width: `${ordW}%` }} />
                      </div>
                      <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-xs overflow-hidden">
                        <div className="h-full bg-blue-600" style={{ width: `${conW}%` }} />
                      </div>
                      <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-xs overflow-hidden">
                        <div className="h-full bg-teal-500" style={{ width: `${scnW}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* MODULE 6: Day-of-Week Matrix */}
          {moduleId === 'day_of_week_matrix' && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Day of Week</th>
                    <th className="py-2.5 px-2.5 text-right">Reports</th>
                    <th className="py-2.5 px-2.5 text-right">Ordered</th>
                    <th className="py-2.5 px-2.5 text-right">Consumed</th>
                    <th className="py-2.5 px-2.5 text-right">QR Scanned</th>
                    <th className="py-2.5 px-2.5 text-right">Difference (Ord − Con)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                  {dayOfWeekMatrix.map((d) => (
                    <tr key={d.idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-white">
                        {d.full}
                      </td>
                      <td className="py-2 px-2.5 text-right text-slate-500">{d.reports}</td>
                      <td className="py-2 px-2.5 text-right">{d.ordered.toLocaleString()}</td>
                      <td className="py-2 px-2.5 text-right text-blue-600 dark:text-blue-400">
                        {d.consumed.toLocaleString()}
                      </td>
                      <td className="py-2 px-2.5 text-right text-teal-600 dark:text-teal-400">
                        {d.scanned.toLocaleString()}
                      </td>
                      <td
                        className={`py-2 px-2.5 text-right font-semibold ${
                          d.difference < 0 ? 'text-rose-600 dark:text-rose-400' : ''
                        }`}
                      >
                        {d.difference >= 0 ? `+${d.difference.toLocaleString()}` : d.difference.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* MODULE 7: Top Property & Date Difference Leaderboard */}
          {moduleId === 'variance_leaderboard' && (
            <div className="overflow-x-auto max-h-[540px] rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Property Name</th>
                    <th className="py-2.5 px-2.5">Reporting Date</th>
                    <th className="py-2.5 px-2.5 text-right">Ordered</th>
                    <th className="py-2.5 px-2.5 text-right">Consumed</th>
                    <th className="py-2.5 px-2.5 text-right">QR Scanned</th>
                    <th className="py-2.5 px-2.5 text-right">Difference (Ord − Con)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                  {[...mgmtFilteredRecords]
                    .sort(
                      (a, b) =>
                        Math.abs(getRecordMealTotals(b).diff) - Math.abs(getRecordMealTotals(a).diff)
                    )
                    .slice(0, 35)
                    .map((r) => {
                      const t = getRecordMealTotals(r);
                      return (
                        <tr
                          key={r.id}
                          onClick={() => onInspectRecord(r)}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                        >
                          <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-white">
                            {r.propertyDisplay}
                          </td>
                          <td className="py-2 px-2.5">{r.reportingDate}</td>
                          <td className="py-2 px-2.5 text-right">{t.ord.toLocaleString()}</td>
                          <td className="py-2 px-2.5 text-right text-blue-600 dark:text-blue-400">
                            {t.con.toLocaleString()}
                          </td>
                          <td className="py-2 px-2.5 text-right text-teal-600 dark:text-teal-400">
                            {t.scn.toLocaleString()}
                          </td>
                          <td
                            className={`py-2 px-2.5 text-right font-semibold ${
                              t.diff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {t.diff >= 0 ? `+${t.diff.toLocaleString()}` : t.diff.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* MODULE 8: Date-by-Date Property Full Ledger */}
          {moduleId === 'daily_full_ledger' && (
            <div className="overflow-x-auto max-h-[540px] rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Property Name</th>
                    <th className="py-2.5 px-2.5">Date</th>
                    <th className="py-2.5 px-2.5">Status</th>
                    <th className="py-2.5 px-2.5 text-right">Ordered</th>
                    <th className="py-2.5 px-2.5 text-right">Consumed</th>
                    <th className="py-2.5 px-2.5 text-right">QR Scanned</th>
                    <th className="py-2.5 px-2.5 text-right">Difference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                  {mgmtFilteredRecords.map((r) => {
                    const t = getRecordMealTotals(r);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => onInspectRecord(r)}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                      >
                        <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-white">
                          {r.propertyDisplay}
                        </td>
                        <td className="py-2 px-2.5">{r.reportingDate}</td>
                        <td className="py-2 px-2.5 font-sans">{r.taskStatus}</td>
                        <td className="py-2 px-2.5 text-right">{t.ord.toLocaleString()}</td>
                        <td className="py-2 px-2.5 text-right text-blue-600 dark:text-blue-400">
                          {t.con.toLocaleString()}
                        </td>
                        <td className="py-2 px-2.5 text-right text-teal-600 dark:text-teal-400">
                          {t.scn.toLocaleString()}
                        </td>
                        <td
                          className={`py-2 px-2.5 text-right font-semibold ${
                            t.diff < 0 ? 'text-rose-600 dark:text-rose-400' : ''
                          }`}
                        >
                          {t.diff >= 0 ? `+${t.diff.toLocaleString()}` : t.diff.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Executive Banner with Download Snapshot (PNG), Export CSV, and Print */}
      <div className="glass-panel rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-blue-600 dark:text-blue-400 font-semibold">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Executive Management Report &amp; Dual-Graph Workbench · Reporting Date: {dateRangeLabel}
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Management Operations Intelligence &amp; 2-Table / Graph Comparator
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Filter by any sheet dimension, select any <strong>2 Graphs or Tables</strong> side-by-side, and download a high-resolution <strong>PNG Snapshot</strong> or <strong>CSV Report</strong> for management review.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 no-print">
          <button
            type="button"
            onClick={() =>
              downloadPropertySnapshotPng({
                title: 'Executive Management Report — Property-Wise Meal Operations',
                subtitle:
                  'Complete breakdown of Ordered, Consumed, QR Scanned, and Difference (Ordered minus Consumed)',
                mealFilterLabel: selectedMeal === 'ALL' ? 'All Meals (Breakfast, Lunch & Dinner)' : selectedMeal,
                dateRangeLabel,
                rows: propertyRows,
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            Download Snapshot (PNG)
          </button>

          <button
            type="button"
            onClick={() => downloadPropertySummaryCsv(propertyRows)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg glass-subtle hover:bg-white/90 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            Download Summary (CSV)
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg glass-subtle hover:bg-white/90 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Management Report
          </button>
        </div>
      </div>

      {/* Comprehensive Multi-Dimensional Filter Control Matrix */}
      <div className="glass-panel rounded-xl p-5 space-y-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 dark:border-slate-800/70 pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
            <Filter className="w-3.5 h-3.5 text-blue-600" />
            Complete Management Filter Matrix (Task Raw + Scanning Sheet Dimensions)
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="font-mono text-slate-500">
              Matching: <strong>{propertyRows.length}</strong> Properties ·{' '}
              <strong>{mgmtFilteredRecords.length}</strong> Daily Reports
            </span>
            <button
              type="button"
              onClick={resetManagementFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-medium"
            >
              <RotateCcw className="w-3 h-3" />
              Reset All Management Filters
            </button>
          </div>
        </div>

        {/* Row 1 of Filters: Meal Selector, Property Multi-Select, Task Status, Day of Week */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
          {/* 1. Meal Type Selector */}
          <div className="space-y-1">
            <label className="block font-medium text-slate-600 dark:text-slate-400">
              1. Meal Service Focus
            </label>
            <div className="flex items-center gap-1 p-1 glass-subtle rounded-lg">
              {(['ALL', 'Breakfast', 'Lunch', 'Dinner'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedMeal(m)}
                  className={`flex-1 py-1 px-2 rounded text-xs font-medium transition-colors ${
                    selectedMeal === m
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {m === 'ALL' ? 'All Meals' : m}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Property Multi-Select */}
          <div className="space-y-1 relative">
            <label className="block font-medium text-slate-600 dark:text-slate-400">
              2. Property Filter
            </label>
            <button
              type="button"
              onClick={() => setShowPropertyPicker((v) => !v)}
              className="w-full px-3 py-1.5 glass-subtle rounded-lg flex items-center justify-between text-slate-800 dark:text-slate-200 font-medium"
            >
              <span className="truncate">
                {selectedProperties.length === 0
                  ? `All Properties (${properties.length})`
                  : `${selectedProperties.length} Selected`}
              </span>
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {showPropertyPicker && (
              <div className="absolute left-0 top-14 z-30 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-3 space-y-2 max-h-60 overflow-y-auto">
                <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="font-semibold">Select Properties</span>
                  <button
                    type="button"
                    onClick={() => setSelectedProperties([])}
                    className="text-blue-600 hover:underline text-[11px]"
                  >
                    Select All
                  </button>
                </div>
                {properties.map((p) => {
                  const checked = selectedProperties.includes(p.normalizedId);
                  return (
                    <label
                      key={p.normalizedId}
                      className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <span className="truncate pr-2">{p.displayName}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const c = e.target.checked;
                          setSelectedProperties((prev) =>
                            c
                              ? [...prev, p.normalizedId]
                              : prev.filter((id) => id !== p.normalizedId)
                          );
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Task Status Multi-Toggle */}
          <div className="space-y-1">
            <label className="block font-medium text-slate-600 dark:text-slate-400">
              3. Daily Report Task Status (Col N)
            </label>
            <div className="flex flex-wrap items-center gap-1 p-1 glass-subtle rounded-lg">
              {(['Completed', 'Pending', 'Overdue', 'In Progress'] as const).map((st) => {
                const active = selectedStatuses.includes(st);
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() =>
                      setSelectedStatuses((prev) =>
                        active ? prev.filter((x) => x !== st) : [...prev, st]
                      )
                    }
                    className={`flex-1 py-1 px-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {st}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Day of Week Selector */}
          <div className="space-y-1">
            <label className="block font-medium text-slate-600 dark:text-slate-400">
              4. Day of Week Pattern (Mon–Sun)
            </label>
            <div className="flex items-center gap-1 p-1 glass-subtle rounded-lg">
              {DAYS_OF_WEEK.map((d) => {
                const active = selectedDaysOfWeek.includes(d.idx);
                return (
                  <button
                    key={d.idx}
                    type="button"
                    onClick={() =>
                      setSelectedDaysOfWeek((prev) =>
                        active ? prev.filter((x) => x !== d.idx) : [...prev, d.idx]
                      )
                    }
                    className={`flex-1 py-1 rounded text-[11px] font-mono font-medium transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Row 2 of Filters: Difference Direction, QR Scan Coverage, Utilization Band, Thresholds & Sort */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs pt-2 border-t border-slate-100 dark:border-slate-800/60">
          {/* 5. Difference Polarity */}
          <div className="space-y-1">
            <label className="block font-medium text-slate-600 dark:text-slate-400">
              5. Difference (Ord − Con)
            </label>
            <select
              value={varianceDirection}
              onChange={(e) => setVarianceDirection(e.target.value as any)}
              className="w-full px-2.5 py-1.5 glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">All Differences</option>
              <option value="POSITIVE_UNCONSUMED">Positive (+ Unconsumed Surplus)</option>
              <option value="NEGATIVE_OVERCONSUMED">Negative (− Over-Consumption)</option>
              <option value="ZERO_EXACT">Zero Variance Only (0)</option>
            </select>
          </div>

          {/* 6. QR Scan Coverage */}
          <div className="space-y-1">
            <label className="block font-medium text-slate-600 dark:text-slate-400">
              6. QR Scanned Coverage
            </label>
            <select
              value={scanCoverageFilter}
              onChange={(e) => setScanCoverageFilter(e.target.value as any)}
              className="w-full px-2.5 py-1.5 glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">All QR Scan States</option>
              <option value="COMPLETE_SCANS">Complete QR Scans Only</option>
              <option value="MISSING_SCANS">Missing / Unmatched QR Scans</option>
              <option value="SCAN_EXCEEDS_CONSUMED">QR Scanned &gt; Consumed Anomaly</option>
            </select>
          </div>

          {/* 7. Utilization Efficiency Band */}
          <div className="space-y-1">
            <label className="block font-medium text-slate-600 dark:text-slate-400">
              7. Consumption Efficiency %
            </label>
            <select
              value={utilizationBand}
              onChange={(e) => setUtilizationBand(e.target.value as any)}
              className="w-full px-2.5 py-1.5 glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">All Efficiency Bands</option>
              <option value="UNDER_80">Under-Consumed (&lt; 80% of Ordered)</option>
              <option value="OPTIMAL_80_100">Optimal Band (80% – 100%)</option>
              <option value="OVER_100">Over-Consumed (&gt; 100% of Ordered)</option>
            </select>
          </div>

          {/* 8. Data Quality Health */}
          <div className="space-y-1">
            <label className="block font-medium text-slate-600 dark:text-slate-400">
              8. Data Quality Health
            </label>
            <select
              value={dataHealthFilter}
              onChange={(e) => setDataHealthFilter(e.target.value as any)}
              className="w-full px-2.5 py-1.5 glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">All Records</option>
              <option value="CLEAN_ONLY">Verified Clean Records Only</option>
              <option value="WITH_WARNINGS_ONLY">Records With Data Warnings Only</option>
            </select>
          </div>

          {/* 9. Minimum Absolute Difference / Ordered Threshold */}
          <div className="space-y-1">
            <label className="block font-medium text-slate-600 dark:text-slate-400">
              9. Min Abs Difference ≥ ({minAbsDifference})
            </label>
            <input
              type="range"
              min={0}
              max={150}
              step={5}
              value={minAbsDifference}
              onChange={(e) => setMinAbsDifference(Number(e.target.value))}
              className="w-full accent-blue-600 mt-2"
            />
          </div>

          {/* 10. Sort Properties By */}
          <div className="space-y-1">
            <label className="block font-medium text-slate-600 dark:text-slate-400">
              10. Sort Properties By
            </label>
            <select
              value={propertySortBy}
              onChange={(e) => setPropertySortBy(e.target.value as any)}
              className="w-full px-2.5 py-1.5 glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
            >
              <option value="ordered_desc">Highest Ordered First</option>
              <option value="consumed_desc">Highest Consumed First</option>
              <option value="scanned_desc">Highest QR Scanned First</option>
              <option value="diff_desc">Largest Surplus (+ Diff) First</option>
              <option value="diff_asc">Largest Deficit (− Diff) First</option>
              <option value="name_asc">Property Name (A → Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Executive KPI Summary Strip for Filtered Selection */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="glass-panel rounded-xl p-4">
          <div className="text-[11px] text-slate-500">Filtered Ordered</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {filteredTotals.ord.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {propertyRows.length} Active Properties
          </div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <div className="text-[11px] text-slate-500">Filtered Consumed</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
            {filteredTotals.con.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {filteredTotals.utilizationPct}% of Ordered
          </div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <div className="text-[11px] text-slate-500">Filtered QR Scanned</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-teal-600 dark:text-teal-400">
            {filteredTotals.scn.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {filteredTotals.qrCompliancePct}% of Consumed
          </div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <div className="text-[11px] text-slate-500">Difference (Ord − Con)</div>
          <div
            className={`mt-1 text-xl font-bold font-mono tabular-nums ${
              filteredTotals.diff < 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {filteredTotals.diff >= 0
              ? `+${filteredTotals.diff.toLocaleString()}`
              : filteredTotals.diff.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">Net indent variance</div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <div className="text-[11px] text-slate-500">Unscanned Meal Gap</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {filteredTotals.unscannedGap.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">Consumed minus QR Scanned</div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <div className="text-[11px] text-slate-500">Matching Daily Reports</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {mgmtFilteredRecords.length}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">{dateRangeLabel}</div>
        </div>
      </div>

      {/* Brainstormed Automated Executive Insights Strip */}
      {executiveInsights.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {executiveInsights.map((ins, i) => (
            <div key={i} className="glass-panel rounded-xl p-4 space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                {ins.title}
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">
                {ins.property}
              </div>
              <div className={`text-xs font-mono font-semibold ${ins.tone}`}>{ins.metric}</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{ins.action}</p>
            </div>
          ))}
        </div>
      )}

      {/* Dual 2-Table / Graph Comparator Selector Bar */}
      <div className="glass-panel rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex flex-wrap items-center gap-4 flex-1">
          <div className="flex items-center gap-2 flex-1 min-w-[260px]">
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 whitespace-nowrap">
              Panel A (Left Graph / Table):
            </span>
            <select
              value={leftSlotModule}
              onChange={(e) => setLeftSlotModule(e.target.value as WorkbenchModuleId)}
              className="flex-1 px-3 py-1.5 text-xs font-medium glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
            >
              {WORKBENCH_MODULES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[260px]">
            <span className="text-xs font-semibold text-teal-700 dark:text-teal-300 whitespace-nowrap">
              Panel B (Right Graph / Table):
            </span>
            <select
              value={rightSlotModule}
              onChange={(e) => setRightSlotModule(e.target.value as WorkbenchModuleId)}
              className="flex-1 px-3 py-1.5 text-xs font-medium glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
            >
              {WORKBENCH_MODULES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 glass-subtle rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setLayoutMode('side_by_side')}
            className={`px-2.5 py-1 rounded font-medium ${
              layoutMode === 'side_by_side'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Side-by-Side (2 Columns)
          </button>
          <button
            type="button"
            onClick={() => setLayoutMode('stacked_full')}
            className={`px-2.5 py-1 rounded font-medium ${
              layoutMode === 'stacked_full'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Full-Width Stacked
          </button>
        </div>
      </div>

      {/* The 2 Selected Table / Graph Modules Rendered Together */}
      <div
        className={`grid gap-6 ${
          layoutMode === 'side_by_side' ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {renderWorkbenchModule(leftSlotModule, 'PANEL A')}
        {renderWorkbenchModule(rightSlotModule, 'PANEL B')}
      </div>
    </div>
  );
};
