import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_GIT_EMAILS,
  ALLOWED_GIT_IDENTITIES,
  HISTORY_START_DATE,
  addDaysToYmd,
  buildSyntheticSecretFixtures,
  buildSyntheticStatusFixture,
  contrastRatio,
  daysInMonth,
  enumerateDates,
  formatPragueDate,
  isLeapYear,
  isLightNeutralColor,
  mondayFirstOffset,
  monthHeadingLabel,
  parseCssColor,
  relativeLuminance,
  scanTextForPrivacyLeaks,
  validateStatusPayload,
} from './contracts.mjs';

test('Europe/Prague timezone boundaries (CET, CEST, DST transitions)', () => {
  // CEST (UTC+2) start boundary around 2026-09-17
  assert.equal(formatPragueDate('2026-09-16T21:59:59.000Z'), '2026-09-16');
  assert.equal(formatPragueDate('2026-09-16T22:00:00.000Z'), '2026-09-17');

  // CEST summer midnight rollover
  assert.equal(formatPragueDate('2026-07-15T21:59:59.000Z'), '2026-07-15');
  assert.equal(formatPragueDate('2026-07-15T22:00:00.000Z'), '2026-07-16');

  // DST fall-back 2026-10-25 (UTC+2 -> UTC+1 at 01:00Z)
  assert.equal(formatPragueDate('2026-10-25T22:30:00.000Z'), '2026-10-25');
  assert.equal(formatPragueDate('2026-10-25T23:00:00.000Z'), '2026-10-26');

  // CET (UTC+1) midnight rollover
  assert.equal(formatPragueDate('2026-11-23T22:59:59.000Z'), '2026-11-23');
  assert.equal(formatPragueDate('2026-11-23T23:00:00.000Z'), '2026-11-24');

  // DST spring-forward 2027-03-28 (UTC+1 -> UTC+2 at 01:00Z)
  assert.equal(formatPragueDate('2027-03-28T00:59:59.000Z'), '2027-03-28');
  assert.equal(formatPragueDate('2027-03-28T01:00:00.000Z'), '2027-03-28');
});

test('UTC-noon date stepping handles month rollovers, DST dates, and leap years', () => {
  const dstFallDates = enumerateDates('2026-10-24', '2026-10-27');
  assert.deepEqual(dstFallDates, ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);

  const dstSpringDates = enumerateDates('2027-03-27', '2027-03-29');
  assert.deepEqual(dstSpringDates, ['2027-03-27', '2027-03-28', '2027-03-29']);

  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(2028), true);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);

  assert.equal(addDaysToYmd('2026-02-28', 1), '2026-03-01');
  assert.equal(addDaysToYmd('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysToYmd('2028-02-29', 1), '2028-03-01');

  assert.equal(mondayFirstOffset(2026, 9), 1); // Sep 1, 2026 is Tuesday
  assert.equal(mondayFirstOffset(2026, 10), 3); // Oct 1, 2026 is Thursday
  assert.equal(mondayFirstOffset(2026, 11), 6); // Nov 1, 2026 is Sunday
  assert.equal(monthHeadingLabel(2026, 11), 'November 2026');
});

