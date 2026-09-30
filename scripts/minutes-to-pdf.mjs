import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const htmlDir = path.resolve('data/minutes-html');
const pdfDir = path.resolve('public/uploads/minutes');

const files = (await readdir(htmlDir)).filter((name) => name.endsWith('.html'));
if (!files.length) {
  throw new Error(`No HTML minutes in ${htmlDir}`);
}

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();

for (const file of files) {
  const htmlPath = path.join(htmlDir, file);
  const pdfPath = path.join(pdfDir, file.replace(/\.html$/i, '.pdf'));
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `
      <div style="font-size:9px;font-family:Segoe UI,Calibri,sans-serif;color:#5a6a7a;width:100%;padding:0 14mm;display:flex;justify-content:space-between;">
        <span>Beds SRA minutes</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`,
    margin: { top: '12mm', bottom: '16mm', left: '0', right: '0' },
  });
  console.log(path.relative(process.cwd(), pdfPath));
}

await browser.close();
