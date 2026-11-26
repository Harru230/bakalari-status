function sanitizeAtomForPublic(atom) {
  let change = null;
  if (atom.change && typeof atom.change === 'object') {
    const safeDesc = atom.change.typeName || atom.change.type || 'Changed';
    change = {
      type: String(atom.change.type ?? '').trim() || 'Changed',
      description: String(safeDesc).trim(),
      time: String(atom.change.time ?? '').trim(),
      typeAbbrev: String(atom.change.typeAbbrev ?? '').trim(),
      typeName: String(atom.change.typeName ?? '').trim(),
    };
  }

  return {
    hourId: Number(atom.hourId),
    subjectAbbrev: String(atom.subjectAbbrev ?? '').trim(),
    subjectName: String(atom.subjectName ?? '').trim(),
    teacherAbbrev: '',
    teacherName: '',
    room: String(atom.room ?? '').trim(),
    groups: Array.isArray(atom.groups) ? [...atom.groups] : [],
    theme: String(atom.theme ?? '').trim(),
    change,
  };
}

/**
 * Removes teacher names, teacher abbreviations, and personal substitution notes
 * from a full live timetable document so it contains zero personal data.
 * @param {Record<string, any>} timetableDoc
 * @returns {Record<string, any>}
 */
export function stripTeacherPersonalData(timetableDoc) {
  if (!timetableDoc || typeof timetableDoc !== 'object') {
    return timetableDoc;
  }

  const weeks = {};
  for (const [weekKey, weekVal] of Object.entries(timetableDoc.weeks || {})) {
    if (!weekVal || typeof weekVal !== 'object') continue;
    weeks[weekKey] = {
      ...weekVal,
      hours: Array.isArray(weekVal.hours) ? weekVal.hours.map((h) => ({ ...h })) : [],
      days: (Array.isArray(weekVal.days) ? weekVal.days : []).map((day) => ({
        ...day,
        atoms: (Array.isArray(day.atoms) ? day.atoms : []).map(sanitizeAtomForPublic),
      })),
    };
  }

  return {
    ...timetableDoc,
    weeks,
  };
}

/**
 * Strips teacher identifiers from a permanent multi-class schedule map so
 * public classes.json publishes zero teacher personal data.
 * @param {Record<string, any>} classesMap
 * @returns {Record<string, any>}
 */
