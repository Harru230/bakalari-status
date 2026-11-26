import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPragueTodayKey } from '../src/lib/timezone.mjs';
import { addDaysToDateKey } from '../src/lib/calendar.mjs';

const BASE_URL = 'https://bakalari.oegp.cz';
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = path.join(ROOT_DIR, 'data', 'timetable.json');
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

class TransientFetchError extends Error {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpsRequest(url, { method = 'GET', headers = {}, body = null, timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...headers };
    let payload = null;
    if (body != null) {
      payload = Buffer.from(body, 'utf8');
      reqHeaders['Content-Length'] = String(payload.length);
    }

    const req = https.request(url, { method, headers: reqHeaders }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function fetchWithRetry(url, options = {}, { maxAttempts = 4, timeoutMs = 45_000, backoffMs = 5_000 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await httpsRequest(url, { ...options, timeoutMs });
      if (RETRYABLE_STATUS.has(res.status)) {
        if (attempt < maxAttempts) {
          await sleep(backoffMs * 2 ** (attempt - 1));
          continue;
        }
        throw new TransientFetchError(`HTTP ${res.status} after ${maxAttempts} attempts`);
      }
      return res;
    } catch (err) {
      if (err instanceof TransientFetchError) throw err;
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(backoffMs * 2 ** (attempt - 1));
        continue;
      }
      throw new TransientFetchError(`Network or timeout error after ${maxAttempts} attempts`);
    }
  }
  throw new TransientFetchError(lastErr ? String(lastErr.message || lastErr) : 'Request failed');
}

function cleanGroupAbbrev(rawAbbrev, classAbbrevs) {
  let text = String(rawAbbrev || '').trim();
  if (!text) return '';
  for (const cls of classAbbrevs) {
    if (!cls) continue;
    if (text === cls) return '';
    if (text.startsWith(`${cls} `)) {
      text = text.slice(cls.length).trim();
    }
  }
  return text;
}

export function normalizeWeekPayload(raw, label) {
  const hours = (Array.isArray(raw?.Hours) ? raw.Hours : []).map((h) => ({
    id: Number(h.Id),
    caption: String(h.Caption ?? '').trim(),
    beginTime: String(h.BeginTime ?? '').trim(),
    endTime: String(h.EndTime ?? '').trim(),
  }));

  const classAbbrevs = (Array.isArray(raw?.Classes) ? raw.Classes : [])
    .map((c) => String(c.Abbrev ?? '').trim())
    .filter(Boolean);

  const subjectById = new Map();
  for (const s of Array.isArray(raw?.Subjects) ? raw.Subjects : []) {
    const id = String(s.Id ?? '');
    subjectById.set(id, {
      abbrev: String(s.Abbrev ?? '').trim(),
      name: String(s.Name ?? '').trim(),
    });
  }

  const teacherById = new Map();
  for (const t of Array.isArray(raw?.Teachers) ? raw.Teachers : []) {
    const id = String(t.Id ?? '');
    teacherById.set(id, {
      abbrev: String(t.Abbrev ?? '').trim(),
      name: String(t.Name ?? '').trim(),
    });
  }

  const roomById = new Map();
  for (const r of Array.isArray(raw?.Rooms) ? raw.Rooms : []) {
    const id = String(r.Id ?? '');
    roomById.set(id, String(r.Abbrev ?? r.Name ?? '').trim());
  }

  const groupById = new Map();
  for (const g of Array.isArray(raw?.Groups) ? raw.Groups : []) {
    const id = String(g.Id ?? '');
    const cleaned = cleanGroupAbbrev(g.Abbrev, classAbbrevs);
    groupById.set(id, cleaned);
  }

  const days = (Array.isArray(raw?.Days) ? raw.Days : []).map((d) => {
    const dateKey = String(d.Date ?? '').slice(0, 10);
    const atoms = (Array.isArray(d.Atoms) ? d.Atoms : []).map((a) => {
      const subj = a.SubjectId != null ? subjectById.get(String(a.SubjectId)) : null;
      const teach = a.TeacherId != null ? teacherById.get(String(a.TeacherId)) : null;
      const room = a.RoomId != null ? roomById.get(String(a.RoomId)) || '' : '';
      const groups = (Array.isArray(a.GroupIds) ? a.GroupIds : [])
        .map((gid) => groupById.get(String(gid)) || '')
        .filter(Boolean);

      const rawChange = a.Change && typeof a.Change === 'object' ? a.Change : null;
      const change = rawChange
        ? {
            type: String(rawChange.ChangeType ?? '').trim() || 'Changed',
            description: String(rawChange.Description ?? '').trim(),
            time: String(rawChange.Time ?? '').trim(),
            typeAbbrev: String(rawChange.TypeAbbrev ?? '').trim(),
            typeName: String(rawChange.TypeName ?? '').trim(),
          }
        : null;

      return {
        hourId: Number(a.HourId),
        subjectAbbrev: subj?.abbrev || (change?.typeAbbrev || ''),
        subjectName: subj?.name || (change?.typeName || ''),
        teacherAbbrev: teach?.abbrev || '',
        teacherName: teach?.name || '',
        room,
        groups,
        theme: String(a.Theme ?? '').trim(),
        change,
      };
    });

    return {
      date: dateKey,
      dayOfWeek: Number(d.DayOfWeek),
      dayType: String(d.DayType ?? 'WorkDay').trim(),
      dayDescription: String(d.DayDescription ?? '').trim(),
      atoms,
    };
  });

  const startDate = label === 'permanent' ? '' : days[0]?.date || '';
  const endDate = label === 'permanent' ? '' : days[days.length - 1]?.date || '';

  return {
    label,
    className: classAbbrevs[0] || '',
    startDate,
    endDate,
    hours,
    days: label === 'permanent' ? days.map((d) => ({ ...d, date: '' })) : days,
  };
}

async function login(username, password) {
  const body = new URLSearchParams({
    client_id: 'ANDR',
    grant_type: 'password',
    username,
    password,
  });
  const res = await fetchWithRetry(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Login failed with HTTP ${res.status}`);
  }
  const data = JSON.parse(res.text);
  if (!data?.access_token) {
    throw new Error('Login response missing access token');
  }
  return data.access_token;
}

async function fetchWeek(token, dateKey, label) {
  const url = `${BASE_URL}/api/3/timetable/actual?date=${encodeURIComponent(dateKey)}`;
  const res = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Timetable fetch (${label}) failed with HTTP ${res.status}`);
  }
  const raw = JSON.parse(res.text);
  return normalizeWeekPayload(raw, label);
}

