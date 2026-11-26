const REPO_SLUG = 'Harru230/bakalari-status';
const STATUS_WORKFLOW = 'status-pages.yml';
const TIMETABLE_WORKFLOW = 'timetable.yml';
const TIMETABLE_PRAGUE_HOUR = '06';

const pragueHourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Prague',
  hour: '2-digit',
  hourCycle: 'h23',
});

/**
 * Returns the two-digit 24-hour clock hour ('00'-'23') in Europe/Prague.
 * @param {Date | number | string} date
 * @returns {string}
 */
export function getPragueHour(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) {
    throw new RangeError('Invalid date passed to getPragueHour');
  }
  return pragueHourFormatter.format(value).padStart(2, '0');
}

/**
 * Triggers a GitHub Actions workflow_dispatch event on main.
 * @param {string} workflowFile
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 */
export async function dispatchWorkflow(workflowFile, token, fetchImpl = fetch) {
  const url = `https://api.github.com/repos/${REPO_SLUG}/actions/workflows/${workflowFile}/dispatches`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'bakalari-cron-trigger',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  if (!res.ok) {
    throw new Error(`GitHub workflow dispatch (${workflowFile}) failed with HTTP ${res.status}`);
  }
}

/**
 * Executes the scheduled hourly trigger: always dispatches status-pages.yml,
 * and dispatches timetable.yml when it is 06:xx in Europe/Prague.
 * @param {number | string | Date} scheduledTime
 * @param {{ GH_DISPATCH_TOKEN?: string }} env
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ pragueHour: string, dispatched: string[] }>}
 */
export async function runScheduledTrigger(scheduledTime, env, fetchImpl = fetch) {
  const token = typeof env?.GH_DISPATCH_TOKEN === 'string' ? env.GH_DISPATCH_TOKEN.trim() : '';
  if (!token) {
    throw new Error('Missing GH_DISPATCH_TOKEN secret in Worker environment');
  }

  const pragueHour = getPragueHour(scheduledTime);
  const workflows = [STATUS_WORKFLOW];
  if (pragueHour === TIMETABLE_PRAGUE_HOUR) {
    workflows.push(TIMETABLE_WORKFLOW);
  }

  for (const workflowFile of workflows) {
    await dispatchWorkflow(workflowFile, token, fetchImpl);
  }

  return { pragueHour, dispatched: workflows };
}

export default {
  async fetch() {
    return new Response('bakalari-cron-trigger ok\n', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },

  async scheduled(controller, env, ctx) {
    const scheduledTime = controller?.scheduledTime ?? Date.now();
    ctx.waitUntil(runScheduledTrigger(scheduledTime, env));
  },
};
