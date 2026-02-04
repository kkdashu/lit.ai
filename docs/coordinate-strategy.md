# Coordinate Alignment Strategy

This document details how `sample-midscene` ensures accurate UI interactions (clicks, inputs) by aligning the AI's visual understanding with Puppeteer's execution context.

## The Problem

Accurate element location is challenging due to two main factors:
1.  **High-DPI Displays (DPR > 1)**: Screenshots are often captured in physical pixels (e.g., 2560x1600), while Puppeteer expects logical pixels (e.g., 1280x800).
2.  **Model Normalization**: Models like Gemini often output coordinates normalized to a 0-1000 range, rather than absolute pixels or 0-1 floats.

If these are not handled, coordinates will be shifted (e.g., clicking 200px lower than intended), causing actions to fail.

## The Solution

We implement a **Strict Alignment Pipeline** involving three key steps:

### 1. Unified Visual Context (Screenshot Resizing)

We strictly force the visual context passed to the AI to match the logical viewport dimensions of the browser.

*   **Logic**: `src/index.ts`
*   **Mechanism**:
    1.  Capture the logical viewport size (`width`, `height`) via `window.innerWidth/Height`.
    2.  Capture the raw screenshot.
    3.  Check if the screenshot dimensions match the logical viewport.
    4.  If they differ (due to DPR or other factors), use `sharp` to **resize** the screenshot to the exact logical `width` x `height` with `{ fit: 'fill' }`.

This ensures that **1 pixel in the image = 1 logical pixel** for Puppeteer.

### 2. Normalized Coordinate Communication

We align with the AI model's native coordinate system to minimize hallucination.

*   **Prompt**: `src/prompt.ts`
*   **Mechanism**:
    *   We explicitly instruct the model to return coordinates in the **0-1000 normalized range** (`[ymin, xmin, ymax, xmax]`).
    *   **Why?**: Gemini models are often trained on 1000x1000 normalized grids. Forcing them to calculate specific pixel values (e.g., "356") increases math errors.

### 3. Precise Denormalization

We convert the AI's output back to precise logical coordinates for execution.

*   **Execution**: `src/index.ts`
*   **Formula**:
    ```typescript
    // Denormalize X (0-1000 -> 0-Width)
    const x = ((xmin + xmax) / 2 / 1000) * logicalWidth;
    
    // Denormalize Y (0-1000 -> 0-Height)
    const y = ((ymin + ymax) / 2 / 1000) * logicalHeight;
    ```

## Action Reliability

Beyond coordinates, we ensure action success with:

*   **Input Reliability**:
    *   **Triple Click**: `click({ clickCount: 3 })` ensures the input field is focused and existing text is selected.
    *   **Typing Delay**: `type(text, { delay: 100 })` ensures characters are registered by complex JavaScript handlers.
*   **Robust XPath Fallback**: If we must use text locators (fallback), we properly escape quotes to prevent syntax errors.

## Summary Flow

1.  **Browser**: Viewport 1280x800 (Logical).
2.  **Screenshot**: Captured at 2560x1600 (Physical) -> **Resized to 1280x800**.
3.  **AI Input**: Receives 1280x800 image.
4.  **AI Output**: Returns `bbox: [ymin: 300, xmin: 400...]` (Normalized 0-1000).
5.  **Execution**: Converts `300/1000 * 800` = `240` logical Y.
6.  **Puppeteer**: Clicks at `(x, 240)`.

Result: **Pixel-perfect accuracy.**