test('WCAG 2.x relative luminance and contrastRatio match reference expectations', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff') * 100) / 100, 21);

  const zinc900On50 = contrastRatio('#18181b', '#fafafa');
  assert.ok(zinc900On50 > 16.9 && zinc900On50 < 17.1, `Expected ~16.97, got ${zinc900On50}`);

  const zinc500OnWhite = contrastRatio('#71717a', '#ffffff');
  assert.ok(zinc500OnWhite > 4.8 && zinc500OnWhite < 4.9, `Expected ~4.83, got ${zinc500OnWhite}`);

  // #777777 on #ffffff is 4.48:1 (< 4.5:1 threshold trap)
  const trapGray = contrastRatio('#777777', '#ffffff');
  assert.ok(trapGray < 4.5 && trapGray > 4.4, `Expected ~4.48, got ${trapGray}`);

  // CSS Color 4 space/slash syntax and rgba alpha compositing
  const parsedSpace = parseCssColor('rgb(24 24 27 / 1)');
  assert.deepEqual(parsedSpace, { r: 24, g: 24, b: 27, a: 1 });
  const semiBlackOnWhite = contrastRatio('rgba(0, 0, 0, 0.5)', '#ffffff');
  assert.ok(semiBlackOnWhite > 3.5 && semiBlackOnWhite < 4.5);

  assert.equal(isLightNeutralColor('rgb(250, 250, 250)'), true);
  assert.equal(isLightNeutralColor('rgb(79, 70, 229)'), false);

  // CSS Color 4: oklch(), oklab(), color(srgb ...)
  const zinc900Oklch = 'oklch(0.21 0.006 285.885)';
  const zinc50Oklch = 'oklch(0.985 0 0)';
  const parsedZinc900 = parseCssColor(zinc900Oklch);
  assert.ok(parsedZinc900 && parsedZinc900.r < 40 && parsedZinc900.g < 40 && parsedZinc900.b < 45);
  assert.ok(contrastRatio(zinc900Oklch, zinc50Oklch) >= 4.5);
  assert.ok(contrastRatio('oklch(0.65 0 0)', 'oklch(1 0 0)') < 4.5);
  assert.equal(isLightNeutralColor(zinc50Oklch), true);
  assert.equal(isLightNeutralColor('oklch(0.55 0.25 260)'), false);

  // Percentage L/C, angle units (deg/rad/grad/turn), none keyword, alpha, out-of-gamut clamp
  const oklchPct = parseCssColor('oklch(21% 1.5% 0.794turn / 50%)');
  assert.ok(oklchPct && Math.abs(oklchPct.a - 0.5) < 1e-6);
  const oklchGrad = parseCssColor('oklch(0.5 0.1 200grad)');
  const oklchRad = parseCssColor(`oklch(0.5 0.1 ${Math.PI}rad)`);
  assert.ok(oklchGrad && oklchRad && Math.abs(oklchGrad.r - oklchRad.r) < 0.01);
  const oklchNone = parseCssColor('oklch(0.5 none none)');
  assert.ok(oklchNone && Math.abs(oklchNone.r - oklchNone.g) < 0.5);
  const clampedOutOfGamut = parseCssColor('oklch(0.7 0.4 150)');
  assert.ok(
    clampedOutOfGamut &&
      clampedOutOfGamut.r >= 0 &&
      clampedOutOfGamut.r <= 255 &&
      clampedOutOfGamut.g >= 0 &&
      clampedOutOfGamut.g <= 255 &&
      clampedOutOfGamut.b >= 0 &&
      clampedOutOfGamut.b <= 255
  );

  // oklab() and color(srgb ...)
  const parsedOklab = parseCssColor('oklab(0.21 0.001 -0.006)');
  assert.ok(parsedOklab && parsedOklab.r < 40 && parsedOklab.a === 1);
  assert.ok(contrastRatio('oklab(0.21 0.001 -0.006)', 'oklab(98.5% 0 0)') >= 4.5);
  const parsedColorSrgb = parseCssColor('color(srgb 0.094 0.094 0.106)');
  assert.ok(parsedColorSrgb && Math.round(parsedColorSrgb.r) === 24 && Math.round(parsedColorSrgb.b) === 27);
  const parsedColorSrgbPct = parseCssColor('color(srgb 100% none 50% / 0.25)');
  assert.deepEqual(parsedColorSrgbPct, { r: 255, g: 0, b: 127.5, a: 0.25 });
});

