import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(req, res) {
  const { t_r } = req.query;
  const isLocal = process.env.NODE_ENV === 'development' || !process.env.VERCEL;
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

    const page1 = await browser.newPage();
    const page2 = await browser.newPage();

    // 1. 두 페이지 로드
    await Promise.all([
      page1.goto(`https://tango-blue.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 }),
      page2.goto(`https://tangobody-rom-print.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 })
    ]);

    // 2. [첫 번째 페이지 전용 구출 코드] 
    // 가변 폰트를 인식 못 하는 서버 크롬을 위해 SUIT 공식 Static(고정형) 웹폰트 경로를 강제 인식시킵니다.
    if (!isLocal) {
      await page1.addStyleTag({
        url: 'https://cdn.jsdelivr.net/gh/sun-typeface/SUIT/fonts/static/woff2/SUIT.css'
      });
      await page1.evaluate(() => {
        const style = document.createElement('style');
        style.innerHTML = `* { font-family: 'SUIT', sans-serif !important; }`;
        document.head.appendChild(style);
      });
    }

    // 3. 웹폰트가 브라우저 메모리에 완전히 안착할 때까지 대기
    await Promise.all([
      page1.evaluate(() => document.fonts.ready),
      page2.evaluate(() => document.fonts.ready)
    ]);

    // 4. 데이터와 차트 렌더링 대기
    await delay(5000); 

    // 5. 각각 PDF 생성
    const [pdf1, pdf2] = await Promise.all([
      page1.pdf({ format: 'A4', printBackground: true }),
      page2.pdf({ format: 'A4', printBackground: true })
    ]);

    // 6. PDF 병합
    const mergedPdf = await PDFDocument.create();
    const doc1 = await PDFDocument.load(pdf1);
    const doc2 = await PDFDocument.load(pdf2);

    const copiedPages1 = await mergedPdf.copyPages(doc1, doc1.getPageIndices());
    copiedPages1.forEach((page) => mergedPdf.addPage(page));

    const copiedPages2 = await mergedPdf.copyPages(doc2, doc2.getPageIndices());
    copiedPages2.forEach((page) => mergedPdf.addPage(page));

    const finalPdfBytes = await mergedPdf.save();

    // 7. 결과 전송
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=result.pdf');
    res.send(Buffer.from(finalPdfBytes));

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    if (browser) await browser.close();
  }
}