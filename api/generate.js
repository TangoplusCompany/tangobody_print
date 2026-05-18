import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForLoadingToDisappear = async (page) => {
  await page.waitForFunction(() => {
    return !document.body.innerText.includes('로딩중');
  }, { timeout: 25000 }).catch(() => console.log(`${page.url()} 로딩 대기 타임아웃 (무시하고 진행)`));
};
const getKstTimestamp = () => {
  const now = new Date();
  // Vercel 서버(UTC)에 9시간을 더해 한국 시간으로 맞춤
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  const ss = String(kst.getUTCSeconds()).padStart(2, '0');
  
  // OS 파일명 제한으로 인해 콜론(:) 대신 대시(-) 사용
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
};

export default async function handler(req, res) {
  const { t_r, type } = req.query;
  const isLocal = process.env.NODE_ENV === 'development' || !process.env.VERCEL;
  const printType = type ? String(type) : '0'; 
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

    const pdfBytesArray = [];

    // --- [Type 0]: 전부 인쇄 ---
    if (printType === '0') {
      const page1 = await browser.newPage();
      const page2 = await browser.newPage();

      await Promise.all([
        page1.goto(`https://tango-blue.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 }),
        page2.goto(`https://tangobody-rom-print.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 })
      ]);

      if (!isLocal) {
        await page1.addStyleTag({ url: 'https://cdn.jsdelivr.net/gh/sun-typeface/SUIT/fonts/static/woff2/SUIT.css' });
        await page1.evaluate(() => {
          const style = document.createElement('style');
          style.innerHTML = `* { font-family: 'SUIT', sans-serif !important; }`;
          document.head.appendChild(style);
        });
      }

      // 폰트 대기 후 로딩 상태 체크
      await Promise.all([page1.evaluate(() => document.fonts.ready), page2.evaluate(() => document.fonts.ready)]);
      await Promise.all([waitForLoadingToDisappear(page1), waitForLoadingToDisappear(page2)]);
      await delay(5000); // 애니메이션 최종 마무리 뜸 들이기

      const [pdf1, pdf2] = await Promise.all([
        page1.pdf({ format: 'A4', printBackground: true }),
        page2.pdf({ format: 'A4', printBackground: true })
      ]);
      pdfBytesArray.push(pdf1, pdf2);
    } 
    
    // --- [Type 1]: 첫 번째 페이지(내 ROM)만 인쇄 ---
    else if (printType === '1') {
      const page1 = await browser.newPage();
      await page1.goto(`https://tango-blue.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 });

      if (!isLocal) {
        await page1.addStyleTag({ url: 'https://cdn.jsdelivr.net/gh/sun-typeface/SUIT/fonts/static/woff2/SUIT.css' });
        await page1.evaluate(() => {
          const style = document.createElement('style');
          style.innerHTML = `* { font-family: 'SUIT', sans-serif !important; }`;
          document.head.appendChild(style);
        });
      }

      await page1.evaluate(() => document.fonts.ready);
      await waitForLoadingToDisappear(page1); // 1페이지 로딩 감시 추가
      await delay(5000); 

      const pdf1 = await page1.pdf({ format: 'A4', printBackground: true });
      pdfBytesArray.push(pdf1);
    } 
    
    // --- [Type 2]: 두 번째 페이지(외주 간편검사)만 인쇄 ---
    else if (printType === '2') {
      const page2 = await browser.newPage();
      await page2.goto(`https://tangobody-rom-print.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 });

      await page2.evaluate(() => document.fonts.ready);
      await waitForLoadingToDisappear(page2); // 2페이지 로딩 감시 추가
      await delay(5000); 

      const pdf2 = await page2.pdf({ format: 'A4', printBackground: true });
      pdfBytesArray.push(pdf2);
    }

    // --- 최종 PDF 결과물 처리 ---
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

    // 현재 한국 시간 타임스탬프 가져오기
    const timestamp = getKstTimestamp();
    const filename = `tangobody-print_${timestamp}.pdf`;

    // 결과 전송 및 동적 파일명 적용
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