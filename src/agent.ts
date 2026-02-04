import { generateText } from 'ai';
import { getSystemPrompt } from './prompt';
import sharp from 'sharp';
import {chromium, Browser, Page} from 'playwright';
import { ConversationHistory } from './conversation';
import { parseXMLPlanningResponse } from './utils';
import { AIAction } from './type';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';


const OPENROUTER_API_KEY = process.env.AI_API_KEY;

const openrouter = createOpenRouter({
  apiKey: OPENROUTER_API_KEY,
});

export class SimpleAgent {
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor() {}

  async init() {
    this.browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.page = await this.browser.newPage();
    await this.page.setViewportSize({ width: 1280, height: 800 });
  }

  async close() {
    if (this.browser) await this.browser.close();
  }

  async aiAct(instruction: string, options?: { maxSteps?: number, deepThink?: boolean }) {
    const maxSteps = options?.maxSteps ?? 15;
    const deepThink = options?.deepThink ?? true;

    if (!this.page) throw new Error('Agent not initialized');

    console.log(`🎯 Goal: ${instruction}`);
    let steps = 0;

    // Initialize History
    const history = new ConversationHistory(getSystemPrompt());

    // Initial User Message
    history.appendUser([{
        type: 'text',
        text: `<user_instruction>${instruction}</user_instruction>`
    }]);

    while (steps < maxSteps) {
      steps++;
      console.log(`\n--- Step ${steps} ---`);

      console.time("Observe");
      // 1. Observe
      const { width, height, dpr } = await this.page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      }));


      // Get screenshot buffer (binary)
      const screenshotBuffer = await this.page.screenshot({ type: 'jpeg', quality: 90 });

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

      console.timeEnd("Observe");

      // Update the LAST user message with the screenshot and context (Memories/SubGoals)
      const lastMsg = history.messages[history.messages.length - 1];
      if (lastMsg.role === 'user') {
         // Add screenshot if missing
         if (Array.isArray(lastMsg.content)) {
           if (!lastMsg.content.find((c: any) => c.type === 'image')) {
               lastMsg.content.push({ type: 'image', image: screenshotBase64 });
           }
         } else {
         }
      }

      console.time("Plan");
      // 2. Think (Plan)
      const res = await generateText({
        model: openrouter('google/gemini-3-flash-preview', {extraBody: {reasoning: {max_tokens: 20}}}),
        messages: history.messages,
      });
      console.timeEnd("Plan");

      console.log('thinking: ', res.reasoningText, res.rawFinishReason, res.finishReason, res.reasoning);

      const rawResponse = res.text;

      console.log('rawResponse', rawResponse);

      const plan = parseXMLPlanningResponse(rawResponse);
      if (plan.log) console.log(`📝 Log: ${plan.log}`);

      // Handle DeepThink Updates from Response
      if (deepThink) {
          if (plan.updateSubGoals && plan.updateSubGoals.length > 0) {
              history.setSubGoals(plan.updateSubGoals);
              console.log('📌 Plan Updated');
          }
          if (plan.markFinishedIndexes && plan.markFinishedIndexes.length > 0) {
              history.markSubGoalsFinished(plan.markFinishedIndexes);
              console.log(`✅ Sub-goals finished: ${plan.markFinishedIndexes.join(', ')}`);
          }
          if (plan.memory) {
              history.appendMemory(plan.memory);
              console.log(`🧠 Memory Added: ${plan.memory}`);
          }
      }

      // Record Assistant Response
      history.appendAssistant(rawResponse);

      // 3. Act / Complete
      if (plan.finalizeSuccess !== undefined) {
        console.log(`✅ Task Completed: ${plan.finalizeSuccess} - ${plan.finalizeMessage}`);
        if (deepThink) history.markAllFinished(); // nice to have
        break;
      }

      if (plan.type && plan.type !== 'null') {
         console.log(`⚡ Action: ${plan.type} ${JSON.stringify(plan.param)}`);
         try {
           await this.executeAction(plan);

           // 4. Prepare Next User Message
           const contextText = deepThink
             ? `\n\n${history.memoriesToText()}${history.subGoalsToText()}`
             : '';

           history.appendUser([
               {
                 type: 'text',
                 text: `The previous action has been executed, here is the latest screenshot. Please continue according to the instruction.${contextText}`
               }
           ]);

         } catch (e: any) {
           console.error(`❌ Action Failed: ${e.message}`);
           history.appendUser([
               { type: 'text', text: `Action ${plan.type} failed. Error: ${e.message}. Please try a different approach or fix the params.` }
           ]);
         }
      } else {
        // No action
        const contextText = deepThink
             ? `\n\n${history.memoriesToText()}${history.subGoalsToText()}`
             : '';

        if (plan.error) {
           console.error(`❌ Agent Error: ${plan.error}`);
           history.appendUser([
               { type: 'text', text: `You reported an error: ${plan.error}. Please try to recover.${contextText}` }
           ]);
        } else {
           console.warn("⚠️ No action parsed.");
           history.appendUser([
               { type: 'text', text: `Please continue.${contextText}` }
           ]);
        }
      }

      await new Promise(r => setTimeout(r, 1000));
    }
  }

  private async executeAction(plan: AIAction) {
    if (!this.page) return;
    const { type, param } = plan;

    switch (type) {
      case 'Launch':
        if (param?.url) await this.page.goto(param.url);
        break;

      case 'Tap':
      case 'Click':
        if (param?.locate?.bbox || param?.locate?.bbox_2d) {
           // Gemini uses [ymin, xmin, ymax, xmax] normalized to 1000
           const [ymin, xmin, ymax, xmax] = param.locate.bbox || param.locate.bbox_2d;

           // Denormalize
           const { width, height } = await this.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
           const x = ((xmin + xmax) / 2 / 1000) * width;
           const y = ((ymin + ymax) / 2 / 1000) * height;

           console.log(`   Clicking at coordinates: (${x}, ${y})`);
           await this.page.mouse.click(x, y);
        } else {
           console.warn(`   [ActionSkipped] Tap action missing bbox: ${JSON.stringify(param)}`);
        }
        break;

      case 'Input':
      case 'Type':
        if (param?.locate?.bbox || param?.locate?.bbox_2d) {
            // Gemini uses [ymin, xmin, ymax, xmax] normalized to 1000
            const [ymin, xmin, ymax, xmax] = param.locate.bbox || param.locate.bbox_2d;

            // Denormalize
            const { width, height } = await this.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
            const x = ((xmin + xmax) / 2 / 1000) * width;
            const y = ((ymin + ymax) / 2 / 1000) * height;

            console.log(`   Focusing input at: (${x}, ${y})`);
            // Click 3 times to ensure focus and select all existing text
            await this.page.mouse.click(x, y, { clickCount: 3 });
            // Small delay to ensure focus
            await new Promise(r => setTimeout(r, 500));
        }
        if (param?.value) {
            await this.page.keyboard.type(param.value, { delay: 100 });
        }
        break;

      case 'Scroll':
        const direction = param?.direction || 'down';
        const scrollAmount = 500;
        if (direction === 'down') await this.page.evaluate((y) => window.scrollBy(0, y), scrollAmount);
        else if (direction === 'up') await this.page.evaluate((y) => window.scrollBy(0, -y), scrollAmount);
        break;

      case 'Sleep':
        if (param?.timeMs) await new Promise(r => setTimeout(r, param.timeMs));
        break;
    }
  }
}
