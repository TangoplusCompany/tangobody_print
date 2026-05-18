import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib'; // npm install pdf-lib 다시 확인!

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

    // 1. [속도 최적화] 각자 고유한 도메인 환경에서 완벽하게 페이지 로드 (CORS, CSS 깨짐 원천 차단)
    await Promise.all([
      page1.goto(`https://tango-blue.vercel.app/?t_r=${t_r}`, { waitUntil: 'networkidle0' }),
      page2.goto(`https://tangobody-rom-print.vercel.app/?t_r=${t_r}`, { waitUntil: 'networkidle0' })
    ]);

    // 2. 비동기 데이터 및 차트가 다 그려질 때까지 확실하게 대기
    await delay(3000); 

    // 3. [최적화] 두 페이지를 동시에 PDF로 각각 구움
    const [pdf1, pdf2] = await Promise.all([
      page1.pdf({ format: 'A4', printBackground: true }),
      page2.pdf({ format: 'A4', printBackground: true })
    ]);

    // 4. 깨끗하게 완성된 두 PDF를 하나로 병합
    const mergedPdf = await PDFDocument.create();
    
    const doc1 = await PDFDocument.load(pdf1);
    const doc2 = await PDFDocument.load(pdf2);

    const copiedPages1 = await mergedPdf.copyPages(doc1, doc1.getPageIndices());
    copiedPages1.forEach((page) => mergedPdf.addPage(page));

    const copiedPages2 = await mergedPdf.copyPages(doc2, doc2.getPageIndices());
    copiedPages2.forEach((page) => mergedPdf.addPage(page));

    const finalPdfBytes = await mergedPdf.save();

    // 5. 브라우저로 최종 결과 쏘기
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