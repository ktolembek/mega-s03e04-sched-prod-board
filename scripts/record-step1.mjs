import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOARD = 'https://ktolembek.github.io/mega-s03e04-sched-prod-board/';
const MAX_LANDING_AGE_MS = 4000;

const browser = await chromium.launch({ slowMo: 10 });
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

let receipt = null;
let got = null;

page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('ack ')) {
    const parts = t.split(' ');
    got = parts[1];
    receipt = parts[parts.length - 1];
  }
});

await page.goto(BOARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-testid=incident-row]', { timeout: 60000 });

let expectedId = null;
let ackAt = null;
let landedAt = null;

for (let attempt = 0; attempt < 30; attempt += 1) {
  const now = Date.now();
  const rows = await page.locator('[data-testid=incident-row]').evaluateAll((els) =>
    els.map((r) => ({
      id: r.dataset.id,
      openedAt: r.querySelector('time')?.getAttribute('datetime') ?? '',
    })),
  );
  const candidate = rows
    .map((row) => ({ ...row, ageMs: now - new Date(row.openedAt).getTime() }))
    .filter((row) => row.ageMs >= 0 && row.ageMs < MAX_LANDING_AGE_MS)
    .sort((a, b) => a.ageMs - b.ageMs)[0];

  if (!candidate) {
    await page.waitForTimeout(100);
    continue;
  }

  expectedId = candidate.id;
  landedAt = ts();
  got = null;
  receipt = null;

  const btn = page
    .locator(`[data-testid=incident-row][data-id="${expectedId}"] [data-testid=ack]`)
    .first();
  const box = await btn.boundingBox();
  if (!box) continue;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });

  await page.waitForFunction(
    () => document.querySelector('[data-testid=board]')?.dataset.refreshing === 'true',
    null,
    { timeout: 5000 },
  );
  ackAt = ts();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 30 });
  await page.waitForTimeout(800);

  if (got && expectedId && got !== expectedId && receipt) {
    break;
  }
}

if (!expectedId || !got || !receipt || got === expectedId) {
  await context.close();
  await browser.close();
  throw new Error(
    `race not captured expected=${expectedId} got=${got} receipt=${receipt ? 'yes' : 'no'}`,
  );
}

await page.waitForTimeout(2000);
const buildSha = await page.locator('[data-testid=build-sha]').textContent();
const video = page.video();
await context.close();
await browser.close();
const videoPath = await video.path();
const dest = path.join(__dirname, 'step1-board-demo-v6.webm');
fs.renameSync(videoPath, dest);

const meta = { expectedId, got, landedAt, ackAt, buildSha, receipt };
fs.writeFileSync(path.join(__dirname, 'step1-log-v6.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta));