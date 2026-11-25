import './styles/main.css';
import './styles/timetable.css';
import { formatPragueDateTime, getPragueTodayKey } from './lib/timezone.mjs';
import { formatShortDate } from './lib/calendar.mjs';

const TIMETABLE_URL = `${import.meta.env.BASE_URL}data/timetable.json`;
const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_TABS = [
  { key: 'last', label: 'Last week' },
  { key: 'current', label: 'This week' },
  { key: 'next', label: 'Next week' },
];

const state = {
  doc: null,
  activeWeek: 'current',
  selectedAtom: null,
};

const rootEl = document.getElementById('timetable-root');
const updatedEl = document.getElementById('timetable-updated');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function formatDayShortDate(dateKey) {
  if (!dateKey || dateKey.length < 10) return '';
  const [, m, d] = dateKey.split('-');
  return `${Number(d)}. ${Number(m)}.`;
}

function formatWeekRange(week) {
  if (!week?.startDate || !week?.endDate) return '';
  const year = week.endDate.slice(0, 4);
  return `${formatShortDate(week.startDate)} to ${formatShortDate(week.endDate)}, ${year}`;
}

function classifyChange(atom) {
  if (!atom.change) return 'regular';
  const t = String(atom.change.type || '').toLowerCase();
  if (t === 'removed' || t === 'canceled' || t === 'cancelled') return 'removed';
  return 'changed';
}

function getVisibleHours(week) {
  const hours = Array.isArray(week?.hours) ? week.hours : [];
  if (hours.length === 0) return [];

  const usedIds = new Set();
  for (const day of week.days || []) {
    for (const atom of day.atoms || []) {
      usedIds.add(Number(atom.hourId));
    }
  }

  const firstIdx = hours.findIndex((h) => usedIds.has(Number(h.id)));
  let lastIdx = -1;
  for (let i = hours.length - 1; i >= 0; i -= 1) {
    if (usedIds.has(Number(hours[i].id))) {
      lastIdx = i;
      break;
    }
  }

  if (firstIdx === -1 || lastIdx === -1) {
    return hours.slice(1, 9);
  }
  return hours.slice(firstIdx, lastIdx + 1);
}

function renderLessonDetail(detailEl, selection) {
  detailEl.replaceChildren();
  if (!selection) {
    detailEl.appendChild(
      el('p', 'tt-detail-empty', 'Select any lesson cell to view room, teacher, topic, and change details.'),
    );
    return;
  }

  const { atom, day, hour } = selection;
  const kind = classifyChange(atom);

  const head = el('div', 'tt-detail-head');
  const title = atom.subjectName || atom.subjectAbbrev || (kind === 'removed' ? 'Canceled lesson' : 'Lesson');
  head.appendChild(el('h3', 'tt-detail-title', title));

  if (atom.change) {
    const badge = el('span', 'tt-change-badge', atom.change.type || 'Changed');
    badge.setAttribute('data-kind', kind);
    head.appendChild(badge);
  }
  detailEl.appendChild(head);

  if (atom.change?.description) {
    const note = el('p', 'tt-detail-change', atom.change.description);
    note.setAttribute('data-kind', kind);
    detailEl.appendChild(note);
  }

  const dl = el('dl', 'tt-detail-grid');
  const addRow = (term, val) => {
    if (!val) return;
    const item = el('div', 'tt-detail-item');
    item.append(el('dt', 'tt-detail-term', term), el('dd', 'tt-detail-val', val));
    dl.appendChild(item);
  };

  const dayLabel = `${DAY_SHORT[day.dayOfWeek] || ''} ${formatShortDate(day.date)}`.trim();
  const timeStr = hour
    ? `${hour.caption}. hour (${hour.beginTime} - ${hour.endTime})`
    : atom.change?.time || '';
  addRow('When', `${dayLabel}, ${timeStr}`);
  addRow('Room', atom.room || '-');
  addRow(
    'Teacher',
    atom.teacherName
      ? `${atom.teacherName}${atom.teacherAbbrev ? ` (${atom.teacherAbbrev})` : ''}`
      : atom.teacherAbbrev || '-',
  );
  if (atom.groups && atom.groups.length > 0) {
    addRow('Group', atom.groups.join(', '));
  }
  if (atom.theme) {
    addRow('Topic', atom.theme);
  }

  detailEl.appendChild(dl);
}

