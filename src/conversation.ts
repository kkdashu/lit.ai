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
