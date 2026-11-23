import './styles/main.css';
import bundledStatus from '../data/status.json';
import { formatPragueDateTime } from './lib/timezone.mjs';
import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  clampMonth,
  computeOverallStats,
  formatEnglishDate,
  formatEnglishFullDate,
  formatMonthHeading,
  formatShortDate,
  getCalendarBounds,
  pickInitialSelectedDate,
  stepMonth,
} from './lib/calendar.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATUS_URL = `${import.meta.env.BASE_URL}data/status.json`;

const REASON_EXPLANATIONS = {
  ok: 'HTTP 200 OK',
  timeout: 'Timed out waiting for response',
  non_200: 'Unexpected HTTP status (not 200)',
  network_error: 'Connection or TLS error',
};

const SOURCE_LABELS = {
  probe: 'Automated probe',
  historical: 'Historical archive',
};

const appState = {
  phase: 'loading',
  doc: null,
  isBundledSnapshot: false,
  viewMonth: null,
  selectedDate: null,
};

const mainEl = document.getElementById('main-content');
const subtitleEl = document.getElementById('site-subtitle');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function formatMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown latency';
  return `${Math.round(value).toLocaleString('en-US')} ms`;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
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
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(SVG_NS, 'path');
  if (status === 'online') {
    path.setAttribute('d', 'M4.5 10.5L8.25 14.25L15.5 6');
    path.setAttribute('stroke-linejoin', 'miter');
  } else {
    path.setAttribute('d', 'M5.5 5.5L14.5 14.5M14.5 5.5L5.5 14.5');
  }
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.25');
  path.setAttribute('stroke-linecap', 'square');
  svg.appendChild(path);
  return svg;
}

