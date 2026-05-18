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

    // 1. 두 페이지 기본 틀 로드
    await Promise.all([
      page1.goto(`https://tango-blue.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 }),
      page2.goto(`https://tangobody-rom-print.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 })
    ]);

    // 2. [핵심] 각 사이트에 내장된 SUIT 웹폰트가 브라우저 메모리에 완전히 안착할 때까지 대기
    await Promise.all([
      page1.evaluate(() => document.fonts.ready),
      page2.evaluate(() => document.fonts.ready)
    ]);

    // 3. 비동기 데이터와 리액트 차트가 완전히 그려지도록 5초간 넉넉하게 뜸을 들임
    // (Vercel 서버 첫 실행 시 외주 API 연동 속도를 고려해 시간을 조금 더 확보했습니다)
    await delay(5000); 

    // 4. 각각 PDF 생성
    const [pdf1, pdf2] = await Promise.all([
      page1.pdf({ format: 'A4', printBackground: true }),
      page2.pdf({ format: 'A4', printBackground: true })
    ]);

    // 5. PDF 병합 (pdf-lib)
    const mergedPdf = await PDFDocument.create();
    const doc1 = await PDFDocument.load(pdf1);
    const doc2 = await PDFDocument.load(pdf2);

    const copiedPages1 = await mergedPdf.copyPages(doc1, doc1.getPageIndices());
    copiedPages1.forEach((page) => mergedPdf.addPage(page));

    const copiedPages2 = await mergedPdf.copyPages(doc2, doc2.getPageIndices());
    copiedPages2.forEach((page) => mergedPdf.addPage(page));

    const finalPdfBytes = await mergedPdf.save();

    // 6. 결과 전송
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