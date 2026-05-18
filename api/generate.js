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
    } else {
      // [핵심 해결책] Vercel 리눅스 크롬 엔진에 한글(CJK) 렌더링 능력을 강제로 주입합니다.
      await chromium.font('https://raw.githack.com/googlefonts/noto-cjk/main/Sans/Subset/NotoSansCJKkr-Regular.otf');
    }

    browser = await puppeteer.launch({
      args: isLocal ? ['--no-sandbox'] : chromium.args,
      executablePath: executablePath,
      headless: isLocal ? false : chromium.headless, 
    });

    const page1 = await browser.newPage();
    const page2 = await browser.newPage();

    // 디버깅용: 가상 브라우저 내부에서 일어나는 자바스크립트 에러를 Vercel 로그에 출력
    if (!isLocal) {
      page1.on('console', msg => console.log('PAGE 1 LOG:', msg.text()));
      page2.on('console', msg => console.log('PAGE 2 LOG:', msg.text()));
    }

    // 1. 페이지 로드
    await Promise.all([
      page1.goto(`https://tango-blue.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 }),
      page2.goto(`https://tangobody-rom-print.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 })
    ]);

    // 2. 웹폰트 및 비동기 데이터 렌더링 완전 대기 (시간을 5초로 확장)
    await Promise.all([
      page1.evaluate(() => document.fonts.ready),
      page2.evaluate(() => document.fonts.ready)
    ]);
    await delay(5000); 

    // 3. PDF 각각 생성
    const [pdf1, pdf2] = await Promise.all([
      page1.pdf({ format: 'A4', printBackground: true }),
      page2.pdf({ format: 'A4', printBackground: true })
    ]);

    // 4. PDF 병합
    const mergedPdf = await PDFDocument.create();
    const doc1 = await PDFDocument.load(pdf1);
    const doc2 = await PDFDocument.load(pdf2);

    const copiedPages1 = await mergedPdf.copyPages(doc1, doc1.getPageIndices());
    copiedPages1.forEach((page) => mergedPdf.addPage(page));

    const copiedPages2 = await mergedPdf.copyPages(doc2, doc2.getPageIndices());
    copiedPages2.forEach((page) => mergedPdf.addPage(page));

    const finalPdfBytes = await mergedPdf.save();

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