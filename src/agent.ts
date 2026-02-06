import { generateText } from 'ai';
import { getSystemPrompt } from './prompt';
import { chromium, Browser, Page } from 'playwright';
import { ConversationHistory } from './conversation';
import { parseXMLPlanningResponse } from './utils';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { screenshot } from './device';
import { executeAction } from './action';


const OPENROUTER_API_KEY = process.env.AI_API_KEY;

const openrouter = createOpenRouter({
  apiKey: OPENROUTER_API_KEY,
});

export class SimpleAgent {
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor() { }

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

  async ai(instruction: string, options?: { maxSteps?: number, deepThink?: boolean }) {
    const maxSteps = options?.maxSteps ?? 15;
    const deepThink = options?.deepThink ?? true;

    if (!this.page) throw new Error('Agent not initialized');

    console.log(`🎯 Goal: ${instruction}`);
    let steps = 0;

    const systemPrompt = getSystemPrompt();
    console.log(systemPrompt);
    // Initialize History
    const history = new ConversationHistory(systemPrompt);

    // Initial User Message
    history.appendUser([{
      type: 'text',
      text: `<user_instruction>${instruction}</user_instruction>`
    }]);

    while (steps < maxSteps) {
      steps++;
      console.log(`\n--- Step ${steps} ---`);

      console.time("Observe");
      const screenshotBase64 = await screenshot(this.page);
      console.timeEnd("Observe");

      // Update the LAST user message with the screenshot and context (Memories/SubGoals)
      const lastMsg = history.messages[history.messages.length - 1];
      if (lastMsg.role === 'user') {
        // Add screenshot if missing
        if (Array.isArray(lastMsg.content)) {
          if (!lastMsg.content.find((c: any) => c.type === 'image')) {
            lastMsg.content.push({ type: 'image', image: screenshotBase64 });
          }
        }
      }

      // console.log(JSON.stringify(history.toJSON()));

      console.time("Plan");
      // 2. Think (Plan)
      const res = await generateText({
        model: openrouter('google/gemini-3-flash-preview'),
        messages: history.messages,
      });
      console.timeEnd("Plan");

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
          await executeAction(this.page, plan);

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
}
