# Project Features Overview

`sample-midscene` is a reference implementation of a pure-vision AI agent capable of complex UI interactions. Below are the key features and architectural decisions.

## 1. DeepThink Agent (`aiAct`)
The core agent logic supports a "DeepThink" mode that enables long-horizon planning and reasoning.

- **Chain of Thought**: The agent outputs a `<thought>` block before every action to reason about the current state.
- **Sub-Goal Decomposition**:
    - Breaks down complex user instructions into smaller, manageable sub-goals (e.g., "Open Google" -> "Type query" -> "Click result").
    - Tracks status (`pending`, `running`, `finished`) via `<update-plan-content>` tags.
- **Memory System**:
    - Persists critical information across steps using `<memory>` tags (e.g., "The price of the item is $50").
    - Injects memory context into subsequent prompts.

## 2. Visual Grounding & Coordinate Alignment
Ensures pixel-perfect interaction on any display.

- **Logical Viewport Enforcement**:
    - Captures screenshots at device resolution.
    - **Resizes** images to match the logical browser viewport (`window.innerWidth/Height`) using `sharp`.
    - Eliminates issues with High-DPI (Retina) displays where physical pixels != logical pixels.
- **Normalized Coordinates**:
    - Requests coordinates in a **0-1000 normalized range** (`[ymin, xmin, ymax, xmax]`) which maps to the native training of Gemini models.
    - **Denormalizes** these values to logical pixels at runtime for execution.

## 3. Robust Action Execution
Enhanced Puppeteer wrappers to handle real-world web complexity.

- **Reliable Typing (`Input`)**:
    - **Triple-Click Focus**: Clicks the input target 3 times to ensure focus and select existing text.
    - **Typing Delay**: Adds a 100ms delay between keystrokes to mimic human behavior and ensure JS event handlers register the input.
- **Robust Clicking (`Tap`)**:
    - **BBox Priority**: Prioritizes coordinate-based clicking (Vision) over text-based matching.
    - **Text Fallback**: If using text locators, implements robust XPath escaping to handle quotes and special characters without crashing.

## 4. Prompt Engineering
Dynamic system prompts located in `src/prompt.ts`.

- **Conditional Logic**: Adapts instructions based on whether `includeSubGoals` is enabled.
- **Strict Constraints**: Explicitly instructs the model *not* to hallucinate actions or use text locators when coordinate data is available.

## Usage

```typescript
// Standard Execution
await agent.aiAct('Open Google');

// DeepThink Mode (Planning + Memory)
await agent.aiAct('Research 3 different coffee machine models and compare prices', { 
  deepThink: true 
});
```
