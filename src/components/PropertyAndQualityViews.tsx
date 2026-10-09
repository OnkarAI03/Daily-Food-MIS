/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Property Detail View & Data Quality Center Components
 */

import React, { useState, useMemo } from 'react';
import {
  DailyReportRecord,
  PropertyEntity,
  ScanningRecord,
  ValidationCategory,
  ValidationFinding,
  ValidationSeverity,
} from '../types/domain';
import { renderTrackedCell, renderVarianceCell } from './DailyReportTable';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  FileWarning,
  Search,
  ShieldAlert,
} from 'lucide-react';

interface PropertyDetailViewProps {
  properties: PropertyEntity[];
  selectedPropertyId: string | null;
  onSelectPropertyId: (id: string) => void;
  records: DailyReportRecord[];
  findings: ValidationFinding[];
  onInspectRecord: (record: DailyReportRecord) => void;
}

export const PropertyDetailView: React.FC<PropertyDetailViewProps> = ({
  properties,
  selectedPropertyId,
  onSelectPropertyId,
  records,
  findings,
  onInspectRecord,
}) => {
  const [selectedMeal, setSelectedMeal] = useState<'ALL' | 'Breakfast' | 'Lunch' | 'Dinner'>('ALL');
  const activePropId = selectedPropertyId || properties[0]?.normalizedId || '';
  const activeProp = properties.find((p) => p.normalizedId === activePropId);

  const propRecords = useMemo(
    () =>
      records
        .filter((r) => r.propertyNormalized === activePropId)
        .sort((a, b) => b.reportingDate.localeCompare(a.reportingDate)),
    [records, activePropId]
  );

  const propFindings = useMemo(
    () => findings.filter((f) => f.propertyNormalized === activePropId),
    [findings, activePropId]
  );

  const propTotals = useMemo(() => {
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

    for (const r of propRecords) {
      bOrd += r.breakfast.ordered.value ?? 0;
      bCon += r.breakfast.consumed.value ?? 0;
      bScn += r.breakfast.scanned.value ?? 0;
      if (r.breakfast.ordered.value !== null && r.breakfast.consumed.value !== null) {
        bPairOrd += r.breakfast.ordered.value;
        bPairCon += r.breakfast.consumed.value;
      }

      lOrd += r.lunch.ordered.value ?? 0;
      lCon += r.lunch.consumed.value ?? 0;
      lScn += r.lunch.scanned.value ?? 0;
      if (r.lunch.ordered.value !== null && r.lunch.consumed.value !== null) {
        lPairOrd += r.lunch.ordered.value;
        lPairCon += r.lunch.consumed.value;
      }

      dOrd += r.dinner.ordered.value ?? 0;
      dCon += r.dinner.consumed.value ?? 0;
      dScn += r.dinner.scanned.value ?? 0;
      if (r.dinner.ordered.value !== null && r.dinner.consumed.value !== null) {
        dPairOrd += r.dinner.ordered.value;
        dPairCon += r.dinner.consumed.value;
      }
    }

    return {
      bOrd,
      bCon,
      bScn,
      bVar: bPairOrd - bPairCon,
      lOrd,
      lCon,
      lScn,
      lVar: lPairOrd - lPairCon,
      dOrd,
      dCon,
      dScn,
      dVar: dPairOrd - dPairCon,
    };
  }, [propRecords]);

  return (
    <div className="space-y-6">
      {/* Property Selector Bar */}
      <div className="glass-panel rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Building2 className="w-5 h-5 text-blue-600" />
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {activeProp ? activeProp.displayName : 'Select a Property'}
            </h2>
            {activeProp && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Normalized ID: <code className="font-mono">{activeProp.normalizedId}</code></span>
                <span aria-hidden="true">·</span>
                <span>Source spelling variants seen: {activeProp.rawVariants.length}</span>
                <span aria-hidden="true">·</span>
                <span>Data Quality Score: <strong className="font-mono">{activeProp.dataQualityScore}/100</strong></span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Meal Selector (All Meals, Breakfast, Lunch, Dinner) */}
          <div className="flex items-center gap-1 p-1 glass-subtle rounded-lg">
            {(['ALL', 'Breakfast', 'Lunch', 'Dinner'] as const).map((meal) => (
              <button
                key={meal}
                type="button"
                onClick={() => setSelectedMeal(meal)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  selectedMeal === meal
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {meal === 'ALL' ? 'All Meals' : meal}
              </button>
            ))}
          </div>

          <label htmlFor="prop-select" className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Switch Property:
          </label>
          <select
            id="prop-select"
            value={activePropId}
            onChange={(e) => onSelectPropertyId(e.target.value)}
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
          >
            {properties.map((p) => (
              <option key={p.normalizedId} value={p.normalizedId}>
                {p.displayName} ({p.totalReportsInPeriod} reports)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 3-Column Meal Breakdown for Selected Property */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            meal: 'Breakfast' as const,
            ord: propTotals.bOrd,
            con: propTotals.bCon,
            scn: propTotals.bScn,
            variance: propTotals.bVar,
          },
          {
            meal: 'Lunch' as const,
            ord: propTotals.lOrd,
            con: propTotals.lCon,
            scn: propTotals.lScn,
            variance: propTotals.lVar,
          },
          {
            meal: 'Dinner' as const,
            ord: propTotals.dOrd,
            con: propTotals.dCon,
            scn: propTotals.dScn,
            variance: propTotals.dVar,
          },
        ]
          .filter((m) => selectedMeal === 'ALL' || selectedMeal === m.meal)
          .map((m) => (
          <div
            key={m.meal}
            className="glass-panel rounded-xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{m.meal} Summary</span>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                Difference (Ordered − Consumed):{' '}
                <strong className={m.variance < 0 ? 'text-rose-600' : 'text-slate-900 dark:text-slate-100'}>
                  {m.variance >= 0 ? `+${m.variance.toLocaleString()}` : m.variance.toLocaleString()}
                </strong>
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Ordered</div>
                <div className="text-base font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {m.ord.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Consumed</div>
                <div className="text-base font-semibold font-mono tabular-nums text-blue-600 dark:text-blue-400">
                  {m.con.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">QR Scanned</div>
                <div className="text-base font-semibold font-mono tabular-nums text-teal-600 dark:text-teal-400">
                  {m.scn.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Difference</div>
                <div
                  className={`text-base font-semibold font-mono tabular-nums ${
                    m.variance < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {m.variance >= 0 ? `+${m.variance.toLocaleString()}` : m.variance.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Property Data Quality Findings */}
      <div className="glass-panel rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
          Property Data Quality &amp; Exception Findings ({propFindings.length})
        </h3>
        {propFindings.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 py-2">
            <CheckCircle2 className="w-4 h-4" />
            All Daily Ops Report and Scanning records for this property passed validation with zero warnings.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {propFindings.map((f) => (
              <div key={f.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono font-semibold uppercase ${
                        f.severity === 'critical' || f.severity === 'high'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      [{f.severity}]
                    </span>
                    <span className="font-mono text-slate-500">{f.sourceLocation}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">{f.category}</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300">{f.message}</p>
                  <p className="text-slate-500 dark:text-slate-400">
                    Remediation: {f.remediation}
                  </p>
                </div>
                <span className="font-mono text-slate-400 shrink-0">{f.reportingDate || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historical Daily Ledger for Selected Property */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Historical Daily Reports — {activeProp?.displayName}
          </h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {propRecords.length} reporting days
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <th className="py-2 px-3 whitespace-nowrap">Reporting Date</th>
                <th className="py-2 px-3 whitespace-nowrap">Task Status</th>
                <th className="py-2 px-3 whitespace-nowrap">Completed At</th>
                {(selectedMeal === 'ALL' || selectedMeal === 'Breakfast') && (
                  <>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Breakfast Ordered</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Breakfast Consumed</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Breakfast QR Scanned</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Breakfast Difference</th>
                  </>
                )}
                {(selectedMeal === 'ALL' || selectedMeal === 'Lunch') && (
                  <>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Lunch Ordered</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Lunch Consumed</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Lunch QR Scanned</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Lunch Difference</th>
                  </>
                )}
                {(selectedMeal === 'ALL' || selectedMeal === 'Dinner') && (
                  <>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Dinner Ordered</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Dinner Consumed</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Dinner QR Scanned</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Dinner Difference</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {propRecords.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => onInspectRecord(r)}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                >
                  <td className="py-2 px-3 font-mono tabular-nums">{r.reportingDate}</td>
                  <td className="py-2 px-3">{r.taskStatus}</td>
                  <td className="py-2 px-3 font-mono tabular-nums text-slate-500">{r.completedAtDisplay}</td>
                  {(selectedMeal === 'ALL' || selectedMeal === 'Breakfast') && (
                    <>
                      <td className="py-2 px-2.5 text-right">{renderTrackedCell(r.breakfast.ordered)}</td>
                      <td className="py-2 px-2.5 text-right">{renderTrackedCell(r.breakfast.consumed)}</td>
                      <td className="py-2 px-2.5 text-right">{renderTrackedCell(r.breakfast.scanned)}</td>
                      <td className="py-2 px-2.5 text-right">{renderVarianceCell(r.breakfast.variance)}</td>
                    </>
                  )}
                  {(selectedMeal === 'ALL' || selectedMeal === 'Lunch') && (
                    <>
                      <td className="py-2 px-2.5 text-right">{renderTrackedCell(r.lunch.ordered)}</td>
                      <td className="py-2 px-2.5 text-right">{renderTrackedCell(r.lunch.consumed)}</td>
                      <td className="py-2 px-2.5 text-right">{renderTrackedCell(r.lunch.scanned)}</td>
                      <td className="py-2 px-2.5 text-right">{renderVarianceCell(r.lunch.variance)}</td>
                    </>
                  )}
                  {(selectedMeal === 'ALL' || selectedMeal === 'Dinner') && (
                    <>
                      <td className="py-2 px-2.5 text-right">{renderTrackedCell(r.dinner.ordered)}</td>
                      <td className="py-2 px-2.5 text-right">{renderTrackedCell(r.dinner.consumed)}</td>
                      <td className="py-2 px-2.5 text-right">{renderTrackedCell(r.dinner.scanned)}</td>
                      <td className="py-2 px-2.5 text-right">{renderVarianceCell(r.dinner.variance)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface DataQualityCenterProps {
  findings: ValidationFinding[];
  unmatchedScans: ScanningRecord[];
  duplicateReportsExcluded: number;
  duplicateScansExcluded: number;
  onSelectProperty: (propertyNormalized: string) => void;
}

export const DataQualityCenter: React.FC<DataQualityCenterProps> = ({
  findings,
  unmatchedScans,
  duplicateReportsExcluded,
  duplicateScansExcluded,
  onSelectProperty,
}) => {
  const [severityFilter, setSeverityFilter] = useState<'ALL' | ValidationSeverity>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | ValidationCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      if (severityFilter !== 'ALL' && f.severity !== severityFilter) return false;
      if (categoryFilter !== 'ALL' && f.category !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          f.propertyDisplay.toLowerCase().includes(q) ||
          f.message.toLowerCase().includes(q) ||
          f.sourceLocation.toLowerCase().includes(q) ||
          (f.reportingDate && f.reportingDate.includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [findings, severityFilter, categoryFilter, searchQuery]);

  const countsBySeverity = useMemo(() => {
    return {
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
    };
  }, [findings]);

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-panel rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Critical &amp; High Severity Findings</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
            {countsBySeverity.critical + countsBySeverity.high}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {countsBySeverity.critical} critical · {countsBySeverity.high} high
          </div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Duplicate Records Quarantined</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {duplicateReportsExcluded + duplicateScansExcluded}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {duplicateReportsExcluded} Task Raw · {duplicateScansExcluded} Scanning (Never summed)
          </div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Unmatched Scan Records</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {unmatchedScans.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Orphaned scans without a matching Daily Ops Report
          </div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Medium &amp; Low Advisories</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {countsBySeverity.medium + countsBySeverity.low}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {countsBySeverity.medium} medium · {countsBySeverity.low} low
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="glass-panel rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
            {(['ALL', 'critical', 'high', 'medium', 'low'] as const).map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setSeverityFilter(sev)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors capitalize whitespace-nowrap shrink-0 ${
                  severityFilter === sev
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {sev === 'ALL' ? 'All Severities' : sev}
              </button>
            ))}
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as any)}
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200"
          >
            <option value="ALL">All Finding Categories</option>
            <option value="MISSING_VALUE">MISSING_VALUE (Blank vs Zero)</option>
            <option value="UNMATCHED_PROPERTY">UNMATCHED_PROPERTY</option>
            <option value="MISSING_SCAN_RECORD">MISSING_SCAN_RECORD</option>
            <option value="DUPLICATE_TASK_REPORT">DUPLICATE_TASK_REPORT</option>
            <option value="DUPLICATE_SCAN_RECORD">DUPLICATE_SCAN_RECORD</option>
            <option value="INVALID_DATE">INVALID_DATE</option>
            <option value="NEGATIVE_VALUE">NEGATIVE_VALUE</option>
            <option value="INVALID_NUMERIC">INVALID_NUMERIC</option>
            <option value="HIGH_VARIANCE_ANOMALY">HIGH_VARIANCE_ANOMALY</option>
          </select>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cell, property, date..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Findings Table */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Source Data Validation &amp; Integrity Findings
          </h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {filteredFindings.length} finding(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <th className="py-2.5 px-3">ID</th>
                <th className="py-2.5 px-3">Severity</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Property</th>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Source Location</th>
                <th className="py-2.5 px-3">Finding &amp; Remediation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredFindings.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">{f.id}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={`font-mono font-semibold uppercase ${
                        f.severity === 'critical'
                          ? 'text-rose-600 dark:text-rose-400'
                          : f.severity === 'high'
                          ? 'text-amber-600 dark:text-amber-400'
                          : f.severity === 'medium'
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-500'
                      }`}
                    >
                      {f.severity}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-700 dark:text-slate-300">
                    {f.category}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap font-medium">
                    <button
                      type="button"
                      onClick={() => onSelectProperty(f.propertyNormalized)}
                      className="text-slate-900 dark:text-slate-100 hover:text-blue-600 hover:underline text-left"
                    >
                      {f.propertyDisplay}
                    </button>
                  </td>
                  <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-400">
                    {f.reportingDate || '—'}
                  </td>
                  <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-700 dark:text-slate-300">
                    {f.sourceLocation}
                  </td>
                  <td className="py-2.5 px-3 space-y-1 max-w-xl">
                    <div className="text-slate-900 dark:text-slate-100">{f.message}</div>
                    <div className="text-slate-500 dark:text-slate-400">
                      <strong className="font-medium">Suggested Remediation:</strong> {f.remediation}
                    </div>
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
