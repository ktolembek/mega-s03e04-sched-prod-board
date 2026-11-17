import { ack, fetchIncidents } from './api.js';

const board = document.querySelector('[data-testid="board"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const list = document.querySelector('[data-testid="incident-list"]');
const buildSha = document.querySelector('[data-testid="build-sha"]');

const BUILD = document.querySelector('meta[name="build"]')?.content ?? 'unknown';
buildSha.textContent = BUILD;

/** EU-ish locales: day before month in the visible string. */
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
let ackInFlight = false;
let renderQueued = false;

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

function rowHtml(i) {
  const isAcked = ackedIds.has(i.id);
  const ackBtn = isAcked
    ? '<span data-testid="acked" class="acked">Acked</span>'
    : `<button type="button" data-testid="ack" class="ack" data-ack-id="${i.id}">Ack</button>`;
  return `<span class="id">${i.id}</span>
        <span class="sev">${i.severity}</span>
        <span class="what">${i.service} · ${i.region} · ${i.summary}</span>
        <time datetime="${i.openedAt}">${formatOpenedAt(i.openedAt)}</time>
        ${ackBtn}`;
}

function render() {
  const incidents = orderedIncidents();
  if (!ready) return;

  loader.classList.add('hidden');
  if (incidents.length === 0) {
    empty.classList.remove('hidden');
    list.classList.add('hidden');
    list.replaceChildren();
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');

  const keep = new Set(incidents.map((i) => i.id));
  for (const child of [...list.children]) {
    if (!keep.has(child.dataset.id)) child.remove();
  }

  const byId = new Map(
    [...list.children].map((el) => [el.dataset.id, el]),
  );

  incidents.forEach((incident, index) => {
    let li = byId.get(incident.id);
    if (!li) {
      li = document.createElement('li');
      li.dataset.testid = 'incident-row';
      li.dataset.id = incident.id;
      li.className = `row ${incident.severity}`;
    } else {
      li.className = `row ${incident.severity}`;
    }
    li.innerHTML = rowHtml(incident);

    const ref = list.children[index];
    if (ref !== li) {
      list.insertBefore(li, ref ?? null);
    }
  });
}

async function onAckActivate(event) {
  const btn = event.target.closest('[data-testid="ack"]');
  if (!btn || btn.disabled) return;
  const id = btn.dataset.ackId ?? btn.closest('[data-testid="incident-row"]')?.dataset.id;
  if (!id) return;

  event.preventDefault();
  btn.disabled = true;
  ackInFlight = true;
  board.dataset.acking = id;
  try {
    const reply = await ack(id);
    ackedIds.add(reply.id);
    console.info('ack-intent', id, 'ack-result', reply.id);
    render();
  } catch (err) {
    console.error(err);
    btn.disabled = false;
  } finally {
    ackInFlight = false;
    delete board.dataset.acking;
    if (renderQueued) {
      renderQueued = false;
      render();
    }
  }
}

list.addEventListener('pointerdown', onAckActivate);

async function refresh() {
  board.dataset.refreshing = 'true';
  try {
    const page = await fetchIncidents();
    mergeIncidents(page.incidents);
    if (!ready) {
      ready = true;
    }
    if (ackInFlight) {
      renderQueued = true;
    } else {
      render();
    }
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