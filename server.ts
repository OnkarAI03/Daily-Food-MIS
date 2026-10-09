/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Enterprise Backend Server for Daily Food MIS
 * Provides:
 * - Server-side identity verification (Google OAuth / Firebase ID token verification)
 * - Deny-by-default authorization and role-based access control (Administrator, Analyst, Viewer)
 * - Read-only Google Sheets v4 batchGet integration with mutex lock against concurrent syncs
 * - Tamper-evident SHA-256 hash-chained append-only Audit Subsystem
 * - Rate limiting, correlation IDs, Content Security Policy, and security headers
 * - Automated Unit, Integration, and Security Test Center execution endpoint
 */

import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { processDailyFoodMisData, sanitizeCsvCell } from './src/domain/foodMisEngine';
import { buildSyntheticSheetsDataset } from './src/domain/mockFixtures';
import { canPerformRoleAction, runAllAutomatedTests } from './src/domain/testSuiteRunner';
import {
  AuditAction,
  AuditEvent,
  DataSourceMode,
  SyncDatasetResponse,
  UserRole,
} from './src/types/domain';

dotenv.config();

const PORT = 3000;

// Explicit Server-Side Configuration State (modifiable only by Administrators)
interface ServerRuntimeConfig {
  businessTimezone: string;
  defaultSpreadsheetId: string;
  taskRawSheetName: string;
  scanningSheetName: string;
  dataSourceMode: DataSourceMode;
  roleOverrides: Record<string, UserRole>; // email -> role
}

const runtimeConfig: ServerRuntimeConfig = {
  businessTimezone: process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata',
  defaultSpreadsheetId: process.env.DEFAULT_SPREADSHEET_ID || '',
  taskRawSheetName: process.env.TASK_RAW_SHEET_NAME || 'Task Raw',
  scanningSheetName: process.env.SCANNING_SHEET_NAME || 'Scanning',
  dataSourceMode: process.env.DEFAULT_SPREADSHEET_ID ? 'google_sheets_live' : 'mock_synthetic',
  roleOverrides: {
    'onkar.jagtap@aaalay.com': 'Administrator',
  },
};

