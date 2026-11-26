import './styles/main.css';
import bundledStatus from '../data/status.json';
import { formatPragueDateTime } from './lib/timezone.mjs';
import {
  MONTH_NAMES,
  WEEKDAY_LABELS,
  addMonths,
  buildMonthGrid,
  clampMonth,
  compareMonths,
  computeOverallStats,
  formatEnglishFullDate,
  formatShortDate,
  getCalendarBounds,
  pickInitialSelectedDate,
} from './lib/calendar.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATUS_URL = `${import.meta.env.BASE_URL}data/status.json`;

const appState = {
  doc: null,
  viewMonth: null,
  selectedDate: null,
};

const mainEl = document.getElementById('main-content');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function formatMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)} ms`;
}

function formatRangeShort(startKey, endKey) {
  if (!startKey || !endKey) return '';
  if (startKey === endKey) return formatShortDate(startKey);
  return `${formatShortDate(startKey)} to ${formatShortDate(endKey)}`;
}

function createStatusSvg(status, className = 'status-icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(SVG_NS, 'path');
  if (status === 'online') {
    path.setAttribute('d', 'M4.5 10.5L8.25 14.25L15.5 6');
  } else {
    path.setAttribute('d', 'M5.5 5.5L14.5 14.5M14.5 5.5L5.5 14.5');
  }
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.25');
  path.setAttribute('stroke-linecap', 'square');
  svg.appendChild(path);
  return svg;
}

function isValidStatusPayload(doc) {
  return Boolean(
    doc &&
      typeof doc === 'object' &&
      !Array.isArray(doc) &&
      doc.days &&
      typeof doc.days === 'object' &&
      !Array.isArray(doc.days),
  );
}

function listAvailableMonths(bounds) {
  const months = [];
  let cursor = { year: bounds.minMonth.year, month: bounds.minMonth.month };
  while (compareMonths(cursor, bounds.maxMonth) <= 0) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

function formatShortReason(reason, httpStatus, latencyMs) {
  const dur = formatMs(latencyMs);
  if (reason === 'ok') {
    return dur ? `HTTP 200 (${dur})` : 'HTTP 200';
  }
  if (reason === 'timeout') {
    return dur ? `Timeout (${dur})` : 'Timeout';
  }
  if (reason === 'non_200') {
    const code = httpStatus ? `HTTP ${httpStatus}` : 'HTTP error';
    return dur ? `${code} (${dur})` : code;
  }
  if (reason === 'network_error') {
    return 'Connection error';
  }
  return httpStatus ? `HTTP ${httpStatus}` : 'Failed';
}

function createStatusBanner(doc, stats, grid) {
  const currentStatus = doc.currentStatus || {};
  const latestDayKey = Object.keys(doc.days).sort().pop();
  const fallbackStatus = latestDayKey ? doc.days[latestDayKey].status : 'offline';
  const verdictStatus =
    currentStatus.status === 'online' || currentStatus.status === 'offline'
      ? currentStatus.status
      : fallbackStatus;

  const banner = el('section', 'status-banner');
  banner.setAttribute('data-verdict', verdictStatus);
  banner.setAttribute('aria-label', 'Current status');

  const header = el('div', 'verdict-header');
  const iconWrap = el('div', 'verdict-icon-wrap');
  iconWrap.appendChild(createStatusSvg(verdictStatus, 'status-icon'));

  const copy = el('div', 'verdict-copy');
  const headline = verdictStatus === 'online' ? 'Bakaláři is online' : 'Bakaláři is offline';
  copy.appendChild(el('h2', 'verdict-heading', headline));

  const metaParts = [];
  if (currentStatus.reason || currentStatus.httpStatus) {
    metaParts.push(
      formatShortReason(currentStatus.reason, currentStatus.httpStatus, currentStatus.latencyMs),
    );
  }
  const checkedAt = currentStatus.checkedAt || doc.generatedAt;
  if (checkedAt) {
    try {
      metaParts.push(`Last check: ${formatPragueDateTime(checkedAt)}`);
    } catch {
      // ignore
    }
  }
  if (metaParts.length > 0) {
    copy.appendChild(el('p', 'verdict-meta tabular-nums', metaParts.join(' | ')));
  }

  header.append(iconWrap, copy);
  banner.appendChild(header);

  const strip = el('div', 'ledger-strip');

  const monthMonitored = grid.summary.monitoredDays;
  const monthUpPct =
    monthMonitored > 0 ? Math.round((grid.summary.onlineDays / monthMonitored) * 100) : 0;
  const monthDownPct = monthMonitored > 0 ? 100 - monthUpPct : 0;

  const itemMonth = el('div', 'ledger-item');
  itemMonth.append(
    el('span', 'ledger-label', `${grid.heading} uptime / downtime`),
    el(
      'span',
      'ledger-value',
      monthMonitored > 0
        ? `${monthUpPct}% up / ${monthDownPct}% down (${grid.summary.onlineDays}d / ${grid.summary.offlineDays}d)`
        : 'No data',
    ),
  );

  const totalUpPct =
    stats.totalDays > 0 ? Math.round((stats.onlineDays / stats.totalDays) * 100) : 0;
  const itemTotal = el('div', 'ledger-item');
  itemTotal.append(
    el('span', 'ledger-label', 'Total uptime'),
    el(
      'span',
      'ledger-value',
      `${totalUpPct}% (${stats.onlineDays} of ${stats.totalDays} days)`,
    ),
  );

  const itemStreak = el('div', 'ledger-item');
  const streakText =
    stats.maxOfflineStreak.days > 0
      ? `${stats.maxOfflineStreak.days} days (${formatRangeShort(stats.maxOfflineStreak.startDate, stats.maxOfflineStreak.endDate)})`
      : '0 days';
  itemStreak.append(
    el('span', 'ledger-label', 'Longest outage'),
    el('span', 'ledger-value', streakText),
  );

  strip.append(itemMonth, itemTotal, itemStreak);
  banner.appendChild(strip);

  return banner;
}

function formatDayDetailRow(term, value, isMono = false) {
  const row = el('div', 'detail-row');
  row.appendChild(el('dt', 'detail-term', term));
  row.appendChild(el('dd', isMono ? 'detail-value detail-value-mono' : 'detail-value', value));
  return row;
}

function renderDetailContent(liveEl, doc, grid, selectedDateKey) {
  liveEl.replaceChildren();
  const dayCell = grid.days.find((d) => d.dateKey === selectedDateKey) || grid.days[0];
  if (!dayCell) return;

  const topRow = el('div', 'detail-date-row');
  topRow.appendChild(el('h3', 'detail-date-title', formatEnglishFullDate(dayCell.dateKey)));

  const badge = el('span', 'detail-badge');
  badge.setAttribute('data-day-verdict', dayCell.status);
  badge.textContent =
    dayCell.status === 'online'
      ? 'Online'
      : dayCell.status === 'offline'
        ? 'Offline'
        : 'No data';
  topRow.appendChild(badge);
  liveEl.appendChild(topRow);

  if (dayCell.status === 'unmonitored') {
    liveEl.appendChild(el('p', 'detail-explanation', 'No checks recorded for this date.'));
    return;
  }

  const dl = el('dl', 'detail-list');
  const dayUpPct = dayCell.checks > 0 ? Math.round((dayCell.up / dayCell.checks) * 100) : 0;
  const dayDownPct = dayCell.checks > 0 ? 100 - dayUpPct : 0;

  const lastCheckedText = dayCell.lastCheckedAt
    ? (() => {
        try {
          return formatPragueDateTime(dayCell.lastCheckedAt);
        } catch {
          return String(dayCell.lastCheckedAt);
        }
      })()
    : 'Not recorded';

  const lastResponse = formatShortReason(dayCell.lastReason, dayCell.lastHttpStatus, null);

  dl.append(
    formatDayDetailRow(
      'Checks',
      `${dayCell.up} up, ${dayCell.down} down (${dayUpPct}% up / ${dayDownPct}% down)`,
    ),
    formatDayDetailRow('Last response', lastResponse, true),
    formatDayDetailRow('Last check', lastCheckedText, true),
  );
  liveEl.appendChild(dl);

  const matchingRecent = Array.isArray(doc.recentChecks)
    ? doc.recentChecks.filter((item) => item && item.date === dayCell.dateKey).slice(0, 24)
    : [];

  if (matchingRecent.length > 0) {
    const recentBlock = el('div', 'recent-checks-block');
    recentBlock.appendChild(el('h4', 'recent-checks-heading', 'Checks on this day'));
    const list = el('ul', 'recent-checks-list');
    for (const item of matchingRecent) {
      const li = el('li', 'recent-check-item');
      let timeLabel = item.timestamp || '';
      try {
        timeLabel = formatPragueDateTime(item.timestamp).slice(11);
      } catch {
        // keep raw
      }
      const outcomeWord = item.status === 'online' ? 'Online' : 'Offline';
      const detail = formatShortReason(item.reason, item.httpStatus, item.latencyMs);
      li.append(
        el('span', 'recent-check-time', timeLabel),
        el('span', 'recent-check-outcome', `${outcomeWord} (${detail})`),
      );
      list.appendChild(li);
    }
    recentBlock.appendChild(list);
    liveEl.appendChild(recentBlock);
  }
}

function renderReady() {
  const doc = appState.doc;
  if (!doc) return;

  const now = new Date();
  const bounds = getCalendarBounds(doc, now);
  const grid = buildMonthGrid({
    year: appState.viewMonth.year,
    month: appState.viewMonth.month,
    statusDoc: doc,
    now,
  });

  if (!grid.days.some((d) => d.dateKey === appState.selectedDate)) {
    appState.selectedDate = pickInitialSelectedDate(grid, bounds.todayKey);
  }

  const stats = computeOverallStats(doc);

  mainEl.replaceChildren();
  mainEl.appendChild(createStatusBanner(doc, stats, grid));

  const workspace = el('div', 'workspace');

  const calendarSection = el('section', 'calendar-sheet');
  calendarSection.setAttribute('aria-label', 'Monthly uptime calendar');

  // Direct month buttons (September, October, November, ...)
  const availableMonths = listAvailableMonths(bounds);
  const multiYear = bounds.minMonth.year !== bounds.maxMonth.year;
  const monthNav = el('nav', 'month-tabs');
  monthNav.setAttribute('aria-label', 'Select month');

  for (const m of availableMonths) {
    const isActive = m.year === appState.viewMonth.year && m.month === appState.viewMonth.month;
    const label = multiYear
      ? `${MONTH_NAMES[m.month - 1]} ${String(m.year).slice(-2)}`
      : MONTH_NAMES[m.month - 1];
    const btn = el('button', 'month-tab', label);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    btn.addEventListener('click', () => {
      if (isActive) return;
      appState.viewMonth = { year: m.year, month: m.month };
      const nextGrid = buildMonthGrid({ ...appState.viewMonth, statusDoc: doc, now });
      appState.selectedDate = pickInitialSelectedDate(nextGrid, bounds.todayKey);
      renderReady();
    });
    monthNav.appendChild(btn);
  }
  calendarSection.appendChild(monthNav);

  const toolbar = el('div', 'calendar-toolbar');
  const monthHeading = el('h2', 'calendar-heading', grid.heading);
  monthHeading.id = 'calendar-heading';
  toolbar.appendChild(monthHeading);

  if (grid.summary.monitoredDays > 0) {
    const upPct = Math.round((grid.summary.onlineDays / grid.summary.monitoredDays) * 100);
    const downPct = 100 - upPct;

    const pctRow = el('div', 'month-pct-row');
    pctRow.append(
      el('span', 'pct-up', `${upPct}% uptime (${grid.summary.onlineDays} up)`),
      el('span', 'pct-down', `${downPct}% downtime (${grid.summary.offlineDays} down)`),
    );
    toolbar.appendChild(pctRow);

    const meter = el('div', 'month-meter');
    meter.setAttribute('aria-hidden', 'true');
    const meterUp = el('div', 'month-meter-up');
    meterUp.style.width = `${upPct}%`;
    const meterDown = el('div', 'month-meter-down');
    meterDown.style.width = `${downPct}%`;
    meter.append(meterUp, meterDown);
    toolbar.appendChild(meter);
  }
  calendarSection.appendChild(toolbar);

  const tableEl = el('div', 'calendar-table');
  tableEl.setAttribute('role', 'table');
  tableEl.setAttribute('aria-labelledby', 'calendar-heading');

  const weekdaysRow = el('div', 'calendar-weekdays');
  weekdaysRow.setAttribute('role', 'row');
  for (const label of WEEKDAY_LABELS) {
    const colHeader = el('div', 'weekday-cell', label);
    colHeader.setAttribute('role', 'columnheader');
    weekdaysRow.appendChild(colHeader);
  }
  tableEl.appendChild(weekdaysRow);

  const slots = [];
  for (let i = 0; i < grid.leadingEmptyCount; i += 1) slots.push(null);
  for (const dayItem of grid.days) slots.push(dayItem);
  for (let i = 0; i < grid.trailingEmptyCount; i += 1) slots.push(null);

  const dayButtons = [];
  const detailPanel = el('section', 'detail-panel');
  detailPanel.setAttribute('aria-label', 'Selected day details');
  detailPanel.appendChild(el('h2', 'detail-heading', 'Day details'));

  const liveRegion = el('div', 'detail-live');
  liveRegion.id = 'day-detail-live';
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  detailPanel.appendChild(liveRegion);

  for (let i = 0; i < slots.length; i += 7) {
    const weekRow = el('div', 'calendar-week');
    weekRow.setAttribute('role', 'row');
    for (let j = 0; j < 7; j += 1) {
      const slotItem = slots[i + j];
      if (!slotItem) {
        const spacer = el('div', 'day-spacer');
        spacer.setAttribute('role', 'cell');
        spacer.setAttribute('aria-hidden', 'true');
        weekRow.appendChild(spacer);
        continue;
      }

      const cellWrap = el('div', 'day-slot');
      cellWrap.setAttribute('role', 'cell');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-btn';
      btn.setAttribute('data-date', slotItem.dateKey);
      btn.setAttribute('data-status', slotItem.status);
      if (slotItem.isToday) {
        btn.setAttribute('data-today', 'true');
        btn.setAttribute('aria-current', 'date');
      }
      btn.setAttribute(
        'aria-pressed',
        slotItem.dateKey === appState.selectedDate ? 'true' : 'false',
      );
      btn.setAttribute('aria-label', slotItem.ariaLabel);

      btn.appendChild(el('span', 'day-num', String(slotItem.day)));
      if (slotItem.status === 'online' || slotItem.status === 'offline') {
        btn.appendChild(createStatusSvg(slotItem.status, 'status-icon'));
      } else {
        const dash = el('span', 'unmonitored-mark', '-');
        dash.setAttribute('aria-hidden', 'true');
        btn.appendChild(dash);
      }

      btn.addEventListener('click', () => {
        appState.selectedDate = slotItem.dateKey;
        for (const other of dayButtons) {
          other.setAttribute(
            'aria-pressed',
            other.getAttribute('data-date') === slotItem.dateKey ? 'true' : 'false',
          );
        }
        renderDetailContent(liveRegion, doc, grid, slotItem.dateKey);
      });

      dayButtons.push(btn);
      cellWrap.appendChild(btn);
      weekRow.appendChild(cellWrap);
    }
    tableEl.appendChild(weekRow);
  }

  calendarSection.appendChild(tableEl);

  const legend = el('div', 'calendar-legend');
  const onlineLegend = el('div', 'legend-item');
  onlineLegend.append(
    createStatusSvg('online', 'status-icon legend-icon-online'),
    el('span', null, 'Online'),
  );
  const offlineLegend = el('div', 'legend-item');
  offlineLegend.append(
    createStatusSvg('offline', 'status-icon legend-icon-offline'),
    el('span', null, 'Offline'),
  );
  const unmonitoredLegend = el('div', 'legend-item');
  unmonitoredLegend.append(
    el('span', 'legend-icon-unmonitored', '-'),
    el('span', null, 'No data'),
  );
  legend.append(onlineLegend, offlineLegend, unmonitoredLegend);
  calendarSection.appendChild(legend);

  renderDetailContent(liveRegion, doc, grid, appState.selectedDate);

  workspace.append(calendarSection, detailPanel);
  mainEl.appendChild(workspace);
}

function applyDoc(doc) {
  if (!isValidStatusPayload(doc)) return;
  appState.doc = doc;
  const now = new Date();
  const bounds = getCalendarBounds(doc, now);
  if (!appState.viewMonth) {
    appState.viewMonth = clampMonth(bounds.todayMonth, bounds);
  }
  const initialGrid = buildMonthGrid({ ...appState.viewMonth, statusDoc: doc, now });
  if (!appState.selectedDate) {
    appState.selectedDate = pickInitialSelectedDate(initialGrid, bounds.todayKey);
  }
  renderReady();
}

async function init() {
  if (isValidStatusPayload(bundledStatus)) {
    applyDoc(bundledStatus);
  }
  try {
    const response = await fetch(STATUS_URL, { cache: 'no-store' });
    if (response.ok) {
      const fresh = await response.json();
      if (isValidStatusPayload(fresh)) {
        applyDoc(fresh);
      }
    }
  } catch {
    // Bundled status is already displayed
  }
}

void init();