export function stripClassTeachers(classesMap) {
  const out = {};
  for (const [classId, entry] of Object.entries(classesMap || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const perm = entry.permanent || {};
    out[classId] = {
      className: entry.className || classId,
      updatedAt: entry.updatedAt || '',
      permanent: {
        label: 'permanent',
        className: entry.className || classId,
        startDate: '',
        endDate: '',
        hours: Array.isArray(perm.hours) ? perm.hours.map((h) => ({ ...h })) : [],
        days: (Array.isArray(perm.days) ? perm.days : []).map((day) => ({
          date: '',
          dayOfWeek: Number(day.dayOfWeek),
          dayType: String(day.dayType ?? 'WorkDay'),
          dayDescription: String(day.dayDescription ?? ''),
          atoms: (Array.isArray(day.atoms) ? day.atoms : []).map(sanitizeAtomForPublic),
        })),
      },
    };
  }
  return out;
}

function extractSurnameForSort(fullName, abbrev) {
  if (!fullName) return abbrev || '';
  const cleaned = fullName
    .replace(/,\s*Ph\.?D\.?$/i, '')
    .replace(/\b(?:Mgr|Mag|MMag|Ing|Dr|PhDr|OStR|Bc|MSc|Dipl\.-Soz|DiS|art|et)\b\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 0) return abbrev || '';
  return parts[parts.length - 1];
}

/**
 * Inverts class-level permanent timetables into deduplicated per-teacher schedules.
 * @param {Record<string, any>} classesMap
 * @param {Record<string, { abbrev: string, name?: string, subjects?: string[], homeroom?: string }> | Array<any>} teachersDir
 * @param {string[]} [classOrder]
 */
export function computeTeacherSchedules(classesMap, teachersDir = {}, classOrder = []) {
  const dirByAbbrev = new Map();
  const dirList = Array.isArray(teachersDir)
    ? teachersDir
    : Object.values(teachersDir || {});
  for (const item of dirList) {
    if (item && item.abbrev) {
      dirByAbbrev.set(String(item.abbrev).trim(), {
        abbrev: String(item.abbrev).trim(),
        name: String(item.name ?? '').trim(),
        subjects: Array.isArray(item.subjects) ? [...item.subjects] : [],
        homeroom: String(item.homeroom ?? '').trim(),
      });
    }
  }

  let canonicalHours = [];
  const orderedClassIds = [
    ...classOrder.filter((cid) => classesMap && classesMap[cid]),
    ...Object.keys(classesMap || {}).filter((cid) => !classOrder.includes(cid)),
  ];

  for (const cid of orderedClassIds) {
    const h = classesMap[cid]?.permanent?.hours;
    if (Array.isArray(h) && h.length > canonicalHours.length) {
      canonicalHours = h.map((item) => ({ ...item }));
    }
  }

  const slotMapsByTeacher = new Map();
  const discoveredSubjects = new Map();

  for (const classId of orderedClassIds) {
    const entry = classesMap[classId];
    const days = entry?.permanent?.days || [];
    for (const day of days) {
      const dow = Number(day.dayOfWeek);
      for (const atom of day.atoms || []) {
        const abbrev = String(atom.teacherAbbrev ?? '').trim();
        if (!abbrev) continue;

        if (!slotMapsByTeacher.has(abbrev)) {
          slotMapsByTeacher.set(abbrev, new Map());
        }
        if (!discoveredSubjects.has(abbrev)) {
          discoveredSubjects.set(abbrev, new Set());
        }
        if (atom.subjectAbbrev) {
          discoveredSubjects.get(abbrev).add(String(atom.subjectAbbrev).trim());
        }

        const teacherSlots = slotMapsByTeacher.get(abbrev);
        const dedupKey = `${dow}|${Number(atom.hourId)}|${String(atom.room ?? '').trim()}|${String(atom.subjectAbbrev ?? '').trim()}`;
        const existing = teacherSlots.get(dedupKey);

        if (existing) {
          if (!existing.classes.includes(classId)) {
            existing.classes.push(classId);
          }
          for (const g of atom.groups || []) {
            if (g && !existing.groups.includes(g)) {
              existing.groups.push(g);
            }
          }
        } else {
          teacherSlots.set(dedupKey, {
            hourId: Number(atom.hourId),
            dayOfWeek: dow,
            subjectAbbrev: String(atom.subjectAbbrev ?? '').trim(),
            subjectName: String(atom.subjectName ?? '').trim(),
            room: String(atom.room ?? '').trim(),
            classes: [classId],
            groups: Array.isArray(atom.groups) ? [...new Set(atom.groups.filter(Boolean))] : [],
            teacherAbbrev: abbrev,
            teacherName: String(atom.teacherName ?? '').trim(),
          });
        }
      }
    }
  }

  const allAbbrevs = new Set([...slotMapsByTeacher.keys(), ...dirByAbbrev.keys()]);
  const teachers = [];

  for (const abbrev of allAbbrevs) {
    const slotMap = slotMapsByTeacher.get(abbrev);
    // Only include teachers who actually appear in schedules (or retain all with lessons > 0)
    if (!slotMap || slotMap.size === 0) continue;

    const meta = dirByAbbrev.get(abbrev);
    const fullName = meta?.name || '';
    const daysByDow = new Map([1, 2, 3, 4, 5].map((dow) => [dow, []]));

    for (const slot of slotMap.values()) {
      const enrichedSlot = {
        ...slot,
        teacherName: slot.teacherName || fullName,
      };
      if (daysByDow.has(slot.dayOfWeek)) {
        daysByDow.get(slot.dayOfWeek).push(enrichedSlot);
      }
    }

    const distinctSlots = new Set();
    const days = [1, 2, 3, 4, 5].map((dow) => {
      const atoms = daysByDow.get(dow);
      atoms.sort((a, b) => a.hourId - b.hourId || a.subjectAbbrev.localeCompare(b.subjectAbbrev));
      for (const a of atoms) {
        distinctSlots.add(`${dow}:${a.hourId}`);
      }
      return {
        date: '',
        dayOfWeek: dow,
        dayType: 'WorkDay',
        dayDescription: '',
        atoms,
      };
    });

    const subjects = meta?.subjects && meta.subjects.length > 0
      ? meta.subjects
      : [...(discoveredSubjects.get(abbrev) || [])].sort();

    teachers.push({
      abbrev,
      name: fullName,
      subjects,
      homeroom: meta?.homeroom || '',
      lessonCount: distinctSlots.size,
      days,
    });
  }

  teachers.sort((a, b) => {
    const sa = extractSurnameForSort(a.name, a.abbrev);
    const sb = extractSurnameForSort(b.name, b.abbrev);
    const cmp = sa.localeCompare(sb, 'cs');
    return cmp !== 0 ? cmp : a.abbrev.localeCompare(b.abbrev, 'cs');
  });

  return {
    hours: canonicalHours,
    teachers,
  };
}