function updateSubtitle(doc) {
  if (!subtitleEl) return;
  if (doc && typeof doc.historyStartDate === 'string') {
    try {
      const startLabel = formatEnglishDate(doc.historyStartDate);
      subtitleEl.textContent = `Direct HTTP 200 monitor for bakalari.oegp.cz/login and daily incident ledger since ${startLabel}.`;
      return;
    } catch {
      // Keep default subtitle if historyStartDate is missing or malformed
    }
  }
  subtitleEl.textContent = 'Direct HTTP 200 monitor for bakalari.oegp.cz/login and daily incident ledger.';
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

function renderLoading() {
  mainEl.replaceChildren();
  const section = el('section', 'state-panel');
  section.setAttribute('role', 'status');
  section.setAttribute('aria-busy', 'true');
  section.append(
    el('h2', 'state-heading', 'Loading Bakaláři status ledger'),
    el('p', 'state-body', 'Fetching the latest probe history for bakalari.oegp.cz/login.'),
  );
  mainEl.appendChild(section);
}

function renderError(message) {
  mainEl.replaceChildren();
  const section = el('section', 'state-panel state-error');
  section.setAttribute('role', 'alert');
  section.append(
    el('h2', 'state-heading', 'Unable to load status data'),
    el(
      'p',
      'state-body',
      message || 'Could not fetch or parse data/status.json. Check your connection and try again.',
    ),
  );

  const actions = el('div', 'state-actions');
  const retryBtn = el('button', 'btn-primary', 'Retry');
  retryBtn.type = 'button';
  retryBtn.id = 'retry-btn';
  retryBtn.addEventListener('click', () => {
    void loadStatus();
  });
  actions.appendChild(retryBtn);

  if (isValidStatusPayload(bundledStatus) && Object.keys(bundledStatus.days).length > 0) {
    const snapshotBtn = el('button', 'btn-secondary', 'View bundled snapshot');
    snapshotBtn.type = 'button';
    snapshotBtn.id = 'snapshot-btn';
    snapshotBtn.addEventListener('click', () => {
      applyLoadedDocument(bundledStatus, true);
    });
    actions.appendChild(snapshotBtn);
  }

  section.appendChild(actions);
  mainEl.appendChild(section);
}

function renderEmpty() {
  mainEl.replaceChildren();
  const section = el('section', 'state-panel');
  section.append(
    el('h2', 'state-heading', 'No checks recorded yet'),
    el(
      'p',
      'state-body',
      'No status history is available yet. Daily checkmarks and crosses appear once the first probe completes.',
    ),
  );

  const actions = el('div', 'state-actions');
  const reloadBtn = el('button', 'btn-secondary', 'Reload status data');
  reloadBtn.type = 'button';
  reloadBtn.id = 'reload-btn';
  reloadBtn.addEventListener('click', () => {
    void loadStatus();
  });
  actions.appendChild(reloadBtn);

  section.appendChild(actions);
  mainEl.appendChild(section);
}

function buildVerdictReasonText(currentStatus) {
  if (!currentStatus || typeof currentStatus !== 'object') {
    return 'Latest probe details are unavailable.';
  }
  const { status, reason, httpStatus, latencyMs } = currentStatus;
  if (reason === 'timeout') {
    return `The /login endpoint did not return an HTTP response within ${formatMs(latencyMs)}. Check again after the next scheduled probe.`;
  }
  if (reason === 'non_200') {
    const code = httpStatus !== null && httpStatus !== undefined ? `HTTP ${httpStatus}` : 'a non-200 status';
    return `The /login endpoint answered with ${code} instead of HTTP 200, so login is recorded as offline.`;
  }
  if (reason === 'network_error') {
    return 'The probe could not open an HTTPS connection to /login.';
  }
  if (reason === 'ok' || status === 'online') {
    if (typeof latencyMs === 'number' && Number.isFinite(latencyMs)) {
      return `Returned HTTP 200 in ${formatMs(latencyMs)}. Timetables and room changes are actually reachable.`;
    }
    return 'Latest recorded check returned HTTP 200.';
  }
  return 'The latest check did not return HTTP 200.';
}

function buildStreakLine(doc, stats, todayKey, verdictStatus) {
  const current = doc.currentStatus || {};
  const effectiveStatus = current.status === 'online' || current.status === 'offline'
    ? current.status
    : verdictStatus;
  const todayDay = doc.days?.[todayKey] ?? null;
  const { currentStreak, maxOfflineStreak } = stats;

  if (effectiveStatus === 'offline') {
    if (currentStreak.status === 'offline' && currentStreak.days >= 2) {
      return `Outage streak: ${currentStreak.days} consecutive days (${formatRangeShort(currentStreak.startDate, currentStreak.endDate)}).`;
    }
    if (todayDay && Number(todayDay.down) > 0) {
      const todayDown = Number(todayDay.down);
      const todayChecks = Number(todayDay.checks ?? (Number(todayDay.up ?? 0) + todayDown));
      const priorRun = maxOfflineStreak.days > 0
        ? ` Longest outage run reached ${maxOfflineStreak.days} ${pluralize(maxOfflineStreak.days, 'day')} (${formatRangeShort(maxOfflineStreak.startDate, maxOfflineStreak.endDate)}).`
        : '';
      return `Today recorded ${todayDown} failed ${pluralize(todayDown, 'check')} out of ${todayChecks}.${priorRun}`;
    }
    if (currentStreak.status === 'online' && currentStreak.days > 0) {
      return `Latest probe failed after a ${currentStreak.days}-day clean run (${formatRangeShort(currentStreak.startDate, currentStreak.endDate)}).`;
    }
    if (maxOfflineStreak.days > 0) {
      return `Longest outage run reached ${maxOfflineStreak.days} ${pluralize(maxOfflineStreak.days, 'day')} (${formatRangeShort(maxOfflineStreak.startDate, maxOfflineStreak.endDate)}).`;
    }
    return 'Marked offline by the latest probe.';
  }

  if (todayDay && Number(todayDay.down) > 0) {
    return `Latest probe passed, though today stays marked offline because ${todayDay.down} earlier ${pluralize(todayDay.down, 'check')} failed.`;
  }
  if (currentStreak.status === 'online' && currentStreak.days > 0) {
    return `Clean streak: ${currentStreak.days} consecutive ${pluralize(currentStreak.days, 'day')} with every check passing.`;
  }
  if (currentStreak.status === 'offline' && currentStreak.days > 0) {
    return `Latest probe returned HTTP 200 after a ${currentStreak.days}-day outage run (${formatRangeShort(currentStreak.startDate, currentStreak.endDate)}).`;
  }
  return 'All recorded checks on the latest day returned HTTP 200.';
}

function createStatusBanner(doc, stats, todayKey) {
  const currentStatus = doc.currentStatus || {};
  const latestDayKey = Object.keys(doc.days).sort().pop();
  const fallbackStatus = latestDayKey ? doc.days[latestDayKey].status : 'offline';
  const verdictStatus = currentStatus.status === 'online' || currentStatus.status === 'offline'
    ? currentStatus.status
    : fallbackStatus;

  const banner = el('section', 'status-banner');
  banner.setAttribute('data-verdict', verdictStatus);
  banner.setAttribute('aria-label', 'Current login status');

  const header = el('div', 'verdict-header');
  const iconWrap = el('div', 'verdict-icon-wrap');
  iconWrap.appendChild(createStatusSvg(verdictStatus, 'status-icon'));

  const copy = el('div', 'verdict-copy');
  const headline = verdictStatus === 'online'
    ? 'Bakaláři /login is up (online)'
    : 'Bakaláři /login is down (offline)';
  copy.appendChild(el('h2', 'verdict-heading', headline));
  copy.appendChild(el('p', 'verdict-reason', buildVerdictReasonText(currentStatus)));

  const meta = el('div', 'verdict-meta');
  const checkedAt = currentStatus.checkedAt || doc.generatedAt;
  if (checkedAt) {
    try {
      const timeSpan = el('p', 'tabular-nums', `Last probe: ${formatPragueDateTime(checkedAt)}`);
      meta.appendChild(timeSpan);
    } catch {
      meta.appendChild(el('p', null, 'Last probe timestamp unavailable.'));
    }
  }
  meta.appendChild(el('p', 'tabular-nums', buildStreakLine(doc, stats, todayKey, verdictStatus)));
  copy.appendChild(meta);

  header.append(iconWrap, copy);
  banner.appendChild(header);

  const strip = el('div', 'ledger-strip');

  const itemDays = el('div', 'ledger-item');
  itemDays.append(
    el('span', 'ledger-label', 'Monitored days'),
    el(
      'span',
      'ledger-value',
      `${stats.totalDays} (${stats.onlineDays} clean, ${stats.offlineDays} offline)`,
    ),
  );

  const itemChecks = el('div', 'ledger-item');
  itemChecks.append(
    el('span', 'ledger-label', 'Checks passed'),
    el('span', 'ledger-value', `${stats.totalUp} of ${stats.totalChecks} HTTP 200`),
  );

  const itemStreak = el('div', 'ledger-item');
  const streakText = stats.maxOfflineStreak.days > 0
    ? `${stats.maxOfflineStreak.days} ${pluralize(stats.maxOfflineStreak.days, 'day')} (${formatRangeShort(stats.maxOfflineStreak.startDate, stats.maxOfflineStreak.endDate)})`
    : '0 days recorded';
  itemStreak.append(
    el('span', 'ledger-label', 'Longest outage run'),
    el('span', 'ledger-value', streakText),
  );

  strip.append(itemDays, itemChecks, itemStreak);
  banner.appendChild(strip);

  return banner;
}

function formatDayDetailRow(term, value, isMono = false) {
  const row = el('div', 'detail-row');
  row.appendChild(el('dt', 'detail-term', term));
  row.appendChild(el('dd', isMono ? 'detail-value detail-value-mono' : 'detail-value', value));
  return row;
}

function formatSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return 'unknown';
  return sources.map((src) => SOURCE_LABELS[src] || src).join(', ');
}