test('validateStatusPayload validates synthetic continuous fixture and catches violations', () => {
  const fixture = buildSyntheticStatusFixture({
    endDate: '2026-11-23',
    mixedDayDate: '2026-11-22',
  });
  const okRes = validateStatusPayload(fixture, { maxDate: '2026-11-23' });
  assert.equal(okRes.valid, true, okRes.errors.join('; '));
  assert.equal(fixture.days['2026-11-22'].status, 'offline');
  assert.equal(fixture.days[HISTORY_START_DATE].date, HISTORY_START_DATE);

  // Strict outage violation: down > 0 marked online
  const badOutage = structuredClone(fixture);
  badOutage.days['2026-11-22'].status = 'online';
  const badOutageRes = validateStatusPayload(badOutage, { maxDate: '2026-11-23' });
  assert.equal(badOutageRes.valid, false);
  assert.ok(badOutageRes.errors.some((e) => e.includes('Strict outage rule')));

  // Missing continuous date gap
  const gapPayload = structuredClone(fixture);
  delete gapPayload.days['2026-10-25'];
  const gapRes = validateStatusPayload(gapPayload, { maxDate: '2026-11-23' });
  assert.equal(gapRes.valid, false);
  assert.ok(gapRes.errors.some((e) => e.includes('2026-10-25')));

  // Unexpected key rejection
  const extraKeyPayload = structuredClone(fixture);
  extraKeyPayload.debugTrace = 'forbidden';
  const extraRes = validateStatusPayload(extraKeyPayload, { maxDate: '2026-11-23' });
  assert.equal(extraRes.valid, false);

  // Empty days allowed only when allowEmptyDays: true
  const emptyFixture = buildSyntheticStatusFixture({ emptyDays: true, endDate: '2026-11-23' });
  assert.equal(validateStatusPayload(emptyFixture, { maxDate: '2026-11-23' }).valid, false);
  assert.equal(
    validateStatusPayload(emptyFixture, { maxDate: '2026-11-23', allowEmptyDays: true }).valid,
    true
  );

  // recentChecks latencyMs: null allowed iff source === 'historical'
  const histNullLatency = structuredClone(fixture);
  histNullLatency.recentChecks[0] = {
    ...histNullLatency.recentChecks[0],
    source: 'historical',
    latencyMs: null,
  };
  assert.equal(
    validateStatusPayload(histNullLatency, { maxDate: '2026-11-23' }).valid,
    true,
    'historical entry with latencyMs: null should be valid'
  );

  const probeNullLatency = structuredClone(fixture);
  probeNullLatency.recentChecks[0] = {
    ...probeNullLatency.recentChecks[0],
    source: 'probe',
    latencyMs: null,
  };
  const probeNullRes = validateStatusPayload(probeNullLatency, { maxDate: '2026-11-23' });
  assert.equal(probeNullRes.valid, false, 'probe entry with latencyMs: null must be invalid');
  assert.ok(probeNullRes.errors.some((e) => e.includes('latencyMs')));

  // Contradiction 1: currentStatus offline cannot have reason ok
  const badCsOfflineOk = structuredClone(fixture);
  badCsOfflineOk.currentStatus = {
    status: 'offline',
    checkedAt: '2026-11-23T12:00:00.000Z',
    httpStatus: 500,
    latencyMs: 50,
    reason: 'ok',
  };
  assert.equal(validateStatusPayload(badCsOfflineOk, { maxDate: '2026-11-23' }).valid, false);

  // Contradiction 2: days[key].lastCheckedAt Prague date must match key
  const badDayTz = structuredClone(fixture);
  badDayTz.days['2026-11-23'].lastCheckedAt = '2026-11-23T23:30:00.000Z';
  assert.equal(validateStatusPayload(badDayTz, { maxDate: '2026-11-23' }).valid, false);

  // Contradiction 3: recentChecks entry contradictory status/httpStatus/reason
  const badCheck = structuredClone(fixture);
  badCheck.recentChecks[0] = {
    ...badCheck.recentChecks[0],
    status: 'offline',
    httpStatus: 200,
    reason: 'ok',
    source: 'probe',
    latencyMs: 42,
  };
  assert.equal(validateStatusPayload(badCheck, { maxDate: '2026-11-23' }).valid, false);
});

test('scanTextForPrivacyLeaks allows clean fixtures and catches synthetic secrets/leaks', () => {
  const cleanText = [
    'Repository: Harru230/bakalari-status',
    'Clone URL: https://github.com/Harru230/bakalari-status.git',
    'Target: https://bakalari.oegp.cz/login',
    `Author: 212044046+Harru230@users.noreply.github.com`,
  ].join('\n');
  assert.deepEqual(scanTextForPrivacyLeaks(cleanText), []);
  assert.ok(ALLOWED_GIT_IDENTITIES.has('Harru230'));
  assert.ok(ALLOWED_GIT_EMAILS.has('41898282+github-actions[bot]@users.noreply.github.com'));

  const secrets = buildSyntheticSecretFixtures();
  assert.ok(scanTextForPrivacyLeaks(secrets.githubPat).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.googleApiKey).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.pemHeader).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.bearerToken).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.rfc1918_192).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.rfc1918_10).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.rfc1918_172).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.badSchoolIp, { forbidAllIpv4: false }).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.badSubdomain).length > 0);
  assert.ok(scanTextForPrivacyLeaks(`https://${secrets.badRootDomain}/portal`).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.badRepo).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.badEmail).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.badEnvPass).length > 0);
  assert.ok(scanTextForPrivacyLeaks(secrets.badBotToken).length > 0);
});
