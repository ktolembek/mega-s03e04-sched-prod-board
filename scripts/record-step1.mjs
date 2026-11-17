import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOARD = 'https://ktolembek.github.io/mega-s03e04-sched-prod-board/';

const browser = await chromium.launch({ slowMo: 20 });
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

let got = null;
let receipt = null;

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

const topRow = page.locator('[data-testid=incident-row]').first();
const expectedId = await topRow.getAttribute('data-id');
const btn = topRow.locator('[data-testid=ack]');
const box = await btn.boundingBox();
if (!box || !expectedId) throw new Error('no top ack');

const x = box.x + box.width / 2;
const y = box.y + box.height / 2;
const landedAt = ts();

await page.mouse.move(x - 40, y, { steps: 6 });
await page.mouse.move(x, y, { steps: 14 });

await page.waitForFunction(
  (prev) => {
    const row = document.querySelector('[data-testid=incident-row]');
    return row && row.dataset.id !== prev;
  },
  expectedId,
  { timeout: 120000 },
);

const ackAt = ts();
await page.mouse.click(x, y, { delay: 90 });
await page.waitForTimeout(1500);

if (!got || !receipt) throw new Error('no ack receipt');
if (got === expectedId) {
  throw new Error(`race not captured expected=${expectedId} got=${got}`);
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