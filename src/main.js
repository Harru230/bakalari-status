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
  formatEnglishDate,
  getCalendarBounds,
  pickInitialSelectedDate,
} from './lib/calendar.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATUS_URL = `${import.meta.env.BASE_URL}data/status.json`;

const state = {
  doc: null,
  viewMonth: null,
  selectedDate: null,
};

const statusEl = document.getElementById('live-status');
const calendarRoot = document.getElementById('calendar-root');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function createIcon(status, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
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

function isValidDoc(doc) {
  return Boolean(doc && typeof doc === 'object' && doc.days && typeof doc.days === 'object');
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

function renderStatusHeader(doc) {
  statusEl.replaceChildren();
  const current = doc.currentStatus || {};
  const latestKey = Object.keys(doc.days).sort().pop();
  const verdict =
    current.status === 'online' || current.status === 'offline'
      ? current.status
      : latestKey
        ? doc.days[latestKey].status
        : 'offline';

  const pill = el('span', 'status-pill');
  pill.setAttribute('data-status', verdict);
  pill.append(
    createIcon(verdict, 'status-pill-icon'),
    el('span', null, verdict === 'online' ? 'No, it is online' : 'Yes, it is offline'),
  );
  statusEl.appendChild(pill);

  const checkedAt = current.checkedAt || doc.generatedAt;
  if (checkedAt) {
    try {
      const formatted = formatPragueDateTime(checkedAt);
      const timeOnly = formatted.slice(11, 16);
      statusEl.appendChild(el('span', 'status-time', `Checked ${timeOnly}`));
    } catch {
      // ignore malformed timestamp
    }
  }
}

function buildDayLine(dayCell) {
  if (!dayCell) return '';
  const dateLabel = formatEnglishDate(dayCell.dateKey);
  if (dayCell.status === 'unmonitored') {
    return `${dateLabel}: No data`;
  }
  if (dayCell.status === 'online') {
    return `${dateLabel}: Online (${dayCell.up}/${dayCell.checks} ok)`;
  }
  return `${dateLabel}: Offline (${dayCell.down}/${dayCell.checks} failed)`;
}

function renderCalendar() {
  const doc = state.doc;
  if (!doc) return;

  renderStatusHeader(doc);

  const now = new Date();
  const bounds = getCalendarBounds(doc, now);
  const grid = buildMonthGrid({
    year: state.viewMonth.year,
    month: state.viewMonth.month,
    statusDoc: doc,
    now,
  });

  if (!grid.days.some((d) => d.dateKey === state.selectedDate)) {
    state.selectedDate = pickInitialSelectedDate(grid, bounds.todayKey);
  }

  calendarRoot.replaceChildren();

  // Month selector tabs (September, October, November, ...)
  const availableMonths = listAvailableMonths(bounds);
  const multiYear = bounds.minMonth.year !== bounds.maxMonth.year;
  const monthTabs = el('nav', 'month-tabs');
  monthTabs.setAttribute('aria-label', 'Select month');

  for (const m of availableMonths) {
    const isActive = m.year === state.viewMonth.year && m.month === state.viewMonth.month;
    const label = multiYear
      ? `${MONTH_NAMES[m.month - 1]} ${String(m.year).slice(-2)}`
      : MONTH_NAMES[m.month - 1];
    const tabBtn = el('button', 'month-tab', label);
    tabBtn.type = 'button';
    tabBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    tabBtn.setAttribute('data-month', `${m.year}-${String(m.month).padStart(2, '0')}`);
    tabBtn.addEventListener('click', () => {
      if (isActive) return;
      state.viewMonth = { year: m.year, month: m.month };
      const nextGrid = buildMonthGrid({ ...state.viewMonth, statusDoc: doc, now });
      state.selectedDate = pickInitialSelectedDate(nextGrid, bounds.todayKey);
      renderCalendar();
    });
    monthTabs.appendChild(tabBtn);
  }
  calendarRoot.appendChild(monthTabs);

  // Month title + Uptime% / Downtime%
  const bar = el('div', 'month-bar');
  const heading = el('h2', 'month-title', grid.heading);
  heading.id = 'calendar-heading';
  bar.appendChild(heading);

  if (grid.summary.monitoredDays > 0) {
    const upPct = Math.round((grid.summary.onlineDays / grid.summary.monitoredDays) * 100);
    const downPct = 100 - upPct;

    const pctRow = el('div', 'month-pct-row');
    const upSpan = el('span', 'pct-up', `${upPct}% uptime (${grid.summary.onlineDays}d)`);
    const downSpan = el('span', 'pct-down', `${downPct}% downtime (${grid.summary.offlineDays}d)`);
    pctRow.append(upSpan, downSpan);
    bar.appendChild(pctRow);

    const meter = el('div', 'month-meter');
    meter.setAttribute('aria-hidden', 'true');
    const meterUp = el('div', 'month-meter-up');
    meterUp.style.width = `${upPct}%`;
    const meterDown = el('div', 'month-meter-down');
    meterDown.style.width = `${downPct}%`;
    meter.append(meterUp, meterDown);
    bar.appendChild(meter);
  } else {
    bar.appendChild(el('span', 'month-counts', 'No monitored days'));
  }

  calendarRoot.appendChild(bar);

  const weekdays = el('div', 'weekdays');
  for (const label of WEEKDAY_LABELS) {
    weekdays.appendChild(el('div', 'weekday', label));
  }
  calendarRoot.appendChild(weekdays);

  const gridEl = el('div', 'days-grid');
  gridEl.setAttribute('role', 'grid');
  gridEl.setAttribute('aria-labelledby', 'calendar-heading');

  for (let i = 0; i < grid.leadingEmptyCount; i += 1) {
    const empty = el('div', 'day-empty');
    empty.setAttribute('aria-hidden', 'true');
    gridEl.appendChild(empty);
  }

  const dayLineEl = el('p', 'day-line');
  dayLineEl.id = 'day-detail-live';
  dayLineEl.setAttribute('aria-live', 'polite');

  const buttons = [];
  for (const item of grid.days) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-cell';
    btn.setAttribute('data-date', item.dateKey);
    btn.setAttribute('data-status', item.status);
    if (item.isToday) {
      btn.setAttribute('data-today', 'true');
      btn.setAttribute('aria-current', 'date');
    }
    btn.setAttribute('aria-pressed', item.dateKey === state.selectedDate ? 'true' : 'false');
    btn.setAttribute('aria-label', `${formatEnglishDate(item.dateKey)}, ${item.status}`);

    btn.appendChild(el('span', 'day-num', String(item.day)));
    if (item.status === 'online' || item.status === 'offline') {
      btn.appendChild(createIcon(item.status, 'day-icon'));
    } else {
      btn.appendChild(el('span', 'day-dash', '-'));
    }

    btn.addEventListener('click', () => {
      state.selectedDate = item.dateKey;
      for (const b of buttons) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      }
      dayLineEl.textContent = buildDayLine(item);
    });

    buttons.push(btn);
    gridEl.appendChild(btn);
  }

  for (let i = 0; i < grid.trailingEmptyCount; i += 1) {
    const empty = el('div', 'day-empty');
    empty.setAttribute('aria-hidden', 'true');
    gridEl.appendChild(empty);
  }

  calendarRoot.appendChild(gridEl);

  const selectedCell = grid.days.find((d) => d.dateKey === state.selectedDate) || grid.days[0];
  dayLineEl.textContent = buildDayLine(selectedCell);
  calendarRoot.appendChild(dayLineEl);
}

function applyDoc(doc) {
  if (!isValidDoc(doc)) return;
  state.doc = doc;
  const now = new Date();
  const bounds = getCalendarBounds(doc, now);
  if (!state.viewMonth) {
    state.viewMonth = clampMonth(bounds.todayMonth, bounds);
  }
  const initialGrid = buildMonthGrid({ ...state.viewMonth, statusDoc: doc, now });
  if (!state.selectedDate) {
    state.selectedDate = pickInitialSelectedDate(initialGrid, bounds.todayKey);
  }
  renderCalendar();
}

async function init() {
  if (isValidDoc(bundledStatus)) {
    applyDoc(bundledStatus);
  }
  try {
    const res = await fetch(STATUS_URL, { cache: 'no-store' });
    if (res.ok) {
      const fresh = await res.json();
      if (isValidDoc(fresh)) {
        applyDoc(fresh);
      }
    }
  } catch {
    // Bundled status is already rendered
  }
}

void init();
