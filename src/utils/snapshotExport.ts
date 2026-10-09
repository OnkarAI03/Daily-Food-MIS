/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * High-Resolution Visual Card-Based Snapshot Image (PNG) & CSV Exporter
 * Features:
 * - Zero black colors: uses a clean, light, high-readability palette (Indigo #4f46e5 for Ordered,
 *   Blue #2563eb for Consumed, Teal #0d9488 for QR Scanned, Emerald/Rose for Difference, and
 *   crisp light cards with soft borders).
 * - Proper formatted Reporting Date / Date Range (e.g., "09 Oct 2026" or "26 Sep 2026 – 09 Oct 2026")
 *   prominently displayed in the header AND on each property card.
 * - Adaptive Multi-Column Card Grid for 20+ Properties:
 *   Automatically arranges property cards into a compact 2-column executive poster grid when
 *   there are > 8 properties (e.g., 20 properties fit cleanly in 10 rows side-by-side on one page!).
 */

export interface PropertySnapshotRow {
  propertyDisplay: string;
  reportDays: number;
  reportingDateRange?: string;
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
}

export function formatReadableDateRange(startDate?: string, endDate?: string): string {
  const fmt = (iso?: string) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
    const [y, m, d] = iso.split('-').map(Number);
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${String(d).padStart(2, '0')} ${months[(m - 1) % 12]} ${y}`;
  };

  if (startDate && endDate) {
    if (startDate === endDate) {
      return `${fmt(startDate)} (${startDate})`;
    }
    return `${fmt(startDate)} – ${fmt(endDate)} (${startDate} to ${endDate})`;
  }
  return startDate || endDate || 'All Filtered Dates';
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill?: string,
  stroke?: string,
  lineWidth = 1
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

export function downloadPropertySnapshotPng(params: {
  title: string;
  subtitle: string;
  mealFilterLabel: string;
  dateRangeLabel: string;
  rows: PropertySnapshotRow[];
  filename?: string;
}): void {
  const { title, subtitle, mealFilterLabel, dateRangeLabel, rows } = params;
  const scale = 2; // 2x Retina DPI for crystal-clear text and bars

  // Adaptive Layout:
  // If > 8 properties (e.g., 12, 20, or 30 properties), use a 2-Column Side-by-Side Card Grid
  // so all 20+ properties fit comfortably on a single executive poster page without becoming a long strip.
  const isMultiColumnGrid = rows.length > 8;
  const gridCols = isMultiColumnGrid ? 2 : 1;
  const width = isMultiColumnGrid ? 2280 : 1640;
  const outerPad = 28;
  const headerHeight = 136;
  const cardHeight = 166;
  const cardGapX = 20;
  const cardGapY = 16;
  const footerCardHeight = 122;

  const gridRowsCount = Math.max(1, Math.ceil(rows.length / gridCols));
  const totalHeight =
    headerHeight +
    24 +
    gridRowsCount * cardHeight +
    Math.max(0, gridRowsCount - 1) * cardGapY +
    24 +
    footerCardHeight +
    32;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = totalHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);

  // Soft Light Canvas Background (Zero Black)
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, width, totalHeight);

  // Clean Light-Indigo & Royal-Blue Header Card (No Black)
  drawRoundedRect(
    ctx,
    outerPad,
    18,
    width - outerPad * 2,
    headerHeight - 18,
    16,
    '#ffffff',
    '#cbd5e1',
    1.5
  );

  // Top Accent Bar inside Header
  drawRoundedRect(ctx, outerPad, 18, width - outerPad * 2, 8, 4, '#2563eb');

  // Header Title & Subtitle (Deep Royal Slate #1e3a8a & #475569 — never pure black)
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1e3a8a';
  ctx.font = 'bold 23px Inter, system-ui, sans-serif';
  ctx.fillText(title, outerPad + 24, 56);

  ctx.fillStyle = '#475569';
  ctx.font = '13px Inter, system-ui, sans-serif';
  ctx.fillText(subtitle, outerPad + 24, 80);

  // Prominent Reporting Date Badge + Meal Filter Badge + Property Count Badge
  const badgeY = 94;
  const dateBadgeText = `Reporting Date: ${dateRangeLabel}`;
  const dateBadgeW = Math.max(260, dateBadgeText.length * 7.4 + 28);
  drawRoundedRect(ctx, outerPad + 24, badgeY, dateBadgeW, 28, 8, '#eff6ff', '#93c5fd');
  ctx.fillStyle = '#1d4ed8';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(dateBadgeText, outerPad + 38, badgeY + 18);

  const mealBadgeX = outerPad + 24 + dateBadgeW + 12;
  const mealBadgeText = `Meal Filter: ${mealFilterLabel}`;
  const mealBadgeW = Math.max(210, mealBadgeText.length * 7.2 + 28);
  drawRoundedRect(ctx, mealBadgeX, badgeY, mealBadgeW, 28, 8, '#eef2ff', '#a5b4fc');
  ctx.fillStyle = '#4338ca';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(mealBadgeText, mealBadgeX + 14, badgeY + 18);

  const propBadgeX = mealBadgeX + mealBadgeW + 12;
  const propBadgeText = `Properties on Page: ${rows.length}`;
  const propBadgeW = Math.max(175, propBadgeText.length * 7.2 + 28);
  drawRoundedRect(ctx, propBadgeX, badgeY, propBadgeW, 28, 8, '#f0fdfa', '#99f6e4');
  ctx.fillStyle = '#0f766e';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(propBadgeText, propBadgeX + 14, badgeY + 18);

  // Color Legend Box in Header Right (Zero Black: Indigo, Blue, Teal, Rose)
  const legendBoxW = 540;
  const legendBoxX = width - outerPad - legendBoxW - 20;
  drawRoundedRect(ctx, legendBoxX, 40, legendBoxW, 44, 10, '#f8fafc', '#e2e8f0');

  const legendItems = [
    { label: 'Ordered', color: '#4f46e5' }, // Indigo-600 (No Black!)
    { label: 'Consumed', color: '#2563eb' }, // Blue-600
    { label: 'QR Scanned', color: '#0d9488' }, // Teal-600
    { label: 'Difference (Ord − Con)', color: '#e11d48' }, // Rose-600
  ];
  let lx = legendBoxX + 18;
  for (const item of legendItems) {
    drawRoundedRect(ctx, lx, 56, 13, 13, 4, item.color);
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, lx + 20, 67);
    lx += item.label.length * 7 + 36;
  }

  // Compute max meal value for proportional bar scaling
  let maxMealVal = 50;
  for (const r of rows) {
    maxMealVal = Math.max(
      maxMealVal,
      r.breakfastOrdered,
      r.breakfastConsumed,
      r.breakfastScanned,
      r.lunchOrdered,
      r.lunchConsumed,
      r.lunchScanned,
      r.dinnerOrdered,
      r.dinnerConsumed,
      r.dinnerScanned
    );
  }

  // Grand Totals Accumulator
  let gBOrd = 0,
    gBCon = 0,
    gBScn = 0,
    gBDiff = 0;
  let gLOrd = 0,
    gLCon = 0,
    gLScn = 0,
    gLDiff = 0;
  let gDOrd = 0,
    gDCon = 0,
    gDScn = 0,
    gDDiff = 0;
  let gTOrd = 0,
    gTCon = 0,
    gTScn = 0,
    gTDiff = 0;

  // Card Dimensions per Column
  const totalAvailWidth = width - outerPad * 2;
  const singleCardWidth =
    gridCols === 2
      ? Math.floor((totalAvailWidth - cardGapX) / 2)
      : totalAvailWidth;

  const startCardsY = headerHeight + 22;

  rows.forEach((prop, index) => {
    gBOrd += prop.breakfastOrdered;
    gBCon += prop.breakfastConsumed;
    gBScn += prop.breakfastScanned;
    gBDiff += prop.breakfastDifference;

    gLOrd += prop.lunchOrdered;
    gLCon += prop.lunchConsumed;
    gLScn += prop.lunchScanned;
    gLDiff += prop.lunchDifference;

    gDOrd += prop.dinnerOrdered;
    gDCon += prop.dinnerConsumed;
    gDScn += prop.dinnerScanned;
    gDDiff += prop.dinnerDifference;

    gTOrd += prop.totalOrdered;
    gTCon += prop.totalConsumed;
    gTScn += prop.totalScanned;
    gTDiff += prop.totalDifference;

    const colIdx = index % gridCols;
    const rowIdx = Math.floor(index / gridCols);

    const cardX = outerPad + colIdx * (singleCardWidth + cardGapX);
    const cardY = startCardsY + rowIdx * (cardHeight + cardGapY);

    // Outer Property Card Container (Crisp White with Subtle Blue-Slate Border)
    drawRoundedRect(
      ctx,
      cardX,
      cardY,
      singleCardWidth,
      cardHeight,
      14,
      '#ffffff',
      '#cbd5e1',
      1.2
    );

    // Left Zone: Property Name, Explicit Date Range, & 2x2 Summary KPI Grid
    const leftW = isMultiColumnGrid ? 285 : 355;
    const leftX = cardX + 16;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 15px Inter, system-ui, sans-serif';
    ctx.fillText(prop.propertyDisplay, leftX, cardY + 26);

    ctx.fillStyle = '#475569';
    ctx.font = '600 11px monospace';
    const propDateText = prop.reportingDateRange || dateRangeLabel;
    ctx.fillText(
      `Date: ${propDateText.slice(0, 32)} (${prop.reportDays}d)`,
      leftX,
      cardY + 45
    );

    // 2x2 KPI Summary Boxes inside Left Zone
    const boxGap = 8;
    const boxW = Math.floor((leftW - boxGap) / 2);
    const boxH = 44;
    const boxY1 = cardY + 58;
    const boxY2 = cardY + 108;

    // Box 1: Ordered (Indigo Theme — No Black)
    drawRoundedRect(ctx, leftX, boxY1, boxW, boxH, 8, '#eef2ff', '#c7d2fe');
    ctx.fillStyle = '#4338ca';
    ctx.font = 'bold 10px Inter, system-ui, sans-serif';
    ctx.fillText('ORDERED', leftX + 10, boxY1 + 15);
    ctx.fillStyle = '#312e81';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(prop.totalOrdered.toLocaleString(), leftX + 10, boxY1 + 35);

    // Box 2: Consumed (Royal Blue Theme)
    drawRoundedRect(ctx, leftX + boxW + boxGap, boxY1, boxW, boxH, 8, '#eff6ff', '#bfdbfe');
    ctx.fillStyle = '#2563eb';
    ctx.font = 'bold 10px Inter, system-ui, sans-serif';
    ctx.fillText('CONSUMED', leftX + boxW + boxGap + 10, boxY1 + 15);
    ctx.fillStyle = '#1d4ed8';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(prop.totalConsumed.toLocaleString(), leftX + boxW + boxGap + 10, boxY1 + 35);

    // Box 3: QR Scanned (Teal Theme)
    drawRoundedRect(ctx, leftX, boxY2, boxW, boxH, 8, '#f0fdfa', '#99f6e4');
    ctx.fillStyle = '#0d9488';
    ctx.font = 'bold 10px Inter, system-ui, sans-serif';
    ctx.fillText('QR SCANNED', leftX + 10, boxY2 + 15);
    ctx.fillStyle = '#0f766e';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(prop.totalScanned.toLocaleString(), leftX + 10, boxY2 + 35);

    // Box 4: Difference (Ordered - Consumed)
    const isNeg = prop.totalDifference < 0;
    drawRoundedRect(
      ctx,
      leftX + boxW + boxGap,
      boxY2,
      boxW,
      boxH,
      8,
      isNeg ? '#fff1f2' : '#ecfdf5',
      isNeg ? '#fecdd3' : '#a7f3d0'
    );
    ctx.fillStyle = isNeg ? '#e11d48' : '#047857';
    ctx.font = 'bold 10px Inter, system-ui, sans-serif';
    ctx.fillText('DIFFERENCE', leftX + boxW + boxGap + 10, boxY2 + 15);
    ctx.fillStyle = isNeg ? '#be123c' : '#065f46';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(
      prop.totalDifference >= 0
        ? `+${prop.totalDifference.toLocaleString()}`
        : prop.totalDifference.toLocaleString(),
      leftX + boxW + boxGap + 10,
      boxY2 + 35
    );

    // Vertical Divider
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(cardX + leftW + 28, cardY + 14);
    ctx.lineTo(cardX + leftW + 28, cardY + cardHeight - 14);
    ctx.stroke();

    // Right Zone: 3 Meal Sub-Cards (Breakfast, Lunch, Dinner)
    const meals = [
      {
        title: 'Breakfast',
        ordered: prop.breakfastOrdered,
        consumed: prop.breakfastConsumed,
        scanned: prop.breakfastScanned,
        difference: prop.breakfastDifference,
      },
      {
        title: 'Lunch',
        ordered: prop.lunchOrdered,
        consumed: prop.lunchConsumed,
        scanned: prop.lunchScanned,
        difference: prop.lunchDifference,
      },
      {
        title: 'Dinner',
        ordered: prop.dinnerOrdered,
        consumed: prop.dinnerConsumed,
        scanned: prop.dinnerScanned,
        difference: prop.dinnerDifference,
      },
    ];

    const rightStartX = cardX + leftW + 40;
    const availRightW = singleCardWidth - (leftW + 56);
    const subCardGap = 10;
    const subCardW = Math.floor((availRightW - subCardGap * 2) / 3);
    const subCardH = cardHeight - 24;
    const subCardY = cardY + 12;

    meals.forEach((m, mIdx) => {
      const mx = rightStartX + mIdx * (subCardW + subCardGap);
      drawRoundedRect(ctx, mx, subCardY, subCardW, subCardH, 10, '#f8fafc', '#e2e8f0');

      // Sub-Card Header: Meal Title on Left, Difference Pill on Right
      ctx.textAlign = 'left';
      ctx.fillStyle = '#1e3a8a';
      ctx.font = 'bold 13px Inter, system-ui, sans-serif';
      ctx.fillText(m.title, mx + 12, subCardY + 23);

      const diffText = `Diff: ${
        m.difference >= 0 ? `+${m.difference.toLocaleString()}` : m.difference.toLocaleString()
      }`;
      const badgeW = Math.max(76, diffText.length * 7 + 14);
      const badgeX = mx + subCardW - badgeW - 10;
      drawRoundedRect(
        ctx,
        badgeX,
        subCardY + 8,
        badgeW,
        21,
        6,
        m.difference < 0 ? '#ffe4e6' : '#e0e7ff'
      );
      ctx.textAlign = 'center';
      ctx.fillStyle = m.difference < 0 ? '#be123c' : '#3730a3';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(diffText, badgeX + badgeW / 2, subCardY + 22);

      // Divider
      ctx.strokeStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(mx + 10, subCardY + 35);
      ctx.lineTo(mx + subCardW - 10, subCardY + 35);
      ctx.stroke();

      // 3 Horizontal Bar Rows: Ordered (Indigo), Consumed (Blue), QR Scanned (Teal)
      const barRows = [
        { label: 'Ordered', val: m.ordered, barColor: '#4f46e5', textColor: '#3730a3' },
        { label: 'Consumed', val: m.consumed, barColor: '#2563eb', textColor: '#1d4ed8' },
        { label: 'QR Scanned', val: m.scanned, barColor: '#0d9488', textColor: '#0f766e' },
      ];

      const labelColW = 76;
      const valueColW = 46;
      const barTrackX = mx + 12 + labelColW;
      const barTrackW = Math.max(40, subCardW - labelColW - valueColW - 24);

      barRows.forEach((br, bIdx) => {
        const ry = subCardY + 58 + bIdx * 32;

        // Label
        ctx.textAlign = 'left';
        ctx.fillStyle = '#475569';
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.fillText(br.label, mx + 12, ry);

        // Bar Track Background
        drawRoundedRect(ctx, barTrackX, ry - 8, barTrackW, 8, 4, '#e2e8f0');

        // Bar Fill (Zero Black — Indigo / Blue / Teal)
        const fillW = Math.max(
          5,
          Math.min(barTrackW, Math.round((br.val / maxMealVal) * barTrackW))
        );
        drawRoundedRect(ctx, barTrackX, ry - 8, fillW, 8, 4, br.barColor);

        // Numeric Value
        ctx.textAlign = 'right';
        ctx.fillStyle = br.textColor;
        ctx.font = 'bold 12px monospace';
        ctx.fillText(br.val.toLocaleString(), mx + subCardW - 12, ry);
      });
    });
  });

  // Grand Total Executive Summary Card at the Bottom (Light Royal Indigo Card — No Black!)
  const footerY =
    startCardsY +
    gridRowsCount * cardHeight +
    Math.max(0, gridRowsCount - 1) * cardGapY +
    20;

  drawRoundedRect(
    ctx,
    outerPad,
    footerY,
    totalAvailWidth,
    footerCardHeight,
    16,
    '#eff6ff',
    '#93c5fd',
    1.5
  );

  ctx.textAlign = 'left';
  ctx.fillStyle = '#1e3a8a';
  ctx.font = 'bold 17px Inter, system-ui, sans-serif';
  ctx.fillText(
    `GRAND TOTAL SUMMARY (${rows.length} Properties Combined)`,
    outerPad + 22,
    footerY + 34
  );

  ctx.fillStyle = '#1d4ed8';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`Reporting Date: ${dateRangeLabel}`, outerPad + 22, footerY + 58);

  ctx.fillStyle = '#334155';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(
    `Ordered: ${gTOrd.toLocaleString()}   |   Consumed: ${gTCon.toLocaleString()}   |   QR Scanned: ${gTScn.toLocaleString()}   |   Difference: ${
      gTDiff >= 0 ? `+${gTDiff.toLocaleString()}` : gTDiff.toLocaleString()
    }`,
    outerPad + 22,
    footerY + 84
  );

  // 3 Meal Totals Cards in Footer Right
  const footerMeals = [
    { title: 'Breakfast Grand Total', ord: gBOrd, con: gBCon, scn: gBScn, diff: gBDiff },
    { title: 'Lunch Grand Total', ord: gLOrd, con: gLCon, scn: gLScn, diff: gLDiff },
    { title: 'Dinner Grand Total', ord: gDOrd, con: gDCon, scn: gDScn, diff: gDDiff },
  ];

  const fStartX = outerPad + 540;
  const fAvailW = totalAvailWidth - 560;
  const fCardW = Math.floor((fAvailW - 24) / 3);

  footerMeals.forEach((fm, idx) => {
    const fx = fStartX + idx * (fCardW + 12);
    drawRoundedRect(
      ctx,
      fx,
      footerY + 14,
      fCardW,
      footerCardHeight - 28,
      10,
      '#ffffff',
      '#bfdbfe'
    );

    ctx.textAlign = 'left';
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 13px Inter, system-ui, sans-serif';
    ctx.fillText(fm.title, fx + 14, footerY + 38);

    ctx.textAlign = 'right';
    ctx.fillStyle = fm.diff < 0 ? '#e11d48' : '#4338ca';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(
      `Difference: ${fm.diff >= 0 ? `+${fm.diff.toLocaleString()}` : fm.diff.toLocaleString()}`,
      fx + fCardW - 14,
      footerY + 38
    );

    ctx.textAlign = 'left';
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(
      `Ordered: ${fm.ord.toLocaleString()}   Consumed: ${fm.con.toLocaleString()}   QR Scanned: ${fm.scn.toLocaleString()}`,
      fx + 14,
      footerY + 74
    );
  });

  // Trigger PNG Download
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      params.filename ||
      `property-meal-cards-snapshot-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

export function downloadPropertySummaryCsv(
  rows: PropertySnapshotRow[],
  filename?: string
): void {
  const headers = [
    'Property Name',
    'Reporting Date Range',
    'Reporting Days',
    'Breakfast Ordered',
    'Breakfast Consumed',
    'Breakfast QR Scanned',
    'Breakfast Difference (Ordered - Consumed)',
    'Lunch Ordered',
    'Lunch Consumed',
    'Lunch QR Scanned',
    'Lunch Difference (Ordered - Consumed)',
    'Dinner Ordered',
    'Dinner Consumed',
    'Dinner QR Scanned',
    'Dinner Difference (Ordered - Consumed)',
    'Total Ordered',
    'Total Consumed',
    'Total QR Scanned',
    'Total Difference (Ordered - Consumed)',
  ];

  const escapeCell = (val: string | number) => {
    const str = String(val ?? '');
    const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const lines = [headers.map(escapeCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.propertyDisplay,
        r.reportingDateRange || 'All Filtered Dates',
        r.reportDays,
        r.breakfastOrdered,
        r.breakfastConsumed,
        r.breakfastScanned,
        r.breakfastDifference,
        r.lunchOrdered,
        r.lunchConsumed,
        r.lunchScanned,
        r.lunchDifference,
        r.dinnerOrdered,
        r.dinnerConsumed,
        r.dinnerScanned,
        r.dinnerDifference,
        r.totalOrdered,
        r.totalConsumed,
        r.totalScanned,
        r.totalDifference,
      ]
        .map(escapeCell)
        .join(',')
    );
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filename || `property-wise-meal-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
