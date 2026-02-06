import { Page } from "playwright";
import { AIAction } from "./type";
import { click, input, launch, scroll, sleep } from "./device";

export async function executeAction(page: Page, plan: AIAction) {
  const { type, param } = plan;

  switch (type) {
    case 'Launch':
      launch(page, { url: param.url });
      break;

    case 'Tap':
    case 'Click':
      if (param?.locate?.bbox || param?.locate?.bbox_2d) {
        const bbox = param.locate.bbox || param?.locate?.bbox_2d;
        click(page, { bbox });
      } else {
        console.warn(`   [ActionSkipped] Tap action missing bbox: ${JSON.stringify(param)}`);
      }
      break;

    case 'Input':
    case 'Type':
      if (param?.locate?.bbox || param?.locate?.bbox_2d) {
        const bbox = param.locate.bbox || param.locate.bbox_2d;
        input(page, { bbox: bbox, value: param.value });
      }
      break;

    case 'Scroll':
      const direction = param?.direction || 'down';
      scroll(page, { direction });

    case 'Sleep':
      sleep(page, { timeMs: param.timeMs });
      break;
  }
}