async function fetchPermanent(token) {
  const url = `${BASE_URL}/api/3/timetable/permanent`;
  const res = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Timetable fetch (permanent) failed with HTTP ${res.status}`);
  }
  const raw = JSON.parse(res.text);
  return normalizeWeekPayload(raw, 'permanent');
}

async function main() {
  const allowTransient = process.argv.includes('--allow-transient-error');
  const username = (process.env.TIMETABLE_LOGIN || '').trim();
  const password = (process.env.TIMETABLE_KEY || '').trim();

  if (!username || !password) {
    console.error('Missing TIMETABLE_LOGIN or TIMETABLE_KEY environment variables.');
    process.exitCode = 1;
    return;
  }

  try {
    const token = await login(username, password);
    const todayKey = getPragueTodayKey(new Date());
    const last = await fetchWeek(token, addDaysToDateKey(todayKey, -7), 'last');
    const current = await fetchWeek(token, todayKey, 'current');
    const next = await fetchWeek(token, addDaysToDateKey(todayKey, 7), 'next');
    const permanent = await fetchPermanent(token);

    const doc = {
      schemaVersion: 1,
      timezone: 'Europe/Prague',
      className: current.className || permanent.className || '',
      updatedAt: new Date().toISOString(),
      weeks: { last, current, next, permanent },
    };

    const tmpPath = `${OUTPUT_PATH}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, OUTPUT_PATH);

    console.log(
      `[timetable] updated ${doc.updatedAt} (last=${last.startDate}, current=${current.startDate}, next=${next.startDate})`,
    );
  } catch (err) {
    if (allowTransient && err instanceof TransientFetchError) {
      console.log(`::warning::Bakalari timetable fetch skipped due to transient outage: ${err.message}`);
      process.exitCode = 0;
      return;
    }
    console.error(`[timetable] failed: ${err?.message || 'unexpected error'}`);
    process.exitCode = 1;
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  void main();
}
