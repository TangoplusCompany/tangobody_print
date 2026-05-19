import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BASIC_URL = process.env.BASIC_URL || '';
const ROM_URL = process.env.ROM_URL || '';
// 아직 없을 수 있으므로 기본값 없이 환경 변수 그대로 가져옵니다.
const BIA_URL = process.env.BIA_URL; 

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
  
  const config = type ? String(type) : "1"; 
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

    const targets = [];
    
    // [1번째 자리: 간편검사] '1'이 들어오면 타겟 추가
    if (config[0] === '1') {
      targets.push({ url: `${BASIC_URL}/?t_r=${t_r}`, isBasic: true });
    }
    
    // [2번째 자리: ROM] '1'이 들어오고 주소가 유효할 때만 추가
    if (config[1] === '1') {
      targets.push({ url: `${ROM_URL}/?t_r=${t_r}`, isBasic: false });
    }
    
    // [3번째 자리: BIA] '1'이 들어왔고, '실제로 Vercel에 BIA_URL 환경 변수가 등록되어 있을 때만' 추가
    if (config[2] === '1' && BIA_URL) {
      targets.push({ url: `${BIA_URL}/?t_r=${t_r}`, isBasic: false });
    }

    // 선택된 타겟이 아무것도 없다면 400 에러 반환
    if (targets.length === 0) {
      return res.status(400).json({ error: "선택된 리포트가 없거나 유효하지 않은 주소입니다." });
    }

    // 동적으로 생성된 타겟 개수만큼만 브라우저 탭 생성 및 로드
    const pages = await Promise.all(targets.map(() => browser.newPage()));
    await Promise.all(pages.map((page, i) => page.goto(targets[i].url, { waitUntil: 'load', timeout: 30000 })));

    // 폰트 주입 및 폰트 레디 대기
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

    // 데이터 로딩 완벽 대기 및 5초 뜸 들이기
    await Promise.all(pages.map(page => waitForLoadingToDisappear(page)));
    await delay(5000); 

    // PDF 굽기
    const pdfBytesArray = await Promise.all(pages.map(page => page.pdf({ format: 'A4', printBackground: true })));

    // PDF 파일 하나로 최종 병합
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