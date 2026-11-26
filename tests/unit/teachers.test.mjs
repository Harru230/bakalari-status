import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripTeacherPersonalData,
  stripClassTeachers,
  computeTeacherSchedules,
} from '../../src/lib/teachers.mjs';

describe('teacher stripping and schedule inversion', () => {
  it('strips teacher names, abbrevs, and raw substitution text for GDPR safety', () => {
    const doc = {
      schemaVersion: 1,
      weeks: {
        current: {
          label: 'current',
          hours: [{ id: 1, caption: '0', beginTime: '7:45', endTime: '8:30' }],
          days: [
            {
              date: '2026-11-26',
              dayOfWeek: 4,
              dayType: 'WorkDay',
              atoms: [
                {
                  hourId: 1,
                  subjectAbbrev: 'M',
                  subjectName: 'Matematika',
                  teacherAbbrev: 'STI',
                  teacherName: 'Mag. Example Teacher',
                  room: '101',
                  groups: [],
                  theme: 'Vectors',
                  change: {
                    type: 'Substitution',
                    description: 'Suplovani: M, Mag. Example Teacher',
                    time: '',
                    typeAbbrev: '',
                    typeName: '',
                  },
                },
              ],
            },
          ],
        },
      },
    };

    const stripped = stripTeacherPersonalData(doc);
    const atom = stripped.weeks.current.days[0].atoms[0];
    assert.equal(atom.teacherAbbrev, '');
    assert.equal(atom.teacherName, '');
    assert.equal(atom.subjectAbbrev, 'M');
    assert.equal(atom.room, '101');
    assert.equal(atom.change.description, 'Substitution');
    // Original doc remains untouched
    assert.equal(doc.weeks.current.days[0].atoms[0].teacherAbbrev, 'STI');
  });

  it('strips teacher fields from class schedules map', () => {
    const stripped = stripClassTeachers({
      '6.A': {
        className: '6.A',
        updatedAt: '2026-11-26T00:00:00Z',
        permanent: {
          hours: [{ id: 2, caption: '1', beginTime: '8:30', endTime: '9:15' }],
          days: [
            {
              dayOfWeek: 1,
              dayType: 'WorkDay',
              atoms: [
                {
                  hourId: 2,
                  subjectAbbrev: 'CJL',
                  room: '106',
                  groups: [],
                  teacherAbbrev: 'PIL',
                  teacherName: 'Mgr. Test',
                },
              ],
            },
          ],
        },
      },
    });

    const a = stripped['6.A'].permanent.days[0].atoms[0];
    assert.equal(a.teacherAbbrev, '');
    assert.equal(a.teacherName, '');
    assert.equal(a.subjectAbbrev, 'CJL');
    assert.equal(a.room, '106');
  });

  it('inverts class timetables into teacher schedules and merges combined lessons', () => {
    const hours = [{ id: 10, caption: '9', beginTime: '15:30', endTime: '16:15' }];
    const classesMap = {
      '6.A': {
        className: '6.A',
        permanent: {
          hours,
          days: [
            {
              dayOfWeek: 3,
              dayType: 'WorkDay',
              atoms: [
                {
                  hourId: 10,
                  subjectAbbrev: 'SSPS',
                  room: '106',
                  groups: ['6SPS'],
                  teacherAbbrev: 'WURA',
                },
              ],
            },
          ],
        },
      },
      '6.B': {
        className: '6.B',
        permanent: {
          hours,
          days: [
            {
              dayOfWeek: 3,
              dayType: 'WorkDay',
              atoms: [
                {
                  hourId: 10,
                  subjectAbbrev: 'SSPS',
                  room: '106',
                  groups: ['6SPS'],
                  teacherAbbrev: 'WURA',
                },
              ],
            },
          ],
        },
      },
    };

    const dir = {
      WURA: { abbrev: 'WURA', name: 'Mag. Arnulf Wurzer', subjects: ['IVT'], homeroom: '3.C' },
    };

    const result = computeTeacherSchedules(classesMap, dir, ['6.A', '6.B']);
    assert.equal(result.teachers.length, 1);
    const wura = result.teachers[0];
    assert.equal(wura.abbrev, 'WURA');
    assert.equal(wura.lessonCount, 1);
    const wedAtoms = wura.days.find((d) => d.dayOfWeek === 3).atoms;
    assert.equal(wedAtoms.length, 1);
    assert.deepEqual(wedAtoms[0].classes, ['6.A', '6.B']);
    assert.deepEqual(wedAtoms[0].groups, ['6SPS']);
    assert.equal(wedAtoms[0].room, '106');
  });
});
