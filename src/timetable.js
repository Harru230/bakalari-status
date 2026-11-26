import './styles/main.css';
import './styles/timetable.css';
import { formatPragueDateTime, getPragueTodayKey } from './lib/timezone.mjs';
import { formatShortDate } from './lib/calendar.mjs';

const TIMETABLE_URL = `${import.meta.env.BASE_URL}data/timetable.json`;
const CLASSES_URL = `${import.meta.env.BASE_URL}data/classes.json`;
const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LIVE_WEEK_TABS = [
  { key: 'last', label: 'Last week' },
  { key: 'current', label: 'This week' },
  { key: 'next', label: 'Next week' },
  { key: 'permanent', label: 'Permanent' },
];

const FALLBACK_CLASS_ORDER = [
  [6, ['A', 'B']],
  [5, ['A', 'B', 'C']],
  [4, ['A', 'B']],
  [3, ['A', 'B', 'C']],
  [2, ['A', 'B', 'C']],
  [1, ['A', 'B', 'C']],
].flatMap(([g, secs]) => secs.map((s) => `${g}.${s}`));

const state = {
  liveDoc: null,
  classesDoc: null,
  liveClassId: '',
  activeClass: '',
  activeWeek: 'current',
  viewMode: 'auto', // 'auto' | 'file'
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

function normalizeHashToClass(hash, order) {
  const clean = String(hash || '').replace(/^#/, '').trim().toUpperCase();
  if (!clean) return null;
  const compact = clean.replace(/[^0-9A-Z]/g, '');
  for (const cid of order) {
    if (cid.toUpperCase() === clean || cid.replace('.', '').toUpperCase() === compact) {
      return cid;
    }
  }
  return null;
}

function formatDayShortDate(dateKey) {
  if (!dateKey || dateKey.length < 10) return '';
  const [, m, d] = dateKey.split('-');
  return `${Number(d)}. ${Number(m)}.`;
}

function formatWeekRange(week) {
  if (week?.label === 'permanent') return 'Permanent schedule';
  if (!week?.startDate || !week?.endDate) return 'Permanent schedule';
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

function isClassAvailable(classId) {
  if (classId && classId === state.liveClassId && state.liveDoc?.weeks) {
    return true;
  }
  const entry = state.classesDoc?.classes?.[classId];
  return Boolean(entry && (entry.permanent || entry.file));
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

  const dayName = DAY_SHORT[day.dayOfWeek] || '';
  const dayLabel = day.date ? `${dayName} ${formatShortDate(day.date)}`.trim() : dayName;
  const timeStr = hour
    ? `${hour.caption}. hour (${hour.beginTime} - ${hour.endTime})`
    : atom.change?.time || '';
  addRow('When', timeStr ? `${dayLabel}, ${timeStr}` : dayLabel);
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

function renderClassBar(order) {
  const bar = el('div', 'tt-class-bar');
  bar.setAttribute('role', 'navigation');
  bar.setAttribute('aria-label', 'Select class');

  let prevGrade = null;
  for (const cid of order) {
    const grade = cid.split('.')[0];
    if (prevGrade !== null && grade !== prevGrade) {
      const sep = el('span', 'tt-class-sep');
      sep.setAttribute('aria-hidden', 'true');
      bar.appendChild(sep);
    }
    prevGrade = grade;

    const active = state.activeClass === cid;
    const available = isClassAvailable(cid);
    const btn = el('button', 'tt-class-pill', cid);
    btn.type = 'button';
    btn.setAttribute('data-class', cid);
    btn.setAttribute('data-available', available ? 'true' : 'false');
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.addEventListener('click', () => {
      if (state.activeClass === cid) return;
      state.activeClass = cid;
      state.viewMode = 'auto';
      state.selectedAtom = null;
      const slug = cid.replace('.', '');
      history.replaceState(null, '', `#${slug}`);
      render();
    });
    bar.appendChild(btn);
  }

  return bar;
}

function renderGridIntoSheet(sheet, week, { isLiveClass }) {
  const todayKey = getPragueTodayKey(new Date());
  const visibleHours = getVisibleHours(week);
  const hourById = new Map(visibleHours.map((h) => [Number(h.id), h]));

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
    if (isLiveClass && day.date && day.date === todayKey) {
      tr.classList.add('tt-row-today');
    }

    const dayTh = el('th', 'tt-day-th');
    dayTh.scope = 'row';
    dayTh.appendChild(el('div', 'tt-day-name', DAY_SHORT[day.dayOfWeek] || ''));
    if (day.date) {
      dayTh.appendChild(el('div', 'tt-day-date', formatDayShortDate(day.date)));
    }
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
  if (isLiveClass && week.label !== 'permanent') {
    addLeg('tt-swatch-changed', 'Changed / Substitution');
    addLeg('tt-swatch-removed', 'Removed / Canceled');
  }
  sheet.appendChild(legend);

  renderLessonDetail(detailCard, state.selectedAtom);
  return detailCard;
}

function renderFileViewerIntoSheet(sheet, classId, entry) {
  const fileUrl = `${import.meta.env.BASE_URL}${String(entry.file).replace(/^\/+/, '')}`;
  const wrap = el('div', 'tt-media-wrap');

  if (entry.fileType === 'pdf') {
    const frame = document.createElement('iframe');
    frame.className = 'tt-pdf-frame';
    frame.src = fileUrl;
    frame.title = `${classId} permanent timetable PDF`;
    wrap.appendChild(frame);
  } else {
    const img = document.createElement('img');
    img.className = 'tt-media-img';
    img.src = fileUrl;
    img.alt = `${classId} permanent timetable`;
    img.loading = 'lazy';
    wrap.appendChild(img);
  }

  const actions = el('div', 'tt-media-actions');
  const openLink = el('a', 'header-btn header-btn-secondary', entry.fileType === 'pdf' ? 'Open PDF' : 'Open full size');
  openLink.href = fileUrl;
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  actions.appendChild(openLink);

  sheet.append(wrap, actions);
}

function render() {
  const order = Array.isArray(state.classesDoc?.order) && state.classesDoc.order.length > 0
    ? state.classesDoc.order
    : FALLBACK_CLASS_ORDER;

  if (!state.activeClass) {
    state.activeClass = state.liveClassId || order[0] || '';
  }

  if (updatedEl && state.liveDoc?.updatedAt) {
    try {
      updatedEl.textContent = `Updated ${formatPragueDateTime(state.liveDoc.updatedAt)} | Daily sync at 06:00`;
    } catch {
      // keep default
    }
  }

  rootEl.replaceChildren();

  const sheet = el('section', 'tt-sheet');
  sheet.setAttribute('aria-label', 'Weekly timetable');
  sheet.appendChild(renderClassBar(order));

  const isLive = Boolean(state.liveClassId && state.activeClass === state.liveClassId && state.liveDoc?.weeks);

  if (isLive) {
    const availableTabs = LIVE_WEEK_TABS.filter((t) => Boolean(state.liveDoc.weeks[t.key]));
    const activeWeekKey = state.liveDoc.weeks[state.activeWeek] ? state.activeWeek : 'current';
    const week = state.liveDoc.weeks[activeWeekKey] || state.liveDoc.weeks.current;

    const topBar = el('div', 'tt-toolbar');
    const tabs = el('nav', 'tt-week-tabs');
    tabs.setAttribute('aria-label', 'Select week');

    for (const t of availableTabs) {
      const btn = el('button', 'tt-week-tab', t.label);
      btn.type = 'button';
      btn.setAttribute('data-week', t.key);
      btn.setAttribute('aria-pressed', activeWeekKey === t.key ? 'true' : 'false');
      btn.addEventListener('click', () => {
        if (state.activeWeek === t.key) return;
        state.activeWeek = t.key;
        state.selectedAtom = null;
        render();
      });
      tabs.appendChild(btn);
    }

    const rangeLabel = el('p', 'tt-range tabular-nums', `${state.activeClass} · ${formatWeekRange(week)}`);
    topBar.append(tabs, rangeLabel);
    sheet.appendChild(topBar);

    const detailCard = renderGridIntoSheet(sheet, week, { isLiveClass: true });
    rootEl.append(sheet, detailCard);
    return;
  }

  const entry = state.classesDoc?.classes?.[state.activeClass];
  if (!entry || (!entry.permanent && !entry.file)) {
    const topBar = el('div', 'tt-toolbar');
    topBar.appendChild(el('p', 'tt-range', `${state.activeClass} · Permanent schedule`));
    sheet.appendChild(topBar);
    sheet.appendChild(
      el('div', 'tt-empty-class', `Permanent timetable for ${state.activeClass} has not been added yet.`),
    );
    rootEl.appendChild(sheet);
    return;
  }

  const hasGrid = Boolean(entry.permanent?.days && entry.permanent?.hours);
  const hasFile = Boolean(entry.file);
  const showFile = !hasGrid || (hasFile && state.viewMode === 'file');

  const topBar = el('div', 'tt-toolbar');
  if (hasGrid && hasFile) {
    const modeTabs = el('nav', 'tt-week-tabs');
    modeTabs.setAttribute('aria-label', 'Display mode');
    for (const m of [
      { key: 'auto', label: 'Table' },
      { key: 'file', label: 'Original file' },
    ]) {
      const btn = el('button', 'tt-week-tab', m.label);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', (showFile ? 'file' : 'auto') === m.key ? 'true' : 'false');
      btn.addEventListener('click', () => {
        state.viewMode = m.key;
        state.selectedAtom = null;
        render();
      });
      modeTabs.appendChild(btn);
    }
    topBar.appendChild(modeTabs);
  }

  topBar.appendChild(el('p', 'tt-range', `${state.activeClass} · Permanent schedule`));
  sheet.appendChild(topBar);

  if (showFile) {
    renderFileViewerIntoSheet(sheet, state.activeClass, entry);
    rootEl.appendChild(sheet);
  } else {
    const detailCard = renderGridIntoSheet(
      sheet,
      { ...entry.permanent, label: 'permanent' },
      { isLiveClass: false },
    );
    rootEl.append(sheet, detailCard);
  }
}

async function init() {
  rootEl.replaceChildren(el('p', 'tt-loading', 'Loading timetable...'));
  try {
    const [ttRes, clsRes] = await Promise.all([
      fetch(TIMETABLE_URL, { cache: 'no-store' }),
      fetch(CLASSES_URL, { cache: 'no-store' }).catch(() => null),
    ]);

    if (!ttRes.ok) throw new Error(`HTTP ${ttRes.status}`);
    const ttData = await ttRes.json();
    if (!ttData || !ttData.weeks) throw new Error('Invalid timetable data');

    let clsData = null;
    if (clsRes && clsRes.ok) {
      try {
        clsData = await clsRes.json();
      } catch {
        clsData = null;
      }
    }

    state.liveDoc = ttData;
    state.classesDoc = clsData;

    const order = Array.isArray(clsData?.order) && clsData.order.length > 0
      ? clsData.order
      : FALLBACK_CLASS_ORDER;

    // Infer live class from timetable.json className (or fallback to 4th grade first section)
    const fallbackLive = order.find((c) => c.startsWith('4.')) || order[0] || '';
    state.liveClassId = ttData.className || fallbackLive;

    const fromHash = normalizeHashToClass(window.location.hash, order);
    state.activeClass = fromHash || state.liveClassId;

    window.addEventListener('hashchange', () => {
      const nextClass = normalizeHashToClass(window.location.hash, order);
      if (nextClass && nextClass !== state.activeClass) {
        state.activeClass = nextClass;
        state.selectedAtom = null;
        render();
      }
    });

    render();
  } catch {
    rootEl.replaceChildren(
      el('div', 'tt-error', 'Timetable snapshot is not available yet. Please try again later.'),
    );
  }
}

void init();
