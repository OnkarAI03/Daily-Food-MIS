/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Food MIS — Enterprise SaaS Platform Main Application
 * Implements:
 * - Collapsible sidebar with Dashboard, Daily Reports, Properties, Meal Analytics, Data Quality, Audit Logs, Test Center, and Settings
 * - 3-zone Top Navigation Bar + Workspace Context Toolbar (Date range presets, Property multi-select, Status filters, Meal selector, Search, Saved Views, Shareable URLs, RBAC Verifier)
 * - Cross-filtering between KPI cards, Charts, and Data Tables
 * - Record Inspection Modal for drill-down from any KPI or chart segment
 * - Official "Sign in with Google" OAuth integration (`spreadsheets.readonly`)
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  DailyReportRecord,
  DataSourceMode,
  FilterState,
  SavedFilterView,
  SyncDatasetResponse,
  TaskStatus,
  UserRole,
} from './types/domain';
import {
  discoverSpreadsheetTabs,
  fetchSessionInfo,
  generateSanitizedCsvExport,
  syncFoodMisDataset,
} from './services/apiClient';
import { googleSignIn, initAuth, logout } from './services/authService';
import { AnalyticsChartsSection } from './components/AnalyticsCharts';
import {
  DailyReportTable,
  renderTrackedCell,
  renderVarianceCell,
} from './components/DailyReportTable';
import {
  DataQualityCenter,
  PropertyDetailView,
} from './components/PropertyAndQualityViews';
import {
  AuditLogsView,
  SettingsAndOpsView,
  TestCenterView,
} from './components/AuditAndTestViews';
import { ManagementReportView } from './components/ManagementReportView';
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  FileSpreadsheet,
  Filter,
  LayoutDashboard,
  Link2,
  Moon,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  Terminal,
  X,
} from 'lucide-react';

type NavSection =
  | 'dashboard'
  | 'management-report'
  | 'daily-reports'
  | 'properties'
  | 'meal-analytics'
  | 'data-quality'
  | 'audit-logs'
  | 'test-center'
  | 'settings';

const DEFAULT_FILTER: FilterState = {
  startDate: '2026-09-26',
  endDate: '2026-10-09',
  preset: '14d',
  properties: [],
  statuses: [],
  mealFocus: 'ALL',
  searchQuery: '',
  onlyWithAnomalies: false,
};

function parseFilterFromUrl(): Partial<FilterState> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const partial: Partial<FilterState> = {};
  const sd = params.get('start');
  const ed = params.get('end');
  const props = params.get('props');
  const statuses = params.get('status');
  const meal = params.get('meal');
  const q = params.get('q');
  const anom = params.get('anomalies');

  if (sd && /^\d{4}-\d{2}-\d{2}$/.test(sd)) partial.startDate = sd;
  if (ed && /^\d{4}-\d{2}-\d{2}$/.test(ed)) partial.endDate = ed;
  if (props) partial.properties = props.split(',').filter(Boolean);
  if (statuses) partial.statuses = statuses.split(',').filter(Boolean) as TaskStatus[];
  if (meal && ['ALL', 'Breakfast', 'Lunch', 'Dinner'].includes(meal)) {
    partial.mealFocus = meal as FilterState['mealFocus'];
  }
  if (q) partial.searchQuery = q;
  if (anom === '1') partial.onlyWithAnomalies = true;
  return partial;
}

