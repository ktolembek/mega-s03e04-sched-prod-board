import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOARD = 'https://ktolembek.github.io/mega-s03e04-sched-prod-board/';
const MAX_LANDING_AGE_MS = 3500;

const browser = await chromium.launch({ slowMo: 25 });
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
let ackedId = null;
let expectedId = null;
let ackAt = null;

page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('ack ')) {
    const parts = t.split(' ');
    ackedId = parts[1];
    receipt = parts[parts.length - 1];
  }
  if (t.startsWith('ack-intent')) {
    const parts = t.split(' ');
    expectedId = parts[1];
    ackedId = parts[3];
  }
});

await page.goto(BOARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-testid=incident-row]', { timeout: 60000 });

const deadline = Date.now() + 180000;
let landedAt = null;

while (Date.now() < deadline) {
  const now = Date.now();
  const rows = await page.locator('[data-testid=incident-row]').evaluateAll((els) =>
    els.map((r) => ({
      id: r.dataset.id,
      openedAt: r.querySelector('time')?.getAttribute('datetime') ?? '',
    })),
  );
  const candidate = rows
    .map((row) => ({
      ...row,
      ageMs: now - new Date(row.openedAt).getTime(),
    }))
    .filter((row) => row.ageMs >= 0 && row.ageMs < MAX_LANDING_AGE_MS)
    .sort((a, b) => a.ageMs - b.ageMs)[0];

  if (candidate) {
    expectedId = candidate.id;
    landedAt = ts();
    const btn = page
      .locator(`[data-testid=incident-row][data-id="${expectedId}"] [data-testid=ack]`)
      .first();
    const box = await btn.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
      ackAt = ts();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 70 });
      break;
    }
  }
  await page.waitForTimeout(80);
}

if (!expectedId) throw new Error('no landing incident in time');

await page
  .locator(`[data-testid=incident-row][data-id="${expectedId}"] [data-testid=acked]`)
  .waitFor({ timeout: 15000 });

await page.waitForTimeout(2500);
const buildSha = await page.locator('[data-testid=build-sha]').textContent();
const video = page.video();
await context.close();
await browser.close();
const videoPath = await video.path();
const dest = path.join(__dirname, 'step1-board-demo-v5.webm');
fs.renameSync(videoPath, dest);

const got = ackedId ?? expectedId;
const meta = { expectedId, got, landedAt, ackAt, buildSha, receipt };
fs.writeFileSync(path.join(__dirname, 'step1-log-v5.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta));