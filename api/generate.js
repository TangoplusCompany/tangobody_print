import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 환경 변수 명칭 변경 (Partner -> Basic)
const BASIC_URL = process.env.BASIC_URL || '';
const ROM_URL = process.env.ROM_URL || '';
const BIA_URL = process.env.BIA_URL || '';

const waitForLoadingToDisappear = async (page) => {
  await page.waitForFunction(() => {
    return !document.body.innerText.includes('로딩중');
  }, { timeout: 25000 }).catch(() => console.log(`${page.url()} 로딩 대기 타임아웃`));
};

const getKstTimestamp = () => {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  const ss = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
};

export default async function handler(req, res) {
  const { t_r, type } = req.query;
  const isLocal = process.env.NODE_ENV === 'development' || !process.env.VERCEL;
  
  const config = type && type.length === 3 ? type : "111"; 
  let browser = null;

  try {
    let executablePath = await chromium.executablePath();
    if (isLocal) {
      executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    }

    browser = await puppeteer.launch({
      args: isLocal ? ['--no-sandbox'] : chromium.args,
      executablePath: executablePath,
      headless: isLocal ? false : chromium.headless, 
    });

    // 1. 타겟 구성 및 isBasic 플래그 설정
    const targets = [];
    if (config[0] === '1') targets.push({ url: `${BASIC_URL}/?t_r=${t_r}`, isBasic: true });  // 간편검사 (Basic)
    if (config[1] === '1') targets.push({ url: `${ROM_URL}/?t_r=${t_r}`, isBasic: false });  // ROM (폰트 주입 필요)
    if (config[2] === '1') targets.push({ url: `${BIA_URL}/?t_r=${t_r}`, isBasic: false });  // BIA (폰트 주입 필요)

    if (targets.length === 0) {
      return res.status(400).json({ error: "최소 하나의 리포트는 선택해야 합니다. (예: type=111)" });
    }

    const pages = await Promise.all(targets.map(() => browser.newPage()));

    // 2. 페이지 로드
    await Promise.all(pages.map((page, i) => page.goto(targets[i].url, { waitUntil: 'load', timeout: 30000 })));

    // 3. 폰트 주입 처리 (isBasic이 'false'인 ROM, BIA 페이지에 일괄 주입)
    await Promise.all(pages.map(async (page, i) => {
      if (!targets[i].isBasic && !isLocal) {
        await page.addStyleTag({ url: 'https://cdn.jsdelivr.net/gh/sun-typeface/SUIT/fonts/static/woff2/SUIT.css' });
        await page.evaluate(() => {
          const style = document.createElement('style');
          style.innerHTML = `* { font-family: 'SUIT', sans-serif !important; }`;
          document.head.appendChild(style);
        });
      }
      await page.evaluate(() => document.fonts.ready);
    }));

    // 4. 데이터 로딩 대기 및 5초 뜸 들이기
    await Promise.all(pages.map(page => waitForLoadingToDisappear(page)));
    await delay(5000); 

    // 5. PDF 생성
    const pdfBytesArray = await Promise.all(pages.map(page => page.pdf({ format: 'A4', printBackground: true })));

    // 6. PDF 병합
    let finalPdfBytes;
    if (pdfBytesArray.length === 1) {
      finalPdfBytes = pdfBytesArray[0];
    } else {
      const mergedPdf = await PDFDocument.create();
      for (const pdfBytes of pdfBytesArray) {
        const doc = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }
      finalPdfBytes = await mergedPdf.save();
    }

    const timestamp = getKstTimestamp();
    const filename = `tangobody-print_${timestamp}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(Buffer.from(finalPdfBytes));

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    if (browser) await browser.close();
  }
}