import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOARD = 'https://ktolembek.github.io/mega-s03e04-sched-prod-board/';
const MAX_LANDING_AGE_MS = 5000;

async function youngIncident(page) {
  const now = Date.now();
  const rows = await page.locator('[data-testid=incident-row]').evaluateAll((els) =>
    els.map((r) => ({
      id: r.dataset.id,
      openedAt: r.querySelector('time')?.getAttribute('datetime') ?? '',
    })),
  );
  return rows
    .map((row) => ({ ...row, ageMs: now - new Date(row.openedAt).getTime() }))
    .filter((row) => row.ageMs >= 0 && row.ageMs < MAX_LANDING_AGE_MS)
    .sort((a, b) => a.ageMs - b.ageMs)[0];
}

async function tryRace(page) {
  let expectedId = null;
  let got = null;
  let receipt = null;

  const handler = (m) => {
    const t = m.text();
    if (t.startsWith('ack-intent')) {
      const parts = t.split(' ');
      expectedId = parts[1];
      got = parts[3];
    }
    if (t.startsWith('ack ')) {
      const parts = t.split(' ');
      got = parts[1];
      receipt = parts[parts.length - 1];
    }
  };
  page.on('console', handler);

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const candidate = await youngIncident(page);
    if (!candidate) {
      await page.waitForTimeout(120);
      continue;
    }

    const btn = page
      .locator(`[data-testid=incident-row][data-id="${candidate.id}"] [data-testid=ack]`)
      .first();
  const visible = await btn.isVisible().catch(() => false);
    if (!visible) continue;

    const box = await btn.boundingBox();
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.down();
    await page.waitForFunction(
      () => document.querySelector('[data-testid=board]')?.dataset.refreshing === 'true',
      null,
      { timeout: 4000 },
    );
    await page.waitForFunction(
      () => document.querySelector('[data-testid=board]')?.dataset.refreshing !== 'true',
      null,
      { timeout: 4000 },
    );
    await page.mouse.up();
    await page.waitForTimeout(600);

    if (expectedId && got && receipt && expectedId !== got) {
      page.off('console', handler);
      return { expectedId, got, receipt };
    }
  }

  page.off('console', handler);
  return null;
}

const browser = await chromium.launch({ slowMo: 15 });
const context = await browser.newContext({
  recordVideo: { dir: __dirname, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const start = Date.now();
const ts = () => {
  const s = Math.floor((Date.now() - start) / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

await page.goto(BOARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-testid=incident-row]', { timeout: 60000 });

const result = await tryRace(page);
if (!result) {
  await context.close();
  await browser.close();
  throw new Error('race not captured');
}

await page.waitForTimeout(2000);
const ackAt = ts();
const buildSha = await page.locator('[data-testid=build-sha]').textContent();
const video = page.video();
await context.close();
await browser.close();
const videoPath = await video.path();
const dest = path.join(__dirname, 'step1-board-demo-v6.webm');
fs.renameSync(videoPath, dest);

const meta = { ...result, ackAt, buildSha };
fs.writeFileSync(path.join(__dirname, 'step1-log-v6.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta));