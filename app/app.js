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
const displayOrder = [];
const ackedIds = new Set();
let ready = false;
let ackInFlight = false;
let pendingRender = false;
let pointerTargetId = null;
let hoverAckId = null;

function mergeIncidents(incidents) {
  for (const i of incidents) {
    incidentsById.set(i.id, i);
  }
}

function orderedAll() {
  return [...incidentsById.values()].sort(
    (a, b) => new Date(b.openedAt) - new Date(a.openedAt),
  );
}

function pendingIncidents() {
  const shown = new Set(displayOrder);
  return orderedAll().filter((i) => !shown.has(i.id));
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

function rowBody(i) {
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

function updateRowElement(li, incident) {
  li.dataset.id = incident.id;
  li.className = `row ${incident.severity}`;
  li.innerHTML = rowBody(incident);
}

function renderList() {
  if (!ready) return;

  loader.classList.add('hidden');
  const incidents = displayOrder.map((id) => incidentsById.get(id)).filter(Boolean);

  if (incidents.length === 0) {
    empty.classList.remove('hidden');
    list.classList.add('hidden');
    list.replaceChildren();
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');

  const byId = new Map([...list.children].map((el) => [el.dataset.id, el]));

  displayOrder.forEach((id, index) => {
    const incident = incidentsById.get(id);
    if (!incident) return;

    let li = byId.get(id);
    if (!li) {
      li = document.createElement('li');
      li.dataset.testid = 'incident-row';
      list.appendChild(li);
    }
    updateRowElement(li, incident);

    const ref = list.children[index];
    if (ref !== li) list.insertBefore(li, ref ?? null);
  });

  for (const child of [...list.children]) {
    if (!displayOrder.includes(child.dataset.id)) child.remove();
  }
}

function render() {
  if (!ready) return;
  renderList();
  updateNewBar();
}

function pullNewIncidents() {
  const pending = pendingIncidents();
  const newestFirst = [...pending].sort(
    (a, b) => new Date(b.openedAt) - new Date(a.openedAt),
  );
  for (const incident of newestFirst) {
    if (!displayOrder.includes(incident.id)) {
      displayOrder.unshift(incident.id);
    }
  }
  render();
}

newBar.addEventListener('click', pullNewIncidents);

list.addEventListener('mousemove', (event) => {
  const btn = event.target.closest('[data-testid="ack"]');
  hoverAckId = btn?.dataset.ackId ?? hoverAckId;
});

list.addEventListener(
  'pointerdown',
  (event) => {
    const btn = event.target.closest('[data-testid="ack"]');
    if (!btn && !hoverAckId) return;
    if (ackInFlight) return;
    pointerTargetId = hoverAckId ?? btn?.dataset.ackId ?? null;
    if (!pointerTargetId) return;
    btn.disabled = true;
    ackInFlight = true;
    void runAck(pointerTargetId, btn);
  },
  true,
);

async function runAck(id, btn) {
  try {
    const reply = await ack(id);
    ackedIds.add(reply.id);
    renderList();
    updateNewBar();
  } catch (err) {
    console.error(err);
    if (btn?.isConnected) btn.disabled = false;
  } finally {
    ackInFlight = false;
    pointerTargetId = null;
  }
}

async function refresh() {
  board.dataset.refreshing = 'true';
  try {
    const page = await fetchIncidents();
    mergeIncidents(page.incidents);

    if (!ready) {
      displayOrder.length = 0;
      for (const i of orderedAll()) displayOrder.push(i.id);
      ready = true;
      render();
      return;
    }

    updateNewBar();
    if (!ackInFlight) renderList();
  } catch (err) {
    console.error('refresh failed', err);
    if (!ready) loader.textContent = 'Could not load incidents. Retrying…';
  } finally {
    delete board.dataset.refreshing;
  }
}

await refresh();
setInterval(refresh, 2000);