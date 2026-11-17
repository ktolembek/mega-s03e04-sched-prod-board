import { ack, fetchIncidents } from './api.js';

const board = document.querySelector('[data-testid="board"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const list = document.querySelector('[data-testid="incident-list"]');
const newBar = document.querySelector('[data-testid="new-bar"]');
const newCount = document.querySelector('[data-testid="new-count"]');
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
const displayedIds = new Set();
const ackedIds = new Set();
let ready = false;
let ackInFlight = false;
let renderQueued = false;
let pointerTargetId = null;

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

function pendingIncidents() {
  return orderedIncidents().filter((i) => !displayedIds.has(i.id));
}

function updateNewBar() {
  const n = pendingIncidents().length;
  if (n > 0 && ready) {
    newBar.classList.remove('hidden');
    newCount.textContent = String(n);
  } else {
    newBar.classList.add('hidden');
  }
}

function renderList() {
  const incidents = orderedIncidents().filter((i) => displayedIds.has(i.id));

  loader.classList.add('hidden');
  if (incidents.length === 0 && !ready) return;

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

  const byId = new Map([...list.children].map((el) => [el.dataset.id, el]));

  incidents.forEach((incident, index) => {
    let li = byId.get(incident.id);
    const isAcked = ackedIds.has(incident.id);
    const ackBtn = isAcked
      ? '<span data-testid="acked" class="acked">Acked</span>'
      : `<button type="button" data-testid="ack" class="ack" data-ack-id="${incident.id}">Ack</button>`;

    if (!li) {
      li = document.createElement('li');
      li.dataset.testid = 'incident-row';
      li.dataset.id = incident.id;
      li.className = `row ${incident.severity}`;
    } else {
      li.className = `row ${incident.severity}`;
    }
    li.innerHTML = `<span class="id">${incident.id}</span>
        <span class="sev">${incident.severity}</span>
        <span class="what">${incident.service} · ${incident.region} · ${incident.summary}</span>
        <time datetime="${incident.openedAt}">${formatOpenedAt(incident.openedAt)}</time>
        ${ackBtn}`;

    const ref = list.children[index];
    if (ref !== li) list.insertBefore(li, ref ?? null);
  });
}

function render() {
  if (!ready) return;
  renderList();
  updateNewBar();
}

function pullNewIncidents() {
  for (const incident of pendingIncidents()) {
    displayedIds.add(incident.id);
  }
  render();
}

newBar.addEventListener('click', pullNewIncidents);

list.addEventListener(
  'pointerdown',
  (event) => {
    const btn = event.target.closest('[data-testid="ack"]');
    if (!btn) return;
    pointerTargetId = btn.dataset.ackId ?? btn.closest('[data-testid="incident-row"]')?.dataset.id ?? null;
  },
  true,
);

async function onAckClick(event) {
  const btn = event.target.closest('[data-testid="ack"]');
  if (!btn || btn.disabled) return;
  const id = pointerTargetId ?? btn.dataset.ackId;
  if (!id) return;

  btn.disabled = true;
  ackInFlight = true;
  try {
    const reply = await ack(id);
    ackedIds.add(reply.id);
    render();
  } catch (err) {
    console.error(err);
    btn.disabled = false;
  } finally {
    ackInFlight = false;
    pointerTargetId = null;
    if (renderQueued) {
      renderQueued = false;
      updateNewBar();
    }
  }
}

list.addEventListener('click', onAckClick);

async function refresh() {
  board.dataset.refreshing = 'true';
  try {
    const page = await fetchIncidents();
    mergeIncidents(page.incidents);

    if (!ready) {
      for (const i of page.incidents) displayedIds.add(i.id);
      ready = true;
      render();
      return;
    }

    updateNewBar();
    if (!ackInFlight) {
      renderList();
    } else {
      renderQueued = true;
    }
  } catch (err) {
    console.error('refresh failed', err);
    if (!ready) loader.textContent = 'Could not load incidents. Retrying…';
  } finally {
    delete board.dataset.refreshing;
  }
}

await refresh();
setInterval(refresh, 2000);