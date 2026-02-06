import { AssistantContent, ModelMessage, UserContent } from "ai";
import { SubGoal } from "./type";

export class ConversationHistory {
  private subGoals: SubGoal[] = [];
  private memories: string[] = [];
  // We store raw messages compatible with Vercel AI SDK
  public messages: ModelMessage[] = [];

  constructor(systemPrompt: string) {
    this.messages.push({ role: 'system', content: systemPrompt });
  }

  appendUser(content: UserContent) {
    this.messages.push({ role: 'user', content });
  }

  appendAssistant(content: AssistantContent) {
    this.messages.push({ role: 'assistant', content });
  }

  // Sub-goal Logic
  setSubGoals(newGoals: SubGoal[]) {
    this.subGoals = newGoals.map((goal) => ({...goal}));
    this.markFirstPendingAsRunning();
  }


  /**
   * Update a single sub-goal by index
   * @returns true if the sub-goal was found and updated, false otherwise
   */
  updateSubGoal(
    index: number,
    updates: Partial<Omit<SubGoal, 'index'>>,
  ): boolean {
    const goal = this.subGoals.find((g) => g.index === index);
    if (!goal) {
      return false;
    }

    if (updates.status !== undefined) {
      goal.status = updates.status;
    }
    if (updates.description !== undefined) {
      goal.description = updates.description;
    }

    return true;
  }

  snapshot(): ModelMessage[] {
    const clonedMessages = structuredClone(this.messages);
    return clonedMessages;
  }

  get length(): number {
    return this.messages.length;
  }

  [Symbol.iterator](): IterableIterator<ModelMessage> {
    return this.messages[Symbol.iterator]();
  }

  toJSON(): ModelMessage[] {
    return this.snapshot();
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


  /**
   * Compress the conversation history if it exceeds the threshold.
   * Removes the oldest messages and replaces them with a single placeholder message.
   * @param threshold - The number of messages that triggers compression.
   * @param keepCount - The number of recent messages to keep after compression.
   * @returns true if compression was performed, false otherwise.
   */
  compressHistory(threshold: number, keepCount: number): boolean {
    if (this.messages.length <= threshold) {
      return false;
    }

    const omittedCount = this.messages.length - keepCount;
    const omittedPlaceholder: ModelMessage = {
      role: 'user',
      content: `(${omittedCount} previous conversation messages have been omitted)`,
    };

    // Keep only the last `keepCount` messages
    const recentMessages = this.messages.slice(-keepCount);

    // Reset and rebuild with placeholder + recent messages
    this.messages.length = 0;
    this.messages.push(omittedPlaceholder);
    for (const msg of recentMessages) {
      this.messages.push(msg);
    }

    return true;
  }
}