export default function App() {
  // Navigation & Theme State (Only non-sensitive UI preferences stored in localStorage)
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dfmis_theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('dfmis_theme', darkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage errors
    }
  }, [darkMode]);

  // Auth & RBAC State
  const [googleUserEmail, setGoogleUserEmail] = useState<string | null>(null);
  const [hasOAuthToken, setHasOAuthToken] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [rbacDowngradeRole, setRbacDowngradeRole] = useState<UserRole | null>(null);
  const [serverRole, setServerRole] = useState<UserRole>('Administrator');

  // Data Source & Sync State
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>('mock_synthetic');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [taskSheetName, setTaskSheetName] = useState('Task Raw');
  const [scanningSheetName, setScanningSheetName] = useState('Scanning');
  const [businessTimezone, setBusinessTimezone] = useState('Asia/Kolkata');

  const [dataset, setDataset] = useState<SyncDatasetResponse | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Filter & Cross-Filtering State
  const [filter, setFilter] = useState<FilterState>(() => ({
    ...DEFAULT_FILTER,
    ...parseFilterFromUrl(),
  }));

  // Saved Filter Views (non-sensitive filter presets only)
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>(() => {
    try {
      const raw = localStorage.getItem('dfmis_saved_views');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [newViewName, setNewViewName] = useState('');
  const [showSavedViewsMenu, setShowSavedViewsMenu] = useState(false);
  const [showPropertySelectMenu, setShowPropertySelectMenu] = useState(false);
  const [copiedUrlNotice, setCopiedUrlNotice] = useState(false);

  // Selected Property for Property Detail & Selected Record for Drill-down Modal
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [inspectedRecord, setInspectedRecord] = useState<DailyReportRecord | null>(null);
  const [showSheetConnectModal, setShowSheetConnectModal] = useState(false);
  const [modalSheetInput, setModalSheetInput] = useState('');
  const [modalTaskTab, setModalTaskTab] = useState('Task Raw');
  const [modalScanTab, setModalScanTab] = useState('Scanning');
  const [modalDiscoveredTabs, setModalDiscoveredTabs] = useState<string[]>([]);
  const [modalSheetTitle, setModalSheetTitle] = useState<string | null>(null);
  const [modalDiscovering, setModalDiscovering] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // AbortController ref for cancelling stale sync requests on rapid date range changes
  const syncAbortRef = useRef<AbortController | null>(null);

  // Initialize Firebase Google Auth listener
  useEffect(() => {
    const unsub = initAuth(
      (user, token) => {
        setGoogleUserEmail(user.email);
        setHasOAuthToken(Boolean(token));
      },
      () => {
        setGoogleUserEmail(null);
        setHasOAuthToken(false);
      }
    );
    return () => unsub();
  }, []);

  // Verify session with backend
  useEffect(() => {
    const controller = new AbortController();
    fetchSessionInfo(rbacDowngradeRole, controller.signal)
      .then((info) => {
        setServerRole(info.actor.role);
      })
      .catch(() => {
        // Handled by sync error state if unauthorized
      });
    return () => controller.abort();
  }, [rbacDowngradeRole, hasOAuthToken]);

  // Synchronize dataset with backend (protected with AbortController against stale responses)
  const triggerSync = useCallback(
    async (overrideParams?: {
      mode?: DataSourceMode;
      spreadsheetId?: string;
      taskSheetName?: string;
      scanningSheetName?: string;
      businessTimezone?: string;
      startDate?: string;
      endDate?: string;
    }) => {
      if (syncAbortRef.current) {
        syncAbortRef.current.abort();
      }
      const controller = new AbortController();
      syncAbortRef.current = controller;

      setLoadingData(true);
      setSyncError(null);

      try {
        const res = await syncFoodMisDataset(
          {
            mode: overrideParams?.mode ?? dataSourceMode,
            spreadsheetId: overrideParams?.spreadsheetId ?? spreadsheetId,
            taskSheetName: overrideParams?.taskSheetName ?? taskSheetName,
            scanningSheetName: overrideParams?.scanningSheetName ?? scanningSheetName,
            businessTimezone: overrideParams?.businessTimezone ?? businessTimezone,
            startDate: overrideParams?.startDate ?? filter.startDate,
            endDate: overrideParams?.endDate ?? filter.endDate,
            rbacDowngradeRole,
          },
          controller.signal
        );
        setDataset(res);
        if (
          res.mode === 'google_sheets_live' &&
          res.kpis.reportingPeriodStart &&
          res.kpis.reportingPeriodEnd &&
          (res.kpis.reportingPeriodStart !== (overrideParams?.startDate ?? filter.startDate) ||
            res.kpis.reportingPeriodEnd !== (overrideParams?.endDate ?? filter.endDate))
        ) {
          setFilter((prev) => ({
            ...prev,
            preset: 'custom',
            startDate: res.kpis.reportingPeriodStart,
            endDate: res.kpis.reportingPeriodEnd,
          }));
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setSyncError(err?.message || 'Unable to synchronize Daily Food MIS dataset.');
      } finally {
        if (syncAbortRef.current === controller) {
          setLoadingData(false);
        }
      }
    },
    [
      dataSourceMode,
      spreadsheetId,
      taskSheetName,
      scanningSheetName,
      businessTimezone,
      filter.startDate,
      filter.endDate,
      rbacDowngradeRole,
    ]
  );

  useEffect(() => {
    triggerSync();
  }, [triggerSync]);

  // Apply client-side interactive filters (Property multi-select, Status, Search, Anomalies)
  const filteredRecords = useMemo(() => {
    if (!dataset) return [];
    return dataset.records.filter((r) => {
      if (filter.properties.length > 0 && !filter.properties.includes(r.propertyNormalized)) {
        return false;
      }
      if (filter.statuses.length > 0 && !filter.statuses.includes(r.taskStatus)) {
        return false;
      }
      if (filter.onlyWithAnomalies && r.findingsCount === 0) {
        return false;
      }
      if (filter.searchQuery.trim()) {
        const q = filter.searchQuery.toLowerCase();
        const match =
          r.propertyDisplay.toLowerCase().includes(q) ||
          r.reportingDate.includes(q) ||
          r.taskStatus.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [dataset, filter.properties, filter.statuses, filter.onlyWithAnomalies, filter.searchQuery]);

  // Recompute dynamic KPIs for currently cross-filtered records
  const activeKpis = useMemo(() => {
    if (!dataset) return null;
    if (
      filter.properties.length === 0 &&
      filter.statuses.length === 0 &&
      !filter.onlyWithAnomalies &&
      !filter.searchQuery.trim()
    ) {
      return dataset.kpis;
    }

    const sumMeal = (selector: (r: DailyReportRecord) => DailyReportRecord['breakfast']) => {
      let orderedTotal = 0,
        consumedTotal = 0,
        scannedTotal = 0,
        pairedOrd = 0,
        pairedCon = 0,
        validOrd = 0,
        validCon = 0,
        validScn = 0,
        missingCount = 0;

      for (const r of filteredRecords) {
        const m = selector(r);
        if (m.ordered.value !== null) {
          orderedTotal += m.ordered.value;
          validOrd++;
        } else missingCount++;

        if (m.consumed.value !== null) {
          consumedTotal += m.consumed.value;
          validCon++;
        } else missingCount++;

        if (m.scanned.value !== null) {
          scannedTotal += m.scanned.value;
          validScn++;
        } else missingCount++;

        if (m.ordered.value !== null && m.consumed.value !== null) {
          pairedOrd += m.ordered.value;
          pairedCon += m.consumed.value;
        }
      }
      return {
        orderedTotal,
        consumedTotal,
        scannedTotal,
        varianceTotal: pairedOrd - pairedCon,
        validOrderedCount: validOrd,
        validConsumedCount: validCon,
        validScannedCount: validScn,
        missingOrInvalidCount: missingCount,
      };
    };

    const propsReporting = new Set(filteredRecords.map((r) => r.propertyNormalized));
    return {
      ...dataset.kpis,
      totalPropertiesReporting: propsReporting.size,
      totalValidReports: filteredRecords.length,
      reportsCompleted: filteredRecords.filter((r) => r.taskStatus === 'Completed').length,
      reportsPending: filteredRecords.filter((r) => r.taskStatus === 'Pending').length,
      reportsOverdue: filteredRecords.filter((r) => r.taskStatus === 'Overdue').length,
      reportsInProgress: filteredRecords.filter((r) => r.taskStatus === 'In Progress').length,
      breakfast: sumMeal((r) => r.breakfast),
      lunch: sumMeal((r) => r.lunch),
      dinner: sumMeal((r) => r.dinner),
    };
  }, [dataset, filteredRecords, filter]);

  // Date Preset Handler (Dynamically uses availableDateRange.maxDate when connected to a live sheet)
  const applyDatePreset = (preset: FilterState['preset']) => {
    const anchorEnd =
      dataset?.availableDateRange?.maxDate && /^\d{4}-\d{2}-\d{2}$/.test(dataset.availableDateRange.maxDate)
        ? dataset.availableDateRange.maxDate
        : '2026-10-09';

    const shiftDays = (isoDate: string, deltaDays: number): string => {
      const [y, m, d] = isoDate.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
      return dt.toISOString().slice(0, 10);
    };

    let start = shiftDays(anchorEnd, -13);
    if (preset === '7d') start = shiftDays(anchorEnd, -6);
    else if (preset === '14d') start = shiftDays(anchorEnd, -13);
    else if (preset === '30d') start = shiftDays(anchorEnd, -29);
    else if (preset === 'all') {
      start =
        dataset?.availableDateRange?.minDate && /^\d{4}-\d{2}-\d{2}$/.test(dataset.availableDateRange.minDate)
          ? dataset.availableDateRange.minDate
          : shiftDays(anchorEnd, -27);
    } else if (preset === 'mtd') {
      start = `${anchorEnd.slice(0, 8)}01`;
    }

    setFilter((prev) => ({
      ...prev,
      preset,
      startDate: start,
      endDate: anchorEnd,
    }));
  };

  // Shareable Filter URL (never exposes credentials or tokens)
  const handleShareFilterUrl = () => {
    const params = new URLSearchParams();
    params.set('start', filter.startDate);
    params.set('end', filter.endDate);
    if (filter.properties.length > 0) params.set('props', filter.properties.join(','));
    if (filter.statuses.length > 0) params.set('status', filter.statuses.join(','));
    if (filter.mealFocus !== 'ALL') params.set('meal', filter.mealFocus);
    if (filter.searchQuery.trim()) params.set('q', filter.searchQuery.trim());
    if (filter.onlyWithAnomalies) params.set('anomalies', '1');

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
    setCopiedUrlNotice(true);
    setTimeout(() => setCopiedUrlNotice(false), 2500);
  };

  // Save named filter view
  const handleSaveFilterView = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newViewName.trim()) return;
    const view: SavedFilterView = {
      id: `VW-${Date.now().toString(36)}`,
      name: newViewName.trim(),
      createdAt: new Date().toISOString().slice(0, 10),
      filter: { ...filter },
    };
    const updated = [view, ...savedViews].slice(0, 12);
    setSavedViews(updated);
    setNewViewName('');
    try {
      localStorage.setItem('dfmis_saved_views', JSON.stringify(updated));
    } catch {
      // Ignore storage error
    }
  };

  // Sanitized CSV Export Handler
  const handleExportCsv = async () => {
    if (filteredRecords.length === 0) return;
    setIsExporting(true);
    try {
      const formatMetric = (val: number | null, status: string) => {
        if (status === 'valid_zero') return 0;
        if (status === 'valid_number' && val !== null) return val;
        return status.toUpperCase();
      };

      const rows = filteredRecords.map((r) => ({
        propertyDisplay: r.propertyDisplay,
        reportingDate: r.reportingDate,
        taskStatus: r.taskStatus,
        completedAtDisplay: r.completedAtDisplay,
        breakfastOrdered: formatMetric(r.breakfast.ordered.value, r.breakfast.ordered.status),
        breakfastConsumed: formatMetric(r.breakfast.consumed.value, r.breakfast.consumed.status),
        breakfastScanned: formatMetric(r.breakfast.scanned.value, r.breakfast.scanned.status),
        breakfastDifference: r.breakfast.variance ?? 'N/A',
        lunchOrdered: formatMetric(r.lunch.ordered.value, r.lunch.ordered.status),
        lunchConsumed: formatMetric(r.lunch.consumed.value, r.lunch.consumed.status),
        lunchScanned: formatMetric(r.lunch.scanned.value, r.lunch.scanned.status),
        lunchDifference: r.lunch.variance ?? 'N/A',
        dinnerOrdered: formatMetric(r.dinner.ordered.value, r.dinner.ordered.status),
        dinnerConsumed: formatMetric(r.dinner.consumed.value, r.dinner.consumed.status),
        dinnerScanned: formatMetric(r.dinner.scanned.value, r.dinner.scanned.status),
        dinnerDifference: r.dinner.variance ?? 'N/A',
      }));

      const res = await generateSanitizedCsvExport({
        rows,
        filterSummary: `${filter.startDate}..${filter.endDate} (${filteredRecords.length} records)`,
        rbacDowngradeRole,
      });

      const blob = new Blob([res.csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily-food-mis-${filter.startDate}-to-${filter.endDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setSyncError(err?.message || 'CSV export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  // Google Sign-In Handler
  const handleGoogleLogin = async () => {
    setIsSigningIn(true);
    setSyncError(null);
    setModalError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setGoogleUserEmail(result.user.email);
        setHasOAuthToken(true);
        if (spreadsheetId.trim()) {
          await triggerSync({
            mode: 'google_sheets_live',
            spreadsheetId: spreadsheetId.trim(),
          });
        } else {
          await triggerSync();
        }
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/user-cancelled'
      ) {
        return;
      }
      const msg =
        code === 'auth/unauthorized-domain'
          ? 'Google Sign-In popup blocked by Firebase domain restriction. You can still load your Google Sheet immediately by pasting the Sheet URL below (ensure the sheet is shared as "Anyone with the link can view").'
          : err?.message || 'Google Sign-In failed. You can also connect a link-shared Google Sheet directly below.';
      setSyncError(msg);
      setModalError(msg);
    } finally {
      setIsSigningIn(false);
    }
  };

  const navItems: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'management-report', label: 'Management Report', icon: SlidersHorizontal },
    { id: 'daily-reports', label: 'Daily Reports', icon: FileSpreadsheet },
    { id: 'properties', label: 'Properties', icon: Building2 },
    { id: 'meal-analytics', label: 'Meal Analytics', icon: BarChart3 },
    { id: 'data-quality', label: 'Data Quality', icon: ShieldAlert },
    { id: 'audit-logs', label: 'Audit Logs', icon: Shield },
    { id: 'test-center', label: 'Test Center', icon: Terminal },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const hasActiveFilters =
    filter.properties.length > 0 ||
    filter.statuses.length > 0 ||
    filter.mealFocus !== 'ALL' ||
    Boolean(filter.searchQuery.trim()) ||
    filter.onlyWithAnomalies;

  const openSheetConnectDialog = () => {
    setModalSheetInput(spreadsheetId);
    setModalTaskTab(taskSheetName);
    setModalScanTab(scanningSheetName);
    setModalDiscoveredTabs(dataset?.discoveredTabs || []);
    setModalSheetTitle(dataset?.spreadsheetTitle || null);
    setModalError(null);
    setShowSheetConnectModal(true);
  };

  const handleModalDiscoverTabs = async () => {
    if (!modalSheetInput.trim()) {
      setModalError('Paste your Google Spreadsheet URL or ID first.');
      return;
    }
    setModalDiscovering(true);
    setModalError(null);
    try {
      const meta = await discoverSpreadsheetTabs({
        spreadsheetId: modalSheetInput,
        rbacDowngradeRole,
      });
      setModalSheetInput(meta.spreadsheetId);
      setModalSheetTitle(meta.title);
      setModalDiscoveredTabs(meta.sheetNames);
      setModalTaskTab(meta.suggestedTaskTab);
      setModalScanTab(meta.suggestedScanTab);
    } catch (err: any) {
      setModalError(err?.message || 'Unable to inspect spreadsheet tabs.');
    } finally {
      setModalDiscovering(false);
    }
  };

  const handleModalConnectAndSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalSheetInput.trim()) {
      setModalError('Please enter a Google Spreadsheet URL or ID.');
      return;
    }
    setModalError(null);
    const nextId = modalSheetInput.trim();
    const nextTask = modalTaskTab.trim() || 'Task Raw';
    const nextScan = modalScanTab.trim() || 'Scanning';

    setDataSourceMode('google_sheets_live');
    setSpreadsheetId(nextId);
    setTaskSheetName(nextTask);
    setScanningSheetName(nextScan);
    setShowSheetConnectModal(false);

    await triggerSync({
      mode: 'google_sheets_live',
      spreadsheetId: nextId,
      taskSheetName: nextTask,
      scanningSheetName: nextScan,
    });
  };

  return (
    <div className="min-h-screen flex glass-canvas text-slate-900 dark:text-slate-100">
      {/* Collapsible Enterprise Glassmorphism Sidebar */}
      <aside
        className={`no-print shrink-0 glass-sidebar flex flex-col justify-between transition-all duration-150 ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div>
          {/* Sidebar Brand Header */}
          <div className="h-14 px-4 border-b border-slate-200/70 dark:border-slate-800/70 flex items-center justify-between">
            {!sidebarCollapsed && (
              <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap truncate">
                Daily Food MIS
              </span>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
            >
              {sidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Primary Sidebar Navigation */}
          <nav className="p-2 space-y-1" aria-label="Main Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-blue-600/12 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-semibold shadow-2xs border border-blue-500/20'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="flex-1 text-left truncate">{item.label}</span>
                  )}
                  {!sidebarCollapsed && item.id === 'data-quality' && dataset && dataset.findings.length > 0 && (
                    <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
                      {dataset.findings.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Connection & Timezone Info */}
        {!sidebarCollapsed && (
          <div className="p-3 m-2 rounded-xl glass-subtle text-[11px] space-y-1.5 text-slate-600 dark:text-slate-400">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800 dark:text-slate-200">Source Mode</span>
              <span className="font-mono">
                {dataset?.mode === 'google_sheets_live' ? 'Live Sheets' : 'Synthetic Fixture'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Timezone</span>
              <span className="font-mono">{businessTimezone}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Active Role</span>
              <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                {serverRole}
              </span>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Strict 3-Zone Top Bar Contract per Frontend Design Constitution */}
        <header className="no-print h-14 px-6 glass-header flex items-center justify-between gap-8 shrink-0 sticky top-0 z-20">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#dashboard"
            onClick={(e) => {
              e.preventDefault();
              setActiveNav('dashboard');
            }}
            className="text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            Daily Food MIS
          </a>

          {/* Zone 2: 5 concise single-line text navigation links */}
          <nav className="hidden xl:flex items-center gap-6 text-xs font-medium text-slate-600 dark:text-slate-400">
            <button
              type="button"
              onClick={() => setActiveNav('dashboard')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activeNav === 'dashboard' ? 'text-slate-900 dark:text-white underline underline-offset-4' : ''
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('management-report')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activeNav === 'management-report' ? 'text-slate-900 dark:text-white underline underline-offset-4' : ''
              }`}
            >
              Management Report
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('daily-reports')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activeNav === 'daily-reports' ? 'text-slate-900 dark:text-white underline underline-offset-4' : ''
              }`}
            >
              Daily Reports
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('data-quality')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activeNav === 'data-quality' ? 'text-slate-900 dark:text-white underline underline-offset-4' : ''
              }`}
            >
              Data Quality
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('test-center')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
                activeNav === 'test-center' ? 'text-slate-900 dark:text-white underline underline-offset-4' : ''
              }`}
            >
              Test Center
            </button>
          </nav>

          {/* Zone 3: Primary Action (Official Sign in with Google or Connect/Sync Live Sheet) */}
          <div className="flex items-center gap-3 shrink-0">
            {!hasOAuthToken ? (
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isSigningIn}
                className="gsi-material-button"
              >
                <div className="gsi-material-button-state"></div>
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      ></path>
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      ></path>
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      ></path>
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      ></path>
                      <path fill="none" d="M0 0h48v48H0z"></path>
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {isSigningIn ? 'Connecting...' : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            ) : (
              <button
                type="button"
                onClick={openSheetConnectDialog}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors whitespace-nowrap shrink-0"
              >
                {dataset?.mode === 'google_sheets_live' ? 'Change Google Sheet' : 'Connect Google Sheet'}
              </button>
            )}
          </div>
        </header>

        {/* Secondary Operational Status & Interactive Filter Toolbar */}
        <div className="no-print glass-header px-6 py-3 space-y-3">
          {/* Operational Telemetry Row: Sync freshness, Mode, Connect Sheet, RBAC Role Switcher, Theme */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openSheetConnectDialog}
                className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="Click to connect or switch Google Sheet URL"
              >
                <Database className="w-3.5 h-3.5 text-blue-600" />
                {dataset?.mode === 'google_sheets_live'
                  ? `Live Sheet: ${dataset.spreadsheetTitle || dataset.spreadsheetIdMasked} (${dataset.taskSheetName} + ${dataset.scanningSheetName})`
                  : 'Synthetic Fixture Dataset (Click to Connect Live Google Sheet)'}
              </button>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Last Sync:{' '}
                {dataset?.lastSyncedAtUtc
                  ? `${dataset.lastSyncedAtUtc.slice(11, 19)} UTC`
                  : 'Syncing...'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">TZ: {businessTimezone}</span>
              {googleUserEmail && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    OAuth: <strong className="font-mono">{googleUserEmail}</strong> (
                    <button
                      type="button"
                      onClick={() => logout()}
                      className="text-blue-600 hover:underline"
                    >
                      Disconnect
                    </button>
                    )
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Quick Connect Google Sheet Button */}
              <button
                type="button"
                onClick={openSheetConnectDialog}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md glass-subtle hover:border-blue-500 text-xs font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                {dataset?.mode === 'google_sheets_live' ? 'Sheet Settings' : 'Load Google Sheet'}
              </button>

              {/* Server-Side RBAC Enforcement Verifier */}
              <label className="inline-flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Test Server RBAC Role:</span>
                <select
                  value={rbacDowngradeRole || 'Administrator'}
                  onChange={(e) => {
                    const val = e.target.value as UserRole;
                    setRbacDowngradeRole(val === 'Administrator' ? null : val);
                  }}
                  className="glass-subtle rounded-md px-2 py-1 text-xs font-medium text-slate-900 dark:text-slate-100"
                >
                  <option value="Administrator">Administrator (Full Access)</option>
                  <option value="Analyst">Analyst (Deny Admin/Audit)</option>
                  <option value="Viewer">Viewer (Read &amp; Approved Export)</option>
                </select>
              </label>

              {/* Refresh Button */}
              <button
                type="button"
                onClick={() => triggerSync()}
                disabled={loadingData}
                title="Refresh synchronization"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md glass-subtle hover:bg-white/80 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
                Refresh
              </button>

              {/* Light / Dark Theme Toggle */}
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                aria-label="Toggle color theme"
                className="p-1.5 rounded-md glass-subtle hover:bg-white/80 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Interactive Global Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex flex-wrap items-center gap-2">
              {/* Quick Date Presets */}
              <div className="flex items-center gap-1 p-1 glass-subtle rounded-lg">
                {(
                  [
                    { id: '7d', label: 'Last 7 Days' },
                    { id: '14d', label: 'Last 14 Days' },
                    { id: 'mtd', label: 'Month to Date' },
                    { id: 'all', label: 'All Available Dates' },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyDatePreset(p.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      filter.preset === p.id
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Explicit Date Range Inputs */}
              <div className="inline-flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1 text-xs font-mono tabular-nums">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="date"
                  value={filter.startDate}
                  onChange={(e) =>
                    setFilter((prev) => ({
                      ...prev,
                      preset: 'custom',
                      startDate: e.target.value,
                    }))
                  }
                  aria-label="Reporting start date"
                  className="bg-transparent focus:outline-none text-slate-800 dark:text-slate-200"
                />
                <span className="text-slate-400">→</span>
                <input
                  type="date"
                  value={filter.endDate}
                  onChange={(e) =>
                    setFilter((prev) => ({
                      ...prev,
                      preset: 'custom',
                      endDate: e.target.value,
                    }))
                  }
                  aria-label="Reporting end date"
                  className="bg-transparent focus:outline-none text-slate-800 dark:text-slate-200"
                />
              </div>

              {/* Property Multi-Select Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowPropertySelectMenu((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200 hover:border-slate-300 whitespace-nowrap shrink-0"
                >
                  <Building2 className="w-3.5 h-3.5 text-slate-500" />
                  Properties ({filter.properties.length === 0 ? 'All' : filter.properties.length})
                </button>

                {showPropertySelectMenu && dataset && (
                  <div className="absolute left-0 top-9 z-30 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
                      <span className="font-semibold">Filter Properties</span>
                      <button
                        type="button"
                        onClick={() => setFilter((prev) => ({ ...prev, properties: [] }))}
                        className="text-blue-600 hover:underline text-[11px]"
                      >
                        Select All
                      </button>
                    </div>
                    <div className="max-h-56 overflow-y-auto space-y-1">
                      {dataset.properties.map((prop) => {
                        const checked = filter.properties.includes(prop.normalizedId);
                        return (
                          <label
                            key={prop.normalizedId}
                            className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <span className="truncate pr-2">{prop.displayName}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const isChecked = e.target.checked;
                                setFilter((prev) => ({
                                  ...prev,
                                  properties: isChecked
                                    ? [...prev.properties, prop.normalizedId]
                                    : prev.properties.filter((id) => id !== prop.normalizedId),
                                }));
                              }}
                              className="rounded border-slate-300 text-blue-600"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Meal Focus Selector */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
                {(['ALL', 'Breakfast', 'Lunch', 'Dinner'] as const).map((meal) => (
                  <button
                    key={meal}
                    type="button"
                    onClick={() => setFilter((prev) => ({ ...prev, mealFocus: meal }))}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      filter.mealFocus === meal
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {meal === 'ALL' ? 'All Meals' : meal}
                  </button>
                ))}
              </div>

              {/* Search Input */}
              <div className="relative w-48 sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={filter.searchQuery}
                  onChange={(e) => setFilter((prev) => ({ ...prev, searchQuery: e.target.value }))}
                  placeholder="Search property, status..."
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Right Controls: Saved Views, Shareable URL, Reset */}
            <div className="flex items-center gap-2 relative">
              <button
                type="button"
                onClick={() => setShowSavedViewsMenu((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Bookmark className="w-3.5 h-3.5" />
                Saved Views ({savedViews.length})
              </button>

              {showSavedViewsMenu && (
                <div className="absolute right-0 top-9 z-30 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-3 space-y-3 text-xs">
                  <form onSubmit={handleSaveFilterView} className="flex gap-1.5">
                    <input
                      type="text"
                      value={newViewName}
                      onChange={(e) => setNewViewName(e.target.value)}
                      placeholder="Save current filter as..."
                      className="flex-1 px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1 bg-blue-600 text-white rounded font-medium"
                    >
                      Save
                    </button>
                  </form>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto">
                    {savedViews.length === 0 ? (
                      <div className="py-2 text-slate-400 text-center">No saved views yet.</div>
                    ) : (
                      savedViews.map((vw) => (
                        <div key={vw.id} className="py-1.5 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setFilter(vw.filter);
                              setShowSavedViewsMenu(false);
                            }}
                            className="font-medium text-left hover:text-blue-600 truncate"
                          >
                            {vw.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = savedViews.filter((x) => x.id !== vw.id);
                              setSavedViews(next);
                              try {
                                localStorage.setItem('dfmis_saved_views', JSON.stringify(next));
                              } catch {}
                            }}
                            className="text-slate-400 hover:text-rose-600"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleShareFilterUrl}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Link2 className="w-3.5 h-3.5" />
                {copiedUrlNotice ? 'URL Copied!' : 'Share View'}
              </button>

              {(hasActiveFilters || filter.preset !== '14d') && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter(DEFAULT_FILTER);
                    window.history.replaceState({}, '', window.location.pathname);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset All
                </button>
              )}
            </div>
          </div>

          {/* Active Filter Summary Line (Unboxed clean metadata with Interactive Clear buttons) */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-200 inline-flex items-center gap-1">
                <Filter className="w-3 h-3" /> Active Filters ({filteredRecords.length} matching records):
              </span>
              {filter.properties.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilter((p) => ({ ...p, properties: [] }))}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200"
                >
                  Properties: {filter.properties.length} <X className="w-3 h-3" />
                </button>
              )}
              {filter.statuses.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilter((p) => ({ ...p, statuses: [] }))}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200"
                >
                  Status: {filter.statuses.join(', ')} <X className="w-3 h-3" />
                </button>
              )}
              {filter.mealFocus !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setFilter((p) => ({ ...p, mealFocus: 'ALL' }))}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200"
                >
                  Meal: {filter.mealFocus} <X className="w-3 h-3" />
                </button>
              )}
              {filter.onlyWithAnomalies && (
                <button
                  type="button"
                  onClick={() => setFilter((p) => ({ ...p, onlyWithAnomalies: false }))}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300"
                >
                  With Data Quality Findings Only <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Main Workspace Body */}
        <main className="flex-1 p-6 space-y-6 overflow-y-auto">
          {syncError && (
            <div className="border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-rose-800 dark:text-rose-300">
              <div className="space-y-1">
                <div className="font-semibold flex items-center gap-1.5 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  Data Synchronization or Permission Alert
                </div>
                <p>{syncError}</p>
              </div>
              <div className="flex items-center gap-2">
                {dataSourceMode === 'google_sheets_live' && (
                  <button
                    type="button"
                    onClick={() => {
                      setDataSourceMode('mock_synthetic');
                      triggerSync({ mode: 'mock_synthetic' });
                    }}
                    className="px-3 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium"
                  >
                    Switch to Synthetic Fixture Mode
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => triggerSync()}
                  className="px-3 py-1.5 rounded bg-rose-600 text-white font-medium hover:bg-rose-700"
                >
                  Retry Sync
                </button>
              </div>
            </div>
          )}

          {/* Loading Skeleton */}
          {loadingData && !dataset ? (
            <div className="space-y-6 animate-pulse">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-28 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4"
                  />
                ))}
              </div>
              <div className="h-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg" />
            </div>
          ) : dataset && activeKpis ? (
            <>
              {/* VIEW 1: EXECUTIVE DASHBOARD */}
              {activeNav === 'dashboard' && (
                <div className="space-y-6">
                  {/* Row 1: Executive Overview KPI Cards (Interactive Cross-Filter Triggers) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {/* KPI 1: Properties Reporting & Daily Task Status */}
                    <button
                      type="button"
                      onClick={() =>
                        setFilter((prev) => ({
                          ...prev,
                          statuses:
                            prev.statuses.includes('Overdue') || prev.statuses.includes('Pending')
                              ? []
                              : ['Pending', 'Overdue'],
                        }))
                      }
                      className="text-left glass-panel hover:border-blue-500 dark:hover:border-blue-400 rounded-xl p-4 transition-all space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                        <span>Properties Reporting &amp; Report Status</span>
                        <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400">
                          {activeKpis.totalPropertiesReporting} of {activeKpis.totalPropertiesKnown} Properties
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <div>
                          <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                            {activeKpis.reportsCompleted}
                          </span>
                          <span className="text-xs text-slate-500 ml-1.5">
                            of {activeKpis.totalValidReports} Reports Completed
                          </span>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        <div>
                          <span className="block text-slate-400 font-sans">Pending</span>
                          <strong className="text-slate-800 dark:text-slate-200">{activeKpis.reportsPending}</strong>
                        </div>
                        <div>
                          <span className="block text-slate-400 font-sans">Overdue</span>
                          <strong
                            className={
                              activeKpis.reportsOverdue > 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-800 dark:text-slate-200'
                            }
                          >
                            {activeKpis.reportsOverdue}
                          </strong>
                        </div>
                        <div>
                          <span className="block text-slate-400 font-sans">In Progress</span>
                          <strong className="text-slate-800 dark:text-slate-200">{activeKpis.reportsInProgress}</strong>
                        </div>
                      </div>
                    </button>

                    {/* KPI 2: Breakfast Full Summary */}
                    <button
                      type="button"
                      onClick={() =>
                        setFilter((prev) => ({
                          ...prev,
                          mealFocus: prev.mealFocus === 'Breakfast' ? 'ALL' : 'Breakfast',
                        }))
                      }
                      className={`text-left glass-panel rounded-xl p-4 transition-all space-y-2.5 ${
                        filter.mealFocus === 'Breakfast'
                          ? 'ring-2 ring-blue-600 dark:ring-blue-400'
                          : 'hover:border-blue-500'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          Breakfast Summary
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          Columns AS · AT · E
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 font-mono tabular-nums text-xs">
                        <div>
                          <div className="text-[11px] font-sans text-slate-500">Breakfast Ordered</div>
                          <div className="text-lg font-bold text-slate-900 dark:text-white">
                            {activeKpis.breakfast.orderedTotal.toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-sans text-slate-500">Breakfast Consumed</div>
                          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                            {activeKpis.breakfast.consumedTotal.toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                        <div>
                          <span className="block text-[11px] font-sans text-slate-500">QR Scanned</span>
                          <strong className="text-teal-600 dark:text-teal-400">
                            {activeKpis.breakfast.scannedTotal.toLocaleString()}
                          </strong>
                        </div>
                        <div>
                          <span className="block text-[11px] font-sans text-slate-500">
                            Difference (Ord − Con)
                          </span>
                          <strong
                            className={
                              activeKpis.breakfast.varianceTotal < 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-900 dark:text-white'
                            }
                          >
                            {activeKpis.breakfast.varianceTotal >= 0
                              ? `+${activeKpis.breakfast.varianceTotal.toLocaleString()}`
                              : activeKpis.breakfast.varianceTotal.toLocaleString()}
                          </strong>
                        </div>
                      </div>
                    </button>

                    {/* KPI 3: Lunch Full Summary */}
                    <button
                      type="button"
                      onClick={() =>
                        setFilter((prev) => ({
                          ...prev,
                          mealFocus: prev.mealFocus === 'Lunch' ? 'ALL' : 'Lunch',
                        }))
                      }
                      className={`text-left glass-panel rounded-xl p-4 transition-all space-y-2.5 ${
                        filter.mealFocus === 'Lunch'
                          ? 'ring-2 ring-blue-600 dark:ring-blue-400'
                          : 'hover:border-blue-500'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          Lunch Summary
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          Columns AU · AV · F
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 font-mono tabular-nums text-xs">
                        <div>
                          <div className="text-[11px] font-sans text-slate-500">Lunch Ordered</div>
                          <div className="text-lg font-bold text-slate-900 dark:text-white">
                            {activeKpis.lunch.orderedTotal.toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-sans text-slate-500">Lunch Consumed</div>
                          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                            {activeKpis.lunch.consumedTotal.toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                        <div>
                          <span className="block text-[11px] font-sans text-slate-500">QR Scanned</span>
                          <strong className="text-teal-600 dark:text-teal-400">
                            {activeKpis.lunch.scannedTotal.toLocaleString()}
                          </strong>
                        </div>
                        <div>
                          <span className="block text-[11px] font-sans text-slate-500">
                            Difference (Ord − Con)
                          </span>
                          <strong
                            className={
                              activeKpis.lunch.varianceTotal < 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-900 dark:text-white'
                            }
                          >
                            {activeKpis.lunch.varianceTotal >= 0
                              ? `+${activeKpis.lunch.varianceTotal.toLocaleString()}`
                              : activeKpis.lunch.varianceTotal.toLocaleString()}
                          </strong>
                        </div>
                      </div>
                    </button>

                    {/* KPI 4: Dinner Full Summary */}
                    <button
                      type="button"
                      onClick={() =>
                        setFilter((prev) => ({
                          ...prev,
                          mealFocus: prev.mealFocus === 'Dinner' ? 'ALL' : 'Dinner',
                        }))
                      }
                      className={`text-left glass-panel rounded-xl p-4 transition-all space-y-2.5 ${
                        filter.mealFocus === 'Dinner'
                          ? 'ring-2 ring-blue-600 dark:ring-blue-400'
                          : 'hover:border-blue-500'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          Dinner Summary
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          Columns AW · AX · G
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 font-mono tabular-nums text-xs">
                        <div>
                          <div className="text-[11px] font-sans text-slate-500">Dinner Ordered</div>
                          <div className="text-lg font-bold text-slate-900 dark:text-white">
                            {activeKpis.dinner.orderedTotal.toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-sans text-slate-500">Dinner Consumed</div>
                          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                            {activeKpis.dinner.consumedTotal.toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                        <div>
                          <span className="block text-[11px] font-sans text-slate-500">QR Scanned</span>
                          <strong className="text-teal-600 dark:text-teal-400">
                            {activeKpis.dinner.scannedTotal.toLocaleString()}
                          </strong>
                        </div>
                        <div>
                          <span className="block text-[11px] font-sans text-slate-500">
                            Difference (Ord − Con)
                          </span>
                          <strong
                            className={
                              activeKpis.dinner.varianceTotal < 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-900 dark:text-white'
                            }
                          >
                            {activeKpis.dinner.varianceTotal >= 0
                              ? `+${activeKpis.dinner.varianceTotal.toLocaleString()}`
                              : activeKpis.dinner.varianceTotal.toLocaleString()}
                          </strong>
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* Period-Over-Period & Data Integrity Strip */}
                  <div className="glass-panel rounded-xl px-5 py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                    <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-400">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        Period-over-Period ({dataset.kpis.periodOverPeriod.previousPeriodStart} to{' '}
                        {dataset.kpis.periodOverPeriod.previousPeriodEnd}):
                      </span>
                      {dataset.kpis.periodOverPeriod.hasComparableHistory ? (
                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          <span>
                            Ordered:{' '}
                            <strong>
                              {dataset.kpis.periodOverPeriod.orderedChangePct! >= 0 ? '+' : ''}
                              {dataset.kpis.periodOverPeriod.orderedChangePct}%
                            </strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Consumed:{' '}
                            <strong>
                              {dataset.kpis.periodOverPeriod.consumedChangePct! >= 0 ? '+' : ''}
                              {dataset.kpis.periodOverPeriod.consumedChangePct}%
                            </strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            QR Scanned:{' '}
                            <strong>
                              {dataset.kpis.periodOverPeriod.scannedChangePct! >= 0 ? '+' : ''}
                              {dataset.kpis.periodOverPeriod.scannedChangePct}%
                            </strong>
                          </span>
                        </div>
                      ) : (
                        <span>No prior historical window available in source</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setFilter((prev) => ({
                            ...prev,
                            onlyWithAnomalies: !prev.onlyWithAnomalies,
                          }))
                        }
                        className="font-mono text-amber-700 dark:text-amber-400 hover:underline"
                      >
                        {dataset.kpis.dataQualityWarningCount} Data Quality Warnings (
                        {dataset.kpis.criticalFindingsCount} High/Critical)
                      </button>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() => setActiveNav('data-quality')}
                        className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Open Data Quality Center →
                      </button>
                    </div>
                  </div>

                  {/* Interactive Analytics Charts */}
                  <AnalyticsChartsSection
                    records={filteredRecords}
                    kpis={activeKpis}
                    mealFocus={filter.mealFocus}
                    startDate={filter.startDate}
                    endDate={filter.endDate}
                    onChangeMealFocus={(meal) =>
                      setFilter((prev) => ({ ...prev, mealFocus: meal }))
                    }
                    onOpenManagementWorkbench={() => setActiveNav('management-report')}
                    onSelectProperty={(propId) => {
                      setSelectedPropertyId(propId);
                      setActiveNav('properties');
                    }}
                    onSelectDateFilter={(dateStr) => {
                      setFilter((prev) => ({
                        ...prev,
                        preset: 'custom',
                        startDate: dateStr,
                        endDate: dateStr,
                      }));
                    }}
                    onSelectStatusFilter={(status) => {
                      setFilter((prev) => ({
                        ...prev,
                        statuses: prev.statuses.includes(status) ? [] : [status],
                      }));
                    }}
                    onInspectRecord={(rec) => setInspectedRecord(rec)}
                  />

                  {/* Daily Report Table */}
                  <DailyReportTable
                    records={filteredRecords}
                    onSelectProperty={(propId) => {
                      setSelectedPropertyId(propId);
                      setActiveNav('properties');
                    }}
                    onInspectRecord={(rec) => setInspectedRecord(rec)}
                    onExportCsv={handleExportCsv}
                    isExporting={isExporting}
                  />
                </div>
              )}

              {/* VIEW 1B: EXECUTIVE MANAGEMENT REPORT & 2-TABLE/GRAPH WORKBENCH */}
              {activeNav === 'management-report' && (
                <ManagementReportView
                  records={filteredRecords}
                  properties={dataset.properties}
                  kpis={activeKpis}
                  dateRangeLabel={
                    filter.startDate === filter.endDate
                      ? filter.startDate
                      : `${filter.startDate} to ${filter.endDate}`
                  }
                  onSelectProperty={(propId) => {
                    setSelectedPropertyId(propId);
                    setActiveNav('properties');
                  }}
                  onInspectRecord={(rec) => setInspectedRecord(rec)}
                />
              )}

              {/* VIEW 2: DAILY REPORTS LEDGER */}
              {activeNav === 'daily-reports' && (
                <div className="space-y-6">
                  <AnalyticsChartsSection
                    records={filteredRecords}
                    kpis={activeKpis}
                    mealFocus={filter.mealFocus}
                    startDate={filter.startDate}
                    endDate={filter.endDate}
                    onChangeMealFocus={(meal) =>
                      setFilter((prev) => ({ ...prev, mealFocus: meal }))
                    }
                    onOpenManagementWorkbench={() => setActiveNav('management-report')}
                    onSelectProperty={(propId) => {
                      setSelectedPropertyId(propId);
                      setActiveNav('properties');
                    }}
                    onSelectDateFilter={(dateStr) => {
                      setFilter((prev) => ({
                        ...prev,
                        preset: 'custom',
                        startDate: dateStr,
                        endDate: dateStr,
                      }));
                    }}
                    onSelectStatusFilter={(status) => {
                      setFilter((prev) => ({
                        ...prev,
                        statuses: prev.statuses.includes(status) ? [] : [status],
                      }));
                    }}
                    onInspectRecord={(rec) => setInspectedRecord(rec)}
                  />
                  <DailyReportTable
                    records={filteredRecords}
                    onSelectProperty={(propId) => {
                      setSelectedPropertyId(propId);
                      setActiveNav('properties');
                    }}
                    onInspectRecord={(rec) => setInspectedRecord(rec)}
                    onExportCsv={handleExportCsv}
                    isExporting={isExporting}
                  />
                </div>
              )}

              {/* VIEW 3: PROPERTY DETAIL */}
              {activeNav === 'properties' && (
                <PropertyDetailView
                  properties={dataset.properties}
                  selectedPropertyId={selectedPropertyId}
                  onSelectPropertyId={(id) => setSelectedPropertyId(id)}
                  records={dataset.records}
                  findings={dataset.findings}
                  onInspectRecord={(rec) => setInspectedRecord(rec)}
                />
              )}

              {/* VIEW 4: MEAL ANALYTICS */}
              {activeNav === 'meal-analytics' && (
                <AnalyticsChartsSection
                  records={filteredRecords}
                  kpis={activeKpis}
                  mealFocus={filter.mealFocus}
                  startDate={filter.startDate}
                  endDate={filter.endDate}
                  onChangeMealFocus={(meal) =>
                    setFilter((prev) => ({ ...prev, mealFocus: meal }))
                  }
                  onOpenManagementWorkbench={() => setActiveNav('management-report')}
                  onSelectProperty={(propId) => {
                    setSelectedPropertyId(propId);
                    setActiveNav('properties');
                  }}
                  onSelectDateFilter={(dateStr) => {
                    setFilter((prev) => ({
                      ...prev,
                      preset: 'custom',
                      startDate: dateStr,
                      endDate: dateStr,
                    }));
                  }}
                  onSelectStatusFilter={(status) => {
                    setFilter((prev) => ({
                      ...prev,
                      statuses: prev.statuses.includes(status) ? [] : [status],
                    }));
                  }}
                  onInspectRecord={(rec) => setInspectedRecord(rec)}
                />
              )}

              {/* VIEW 5: DATA QUALITY CENTER */}
              {activeNav === 'data-quality' && (
                <DataQualityCenter
                  findings={dataset.findings}
                  unmatchedScans={dataset.unmatchedScans}
                  duplicateReportsExcluded={dataset.kpis.duplicateReportsExcluded}
                  duplicateScansExcluded={dataset.kpis.duplicateScansExcluded}
                  onSelectProperty={(propId) => {
                    setSelectedPropertyId(propId);
                    setActiveNav('properties');
                  }}
                />
              )}

              {/* VIEW 6: AUDIT LOGS */}
              {activeNav === 'audit-logs' && (
                <AuditLogsView
                  currentRole={serverRole}
                  rbacDowngradeRole={rbacDowngradeRole}
                />
              )}

              {/* VIEW 7: AUTOMATED TEST CENTER */}
              {activeNav === 'test-center' && (
                <TestCenterView rbacDowngradeRole={rbacDowngradeRole} />
              )}

              {/* VIEW 8: SETTINGS & OPERATIONS */}
              {activeNav === 'settings' && (
                <SettingsAndOpsView
                  currentMode={dataSourceMode}
                  spreadsheetId={spreadsheetId}
                  taskSheetName={taskSheetName}
                  scanningSheetName={scanningSheetName}
                  businessTimezone={businessTimezone}
                  currentRole={serverRole}
                  rbacDowngradeRole={rbacDowngradeRole}
                  onSaveConfig={async (cfg) => {
                    setDataSourceMode(cfg.mode);
                    setSpreadsheetId(cfg.spreadsheetId);
                    setTaskSheetName(cfg.taskSheetName);
                    setScanningSheetName(cfg.scanningSheetName);
                    setBusinessTimezone(cfg.businessTimezone);
                    await triggerSync(cfg);
                  }}
                />
              )}
            </>
          ) : null}
        </main>
      </div>

      {/* Connect Live Google Sheet Modal (Paste URL or ID + Auto-Discover Tabs) */}
      {showSheetConnectModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowSheetConnectModal(false)}
        >
          <div
            className="glass-panel rounded-2xl max-w-xl w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 dark:border-slate-800/70 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                  Connect Live Google Sheet (Read-Only)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Paste your full Google Sheets URL or Spreadsheet ID. We automatically extract the ID, discover your worksheet tabs, and adjust the date window to match your sheet.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSheetConnectModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!hasOAuthToken ? (
              <div className="p-3 rounded-xl glass-subtle flex flex-wrap items-center justify-between gap-3 text-xs text-slate-700 dark:text-slate-300">
                <div className="space-y-0.5 flex-1 min-w-[220px]">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    Two ways to connect your Google Sheet:
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    1. <strong>Direct Link Mode:</strong> Paste your Google Sheet URL below and click <strong>Load &amp; Synchronize Sheet</strong> (works immediately if shared as <em>&ldquo;Anyone with the link can view&rdquo;</em>).<br />
                    2. <strong>Private OAuth Mode:</strong> Click <strong>Sign in with Google</strong> for private spreadsheets.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isSigningIn}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 shrink-0 shadow-2xs"
                >
                  {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
                </button>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Google OAuth Connected ({googleUserEmail || 'Authorized'})
                </span>
                <span className="font-mono text-[11px]">spreadsheets.readonly</span>
              </div>
            )}

            <form onSubmit={handleModalConnectAndSync} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Google Spreadsheet URL or ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={modalSheetInput}
                    onChange={(e) => setModalSheetInput(e.target.value)}
                    placeholder="Paste https://docs.google.com/spreadsheets/d/.../edit or Spreadsheet ID"
                    className="flex-1 px-3 py-2 font-mono glass-subtle rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    disabled={modalDiscovering}
                    onClick={handleModalDiscoverTabs}
                    className="px-3 py-2 font-medium bg-slate-800 dark:bg-slate-700 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {modalDiscovering ? 'Inspecting...' : 'Inspect Sheet Tabs'}
                  </button>
                </div>
              </div>

              {modalSheetTitle && (
                <div className="p-3 rounded-xl glass-subtle space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Connected to: {modalSheetTitle}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {modalDiscoveredTabs.length} tabs found
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    Available tabs: <span className="font-mono">{modalDiscoveredTabs.join(' · ')}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Task Raw Tab Name (Cols B, D, K, N, O, AS..AX)
                  </label>
                  {modalDiscoveredTabs.length > 0 ? (
                    <select
                      value={modalTaskTab}
                      onChange={(e) => setModalTaskTab(e.target.value)}
                      className="w-full px-3 py-2 font-mono glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
                    >
                      {modalDiscoveredTabs.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={modalTaskTab}
                      onChange={(e) => setModalTaskTab(e.target.value)}
                      className="w-full px-3 py-2 font-mono glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  )}
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Scanning Tab Name (Cols C, D, E, F, G)
                  </label>
                  {modalDiscoveredTabs.length > 0 ? (
                    <select
                      value={modalScanTab}
                      onChange={(e) => setModalScanTab(e.target.value)}
                      className="w-full px-3 py-2 font-mono glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
                    >
                      {modalDiscoveredTabs.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={modalScanTab}
                      onChange={(e) => setModalScanTab(e.target.value)}
                      className="w-full px-3 py-2 font-mono glass-subtle rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  )}
                </div>
              </div>

              {modalError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300">
                  {modalError}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 dark:border-slate-800/70">
                <button
                  type="button"
                  onClick={() => {
                    setDataSourceMode('mock_synthetic');
                    setShowSheetConnectModal(false);
                    triggerSync({ mode: 'mock_synthetic' });
                  }}
                  className="px-3 py-1.5 rounded-lg glass-subtle text-slate-700 dark:text-slate-300 hover:bg-white/80"
                >
                  Use Synthetic Fixture Dataset
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSheetConnectModal(false)}
                    className="px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-xs"
                  >
                    Load &amp; Synchronize Sheet
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Drill-Down Inspection Modal */}
      {inspectedRecord && dataset && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setInspectedRecord(null)}
        >
          <div
            className="glass-panel rounded-2xl max-w-2xl w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 dark:border-slate-800/70 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  {inspectedRecord.propertyDisplay} — {inspectedRecord.reportingDate}
                </h3>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  Task Raw Row #{inspectedRecord.taskRowNumber} ·{' '}
                  {inspectedRecord.scanRowNumber
                    ? `Matched Scanning Row #${inspectedRecord.scanRowNumber}`
                    : 'No Matching Scanning Row'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectedRecord(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              {([inspectedRecord.breakfast, inspectedRecord.lunch, inspectedRecord.dinner] as const).map(
                (m) => (
                  <div
                    key={m.mealType}
                    className="p-3 rounded-xl glass-subtle space-y-1.5"
                  >
                    <div className="font-semibold text-slate-900 dark:text-white">{m.mealType}</div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Ordered:</span>
                      {renderTrackedCell(m.ordered)}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Consumed:</span>
                      {renderTrackedCell(m.consumed)}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">QR Scanned:</span>
                      {renderTrackedCell(m.scanned)}
                    </div>
                    <div className="flex justify-between pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                      <span className="text-slate-500">Difference (Ord−Con):</span>
                      {renderVarianceCell(m.variance)}
                    </div>
                  </div>
                )
              )}
            </div>

            {inspectedRecord.findingIds.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/70 text-xs">
                <div className="font-semibold text-amber-700 dark:text-amber-400">
                  Data Quality Findings Attached to This Record:
                </div>
                {dataset.findings
                  .filter((f) => inspectedRecord.findingIds.includes(f.id))
                  .map((f) => (
                    <div
                      key={f.id}
                      className="p-2.5 rounded-xl glass-subtle space-y-1"
                    >
                      <div className="font-mono text-[11px] text-slate-500">
                        [{f.severity.toUpperCase()}] {f.sourceLocation} — {f.category}
                      </div>
                      <div className="text-slate-900 dark:text-slate-100">{f.message}</div>
                      <div className="text-slate-500">Remediation: {f.remediation}</div>
                    </div>
                  ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  const propId = inspectedRecord.propertyNormalized;
                  setInspectedRecord(null);
                  setSelectedPropertyId(propId);
                  setActiveNav('properties');
                }}
                className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Open Full Property History →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
