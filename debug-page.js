// table-tennis/debug-page.js
import puppeteer from "puppeteer";

async function debugPage() {
  const browser = await puppeteer.launch({ headless: false }); // Run visible
  const page = await browser.newPage();

  await page.goto("https://www.sofascore.com/table-tennis", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await new Promise((r) => setTimeout(r, 5000));

  // Get all text content to see what's on the page
  const text = await page.evaluate(() => document.body.innerText);
  console.log("Page text preview:", text.substring(0, 2000));

  // Look for score patterns
  const scores = await page.evaluate(() => {
    const body = document.body.innerText;
    const scoreRegex = /\d+[-:]\d+/g;
    const matches = body.match(scoreRegex);
    return matches;
  });

  console.log("Found scores:", scores?.slice(0, 20));

  // Get HTML structure
  const html = await page.evaluate(() => document.body.innerHTML);
  console.log("HTML preview:", html.substring(0, 5000));

  await new Promise((r) => setTimeout(r, 30000)); // Keep open to see
  await browser.close();
}

debugPage().catch(console.error);