function render() {
  const doc = state.doc;
  if (!doc || !doc.weeks) return;

  if (updatedEl && doc.updatedAt) {
    try {
      updatedEl.textContent = `Updated ${formatPragueDateTime(doc.updatedAt)} | Daily sync at 06:00`;
    } catch {
      // keep default
    }
  }

  const week = doc.weeks[state.activeWeek] || doc.weeks.current;
  if (!week) return;

  const todayKey = getPragueTodayKey(new Date());
  const visibleHours = getVisibleHours(week);
  const hourById = new Map(visibleHours.map((h) => [Number(h.id), h]));

  rootEl.replaceChildren();

  const sheet = el('section', 'tt-sheet');
  sheet.setAttribute('aria-label', 'Weekly timetable');

  const topBar = el('div', 'tt-toolbar');
  const tabs = el('nav', 'tt-week-tabs');
  tabs.setAttribute('aria-label', 'Select week');

  for (const t of WEEK_TABS) {
    const isActive = state.activeWeek === t.key;
    const btn = el('button', 'tt-week-tab', t.label);
    btn.type = 'button';
    btn.setAttribute('data-week', t.key);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    btn.addEventListener('click', () => {
      if (state.activeWeek === t.key) return;
      state.activeWeek = t.key;
      state.selectedAtom = null;
      render();
    });
    tabs.appendChild(btn);
  }

  const rangeLabel = el('p', 'tt-range tabular-nums', formatWeekRange(week));
  topBar.append(tabs, rangeLabel);
  sheet.appendChild(topBar);

  const scrollWrap = el('div', 'tt-scroll');
  const table = el('table', 'tt-table');

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const cornerTh = el('th', 'tt-corner', 'Day');
  cornerTh.scope = 'col';
  headRow.appendChild(cornerTh);

  for (const h of visibleHours) {
    const th = el('th', 'tt-hour-th');
    th.scope = 'col';
    th.append(
      el('div', 'tt-hour-num', h.caption),
      el('div', 'tt-hour-time', `${h.beginTime}-${h.endTime}`),
    );
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const allButtons = [];
  const detailCard = el('section', 'tt-detail-card');
  detailCard.setAttribute('aria-live', 'polite');

  for (const day of week.days || []) {
    const tr = document.createElement('tr');
    if (day.date === todayKey) tr.classList.add('tt-row-today');

    const dayTh = el('th', 'tt-day-th');
    dayTh.scope = 'row';
    dayTh.append(
      el('div', 'tt-day-name', DAY_SHORT[day.dayOfWeek] || ''),
      el('div', 'tt-day-date', formatDayShortDate(day.date)),
    );
    tr.appendChild(dayTh);

    const atoms = Array.isArray(day.atoms) ? day.atoms : [];
    const isSpecialDay = day.dayType && day.dayType !== 'WorkDay' && atoms.length === 0;

    if (isSpecialDay) {
      const td = el('td', 'tt-special-td');
      td.colSpan = Math.max(visibleHours.length, 1);
      const fallbackLabel =
        day.dayType === 'Weekend' && day.dayOfWeek <= 5
          ? 'Day off'
          : day.dayType === 'Holiday' || day.dayType === 'Celebration'
            ? 'Holiday'
            : day.dayType;
      td.appendChild(el('div', 'tt-special-banner', day.dayDescription || fallbackLabel));
      tr.appendChild(td);
      tbody.appendChild(tr);
      continue;
    }

    const atomsByHour = new Map();
    for (const a of atoms) {
      const hid = Number(a.hourId);
      if (!atomsByHour.has(hid)) atomsByHour.set(hid, []);
      atomsByHour.get(hid).push(a);
    }

    for (const h of visibleHours) {
      const td = el('td', 'tt-cell-td');
      const slotAtoms = atomsByHour.get(Number(h.id)) || [];

      if (slotAtoms.length > 0) {
        const stack = el('div', 'tt-cell-stack');
        for (const atom of slotAtoms) {
          const kind = classifyChange(atom);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tt-atom';
          btn.setAttribute('data-kind', kind);
          btn.setAttribute('aria-pressed', 'false');

          const topMeta = el('div', 'tt-atom-top');
          const grpText = atom.groups && atom.groups.length > 0 ? atom.groups.join(' ') : '';
          topMeta.append(
            el('span', 'tt-atom-group', grpText),
            el('span', 'tt-atom-room', atom.room || ''),
          );

          const subjText = atom.subjectAbbrev || (kind === 'removed' ? 'Canceled' : 'Change');
          btn.append(
            topMeta,
            el('div', 'tt-atom-subj', subjText),
            el('div', 'tt-atom-teacher', atom.teacherAbbrev || ''),
          );

          btn.addEventListener('click', () => {
            state.selectedAtom = { atom, day, hour: hourById.get(Number(h.id)) };
            for (const other of allButtons) {
              other.setAttribute('aria-pressed', other === btn ? 'true' : 'false');
            }
            renderLessonDetail(detailCard, state.selectedAtom);
          });

          allButtons.push(btn);
          stack.appendChild(btn);
        }
        td.appendChild(stack);
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  scrollWrap.appendChild(table);
  sheet.appendChild(scrollWrap);

  const legend = el('div', 'tt-legend');
  const addLeg = (cls, text) => {
    const item = el('span', 'tt-legend-item');
    item.append(el('span', `tt-swatch ${cls}`), el('span', null, text));
    legend.appendChild(item);
  };
  addLeg('tt-swatch-regular', 'Regular');
  addLeg('tt-swatch-changed', 'Changed / Substitution');
  addLeg('tt-swatch-removed', 'Removed / Canceled');
  sheet.appendChild(legend);

  rootEl.appendChild(sheet);

  renderLessonDetail(detailCard, state.selectedAtom);
  rootEl.appendChild(detailCard);
}

async function init() {
  rootEl.replaceChildren(el('p', 'tt-loading', 'Loading timetable...'));
  try {
    const res = await fetch(TIMETABLE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.weeks) throw new Error('Invalid timetable data');
    state.doc = data;
    render();
  } catch {
    rootEl.replaceChildren(
      el('div', 'tt-error', 'Timetable snapshot is not available yet. Please try again later.'),
    );
  }
}

void init();
