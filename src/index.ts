
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import puppeteer, { Browser, Page } from 'puppeteer';
import * as dotenv from 'dotenv';
import { getSystemPrompt } from './prompt';
import sharp from 'sharp';

dotenv.config({path: '.env'});

console.log(process.env.AI_API_KEY)

const OPENROUTER_API_KEY = process.env.AI_API_KEY;

const openrouter = createOpenRouter({
  apiKey: OPENROUTER_API_KEY,
});

// --- Types & Interfaces ---

export interface SubGoal {
  index: number;
  description: string;
  status: 'pending' | 'running' | 'finished';
}

interface AIAction {
  type: string;
  param?: any;
  thought?: string;
  log?: string;
  error?: string;
  finalizeMessage?: string;
  finalizeSuccess?: boolean;

  // DeepThink / SubGoal related
  updateSubGoals?: SubGoal[];
  markFinishedIndexes?: number[];
  memory?: string;
}

// --- Helper Functions for XML Parsing ---

function extractXMLTag(xmlString: string, tagName: string): string | undefined {
  const lowerXmlString = xmlString.toLowerCase();
  const lowerTagName = tagName.toLowerCase();
  const closeTag = `</${lowerTagName}>`;
  const openTag = `<${lowerTagName}>`;

  const lastCloseIndex = lowerXmlString.lastIndexOf(closeTag);
  if (lastCloseIndex === -1) return undefined;

  const searchArea = lowerXmlString.substring(0, lastCloseIndex);
  const lastOpenIndex = searchArea.lastIndexOf(openTag);
  if (lastOpenIndex === -1) return undefined;

  const contentStart = lastOpenIndex + openTag.length;
  const contentEnd = lastCloseIndex;
  return xmlString.substring(contentStart, contentEnd).trim();
}

function safeParseJson(jsonStr: string) {
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    return undefined;
  }
}

function parseSubGoalsFromXML(xmlContent: string): SubGoal[] {
  const subGoals: SubGoal[] = [];
  const regex = /<sub-goal\s+index="(\d+)"\s+status="(pending|finished)"(?:\s*\/>|>([\s\S]*?)<\/sub-goal>)/gi;
  let match: RegExpExecArray | null;

  // Note: Since we are matching global, we need to reset lastIndex if reusing regex, or just loop
  while ((match = regex.exec(xmlContent)) !== null) {
      const index = parseInt(match[1], 10);
      const status = match[2] as 'pending' | 'finished';
      const description = match[3]?.trim() || '';
      // Default to running if it's the first pending? Core logic handles "pending -> running".
      // Here we just parse what the AI gave.
      subGoals.push({ index, status, description });
  }
  return subGoals;
}

function parseMarkFinishedIndexes(xmlContent: string): number[] {
  const indexes: number[] = [];
  const regex = /<sub-goal\s+index="(\d+)"\s+status="finished"\s*\/>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xmlContent)) !== null) {
    indexes.push(parseInt(match[1], 10));
  }
  return indexes;
}

function parseXMLPlanningResponse(xmlString: string): AIAction {
  const thought = extractXMLTag(xmlString, 'thought');
  const log = extractXMLTag(xmlString, 'log');
  const error = extractXMLTag(xmlString, 'error');
  const actionType = extractXMLTag(xmlString, 'action-type');
  const actionParamStr = extractXMLTag(xmlString, 'action-param-json');

  const completeGoalRegex = /<complete-goal\s+success="(true|false)">([\s\S]*?)<\/complete-goal>/i;
  const completeGoalMatch = xmlString.match(completeGoalRegex);

  let finalizeMessage: string | undefined;
  let finalizeSuccess: boolean | undefined;

  if (completeGoalMatch) {
    finalizeSuccess = completeGoalMatch[1] === 'true';
    finalizeMessage = completeGoalMatch[2]?.trim();
  }

  // Parse Sub-goal related tags
  const updatePlanContent = extractXMLTag(xmlString, 'update-plan-content');
  const markSubGoalDone = extractXMLTag(xmlString, 'mark-sub-goal-done');
  const memory = extractXMLTag(xmlString, 'memory');

  const updateSubGoals = updatePlanContent ? parseSubGoalsFromXML(updatePlanContent) : undefined;
  const markFinishedIndexes = markSubGoalDone ? parseMarkFinishedIndexes(markSubGoalDone) : undefined;

  let action: any = null;
  // If we have an explicit action type provided by the model
  if (actionType && actionType.toLowerCase() !== 'null') {
    const type = actionType.trim();
    let param: any = undefined;
    if (actionParamStr) {
       param = safeParseJson(actionParamStr);
    }
    action = { type, param };
  }

  return {
    thought,
    log,
    error,
    ...(action ? { type: action.type, param: action.param } : { type: 'null' }),
    finalizeMessage,
    finalizeSuccess,
    updateSubGoals,
    markFinishedIndexes,
    memory
  };
}


