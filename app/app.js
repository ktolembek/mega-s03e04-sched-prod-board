import { ack, fetchIncidents } from './api.js';

const board = document.querySelector('[data-testid="board"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const list = document.querySelector('[data-testid="incident-list"]');
const buildSha = document.querySelector('[data-testid="build-sha"]');

const BUILD = document.querySelector('meta[name="build"]')?.content ?? 'unknown';
buildSha.textContent = BUILD;

const EU_LOCALE =
  /^(de|fr|it|es|pt|nl|pl|cs|sk|da|sv|fi|el|hu|ro|bg|hr|sl|et|lv|lt|mt|ga)(-|$)/i.test(
    navigator.language,
  );

function formatOpenedAt(iso) {
  const d = new Date(iso);
  const locale = EU_LOCALE ? 'en-GB' : navigator.language || 'en-US';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

const incidentsById = new Map();
const ackedIds = new Set();
let ready = false;

function mergeIncidents(incidents) {
  for (const i of incidents) {
    incidentsById.set(i.id, i);
  }
}

function orderedIncidents() {
  return [...incidentsById.values()].sort(
    (a, b) => new Date(b.openedAt) - new Date(a.openedAt),
  );
}

function render() {
  const incidents = orderedIncidents();
  if (!ready) return;

  loader.classList.add('hidden');
  if (incidents.length === 0) {
    empty.classList.remove('hidden');
    list.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = incidents
    .map((i) => {
      const isAcked = ackedIds.has(i.id);
      const ackBtn = isAcked
        ? '<span data-testid="acked" class="acked">Acked</span>'
        : `<button type="button" data-testid="ack" class="ack">Ack</button>`;
      return `<li data-testid="incident-row" data-id="${i.id}" class="row ${i.severity}">
        <span class="id">${i.id}</span>
        <span class="sev">${i.severity}</span>
        <span class="what">${i.service} · ${i.region} · ${i.summary}</span>
        <time datetime="${i.openedAt}">${formatOpenedAt(i.openedAt)}</time>
        ${ackBtn}
      </li>`;
    })
    .join('');
}

async function onAckClick(event) {
  const btn = event.target.closest('[data-testid="ack"]');
  if (!btn) return;
  const row = btn.closest('[data-testid="incident-row"]');
  if (!row) return;
  const id = row.dataset.id;
  btn.disabled = true;
  try {
    const reply = await ack(id);
    ackedIds.add(reply.id);
    render();
  } catch (err) {
    console.error(err);
    btn.disabled = false;
  }
}

list.addEventListener('click', onAckClick);

async function refresh() {
  board.dataset.refreshing = 'true';
  try {
    const page = await fetchIncidents();
    mergeIncidents(page.incidents);
    if (!ready) {
      ready = true;
    }
    render();
  } catch (err) {
    console.error('refresh failed', err);
    if (!ready) {
      loader.textContent = 'Could not load incidents. Retrying…';
    }
  } finally {
    delete board.dataset.refreshing;
  }
}

await refresh();
setInterval(refresh, 2000);