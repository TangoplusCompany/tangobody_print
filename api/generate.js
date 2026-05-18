import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(req, res) {
  const { t_r, type } = req.query;
  const isLocal = process.env.NODE_ENV === 'development' || !process.env.VERCEL;
  
  // type이 없으면 기본값 '0'(전부)으로 설정
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

    // --- [분기 로직 0]: 전부 인쇄 (기존과 동일하게 병렬 처리) ---
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

      await Promise.all([
        page1.evaluate(() => document.fonts.ready),
        page2.evaluate(() => document.fonts.ready)
      ]);
      await delay(5000); 

      const [pdf1, pdf2] = await Promise.all([
        page1.pdf({ format: 'A4', printBackground: true }),
        page2.pdf({ format: 'A4', printBackground: true })
      ]);
      pdfBytesArray.push(pdf1, pdf2);
    } 
    
    // --- [분기 로직 1]: 첫 번째 페이지(간편검사)만 인쇄 ---
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
      await delay(5000); 

      const pdf1 = await page1.pdf({ format: 'A4', printBackground: true });
      pdfBytesArray.push(pdf1);
    } 
    
    // --- [분기 로직 2]: 두 번째 페이지(ROM)만 인쇄 ---
    else if (printType === '2') {
      const page2 = await browser.newPage();
      await page2.goto(`https://tangobody-rom-print.vercel.app/?t_r=${t_r}`, { waitUntil: 'load', timeout: 30000 });

      await page2.evaluate(() => document.fonts.ready);
      await delay(5000); 

      const pdf2 = await page2.pdf({ format: 'A4', printBackground: true });
      pdfBytesArray.push(pdf2);
    }

    // --- 최종 PDF 결과물 처리 ---
    let finalPdfBytes;

    // 한 페이지만 요청했을 경우 병합 연산을 패스하여 성능 최적화
    if (pdfBytesArray.length === 1) {
      finalPdfBytes = pdfBytesArray[0];
    } else {
      // 두 페이지 이상일 때만 pdf-lib로 병합 실행
      const mergedPdf = await PDFDocument.create();
      for (const pdfBytes of pdfBytesArray) {
        const doc = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }
      finalPdfBytes = await mergedPdf.save();
    }

    // 결과 전송
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