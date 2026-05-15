import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';

export default async function handler(req, res) {
  const { t_r } = req.query; // 외주 페이지용 암호화 키

  if (!t_r) {
    return res.status(400).send('t_r parameter is required');
  }

  let browser = null;
  const WIN_CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const isLocal = process.env.NODE_ENV === 'development';
  try {
    // // 1. 브라우저 실행 (Vercel 환경 대응)
    // browser = await puppeteer.launch({
    //   args: chromium.args,
    //   executablePath: await chromium.executablePath(),
    //   headless: chromium.headless,
    // });
    const browser = await puppeteer.launch({
      args: isLocal ? [] : chromium.args,
      executablePath: isLocal ? WIN_CHROME_PATH : await chromium.executablePath(),
      headless: isLocal ? false : chromium.headless, // 로컬에선 동작 확인을 위해 브라우저가 뜨게(false) 설정 가능
    });

    const page = await browser.newPage();
    const pdfDocs = [];

    await page.goto(`https://tango-blue.vercel.app/?t_r=${t_r}`, { waitUntil: 'networkidle2' });
    const pdf1 = await page.pdf({ format: 'A4', printBackground: true });
    pdfDocs.push(pdf1);

    await page.goto(`https://tangobody-rom-print.vercel.app/?t_r=${t_r}`, { waitUntil: 'networkidle2' });
    const pdf2 = await page.pdf({ format: 'A4', printBackground: true });
    pdfDocs.push(pdf2);

    await page.goto(`https://tangobody-bia-print.vercel.app/?t_r=${t_r}`, { waitUntil: 'networkidle2' });
    const pdf3 = await page.pdf({ format: 'A4', printBackground: true });
    pdfDocs.push(pdf3);

    // 4. PDF 병합 (pdf-lib)
    const mergedPdf = await PDFDocument.create();
    for (const pdfBytes of pdfDocs) {
      const doc = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const finalPdfBytes = await mergedPdf.save();

    // 5. PDF 파일로 응답
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=result.pdf');
    res.send(Buffer.from(finalPdfBytes));

  } catch (error) {
    console.error(error);
    res.status(500).send('PDF Generation Failed');
  } finally {
    if (browser) await browser.close();
  }
}