// --- Conversation History Class ---

class ConversationHistory {
    private subGoals: SubGoal[] = [];
    private memories: string[] = [];
    // We store raw messages compatible with Vercel AI SDK
    public messages: any[] = [];

    constructor(systemPrompt: string) {
        this.messages.push({ role: 'system', content: systemPrompt });
    }

    appendUser(content: any[]) {
         this.messages.push({ role: 'user', content });
    }

    appendAssistant(content: string) {
         this.messages.push({ role: 'assistant', content });
    }

    // Sub-goal Logic
    setSubGoals(newGoals: SubGoal[]) {
        this.subGoals = newGoals;
        this.markFirstPendingAsRunning();
    }

    markSubGoalsFinished(indexes: number[]) {
        indexes.forEach(idx => {
            const goal = this.subGoals.find(g => g.index === idx);
            if (goal) goal.status = 'finished';
        });
        this.markFirstPendingAsRunning();
    }

    markAllFinished() {
        this.subGoals.forEach(g => g.status = 'finished');
    }

    markFirstPendingAsRunning() {
        // If there is no currently running task, find the first pending and mark it running
        const running = this.subGoals.find(g => g.status === 'running');
        if (!running) {
             const firstPending = this.subGoals.find(g => g.status === 'pending');
             if (firstPending) firstPending.status = 'running';
        }
    }

    subGoalsToText(): string {
        if (this.subGoals.length === 0) return '';
        const lines = this.subGoals.map(g => `${g.index}. ${g.description} (${g.status})`);
        const current = this.subGoals.find(g => g.status === 'running');
        const currentText = current ? `\nCurrent sub-goal is: ${current.description}` : '';
        return `Sub-goals:\n${lines.join('\n')}${currentText}`;
    }

    // Memory Logic
    appendMemory(mem: string) {
        if (mem) this.memories.push(mem);
    }

    memoriesToText(): string {
        if (this.memories.length === 0) return '';
        return `Memories from previous steps:\n---\n${this.memories.join('\n---\n')}\n`;
    }
}


// --- Agent Implementation ---

export class SimpleAgent {
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor() {}

  async init() {
    this.browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });
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
    const history = new ConversationHistory(getSystemPrompt({
      includeSubGoals: deepThink,
      includeThought: true
    }));

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
         if (!lastMsg.content.find((c: any) => c.type === 'image')) {
             lastMsg.content.push({ type: 'image', image: screenshotBase64 });
         }
      }

      console.time("Plan");
      // 2. Think (Plan)
      const { text: rawResponse } = await generateText({
        model: openrouter('google/gemini-3-flash-preview'),
        messages: history.messages as any,
      });
      console.timeEnd("Plan");

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

// Demo Run
if (require.main === module) {
  (async () => {
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('Please set OPENROUTER_API_KEY in .env file');
      process.exit(1);
    }

    const agent = new SimpleAgent();
    await agent.init();

    try {
      await agent.aiAct('去小红书网页，查看今天的热门帖子, 然后点开前4个看看', { deepThink: true });
    } catch(e) {
      console.error(e);
    } finally {
      await new Promise(r => setTimeout(r, 5000));
      await agent.close();
    }
  })();
}