function formatRecentCheckLine(entry) {
  let timeLabel = entry.timestamp || '';
  try {
    const formatted = formatPragueDateTime(entry.timestamp);
    timeLabel = formatted.slice(11);
  } catch {
    // Keep raw string if timestamp is non-standard
  }
  const outcomeWord = entry.status === 'online' ? 'Online' : 'Offline';
  const details = [];
  if (entry.reason) details.push(entry.reason);
  if (entry.httpStatus !== null && entry.httpStatus !== undefined) {
    details.push(`HTTP ${entry.httpStatus}`);
  }
  if (typeof entry.latencyMs === 'number' && Number.isFinite(entry.latencyMs)) {
    details.push(formatMs(entry.latencyMs));
  }
  const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
  return { timeLabel, outcomeText: `${outcomeWord}${suffix}` };
}

function renderDetailContent(liveEl, doc, grid, selectedDateKey) {
  liveEl.replaceChildren();
  const dayCell = grid.days.find((d) => d.dateKey === selectedDateKey) || grid.days[0];
  if (!dayCell) return;

  const topRow = el('div', 'detail-date-row');
  topRow.appendChild(el('h3', 'detail-date-title', formatEnglishFullDate(dayCell.dateKey)));

  const badge = el('span', 'detail-badge');
  badge.setAttribute('data-day-verdict', dayCell.status);
  if (dayCell.status === 'online') {
    badge.textContent = 'Online';
  } else if (dayCell.status === 'offline') {
    badge.textContent = 'Offline';
  } else {
    badge.textContent = 'Unmonitored';
  }
  topRow.appendChild(badge);
  liveEl.appendChild(topRow);

  if (dayCell.status === 'unmonitored') {
    let explanation = 'No checks recorded for this date.';
    if (dayCell.isPreHistory && doc.historyStartDate) {
      explanation = `Before monitoring started on ${doc.historyStartDate}. No checks recorded.`;
    } else if (dayCell.isFuture) {
      explanation = 'Future date. Not monitored yet. Scheduled probes update this date when reached.';
    }
    liveEl.appendChild(el('p', 'detail-explanation', explanation));

    const dl = el('dl', 'detail-list');
    dl.append(
      formatDayDetailRow('Date (Europe/Prague)', dayCell.dateKey, true),
      formatDayDetailRow('Verdict', 'Unmonitored'),
    );
    liveEl.appendChild(dl);
    return;
  }

  const explanation = dayCell.status === 'online'
    ? 'Every check on this date returned HTTP 200.'
    : `Marked offline because ${dayCell.down} of ${dayCell.checks} ${pluralize(dayCell.checks, 'check')} failed or missed HTTP 200.`;
  liveEl.appendChild(el('p', 'detail-explanation', explanation));

  const dl = el('dl', 'detail-list');
  const lastCheckedText = dayCell.lastCheckedAt
    ? (() => {
        try {
          return formatPragueDateTime(dayCell.lastCheckedAt);
        } catch {
          return String(dayCell.lastCheckedAt);
        }
      })()
    : 'Not recorded';

  const lastHttpText = dayCell.lastHttpStatus !== null && dayCell.lastHttpStatus !== undefined
    ? `HTTP ${dayCell.lastHttpStatus}`
    : 'None (no HTTP response)';

  const rawReason = dayCell.lastReason ?? 'unknown';
  const reasonNote = REASON_EXPLANATIONS[rawReason];
  const reasonDisplay = reasonNote ? `${rawReason} (${reasonNote})` : rawReason;

  dl.append(
    formatDayDetailRow('Date (Europe/Prague)', dayCell.dateKey, true),
    formatDayDetailRow('Verdict', dayCell.status === 'online' ? 'Online' : 'Offline'),
    formatDayDetailRow(
      'Checks logged',
      `${dayCell.checks} (${dayCell.up} up, ${dayCell.down} down)`,
    ),
    formatDayDetailRow('Last reason', reasonDisplay, true),
    formatDayDetailRow('Last HTTP status', lastHttpText, true),
    formatDayDetailRow('Last checked (Europe/Prague)', lastCheckedText, true),
    formatDayDetailRow('Sources', formatSources(dayCell.sources)),
  );
  liveEl.appendChild(dl);

  const matchingRecent = Array.isArray(doc.recentChecks)
    ? doc.recentChecks.filter((item) => item && item.date === dayCell.dateKey).slice(0, 12)
    : [];

  if (matchingRecent.length > 0) {
    const recentBlock = el('div', 'recent-checks-block');
    recentBlock.appendChild(el('h4', 'recent-checks-heading', 'Recent checks on this date'));
    const list = el('ul', 'recent-checks-list');
    for (const item of matchingRecent) {
      const li = el('li', 'recent-check-item');
      const { timeLabel, outcomeText } = formatRecentCheckLine(item);
      li.append(
        el('span', 'recent-check-time', timeLabel),
        el('span', 'recent-check-outcome', outcomeText),
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

  if (appState.isBundledSnapshot) {
    const notice = el('section', 'snapshot-notice');
    notice.setAttribute('aria-label', 'Snapshot notice');
    notice.appendChild(
      el(
        'p',
        'snapshot-notice-text',
        'Showing bundled build-time snapshot because the live status fetch failed.',
      ),
    );
    const retryLive = el('button', 'btn-secondary', 'Retry');
    retryLive.type = 'button';
    retryLive.addEventListener('click', () => {
      void loadStatus();
    });
    notice.appendChild(retryLive);
    mainEl.appendChild(notice);
  }

  mainEl.appendChild(createStatusBanner(doc, stats, bounds.todayKey));

  const workspace = el('div', 'workspace');

  const calendarSection = el('section', 'calendar-sheet');
  calendarSection.setAttribute('aria-label', 'Monthly uptime calendar');

  const toolbar = el('div', 'calendar-toolbar');
  const titleBlock = el('div', 'calendar-title-block');

  const monthHeading = el('h2', 'calendar-heading', grid.heading);
  monthHeading.id = 'calendar-heading';
  monthHeading.setAttribute('data-calendar-heading', '');
  titleBlock.appendChild(monthHeading);

  const summaryText = grid.summary.monitoredDays > 0
    ? `${grid.summary.onlineDays} clean, ${grid.summary.offlineDays} with outages (${grid.summary.totalUp} of ${grid.summary.totalChecks} checks passed)`
    : `No checks recorded in ${grid.heading}.`;
  const summaryEl = el('p', 'calendar-summary', summaryText);
  summaryEl.setAttribute('data-tabular', '');
  titleBlock.appendChild(summaryEl);

  const nav = el('nav', 'calendar-nav');
  nav.setAttribute('aria-label', 'Calendar month navigation');

  const prevTarget = stepMonth(appState.viewMonth, -1, bounds);
  const nextTarget = stepMonth(appState.viewMonth, 1, bounds);

  const prevBtn = el('button', 'btn-secondary', 'Previous');
  prevBtn.type = 'button';
  prevBtn.id = 'nav-prev';
  prevBtn.disabled = !grid.canPrev;
  prevBtn.setAttribute(
    'aria-label',
    grid.canPrev
      ? `Previous month, ${formatMonthHeading(prevTarget.year, prevTarget.month)}`
      : 'Previous month, earliest recorded month reached',
  );

  const todayBtn = el('button', 'btn-primary', 'Today');
  todayBtn.type = 'button';
  todayBtn.id = 'nav-today';
  todayBtn.setAttribute(
    'aria-label',
    `Today, jump to ${formatMonthHeading(bounds.todayMonth.year, bounds.todayMonth.month)}`,
  );

  const nextBtn = el('button', 'btn-secondary', 'Next');
  nextBtn.type = 'button';
  nextBtn.id = 'nav-next';
  nextBtn.disabled = !grid.canNext;
  nextBtn.setAttribute(
    'aria-label',
    grid.canNext
      ? `Next month, ${formatMonthHeading(nextTarget.year, nextTarget.month)}`
      : 'Next month, current month reached',
  );

  nav.append(prevBtn, todayBtn, nextBtn);
  toolbar.append(titleBlock, nav);
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
  for (let i = 0; i < grid.leadingEmptyCount; i += 1) {
    slots.push(null);
  }
  for (const dayItem of grid.days) {
    slots.push(dayItem);
  }
  for (let i = 0; i < grid.trailingEmptyCount; i += 1) {
    slots.push(null);
  }

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
      btn.setAttribute('aria-pressed', slotItem.dateKey === appState.selectedDate ? 'true' : 'false');
      btn.setAttribute('aria-label', slotItem.ariaLabel);

      const numSpan = el('span', 'day-num', String(slotItem.day));
      btn.appendChild(numSpan);

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
  legend.setAttribute('aria-label', 'Calendar status legend');

  const onlineLegend = el('div', 'legend-item');
  onlineLegend.append(
    createStatusSvg('online', 'status-icon legend-icon-online'),
    el('span', null, 'Online (all checks HTTP 200)'),
  );

  const offlineLegend = el('div', 'legend-item');
  offlineLegend.append(
    createStatusSvg('offline', 'status-icon legend-icon-offline'),
    el('span', null, 'Offline (any timeout or non-200)'),
  );

  const unmonitoredLegend = el('div', 'legend-item');
  const unmonDash = el('span', 'legend-icon-unmonitored', '-');
  unmonDash.setAttribute('aria-hidden', 'true');
  unmonitoredLegend.append(unmonDash, el('span', null, 'Unmonitored (no checks)'));

  legend.append(onlineLegend, offlineLegend, unmonitoredLegend);
  calendarSection.appendChild(legend);

  renderDetailContent(liveRegion, doc, grid, appState.selectedDate);

  workspace.append(calendarSection, detailPanel);
  mainEl.appendChild(workspace);

  prevBtn.addEventListener('click', () => {
    if (!grid.canPrev) return;
    const nextState = stepMonth(appState.viewMonth, -1, bounds);
    appState.viewMonth = { year: nextState.year, month: nextState.month };
    const nextGrid = buildMonthGrid({ ...appState.viewMonth, statusDoc: doc, now });
    appState.selectedDate = pickInitialSelectedDate(nextGrid, bounds.todayKey);
    renderReady();
    const target = document.getElementById('nav-prev');
    if (target && !target.disabled) {
      target.focus({ preventScroll: true });
    } else {
      document.getElementById('nav-next')?.focus({ preventScroll: true });
    }
  });

  nextBtn.addEventListener('click', () => {
    if (!grid.canNext) return;
    const nextState = stepMonth(appState.viewMonth, 1, bounds);
    appState.viewMonth = { year: nextState.year, month: nextState.month };
    const nextGrid = buildMonthGrid({ ...appState.viewMonth, statusDoc: doc, now });
    appState.selectedDate = pickInitialSelectedDate(nextGrid, bounds.todayKey);
    renderReady();
    const target = document.getElementById('nav-next');
    if (target && !target.disabled) {
      target.focus({ preventScroll: true });
    } else {
      document.getElementById('nav-prev')?.focus({ preventScroll: true });
    }
  });

  todayBtn.addEventListener('click', () => {
    const freshNow = new Date();
    const freshBounds = getCalendarBounds(doc, freshNow);
    appState.viewMonth = clampMonth(freshBounds.todayMonth, freshBounds);
    const todayGrid = buildMonthGrid({ ...appState.viewMonth, statusDoc: doc, now: freshNow });
    appState.selectedDate = pickInitialSelectedDate(todayGrid, freshBounds.todayKey);
    renderReady();
    document.getElementById('nav-today')?.focus({ preventScroll: true });
  });
}

function applyLoadedDocument(doc, isBundledSnapshot = false) {
  appState.doc = doc;
  appState.isBundledSnapshot = isBundledSnapshot;
  updateSubtitle(doc);

  const dayCount = Object.keys(doc.days).length;
  if (dayCount === 0) {
    appState.phase = 'empty';
    renderEmpty();
    return;
  }

  const now = new Date();
  const bounds = getCalendarBounds(doc, now);
  appState.viewMonth = clampMonth(bounds.todayMonth, bounds);
  const initialGrid = buildMonthGrid({ ...appState.viewMonth, statusDoc: doc, now });
  appState.selectedDate = pickInitialSelectedDate(initialGrid, bounds.todayKey);
  appState.phase = 'ready';
  renderReady();
}

async function loadStatus() {
  appState.phase = 'loading';
  renderLoading();

  let payload = null;
  try {
    const response = await fetch(STATUS_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    payload = await response.json();
    if (!isValidStatusPayload(payload)) {
      throw new Error('Invalid status payload schema');
    }
  } catch {
    if (
      window.location.protocol === 'file:' &&
      isValidStatusPayload(bundledStatus) &&
      Object.keys(bundledStatus.days).length > 0
    ) {
      applyLoadedDocument(bundledStatus, true);
      return;
    }
    appState.phase = 'error';
    renderError(
      'Could not fetch or parse data/status.json. Check your connection and try again.',
    );
    return;
  }

  applyLoadedDocument(payload, false);
}

void loadStatus();
