import { Page } from "playwright";
import sharp from "sharp";
import { waitFor } from "./utils";

export async function screenshot(page: Page) {
  // 1. Observe
  const { width, height } = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));


  // Get screenshot buffer (binary)
  const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 90 });

  const bg = await sharp(screenshotBuffer).metadata();

  // Always resize to logical size to ensure specific 1:1 mapping for AI
  // This handles DPR > 1, and any other scaling oddities
  let screenshotBase64: string;
  if (bg.width !== width || bg.height !== height) {
    const resizedBuffer = await sharp(screenshotBuffer)
      .resize(width, height, { fit: 'fill' })
      .jpeg({ quality: 90 })
      .toBuffer();
    screenshotBase64 = resizedBuffer.toString('base64');
  } else {
    screenshotBase64 = Buffer.from(screenshotBuffer).toString('base64');
  }
  return screenshotBase64;
}

export async function launch(page: Page, params: {url: string}) {
  await page.goto(params.url)
}

async function getBboxCenter(page: Page, bbox: number[]) {
   const [ymin, xmin, ymax, xmax] = bbox;
   const { width, height } = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
   const x = ((xmin + xmax) / 2 / 1000) * width;
   const y = ((ymin + ymax) / 2 / 1000) * height;
   return {
     x,
     y
   }
}

export async function click(page: Page, params: {bbox: number[]}) {
  const {x, y} = await getBboxCenter(page, params.bbox);
  await page.mouse.click(x, y);
}

export async function input(page: Page, params: {value: string, bbox: number[]}) {
  const {x, y} = await getBboxCenter(page, params.bbox);
  await page.mouse.click(x, y, {clickCount: 3});
  await waitFor(500);
  await page.keyboard.type(params.value, {delay: 100});
}

export async function scroll(page: Page, params: {direction: 'down' | 'up'}) {
  const scrollAmount = 500;
  const direction = params.direction;
  if (direction === 'down') {
    await page.evaluate((y) => window.scrollBy(0, y), scrollAmount);
  } else if (direction === 'up') {
    await page.evaluate((y) => window.scrollBy(0, -y), scrollAmount);
  }
}

export async function sleep(page: Page, params: {timeMs: number}) {
  await waitFor(params.timeMs);
}
