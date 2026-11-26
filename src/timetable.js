import './styles/main.css';
import './styles/timetable.css';
import { formatPragueDateTime, getPragueTodayKey } from './lib/timezone.mjs';
import { formatShortDate } from './lib/calendar.mjs';
import { decryptJson } from './lib/vault.mjs';
import { computeTeacherSchedules } from './lib/teachers.mjs';

const BASE = import.meta.env.BASE_URL;
const TIMETABLE_URL = `${BASE}data/timetable.json`;
const CLASSES_URL = `${BASE}data/classes.json`;
const TIMETABLE_VAULT_URL = `${BASE}data/timetable.enc.json`;
const TEACHERS_VAULT_URL = `${BASE}data/teachers.enc.json`;
const VAULT_STORAGE_KEY = 'bakalari_vault_key';

const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_MAP = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };
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

const mobileMq =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 767px)')
    : null;

function getPragueWeekday(date = new Date()) {
  try {
    const short = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Prague',
      weekday: 'short',
    }).format(date);
    return WEEKDAY_MAP[short] || 1;
  } catch {
    return 1;
  }
}

const state = {
  liveDoc: null,
  classesDoc: null,
  liveClassId: '',
  mode: 'classes', // 'classes' | 'teachers'
  activeClass: '',
  activeWeek: 'current',
  viewMode: 'auto',
  isMobileViewport: mobileMq ? mobileMq.matches : false,
  mobileLayout: 'day', // 'day' | 'week'
  activeDayOfWeek: getPragueWeekday(new Date()),
  unlocked: false,
  vaultLiveDoc: null,
  unlockedClassesMap: null,
  teacherSchedules: null,
  activeTeacher: '',
  teacherQuery: '',
  unlockError: '',
  unlockPending: false,
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

function getClassOrder() {
  return Array.isArray(state.classesDoc?.order) && state.classesDoc.order.length > 0
    ? state.classesDoc.order
    : FALLBACK_CLASS_ORDER;
}

function normalizeHashToClass(hash, order) {
  const clean = String(hash || '').replace(/^#/, '').trim().toUpperCase();
  if (!clean || clean.startsWith('TEACHER-')) return null;
  const compact = clean.replace(/[^0-9A-Z]/g, '');
  for (const cid of order) {
    if (cid.toUpperCase() === clean || cid.replace('.', '').toUpperCase() === compact) {
      return cid;
    }
  }
  return null;
}

function parseTeacherHash(hash) {
  const clean = String(hash || '').replace(/^#/, '').trim();
  if (!/^teacher-/i.test(clean)) return null;
  return clean.slice('teacher-'.length).trim().toUpperCase() || null;
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

function formatShortTeacherPill(teacher) {
  if (!teacher.name) return teacher.abbrev;
  const cleaned = teacher.name
    .replace(/,\s*Ph\.?D\.?$/i, '')
    .replace(/\b(?:Mgr|Mag|MMag|Ing|Dr|PhDr|OStR|Bc|MSc|Dipl\.-Soz|DiS|art|et)\b\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(' ').filter(Boolean);
  const surname = parts.length > 0 ? parts[parts.length - 1] : teacher.abbrev;
  return `${surname} (${teacher.abbrev})`;
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

function getActiveLiveDoc() {
  return state.unlocked && state.vaultLiveDoc?.weeks ? state.vaultLiveDoc : state.liveDoc;
}

function getClassEntry(classId) {
  if (state.unlocked && state.unlockedClassesMap?.[classId]) {
    return state.unlockedClassesMap[classId];
  }
  return state.classesDoc?.classes?.[classId] || null;
}

function isClassAvailable(classId) {
  if (classId && classId === state.liveClassId && getActiveLiveDoc()?.weeks) {
    return true;
  }
  const entry = getClassEntry(classId);
  return Boolean(entry && (entry.permanent || entry.file));
}

async function unlockWithPassphrase(passphrase, { persist = true } = {}) {
  const cleanPass = String(passphrase || '').trim();
  if (!cleanPass) {
    throw new Error('Passphrase is required.');
  }

  const [teachersRes, liveVaultRes] = await Promise.all([
    fetch(TEACHERS_VAULT_URL, { cache: 'no-store' }),
    fetch(TIMETABLE_VAULT_URL, { cache: 'no-store' }).catch(() => null),
  ]);

  if (!teachersRes.ok) {
    throw new Error('Encrypted teacher data is unavailable.');
  }

  const teachersEnvelope = await teachersRes.json();
  const decryptedTeachers = await decryptJson(teachersEnvelope, cleanPass);

  let decryptedLive = null;
  if (liveVaultRes && liveVaultRes.ok) {
    try {
      const liveEnvelope = await liveVaultRes.json();
      decryptedLive = await decryptJson(liveEnvelope, cleanPass);
    } catch {
      decryptedLive = null;
    }
  }

  const order = Array.isArray(decryptedTeachers.order) && decryptedTeachers.order.length > 0
    ? decryptedTeachers.order
    : getClassOrder();

  const classesMap = { ...(decryptedTeachers.classLessonsWithTeachers || {}) };
  if (decryptedLive?.weeks?.permanent && state.liveClassId && !classesMap[state.liveClassId]) {
    classesMap[state.liveClassId] = {
      className: state.liveClassId,
      updatedAt: decryptedLive.updatedAt || '',
      permanent: decryptedLive.weeks.permanent,
    };
  }

  const schedules = computeTeacherSchedules(classesMap, decryptedTeachers.teachers || {}, order);

  state.unlocked = true;
  state.vaultLiveDoc = decryptedLive;
  state.unlockedClassesMap = classesMap;
  state.teacherSchedules = schedules;
  state.unlockError = '';

  if (
    !state.activeTeacher ||
    !schedules.teachers.some((t) => t.abbrev === state.activeTeacher)
  ) {
    state.activeTeacher = schedules.teachers[0]?.abbrev || '';
  }

  if (persist) {
    try {
      localStorage.setItem(VAULT_STORAGE_KEY, cleanPass);
    } catch {
      // ignore storage errors
    }
  }
}

function lockVault() {
  state.unlocked = false;
  state.vaultLiveDoc = null;
  state.unlockedClassesMap = null;
  state.teacherSchedules = null;
  state.unlockError = '';
  state.selectedAtom = null;
  try {
    localStorage.removeItem(VAULT_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function isShowingScheduleGrid() {
  if (state.mode === 'teachers') {
    return Boolean(state.unlocked && state.teacherSchedules?.teachers?.length);
  }
  const liveDoc = getActiveLiveDoc();
  if (state.liveClassId && state.activeClass === state.liveClassId && liveDoc?.weeks) {
    return true;
  }
  const entry = getClassEntry(state.activeClass);
  return Boolean(entry?.permanent?.days && entry?.permanent?.hours);
}

function renderModeBar() {
  const row = el('div', 'tt-mode-bar');

  const modeTabs = el('div', 'tt-mode-tabs');
  modeTabs.setAttribute('role', 'tablist');
  modeTabs.setAttribute('aria-label', 'Timetable view');

  for (const m of [
    { key: 'classes', label: 'Classes' },
    { key: 'teachers', label: 'Teachers' },
  ]) {
    const btn = el('button', 'tt-mode-tab', m.label);
    btn.type = 'button';
    btn.setAttribute('data-mode', m.key);
    btn.setAttribute('aria-pressed', state.mode === m.key ? 'true' : 'false');
    btn.addEventListener('click', () => {
      if (state.mode === m.key) return;
      state.mode = m.key;
      state.selectedAtom = null;
      if (m.key === 'classes' && state.activeClass) {
        history.replaceState(null, '', `#${state.activeClass.replace('.', '')}`);
      } else if (m.key === 'teachers' && state.unlocked && state.activeTeacher) {
        history.replaceState(null, '', `#teacher-${state.activeTeacher}`);
      }
      render();
    });
    modeTabs.appendChild(btn);
  }

  row.appendChild(modeTabs);

  const actions = el('div', 'tt-mode-actions');

  if (state.isMobileViewport && isShowingScheduleGrid()) {
    const layoutToggle = el('div', 'tt-layout-toggle');
    layoutToggle.setAttribute('role', 'group');
    layoutToggle.setAttribute('aria-label', 'Schedule layout');
    for (const item of [
      { key: 'day', label: 'Day' },
      { key: 'week', label: 'Week' },
    ]) {
      const btn = el('button', 'tt-layout-btn', item.label);
      btn.type = 'button';
      btn.setAttribute('data-layout', item.key);
      btn.setAttribute('aria-pressed', state.mobileLayout === item.key ? 'true' : 'false');
      btn.addEventListener('click', () => {
        if (state.mobileLayout === item.key) return;
        state.mobileLayout = item.key;
        state.selectedAtom = null;
        render();
      });
      layoutToggle.appendChild(btn);
    }
    actions.appendChild(layoutToggle);
  }

  if (state.unlocked) {
    const lockBtn = el('button', 'tt-lock-btn', 'Lock');
    lockBtn.type = 'button';
    lockBtn.addEventListener('click', () => {
      lockVault();
      render();
    });
    actions.appendChild(lockBtn);
  }

  if (actions.childNodes.length > 0) {
    row.appendChild(actions);
  }

  return row;
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

function renderLessonDetail(detailEl, selection, { teacherMode = false } = {}) {
  detailEl.replaceChildren();
  if (!selection) {
    detailEl.appendChild(
      el('p', 'tt-detail-empty', 'Select any lesson cell to view room, subject, and schedule details.'),
    );
    return;
  }

  const { atom, day, hour, teacherObj } = selection;
  const kind = classifyChange(atom);

  const head = el('div', 'tt-detail-head');
  const baseTitle = atom.subjectName || atom.subjectAbbrev || (kind === 'removed' ? 'Canceled lesson' : 'Lesson');
  const title = teacherMode && Array.isArray(atom.classes) && atom.classes.length > 0
    ? `${baseTitle} (${atom.classes.join(', ')})`
    : baseTitle;
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

  if (teacherMode && Array.isArray(atom.classes) && atom.classes.length > 0) {
    addRow('Class', atom.classes.join(', '));
  }

  const dayName = DAY_SHORT[day.dayOfWeek] || '';
  const dayLabel = day.date ? `${dayName} ${formatShortDate(day.date)}`.trim() : dayName;
  const timeStr = hour
    ? `${hour.caption}. hour (${hour.beginTime} - ${hour.endTime})`
    : atom.change?.time || '';
  addRow('When', timeStr ? `${dayLabel}, ${timeStr}` : dayLabel);
  addRow('Room', atom.room || '-');

  const resolvedTeacherName = atom.teacherName || teacherObj?.name || '';
  const resolvedTeacherAbbrev = atom.teacherAbbrev || teacherObj?.abbrev || '';
  if (resolvedTeacherName || resolvedTeacherAbbrev) {
    addRow(
      'Teacher',
      resolvedTeacherName
        ? `${resolvedTeacherName}${resolvedTeacherAbbrev ? ` (${resolvedTeacherAbbrev})` : ''}`
        : resolvedTeacherAbbrev,
    );
  }

  if (atom.groups && atom.groups.length > 0) {
    addRow('Group', atom.groups.join(', '));
  }
  if (atom.theme) {
    addRow('Topic', atom.theme);
  }

  detailEl.appendChild(dl);
}

function appendLegend(sheet, { isLiveClass, week }) {
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
}

function renderDayViewIntoSheet(sheet, week, { isLiveClass, teacherMode = false, teacherObj = null }) {
  const todayKey = getPragueTodayKey(new Date());
  const todayDow = getPragueWeekday(new Date());
  const days = Array.isArray(week?.days) ? week.days : [];
  const hours = Array.isArray(week?.hours) ? week.hours : [];
  const hourById = new Map(hours.map((h) => [Number(h.id), h]));

  const dayTabs = el('div', 'tt-day-tabs');
  dayTabs.setAttribute('role', 'tablist');
  dayTabs.setAttribute('aria-label', 'Select day');

  const selectedDay =
    days.find((d) => Number(d.dayOfWeek) === state.activeDayOfWeek) || days[0] || null;
  if (selectedDay) {
    state.activeDayOfWeek = Number(selectedDay.dayOfWeek);
  }

  for (const d of days) {
    const dow = Number(d.dayOfWeek);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tt-day-tab';
    btn.setAttribute('data-day', String(dow));
    btn.setAttribute('aria-pressed', dow === state.activeDayOfWeek ? 'true' : 'false');
    const isToday = isLiveClass ? d.date === todayKey : dow === todayDow;
    if (isToday) {
      btn.setAttribute('data-today', 'true');
    }

    btn.appendChild(el('span', 'tt-day-tab-name', DAY_SHORT[dow] || ''));
    if (d.date) {
      btn.appendChild(el('span', 'tt-day-tab-date', formatDayShortDate(d.date)));
    }
    btn.addEventListener('click', () => {
      if (state.activeDayOfWeek === dow) return;
      state.activeDayOfWeek = dow;
      state.selectedAtom = null;
      render();
    });
    dayTabs.appendChild(btn);
  }

  sheet.appendChild(dayTabs);

  const detailCard = el('section', 'tt-detail-card');
  detailCard.setAttribute('aria-live', 'polite');

  if (!selectedDay) {
    sheet.appendChild(el('div', 'tt-empty-class', 'No schedule data available.'));
    renderLessonDetail(detailCard, null, { teacherMode });
    return detailCard;
  }

  const atoms = Array.isArray(selectedDay.atoms) ? selectedDay.atoms : [];
  const isSpecialDay = selectedDay.dayType && selectedDay.dayType !== 'WorkDay' && atoms.length === 0;

  if (isSpecialDay) {
    const fallbackLabel =
      selectedDay.dayType === 'Weekend' && selectedDay.dayOfWeek <= 5
        ? 'Day off'
        : selectedDay.dayType === 'Holiday' || selectedDay.dayType === 'Celebration'
          ? 'Holiday'
          : selectedDay.dayType;
    sheet.appendChild(el('div', 'tt-special-banner', selectedDay.dayDescription || fallbackLabel));
    renderLessonDetail(detailCard, null, { teacherMode });
    return detailCard;
  }

  if (atoms.length === 0) {
    sheet.appendChild(el('div', 'tt-empty-class', 'No lessons scheduled for this day.'));
    renderLessonDetail(detailCard, null, { teacherMode });
    return detailCard;
  }

  const usedIds = new Set(atoms.map((a) => Number(a.hourId)));
  const firstIdx = hours.findIndex((h) => usedIds.has(Number(h.id)));
  let lastIdx = -1;
  for (let i = hours.length - 1; i >= 0; i -= 1) {
    if (usedIds.has(Number(hours[i].id))) {
      lastIdx = i;
      break;
    }
  }
  const dayHours =
    firstIdx !== -1 && lastIdx !== -1 ? hours.slice(firstIdx, lastIdx + 1) : hours;

  const atomsByHour = new Map();
  for (const a of atoms) {
    const hid = Number(a.hourId);
    if (!atomsByHour.has(hid)) atomsByHour.set(hid, []);
    atomsByHour.get(hid).push(a);
  }

  const dayList = el('div', 'tt-day-list');
  const allButtons = [];

  for (const h of dayHours) {
    const row = el('div', 'tt-day-row');

    const hourBox = el('div', 'tt-day-hour');
    hourBox.append(
      el('div', 'tt-day-hour-num', h.caption),
      el('div', 'tt-day-hour-time', `${h.beginTime}\n${h.endTime}`),
    );
    const timeEl = hourBox.querySelector('.tt-day-hour-time');
    if (timeEl) {
      timeEl.replaceChildren(
        el('div', null, h.beginTime),
        el('div', null, h.endTime),
      );
    }
    row.appendChild(hourBox);

    const slotAtoms = atomsByHour.get(Number(h.id)) || [];
    if (slotAtoms.length === 0) {
      row.appendChild(el('div', 'tt-day-free', 'Free'));
      dayList.appendChild(row);
      continue;
    }

    const lessonsCol = el('div', 'tt-day-lessons');
    for (const atom of slotAtoms) {
      const kind = classifyChange(atom);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tt-atom tt-day-card';
      btn.setAttribute('data-kind', kind);
      btn.setAttribute('aria-pressed', 'false');

      const main = el('div', 'tt-day-card-main');
      const subjRow = el('div', 'tt-day-card-subj-row');
      const subjText = atom.subjectAbbrev || (kind === 'removed' ? 'Canceled' : 'Change');
      subjRow.appendChild(el('span', 'tt-day-card-subj', subjText));
      if (!teacherMode && atom.subjectName && atom.subjectName !== subjText) {
        subjRow.appendChild(el('span', 'tt-day-card-subname', atom.subjectName));
      }
      main.appendChild(subjRow);

      const metaParts = [];
      if (teacherMode) {
        if (Array.isArray(atom.classes) && atom.classes.length > 0) {
          metaParts.push(atom.classes.join(', '));
        }
        if (Array.isArray(atom.groups) && atom.groups.length > 0) {
          metaParts.push(atom.groups.join(' '));
        }
      } else {
        if (Array.isArray(atom.groups) && atom.groups.length > 0) {
          metaParts.push(atom.groups.join(' '));
        }
        if (atom.teacherAbbrev) {
          metaParts.push(atom.teacherAbbrev);
        }
      }
      if (metaParts.length > 0) {
        main.appendChild(el('div', 'tt-day-card-meta', metaParts.join(' · ')));
      }

      const side = el('div', 'tt-day-card-side');
      if (atom.room) {
        side.appendChild(el('span', 'tt-day-card-room', atom.room));
      }
      if (kind !== 'regular') {
        side.appendChild(
          el('span', 'tt-day-card-badge', kind === 'removed' ? 'Canceled' : atom.change?.type || 'Changed'),
        );
      }

      btn.append(main, side);
      btn.addEventListener('click', () => {
        state.selectedAtom = {
          atom,
          day: selectedDay,
          hour: hourById.get(Number(h.id)),
          teacherObj,
        };
        for (const other of allButtons) {
          other.setAttribute('aria-pressed', other === btn ? 'true' : 'false');
        }
        renderLessonDetail(detailCard, state.selectedAtom, { teacherMode });
      });

      allButtons.push(btn);
      lessonsCol.appendChild(btn);
    }

    row.appendChild(lessonsCol);
    dayList.appendChild(row);
  }

  sheet.appendChild(dayList);
  appendLegend(sheet, { isLiveClass, week });
  renderLessonDetail(detailCard, state.selectedAtom, { teacherMode });
  return detailCard;
}

function renderGridIntoSheet(sheet, week, { isLiveClass, teacherMode = false, teacherObj = null }) {
  const todayKey = getPragueTodayKey(new Date());
  const visibleHours = getVisibleHours(week);
  const hourById = new Map(visibleHours.map((h) => [Number(h.id), h]));

  const scrollWrap = el('div', 'tt-scroll');
  scrollWrap.setAttribute('tabindex', '0');
  scrollWrap.setAttribute('role', 'region');
  scrollWrap.setAttribute('aria-label', 'Weekly timetable grid');

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
          const classLabel = Array.isArray(atom.classes) ? atom.classes.join(', ') : '';

          if (teacherMode) {
            topMeta.append(
              el('span', 'tt-atom-class', classLabel),
              el('span', 'tt-atom-room', atom.room || ''),
            );
          } else {
            topMeta.append(
              el('span', 'tt-atom-group', grpText),
              el('span', 'tt-atom-room', atom.room || ''),
            );
          }

          const subjText = atom.subjectAbbrev || (kind === 'removed' ? 'Canceled' : 'Change');
          const bottomText = teacherMode ? grpText : (atom.teacherAbbrev || '');

          btn.append(
            topMeta,
            el('div', 'tt-atom-subj', subjText),
            el('div', 'tt-atom-teacher', bottomText),
          );

          btn.addEventListener('click', () => {
            state.selectedAtom = {
              atom,
              day,
              hour: hourById.get(Number(h.id)),
              teacherObj,
            };
            for (const other of allButtons) {
              other.setAttribute('aria-pressed', other === btn ? 'true' : 'false');
            }
            renderLessonDetail(detailCard, state.selectedAtom, { teacherMode });
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

  appendLegend(sheet, { isLiveClass, week });
  renderLessonDetail(detailCard, state.selectedAtom, { teacherMode });
  return detailCard;
}

function renderScheduleIntoSheet(sheet, week, opts) {
  if (state.isMobileViewport && state.mobileLayout === 'day') {
    return renderDayViewIntoSheet(sheet, week, opts);
  }
  return renderGridIntoSheet(sheet, week, opts);
}

function renderFileViewerIntoSheet(sheet, classId, entry) {
  const fileUrl = `${BASE}${String(entry.file).replace(/^\/+/, '')}`;
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

function renderLockedTeachersView(sheet) {
  const panel = el('div', 'tt-lock-panel');
  panel.append(
    el('h2', 'tt-lock-title', 'Teacher timetables'),
    el(
      'p',
      'tt-lock-desc',
      'Enter the school passphrase to unlock teacher timetables locally in your browser.',
    ),
  );

  const form = el('form', 'tt-lock-form');
  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'tt-lock-input';
  input.placeholder = 'Passphrase';
  input.autocomplete = 'current-password';
  input.setAttribute('aria-label', 'Passphrase');
  input.required = true;
  input.disabled = state.unlockPending;

  const submitBtn = el('button', 'tt-lock-submit', state.unlockPending ? 'Unlocking...' : 'Unlock');
  submitBtn.type = 'submit';
  submitBtn.disabled = state.unlockPending;

  form.append(input, submitBtn);
  panel.appendChild(form);

  const errorEl = el('p', 'tt-lock-error', state.unlockError || '');
  errorEl.setAttribute('role', 'alert');
  if (!state.unlockError) errorEl.hidden = true;
  panel.appendChild(errorEl);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pass = input.value.trim();
    if (!pass || state.unlockPending) return;
    state.unlockPending = true;
    state.unlockError = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Unlocking...';

    try {
      await unlockWithPassphrase(pass, { persist: true });
      state.unlockPending = false;
      if (state.activeTeacher) {
        history.replaceState(null, '', `#teacher-${state.activeTeacher}`);
      }
      render();
    } catch {
      state.unlockPending = false;
      state.unlockError = 'Incorrect passphrase.';
      errorEl.textContent = state.unlockError;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Unlock';
      input.focus();
      input.select();
    }
  });

  sheet.appendChild(panel);
}

function renderTeachersView(sheet) {
  if (!state.unlocked || !state.teacherSchedules) {
    renderLockedTeachersView(sheet);
    return null;
  }

  const { hours, teachers } = state.teacherSchedules;
  if (!teachers || teachers.length === 0) {
    sheet.appendChild(el('div', 'tt-empty-class', 'No teacher timetables available.'));
    return null;
  }

  const controls = el('div', 'tt-teacher-controls');
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'tt-search-input';
  searchInput.placeholder = 'Search teacher by name or code...';
  searchInput.setAttribute('aria-label', 'Search teacher');
  searchInput.value = state.teacherQuery;

  const pillBox = el('div', 'tt-teacher-bar');
  pillBox.setAttribute('role', 'navigation');
  pillBox.setAttribute('aria-label', 'Select teacher');

  const populatePills = () => {
    pillBox.replaceChildren();
    const q = state.teacherQuery.trim().toLowerCase();
    const filtered = q
      ? teachers.filter((t) => {
          const hay = `${t.name} ${t.abbrev} ${(t.subjects || []).join(' ')} ${t.homeroom || ''}`.toLowerCase();
          return hay.includes(q);
        })
      : teachers;

    if (filtered.length === 0) {
      pillBox.appendChild(el('span', 'tt-search-empty', 'No matching teachers.'));
      return;
    }

    for (const t of filtered) {
      const btn = el('button', 'tt-class-pill tt-teacher-pill', formatShortTeacherPill(t));
      btn.type = 'button';
      btn.setAttribute('data-teacher', t.abbrev);
      btn.setAttribute('aria-pressed', state.activeTeacher === t.abbrev ? 'true' : 'false');
      btn.addEventListener('click', () => {
        if (state.activeTeacher === t.abbrev) return;
        state.activeTeacher = t.abbrev;
        state.selectedAtom = null;
        history.replaceState(null, '', `#teacher-${t.abbrev}`);
        render();
      });
      pillBox.appendChild(btn);
    }
  };

  searchInput.addEventListener('input', () => {
    state.teacherQuery = searchInput.value;
    populatePills();
  });

  populatePills();
  controls.append(searchInput, pillBox);
  sheet.appendChild(controls);

  const selected = teachers.find((t) => t.abbrev === state.activeTeacher) || teachers[0];
  state.activeTeacher = selected.abbrev;

  const infoParts = [
    selected.name ? `${selected.name} (${selected.abbrev})` : selected.abbrev,
    selected.homeroom ? `Homeroom ${selected.homeroom}` : '',
    `${selected.lessonCount} lessons/week`,
  ].filter(Boolean);

  const topBar = el('div', 'tt-toolbar');
  topBar.appendChild(el('p', 'tt-range tt-teacher-heading', infoParts.join(' · ')));
  if (selected.subjects && selected.subjects.length > 0) {
    topBar.appendChild(el('p', 'tt-range', `Subjects: ${selected.subjects.join(', ')}`));
  }
  sheet.appendChild(topBar);

  const teacherWeek = {
    label: 'permanent',
    hours,
    days: selected.days,
  };

  return renderScheduleIntoSheet(sheet, teacherWeek, {
    isLiveClass: false,
    teacherMode: true,
    teacherObj: selected,
  });
}

function render() {
  const order = getClassOrder();
  if (!state.activeClass) {
    state.activeClass = state.liveClassId || order[0] || '';
  }

  const liveDoc = getActiveLiveDoc();
  if (updatedEl && liveDoc?.updatedAt) {
    try {
      updatedEl.textContent = `Updated ${formatPragueDateTime(liveDoc.updatedAt)} | Daily sync at 06:00`;
    } catch {
      // keep default
    }
  }

  rootEl.replaceChildren();

  const sheet = el('section', 'tt-sheet');
  sheet.setAttribute('aria-label', 'Weekly timetable');
  sheet.appendChild(renderModeBar());

  if (state.mode === 'teachers') {
    const detailCard = renderTeachersView(sheet);
    if (detailCard) {
      rootEl.append(sheet, detailCard);
    } else {
      rootEl.appendChild(sheet);
    }
    return;
  }

  sheet.appendChild(renderClassBar(order));

  const isLive = Boolean(state.liveClassId && state.activeClass === state.liveClassId && liveDoc?.weeks);

  if (isLive) {
    const availableTabs = LIVE_WEEK_TABS.filter((t) => Boolean(liveDoc.weeks[t.key]));
    const activeWeekKey = liveDoc.weeks[state.activeWeek] ? state.activeWeek : 'current';
    const week = liveDoc.weeks[activeWeekKey] || liveDoc.weeks.current;

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

    const detailCard = renderScheduleIntoSheet(sheet, week, { isLiveClass: true });
    rootEl.append(sheet, detailCard);
    return;
  }

  const entry = getClassEntry(state.activeClass);
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
    const detailCard = renderScheduleIntoSheet(
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

    const order = getClassOrder();
    const fallbackLive = order.find((c) => c.startsWith('4.')) || order[0] || '';
    state.liveClassId = ttData.className || fallbackLive;

    const teacherHash = parseTeacherHash(window.location.hash);
    const classHash = normalizeHashToClass(window.location.hash, order);

    if (teacherHash) {
      state.mode = 'teachers';
      state.activeTeacher = teacherHash;
      state.activeClass = state.liveClassId;
    } else {
      state.activeClass = classHash || state.liveClassId;
    }

    let savedKey = '';
    try {
      savedKey = localStorage.getItem(VAULT_STORAGE_KEY) || '';
    } catch {
      savedKey = '';
    }
    if (savedKey) {
      try {
        await unlockWithPassphrase(savedKey, { persist: false });
      } catch {
        lockVault();
      }
    }

    if (mobileMq) {
      mobileMq.addEventListener('change', (ev) => {
        if (state.isMobileViewport !== ev.matches) {
          state.isMobileViewport = ev.matches;
          render();
        }
      });
    }

    window.addEventListener('hashchange', () => {
      const nextTeacher = parseTeacherHash(window.location.hash);
      if (nextTeacher) {
        state.mode = 'teachers';
        state.activeTeacher = nextTeacher;
        state.selectedAtom = null;
        render();
        return;
      }
      const nextClass = normalizeHashToClass(window.location.hash, getClassOrder());
      if (nextClass) {
        state.mode = 'classes';
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