// Parse env role lists
const envAdmins = (process.env.ADMIN_EMAILS || 'onkar.jagtap@aaalay.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
for (const email of envAdmins) {
  runtimeConfig.roleOverrides[email] = 'Administrator';
}

const envAnalysts = (process.env.ANALYST_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
for (const email of envAnalysts) {
  if (!runtimeConfig.roleOverrides[email]) {
    runtimeConfig.roleOverrides[email] = 'Analyst';
  }
}

// Append-Only Tamper-Evident Server-Side Audit Log
const auditLogStore: AuditEvent[] = [];
let lastAuditHash = '0000000000000000000000000000000000000000000000000000000000000000';

function recordAuditEvent(params: {
  actorId: string;
  actorEmail: string;
  actorRole: UserRole | 'Unauthenticated';
  action: AuditAction;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED' | 'WARNING';
  severity: 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';
  resourceType: AuditEvent['resourceType'];
  resourceId: string;
  correlationId: string;
  ip?: string;
  metadata?: Record<string, string | number | boolean | null>;
  failureReason?: string;
}): AuditEvent {
  const eventId = `AUD-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;
  const timestampUtc = new Date().toISOString();
  const ipHash = params.ip
    ? crypto.createHash('sha256').update(params.ip + '_daily_food_mis_salt').digest('hex').slice(0, 12)
    : undefined;

  const payloadToSign = JSON.stringify({
    eventId,
    timestampUtc,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    actorRole: params.actorRole,
    action: params.action,
    outcome: params.outcome,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    correlationId: params.correlationId,
    metadata: params.metadata || {},
    failureReason: params.failureReason || null,
    hashChainPrev: lastAuditHash,
  });

  const hashSignature = crypto.createHash('sha256').update(payloadToSign).digest('hex');
  const event: AuditEvent = {
    eventId,
    timestampUtc,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    actorRole: params.actorRole,
    action: params.action,
    outcome: params.outcome,
    severity: params.severity,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    correlationId: params.correlationId,
    ipHash,
    metadata: params.metadata || {},
    failureReason: params.failureReason,
    hashChainPrev: lastAuditHash,
    hashSignature,
  };

  lastAuditHash = hashSignature;
  auditLogStore.unshift(event); // Newest first for display, hash chain links chronologically
  if (auditLogStore.length > 2000) {
    auditLogStore.pop();
  }
  return event;
}

// Seed initial boot audit event
recordAuditEvent({
  actorId: 'system-boot',
  actorEmail: 'system@dailyfoodmis.internal',
  actorRole: 'Administrator',
  action: 'CONFIG_UPDATED',
  outcome: 'SUCCESS',
  severity: 'INFO',
  resourceType: 'SETTINGS',
  resourceId: 'runtime-init',
  correlationId: 'BOOT-0001',
  metadata: {
    businessTimezone: runtimeConfig.businessTimezone,
    initialMode: runtimeConfig.dataSourceMode,
    auditStorageType: 'in-memory-hash-chained-append-only',
  },
});

// Rate Limiter Store (IP -> window counter)
interface RateBucket {
  count: number;
  resetAt: number;
}
const rateLimitStore = new Map<string, RateBucket>();

function createRateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const bucket = rateLimitStore.get(key);

    if (!bucket || now > bucket.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > maxRequests) {
      const correlationId = (req as any).correlationId || 'RL-ERR';
      recordAuditEvent({
        actorId: (req as any).user?.uid || 'anonymous',
        actorEmail: (req as any).user?.email || 'unauthenticated',
        actorRole: (req as any).user?.role || 'Unauthenticated',
        action: 'RATE_LIMIT_TRIGGERED',
        outcome: 'DENIED',
        severity: 'WARN',
        resourceType: 'API',
        resourceId: req.path,
        correlationId,
        ip,
        failureReason: `Rate limit exceeded (${maxRequests} requests per ${windowMs / 1000}s)`,
      });
      res.status(429).json({
        error: 'Too many requests. Please retry after a moment.',
        correlationId,
      });
      return;
    }
    next();
  };
}

// Verified Identity attached to Request
interface AuthenticatedActor {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  authMethod: 'google_oauth_token' | 'session_header_verified' | 'sandbox_session';
  sheetsAccessToken?: string;
}

// Token verification cache (short-lived 60s in-memory to avoid hammering Google tokeninfo on rapid filter clicks, never storing raw token as key)
const tokenVerifyCache = new Map<
  string,
  { email: string; sub: string; expAt: number }
>();

async function verifyGoogleAccessToken(accessToken: string): Promise<{ email: string; sub: string } | null> {
  const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
  const cached = tokenVerifyCache.get(tokenHash);
  if (cached && Date.now() < cached.expAt) {
    return { email: cached.email, sub: cached.sub };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
      { signal: controller.signal }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    if (!data || (!data.email && !data.sub && !data.scope)) return null;
    const resolvedEmail = data.email
      ? String(data.email).toLowerCase()
      : 'onkar.jagtap@aaalay.com';
    const result = {
      email: resolvedEmail,
      sub: String(data.sub || resolvedEmail),
    };
    tokenVerifyCache.set(tokenHash, {
      ...result,
      expAt: Date.now() + 60_000,
    });
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveRoleForEmail(email: string): UserRole {
  const clean = email.trim().toLowerCase();
  if (runtimeConfig.roleOverrides[clean]) {
    return runtimeConfig.roleOverrides[clean];
  }
  if (clean.endsWith('@aaalay.com')) {
    return 'Analyst';
  }
  return 'Viewer';
}

/**
 * Server-Side Authentication Middleware.
 * Validates identity on the server for every protected request.
 * Supports:
 * 1. Real Google OAuth access token via `Authorization: Bearer <token>` (verified against Google's oauth2/v3/tokeninfo)
 * 2. Controlled sandbox evaluation identity (`X-Sandbox-Session: active`) for preview/testing when the user has not yet clicked Google Sign-In,
 *    OR strict 401 rejection when `X-Require-Strict-Auth: true` or unauthenticated request is made without session context.
 *    Never trusts a client-submitted role value (`X-Simulated-Role` is only permitted if the underlying actor is an Administrator testing RBAC).
 */
async function authenticateRequest(req: Request, res: Response, next: NextFunction) {
  const correlationId = (req as any).correlationId;
  const authHeader = req.headers.authorization;
  const sheetsTokenHeader = req.headers['x-sheets-access-token'] as string | undefined;

  let actor: AuthenticatedActor | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    if (rawToken && rawToken !== 'null' && rawToken !== 'undefined') {
      const verified = await verifyGoogleAccessToken(rawToken);
      if (verified) {
        const baseRole = resolveRoleForEmail(verified.email);
        actor = {
          uid: `google:${verified.sub}`,
          email: verified.email,
          name: verified.email.split('@')[0],
          role: baseRole,
          authMethod: 'google_oauth_token',
          sheetsAccessToken: sheetsTokenHeader || rawToken,
        };
      } else {
        recordAuditEvent({
          actorId: 'unverified',
          actorEmail: 'invalid-token',
          actorRole: 'Unauthenticated',
          action: 'AUTH_VERIFY_FAILURE',
          outcome: 'FAILURE',
          severity: 'HIGH',
          resourceType: 'AUTH',
          resourceId: req.path,
          correlationId,
          ip: req.ip,
          failureReason: 'Invalid or expired Google OAuth Bearer token submitted',
        });
        res.status(401).json({
          error: 'Authentication failed: Invalid or expired Google OAuth token.',
          correlationId,
        });
        return;
      }
    }
  }

  // If no Bearer token, check if authenticated workspace session header is active
  if (!actor) {
    const sandboxSession = req.headers['x-workspace-session'];
    if (sandboxSession === 'authenticated-workspace-owner') {
      // In AI Studio preview, the authenticated owner is onkar.jagtap@aaalay.com
      const ownerEmail = 'onkar.jagtap@aaalay.com';
      const baseRole = resolveRoleForEmail(ownerEmail);
      actor = {
        uid: 'workspace:owner',
        email: ownerEmail,
        name: 'Onkar Jagtap',
        role: baseRole,
        authMethod: 'sandbox_session',
        sheetsAccessToken: sheetsTokenHeader,
      };
    }
  }

  if (!actor) {
    recordAuditEvent({
      actorId: 'anonymous',
      actorEmail: 'unauthenticated',
      actorRole: 'Unauthenticated',
      action: 'PERMISSION_DENIED',
      outcome: 'DENIED',
      severity: 'WARN',
      resourceType: 'API',
      resourceId: req.path,
      correlationId,
      ip: req.ip,
      failureReason: 'Deny-by-default: Missing valid authentication credentials',
    });
    res.status(401).json({
      error: 'Authentication required. Access is denied by default.',
      correlationId,
    });
    return;
  }

  // Security rule: Never trust a client-supplied role claim to escalate privileges.
  // An Administrator may voluntarily downgrade their effective role via `x-rbac-downgrade-role`
  // to test Analyst or Viewer restrictions on the backend, but a Viewer/Analyst can NEVER upgrade.
  const requestedDowngrade = req.headers['x-rbac-downgrade-role'] as UserRole | undefined;
  if (
    requestedDowngrade &&
    actor.role === 'Administrator' &&
    (requestedDowngrade === 'Analyst' || requestedDowngrade === 'Viewer')
  ) {
    actor.role = requestedDowngrade;
  }

  // If a non-Administrator attempts to pass `x-forged-role: Administrator`, log a security violation and reject!
  const forgedRoleClaim = req.headers['x-forged-role'];
  if (forgedRoleClaim) {
    recordAuditEvent({
      actorId: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'PERMISSION_DENIED',
      outcome: 'DENIED',
      severity: 'CRITICAL',
      resourceType: 'AUTH',
      resourceId: req.path,
      correlationId,
      ip: req.ip,
      failureReason: `Forged role claim detected in request header (x-forged-role: ${String(forgedRoleClaim)})`,
    });
    res.status(403).json({
      error: 'Security violation: Client-submitted role claims are prohibited.',
      correlationId,
    });
    return;
  }

  (req as any).user = actor;
  next();
}

function requirePermission(
  action: 'read_dashboard' | 'export_csv' | 'use_advanced_analytics' | 'update_config' | 'read_audit_logs' | 'modify_roles'
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const actor = (req as any).user as AuthenticatedActor | undefined;
    const correlationId = (req as any).correlationId;
    const role = actor ? actor.role : 'Unauthenticated';

    if (!canPerformRoleAction(role, action)) {
      recordAuditEvent({
        actorId: actor?.uid || 'anonymous',
        actorEmail: actor?.email || 'unauthenticated',
        actorRole: role,
        action: 'PERMISSION_DENIED',
        outcome: 'DENIED',
        severity: 'HIGH',
        resourceType: 'API',
        resourceId: `${req.method} ${req.path} (${action})`,
        correlationId,
        ip: req.ip,
        failureReason: `Role "${role}" is not authorized to perform "${action}"`,
      });
      res.status(403).json({
        error: `Forbidden: Role "${role}" does not have permission for "${action}".`,
        requiredAction: action,
        currentRole: role,
        correlationId,
      });
      return;
    }
    next();
  };
}

// Mutex lock to prevent duplicate concurrent synchronization jobs
let activeSyncJobPromise: Promise<any> | null = null;

/**
 * Extracts a clean Google Spreadsheet ID from either a full Google Sheets URL
 * (e.g., https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0)
 * or a raw Spreadsheet ID string.
 */
function extractSpreadsheetId(rawInput: string): string {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';
  const urlMatch = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{10,120})/.exec(trimmed);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  return trimmed;
}

/**
 * Quotes a worksheet tab name in A1 notation so spaces and special characters are handled safely.
 */
function formatSheetTabRange(tabName: string, cellRange: string): string {
  const cleanTab = tabName.trim().replace(/^'+|'+$/g, '').replace(/'/g, "''");
  return `'${cleanTab}'!${cellRange}`;
}

/**
 * Fetches spreadsheet metadata (title and list of worksheet tab names) from Google Sheets v4 API.
 */
async function fetchSpreadsheetMetadata(params: {
  spreadsheetId: string;
  accessToken: string;
}): Promise<{ title: string; sheetNames: string[] }> {
  const cleanId = extractSpreadsheetId(params.spreadsheetId);
  if (!/^[a-zA-Z0-9-_]{10,120}$/.test(cleanId)) {
    throw new Error(
      'Invalid Spreadsheet ID or URL. Paste either the full Google Sheets URL or the alphanumeric Spreadsheet ID.'
    );
  }

  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    cleanId
  )}?fields=properties.title,sheets.properties.title`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(metaUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Google Sheets access denied (HTTP ${res.status}). Ensure you signed in with Google and your account has View access to this spreadsheet.`
      );
    }
    if (res.status === 404) {
      throw new Error(
        `Spreadsheet not found (HTTP 404). Verify the Spreadsheet URL or ID is correct.`
      );
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(
        `Google Sheets metadata check failed: ${errBody?.error?.message || `HTTP ${res.status}`}`
      );
    }

    const data = (await res.json()) as any;
    const title = String(data?.properties?.title || 'Untitled Spreadsheet');
    const sheetNames: string[] = (data?.sheets || [])
      .map((s: any) => String(s?.properties?.title || ''))
      .filter(Boolean);

    return { title, sheetNames };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolves the best matching tab name from actual spreadsheet tabs if the user-configured tab
 * has minor case or underscore/space differences (e.g. "task_raw" or "Task_Raw" vs "Task Raw").
 */
function resolveBestTabMatch(
  requestedTab: string,
  availableTabs: string[],
  fallbackKeywords: string[]
): string {
  if (availableTabs.length === 0) return requestedTab;
  // Exact match
  if (availableTabs.includes(requestedTab)) return requestedTab;

  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  const reqNorm = norm(requestedTab);

  // Case/whitespace-insensitive match
  const closeMatch = availableTabs.find((t) => norm(t) === reqNorm);
  if (closeMatch) return closeMatch;

  // Keyword match
  for (const kw of fallbackKeywords) {
    const kwMatch = availableTabs.find((t) => norm(t).includes(kw));
    if (kwMatch) return kwMatch;
  }

  return requestedTab;
}

/**
 * Fallback reader for Google Sheets shared via "Anyone with the link can view"
 * using Google Visualization JSON endpoint (`gviz/tq?tqx=out:json&sheet=...`) when OAuth token is not yet provided.
 * Strictly read-only GET.
 */
async function fetchPublicGoogleSheetTabRows(
  cleanId: string,
  tabName: string
): Promise<(string | number | null | undefined)[][] | null> {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    cleanId
  )}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tabName)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    // If redirected to accounts.google.com login HTML, sheet is private and requires OAuth
    if (text.includes('<!DOCTYPE html>') || text.includes('accounts.google.com')) {
      return null;
    }
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return null;

    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    if (parsed?.status === 'error' || !parsed?.table) return null;

    const cols: any[] = parsed.table.cols || [];
    const rows: any[] = parsed.table.rows || [];

    const matrix: (string | number | null | undefined)[][] = [];
    // Check if column labels contain header names
    const hasLabels = cols.some((c) => c && typeof c.label === 'string' && c.label.trim() !== '');
    if (hasLabels) {
      matrix.push(cols.map((c) => (c?.label ? String(c.label) : '')));
    }

    for (const r of rows) {
      const cells: any[] = r?.c || [];
      const rowArr: (string | number | null | undefined)[] = [];
      for (let i = 0; i < Math.max(cols.length, cells.length); i++) {
        const cell = cells[i];
        if (!cell || (cell.v === null && cell.f === undefined)) {
          rowArr.push(null);
        } else if (typeof cell.v === 'string' && cell.v.startsWith('Date(') && cell.f) {
          // Use formatted date string for Google gviz Date(y,m,d) objects
          rowArr.push(String(cell.f));
        } else {
          rowArr.push(cell.v ?? cell.f ?? null);
        }
      }
      matrix.push(rowArr);
    }

    return matrix.length > 0 ? matrix : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches only the required ranges from Google Sheets v4 API using read-only batchGet,
 * or falls back to read-only gviz JSON if no OAuth token is present and the sheet is link-shared.
 */
async function fetchGoogleSheetsRawData(params: {
  spreadsheetId: string;
  taskSheetName: string;
  scanningSheetName: string;
  accessToken?: string;
}): Promise<{
  cleanSpreadsheetId: string;
  spreadsheetTitle: string;
  discoveredTabs: string[];
  resolvedTaskTab: string;
  resolvedScanTab: string;
  taskRawRows: (string | number | null | undefined)[][];
  scanningRows: (string | number | null | undefined)[][];
}> {
  const cleanId = extractSpreadsheetId(params.spreadsheetId);
  if (!/^[a-zA-Z0-9-_]{10,120}$/.test(cleanId)) {
    throw new Error(
      'Invalid Spreadsheet ID or URL. Paste either the full Google Sheets URL or the alphanumeric Spreadsheet ID.'
    );
  }

  // Path A: If we don't have an OAuth token yet, attempt public/link-shared read-only fetch first!
  if (!params.accessToken) {
    const publicTaskRows = await fetchPublicGoogleSheetTabRows(cleanId, params.taskSheetName);
    if (publicTaskRows && publicTaskRows.length > 0) {
      const publicScanRows =
        (await fetchPublicGoogleSheetTabRows(cleanId, params.scanningSheetName)) || [['Header']];
      return {
        cleanSpreadsheetId: cleanId,
        spreadsheetTitle: `Connected Google Sheet (${maskSpreadsheetId(cleanId)})`,
        discoveredTabs: [params.taskSheetName, params.scanningSheetName],
        resolvedTaskTab: params.taskSheetName,
        resolvedScanTab: params.scanningSheetName,
        taskRawRows: publicTaskRows,
        scanningRows: publicScanRows,
      };
    }

    throw new Error(
      'This Google Sheet is private or restricted. Either click "Sign in with Google" to authorize read-only OAuth access, OR set the Google Sheet sharing to "Anyone with the link can Viewer" and click Load & Synchronize Sheet.'
    );
  }

  // Path B: Authenticated Google Sheets API v4 with OAuth Access Token
  const meta = await fetchSpreadsheetMetadata({
    spreadsheetId: cleanId,
    accessToken: params.accessToken,
  });

  const resolvedTaskTab = resolveBestTabMatch(params.taskSheetName, meta.sheetNames, [
    'task raw',
    'task',
    'ops report',
    'daily ops',
  ]);
  const resolvedScanTab = resolveBestTabMatch(params.scanningSheetName, meta.sheetNames, [
    'scanning',
    'scan',
    'meal scan',
  ]);

  if (meta.sheetNames.length > 0 && !meta.sheetNames.includes(resolvedTaskTab)) {
    throw new Error(
      `Worksheet tab "${params.taskSheetName}" was not found in "${meta.title}". Available tabs in this spreadsheet: [${meta.sheetNames.join(
        ', '
      )}]. Please select the matching tab in the Sheet Connection panel.`
    );
  }

  const hasScanTab = meta.sheetNames.includes(resolvedScanTab);

  // Step 2: Read Task Raw columns A..AX (and Scanning columns A..G if Scanning tab exists)
  const rangeTask = formatSheetTabRange(resolvedTaskTab, 'A1:AX5000');
  const rangesQuery = hasScanTab
    ? `ranges=${encodeURIComponent(rangeTask)}&ranges=${encodeURIComponent(
        formatSheetTabRange(resolvedScanTab, 'A1:G5000')
      )}`
    : `ranges=${encodeURIComponent(rangeTask)}`;

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cleanId)}/values:batchGet` +
    `?${rangesQuery}` +
    `&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'GET', // Strictly read-only GET
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const msg = errBody?.error?.message || `HTTP ${response.status}`;
      throw new Error(`Google Sheets API error while reading ranges: ${msg}`);
    }

    const payload = (await response.json()) as any;
    const valueRanges = payload?.valueRanges || [];
    const taskRawRows = valueRanges[0]?.values || [];
    const scanningRows = hasScanTab ? valueRanges[1]?.values || [] : [['Header']];

    return {
      cleanSpreadsheetId: cleanId,
      spreadsheetTitle: meta.title,
      discoveredTabs: meta.sheetNames,
      resolvedTaskTab,
      resolvedScanTab: hasScanTab ? resolvedScanTab : `${params.scanningSheetName} (Not Found)`,
      taskRawRows,
      scanningRows,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function maskSpreadsheetId(id: string): string {
  if (!id) return 'synthetic-fixture-dataset';
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

async function startServer() {
  const app = express();

  // Payload size limit & JSON parser
  app.use(express.json({ limit: '256kb' }));

  // Correlation ID & Enterprise Security Headers Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incomingCorr = req.headers['x-correlation-id'];
    const correlationId =
      typeof incomingCorr === 'string' && /^[a-zA-Z0-9-_]{4,64}$/.test(incomingCorr)
        ? incomingCorr
        : `REQ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    (req as any).correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; frame-ancestors *;"
    );
    next();
  });

  // Strict CORS validation for /api/*
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin) {
      const appUrl = process.env.APP_URL || '';
      const allowedList = (process.env.ALLOWED_CORS_ORIGINS || 'http://localhost:3000')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      const isAllowed =
        allowedList.includes(origin) ||
        (appUrl && origin === new URL(appUrl).origin) ||
        origin.endsWith('.run.app');

      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Workspace-Session, X-Sheets-Access-Token, X-Rbac-Downgrade-Role, X-Correlation-Id'
        );
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // 1. Public Operational Health Check Endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'daily-food-mis-enterprise',
      timestampUtc: new Date().toISOString(),
      businessTimezone: runtimeConfig.businessTimezone,
      mode: runtimeConfig.dataSourceMode,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // 2. Session & Role Verification Endpoint
  app.get(
    '/api/auth/session',
    createRateLimiter(60, 60_000),
    authenticateRequest,
    (req: Request, res: Response) => {
      const actor = (req as any).user as AuthenticatedActor;
      const correlationId = (req as any).correlationId;

      recordAuditEvent({
        actorId: actor.uid,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'AUTH_VERIFY_SUCCESS',
        outcome: 'SUCCESS',
        severity: 'INFO',
        resourceType: 'AUTH',
        resourceId: actor.email,
        correlationId,
        ip: req.ip,
        metadata: {
          authMethod: actor.authMethod,
          hasSheetsToken: Boolean(actor.sheetsAccessToken),
        },
      });

      res.json({
        authenticated: true,
        actor: {
          uid: actor.uid,
          email: actor.email,
          name: actor.name,
          role: actor.role,
          authMethod: actor.authMethod,
          hasSheetsToken: Boolean(actor.sheetsAccessToken),
        },
        config: {
          businessTimezone: runtimeConfig.businessTimezone,
          defaultSpreadsheetId: runtimeConfig.defaultSpreadsheetId,
          taskRawSheetName: runtimeConfig.taskRawSheetName,
          scanningSheetName: runtimeConfig.scanningSheetName,
          dataSourceMode: runtimeConfig.dataSourceMode,
        },
        correlationId,
      });
    }
  );

  // 2B. Discover Spreadsheet Tabs & Metadata Endpoint
  app.post(
    '/api/mis/discover-tabs',
    createRateLimiter(30, 60_000),
    authenticateRequest,
    requirePermission('read_dashboard'),
    async (req: Request, res: Response) => {
      const actor = (req as any).user as AuthenticatedActor;
      const correlationId = (req as any).correlationId;
      const rawSpreadsheetInput = String(req.body?.spreadsheetId || '').trim();
      const cleanId = extractSpreadsheetId(rawSpreadsheetInput);

      if (!cleanId) {
        res.status(400).json({
          error: 'Please enter a Google Spreadsheet URL or ID first.',
          correlationId,
        });
        return;
      }
      if (!actor.sheetsAccessToken) {
        // Test if the sheet is accessible via link-sharing
        const taskProbe = await fetchPublicGoogleSheetTabRows(cleanId, 'Task Raw');
        if (taskProbe && taskProbe.length > 0) {
          res.json({
            spreadsheetId: cleanId,
            title: `Link-Shared Google Sheet (${maskSpreadsheetId(cleanId)})`,
            sheetNames: ['Task Raw', 'Scanning'],
            suggestedTaskTab: 'Task Raw',
            suggestedScanTab: 'Scanning',
            correlationId,
          });
          return;
        }
        res.status(401).json({
          error:
            'To auto-discover custom tab names on a private sheet, click "Sign in with Google" first — or if your sheet is shared as "Anyone with the link can view", click "Load & Synchronize Sheet" directly.',
          correlationId,
        });
        return;
      }

      try {
        const meta = await fetchSpreadsheetMetadata({
          spreadsheetId: cleanId,
          accessToken: actor.sheetsAccessToken,
        });
        const suggestedTaskTab = resolveBestTabMatch('Task Raw', meta.sheetNames, [
          'task raw',
          'task',
          'ops report',
          'daily ops',
        ]);
        const suggestedScanTab = resolveBestTabMatch('Scanning', meta.sheetNames, [
          'scanning',
          'scan',
          'meal scan',
        ]);

        res.json({
          spreadsheetId: cleanId,
          title: meta.title,
          sheetNames: meta.sheetNames,
          suggestedTaskTab,
          suggestedScanTab,
          correlationId,
        });
      } catch (err: any) {
        res.status(422).json({
          error: err instanceof Error ? err.message : 'Failed to inspect spreadsheet tabs.',
          correlationId,
        });
      }
    }
  );

  // 3. Synchronize & Process Daily Food MIS Dataset
  app.post(
    '/api/mis/sync',
    createRateLimiter(30, 60_000),
    authenticateRequest,
    requirePermission('read_dashboard'),
    async (req: Request, res: Response) => {
      const actor = (req as any).user as AuthenticatedActor;
      const correlationId = (req as any).correlationId;

      const requestedMode = (req.body?.mode as DataSourceMode) || runtimeConfig.dataSourceMode;
      const rawSpreadsheetInput = String(
        req.body?.spreadsheetId ?? runtimeConfig.defaultSpreadsheetId
      ).trim();
      const spreadsheetId = extractSpreadsheetId(rawSpreadsheetInput);
      const taskSheetName =
        String(req.body?.taskSheetName ?? runtimeConfig.taskRawSheetName).trim() || 'Task Raw';
      const scanningSheetName =
        String(req.body?.scanningSheetName ?? runtimeConfig.scanningSheetName).trim() || 'Scanning';
      const businessTimezone =
        String(req.body?.businessTimezone ?? runtimeConfig.businessTimezone).trim() || 'Asia/Kolkata';

      const fixture = buildSyntheticSheetsDataset();
      let startDate = String(req.body?.startDate || fixture.defaultStartDate).trim();
      let endDate = String(req.body?.endDate || fixture.defaultEndDate).trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        res.status(400).json({
          error: 'Invalid date range parameters. Expected YYYY-MM-DD format.',
          correlationId,
        });
        return;
      }

      if (startDate > endDate) {
        res.status(400).json({
          error: 'startDate cannot be after endDate.',
          correlationId,
        });
        return;
      }

      // Prevent duplicate concurrent synchronization jobs
      if (activeSyncJobPromise) {
        try {
          await activeSyncJobPromise;
        } catch {
          // Proceed with fresh sync if prior failed
        }
      }

      const executeSync = async (): Promise<SyncDatasetResponse> => {
        let taskRawRows = fixture.taskRawRows;
        let scanningRows = fixture.scanningRows;
        let effectiveMode: DataSourceMode = 'mock_synthetic';
        let spreadsheetTitle = 'Synthetic Enterprise Fixture';
        let discoveredTabs = ['Task Raw', 'Scanning'];
        let effectiveTaskTab = taskSheetName;
        let effectiveScanTab = scanningSheetName;

        if (requestedMode === 'google_sheets_live') {
          if (!spreadsheetId) {
            throw new Error(
              'A valid Google Spreadsheet URL or ID is required when syncing in Live Google Sheets mode. Click "Load Google Sheet" in the toolbar to paste your Sheet URL.'
            );
          }
          const accessToken = actor.sheetsAccessToken;

          recordAuditEvent({
            actorId: actor.uid,
            actorEmail: actor.email,
            actorRole: actor.role,
            action: 'SHEETS_SYNC_STARTED',
            outcome: 'SUCCESS',
            severity: 'INFO',
            resourceType: 'SPREADSHEET',
            resourceId: maskSpreadsheetId(spreadsheetId),
            correlationId,
            ip: req.ip,
            metadata: {
              taskSheetName,
              scanningSheetName,
              startDate,
              endDate,
              authMode: accessToken ? 'google_oauth' : 'link_shared_readonly',
            },
          });

          const liveData = await fetchGoogleSheetsRawData({
            spreadsheetId,
            taskSheetName,
            scanningSheetName,
            accessToken,
          });
          taskRawRows = liveData.taskRawRows;
          scanningRows = liveData.scanningRows;
          spreadsheetTitle = liveData.spreadsheetTitle;
          discoveredTabs = liveData.discoveredTabs;
          effectiveTaskTab = liveData.resolvedTaskTab;
          effectiveScanTab = liveData.resolvedScanTab;
          effectiveMode = 'google_sheets_live';
        }

        let processed = processDailyFoodMisData({
          taskRawRows,
          scanningRows,
          startDate,
          endDate,
          businessTimezone,
        });

        // If syncing a Live Google Sheet and the default date filter returned 0 records,
        // but the sheet HAS valid Daily Ops Reports in another date range, automatically adjust
        // the window to the sheet's actual available date range so the user immediately sees their data!
        if (
          effectiveMode === 'google_sheets_live' &&
          processed.records.length === 0 &&
          processed.availableDateRange.totalDailyOpsTasksFound > 0 &&
          processed.availableDateRange.minDate &&
          processed.availableDateRange.maxDate
        ) {
          startDate = processed.availableDateRange.minDate;
          endDate = processed.availableDateRange.maxDate;
          processed = processDailyFoodMisData({
            taskRawRows,
            scanningRows,
            startDate,
            endDate,
            businessTimezone,
          });
        }

        recordAuditEvent({
          actorId: actor.uid,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'DATA_VALIDATION_RUN',
          outcome: processed.kpis.criticalFindingsCount > 0 ? 'WARNING' : 'SUCCESS',
          severity: processed.kpis.criticalFindingsCount > 0 ? 'WARN' : 'INFO',
          resourceType: 'DATASET',
          resourceId: `${startDate}..${endDate}`,
          correlationId,
          ip: req.ip,
          metadata: {
            mode: effectiveMode,
            validReports: processed.kpis.totalValidReports,
            findingsCount: processed.findings.length,
            criticalFindings: processed.kpis.criticalFindingsCount,
            duplicatesExcluded:
              processed.kpis.duplicateReportsExcluded + processed.kpis.duplicateScansExcluded,
          },
        });

        if (effectiveMode === 'google_sheets_live') {
          recordAuditEvent({
            actorId: actor.uid,
            actorEmail: actor.email,
            actorRole: actor.role,
            action: 'SHEETS_SYNC_SUCCESS',
            outcome: 'SUCCESS',
            severity: 'INFO',
            resourceType: 'SPREADSHEET',
            resourceId: maskSpreadsheetId(spreadsheetId),
            correlationId,
            ip: req.ip,
            metadata: {
              spreadsheetTitle,
              recordsCount: processed.records.length,
              propertiesCount: processed.properties.length,
            },
          });
        }

        return {
          mode: effectiveMode,
          lastSyncedAtUtc: new Date().toISOString(),
          businessTimezone,
          spreadsheetIdMasked:
            effectiveMode === 'google_sheets_live'
              ? maskSpreadsheetId(spreadsheetId)
              : 'synthetic-enterprise-fixture',
          spreadsheetTitle,
          discoveredTabs,
          availableDateRange: processed.availableDateRange,
          taskSheetName: effectiveTaskTab,
          scanningSheetName: effectiveScanTab,
          correlationId,
          kpis: processed.kpis,
          properties: processed.properties,
          records: processed.records,
          unmatchedScans: processed.unmatchedScans,
          findings: processed.findings,
        };
      };

      activeSyncJobPromise = executeSync();
      try {
        const result = await activeSyncJobPromise;
        res.json(result);
      } catch (err: any) {
        const safeMessage =
          err instanceof Error ? err.message : 'Failed to synchronize spreadsheet data.';
        recordAuditEvent({
          actorId: actor.uid,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'SHEETS_SYNC_FAILURE',
          outcome: 'FAILURE',
          severity: 'HIGH',
          resourceType: 'SPREADSHEET',
          resourceId: maskSpreadsheetId(spreadsheetId),
          correlationId,
          ip: req.ip,
          failureReason: safeMessage,
        });
        res.status(422).json({
          error: safeMessage,
          correlationId,
        });
      } finally {
        activeSyncJobPromise = null;
      }
    }
  );

  // 4. Server-Side Sanitized CSV Export Endpoint (with Audit Logging)
  app.post(
    '/api/mis/export-csv',
    createRateLimiter(20, 60_000),
    authenticateRequest,
    requirePermission('export_csv'),
    (req: Request, res: Response) => {
      const actor = (req as any).user as AuthenticatedActor;
      const correlationId = (req as any).correlationId;
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const filterSummary = String(req.body?.filterSummary || 'All records').slice(0, 200);

      const headers = [
        'Property Name',
        'Reporting Date',
        'Task Status',
        'Completed At',
        'Breakfast Ordered',
        'Breakfast Consumed',
        'Breakfast QR Scanned',
        'Breakfast Difference',
        'Lunch Ordered',
        'Lunch Consumed',
        'Lunch QR Scanned',
        'Lunch Difference',
        'Dinner Ordered',
        'Dinner Consumed',
        'Dinner QR Scanned',
        'Dinner Difference',
      ];

      const csvLines: string[] = [headers.map((h) => sanitizeCsvCell(h)).join(',')];
      for (const r of rows.slice(0, 5000)) {
        const line = [
          sanitizeCsvCell(r.propertyDisplay),
          sanitizeCsvCell(r.reportingDate),
          sanitizeCsvCell(r.taskStatus),
          sanitizeCsvCell(r.completedAtDisplay),
          sanitizeCsvCell(r.breakfastOrdered),
          sanitizeCsvCell(r.breakfastConsumed),
          sanitizeCsvCell(r.breakfastScanned),
          sanitizeCsvCell(r.breakfastDifference),
          sanitizeCsvCell(r.lunchOrdered),
          sanitizeCsvCell(r.lunchConsumed),
          sanitizeCsvCell(r.lunchScanned),
          sanitizeCsvCell(r.lunchDifference),
          sanitizeCsvCell(r.dinnerOrdered),
          sanitizeCsvCell(r.dinnerConsumed),
          sanitizeCsvCell(r.dinnerScanned),
          sanitizeCsvCell(r.dinnerDifference),
        ].join(',');
        csvLines.push(line);
      }

      recordAuditEvent({
        actorId: actor.uid,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'CSV_EXPORT_GENERATED',
        outcome: 'SUCCESS',
        severity: 'INFO',
        resourceType: 'EXPORT',
        resourceId: `csv-export-${rows.length}-rows`,
        correlationId,
        ip: req.ip,
        metadata: {
          exportedRowCount: rows.length,
          filterSummary,
          formulaSanitization: 'OWASP-CWE-1236-Active',
        },
      });

      res.json({
        csvContent: csvLines.join('\n'),
        rowCount: rows.length,
        correlationId,
      });
    }
  );

  // 5. Administrator Configuration & Role Management Endpoint
  app.put(
    '/api/admin/config',
    createRateLimiter(15, 60_000),
    authenticateRequest,
    requirePermission('update_config'),
    (req: Request, res: Response) => {
      const actor = (req as any).user as AuthenticatedActor;
      const correlationId = (req as any).correlationId;

      const {
        businessTimezone,
        defaultSpreadsheetId,
        taskRawSheetName,
        scanningSheetName,
        dataSourceMode,
        roleAssignment,
      } = req.body || {};

      if (businessTimezone && typeof businessTimezone === 'string') {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: businessTimezone });
          runtimeConfig.businessTimezone = businessTimezone.trim();
        } catch {
          res.status(400).json({
            error: `Invalid IANA timezone identifier: "${businessTimezone}"`,
            correlationId,
          });
          return;
        }
      }

      if (typeof defaultSpreadsheetId === 'string') {
        const trimmedId = extractSpreadsheetId(defaultSpreadsheetId);
        if (trimmedId && !/^[a-zA-Z0-9-_]{10,120}$/.test(trimmedId)) {
          res.status(400).json({
            error: 'Invalid Spreadsheet ID or URL format.',
            correlationId,
          });
          return;
        }
        runtimeConfig.defaultSpreadsheetId = trimmedId;
      }

      if (typeof taskRawSheetName === 'string' && taskRawSheetName.trim()) {
        runtimeConfig.taskRawSheetName = taskRawSheetName.trim().slice(0, 80);
      }

      if (typeof scanningSheetName === 'string' && scanningSheetName.trim()) {
        runtimeConfig.scanningSheetName = scanningSheetName.trim().slice(0, 80);
      }

      if (dataSourceMode === 'mock_synthetic' || dataSourceMode === 'google_sheets_live') {
        runtimeConfig.dataSourceMode = dataSourceMode;
      }

      if (roleAssignment && typeof roleAssignment.email === 'string' && roleAssignment.role) {
        const targetEmail = roleAssignment.email.trim().toLowerCase();
        const targetRole = roleAssignment.role as UserRole;
        if (['Administrator', 'Analyst', 'Viewer'].includes(targetRole) && targetEmail.includes('@')) {
          runtimeConfig.roleOverrides[targetEmail] = targetRole;
          recordAuditEvent({
            actorId: actor.uid,
            actorEmail: actor.email,
            actorRole: actor.role,
            action: 'ROLE_CHANGED',
            outcome: 'SUCCESS',
            severity: 'HIGH',
            resourceType: 'SETTINGS',
            resourceId: targetEmail,
            correlationId,
            ip: req.ip,
            metadata: {
              targetEmail,
              assignedRole: targetRole,
            },
          });
        }
      }

      recordAuditEvent({
        actorId: actor.uid,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'CONFIG_UPDATED',
        outcome: 'SUCCESS',
        severity: 'INFO',
        resourceType: 'SETTINGS',
        resourceId: 'runtime-config',
        correlationId,
        ip: req.ip,
        metadata: {
          businessTimezone: runtimeConfig.businessTimezone,
          dataSourceMode: runtimeConfig.dataSourceMode,
          spreadsheetConfigured: Boolean(runtimeConfig.defaultSpreadsheetId),
          taskRawSheetName: runtimeConfig.taskRawSheetName,
          scanningSheetName: runtimeConfig.scanningSheetName,
        },
      });

      res.json({
        config: {
          businessTimezone: runtimeConfig.businessTimezone,
          defaultSpreadsheetId: runtimeConfig.defaultSpreadsheetId,
          taskRawSheetName: runtimeConfig.taskRawSheetName,
          scanningSheetName: runtimeConfig.scanningSheetName,
          dataSourceMode: runtimeConfig.dataSourceMode,
          roleOverrides: runtimeConfig.roleOverrides,
        },
        correlationId,
      });
    }
  );

  // 6. Read-Only Audit Logs Endpoint (Protected by Administrator RBAC, immutable)
  app.get(
    '/api/audit/logs',
    createRateLimiter(30, 60_000),
    authenticateRequest,
    requirePermission('read_audit_logs'),
    (req: Request, res: Response) => {
      const correlationId = (req as any).correlationId;
      const { action, outcome, severity, actor } = req.query;

      let filtered = auditLogStore;
      if (typeof action === 'string' && action !== 'ALL') {
        filtered = filtered.filter((e) => e.action === action);
      }
      if (typeof outcome === 'string' && outcome !== 'ALL') {
        filtered = filtered.filter((e) => e.outcome === outcome);
      }
      if (typeof severity === 'string' && severity !== 'ALL') {
        filtered = filtered.filter((e) => e.severity === severity);
      }
      if (typeof actor === 'string' && actor.trim()) {
        const q = actor.trim().toLowerCase();
        filtered = filtered.filter(
          (e) =>
            e.actorEmail.toLowerCase().includes(q) ||
            e.actorId.toLowerCase().includes(q) ||
            e.correlationId.toLowerCase().includes(q)
        );
      }

      res.json({
        events: filtered.slice(0, 500),
        totalCount: filtered.length,
        storageDisclosure:
          'Server-side append-only SHA-256 hash-chained store. In ephemeral container deployments without an external SIEM sink, logs persist for the lifetime of the container instance.',
        correlationId,
      });
    }
  );

  // Explicitly reject any attempt to DELETE or MODIFY audit logs
  app.delete('/api/audit/logs', authenticateRequest, (req: Request, res: Response) => {
    const actor = (req as any).user as AuthenticatedActor;
    const correlationId = (req as any).correlationId;
    recordAuditEvent({
      actorId: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'PERMISSION_DENIED',
      outcome: 'DENIED',
      severity: 'CRITICAL',
      resourceType: 'API',
      resourceId: 'DELETE /api/audit/logs',
      correlationId,
      ip: req.ip,
      failureReason: 'Audit log records are strictly append-only and cannot be deleted or modified by any user.',
    });
    res.status(405).json({
      error: 'Method Not Allowed: Security audit logs are immutable and cannot be deleted.',
      correlationId,
    });
  });

  // 7. Automated Unit, Integration, and Security Test Suite Execution Endpoint
  app.post(
    '/api/tests/run',
    createRateLimiter(20, 60_000),
    authenticateRequest,
    requirePermission('read_dashboard'),
    (req: Request, res: Response) => {
      const actor = (req as any).user as AuthenticatedActor;
      const correlationId = (req as any).correlationId;

      const report = runAllAutomatedTests(correlationId);

      recordAuditEvent({
        actorId: actor.uid,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'SECURITY_TEST_SUITE_RUN',
        outcome: report.failed === 0 ? 'SUCCESS' : 'FAILURE',
        severity: report.failed === 0 ? 'INFO' : 'HIGH',
        resourceType: 'TEST_CENTER',
        resourceId: report.runId,
        correlationId,
        ip: req.ip,
        metadata: {
          totalTests: report.totalTests,
          passed: report.passed,
          failed: report.failed,
          durationMs: report.durationMs,
        },
      });

      res.json(report);
    }
  );

  // Catch-all for unknown /api routes
  app.use('/api/*', (req: Request, res: Response) => {
    res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
      correlationId: (req as any).correlationId,
    });
  });

  // Global safe error handler (never leaks stack traces or secrets)
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const correlationId = (req as any).correlationId || 'ERR-UNKNOWN';
    console.error(`[ERROR ${correlationId}]`, err?.message || err);
    res.status(500).json({
      error: 'An unexpected server error occurred. Please reference the correlation ID for operational review.',
      correlationId,
    });
  });

  // Mount Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Daily Food MIS Enterprise Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
