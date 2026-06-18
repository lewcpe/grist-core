# Adding an LLM-Powered Chat Box to Grist

## Objective
The goal is to implement a side chat panel in Grist that allows users to interact with a Large Language Model (LLM). This LLM will have the capability to control and configure spreadsheets, forms, and other document settings.

## Current State of AI Features
Currently, AI integration in Grist exists in two main forms:
1.  **Formula Assistant (`FormulaAssistant.ts`)**: An extension of the formula editor that uses AI to suggest and write formulas. It uses an internal `Assistant` widget to provide a chat-like interface specifically scoped to formula editing.
2.  **Assistant Pop-ups (`AssistantPopup.ts` in Enterprise/SaaS)**: There are stubs for `buildAssistantPopup` and `buildOpenAssistantButton` in the core repository (`stubs/app/client/widgets/AssistantPopup.ts`). These suggest an upcoming or Enterprise-specific general assistant interface, but they are not fully implemented in the open-source version currently.

The core chat interface widget itself is defined in `app/client/widgets/Assistant.ts`, which maintains conversation history, renders messages (using Markdown via marked), and handles basic inputs.

## Side Panel Architecture
Grist's UI supports a "Right Panel" mechanism for various tools.
*   **`RightPanelTool` (in `GristDoc.ts`)**: This is a string union type that dictates what is displayed in the auxiliary right panel. Currently, it supports `"none"`, `"docHistory"`, `"validations"`, and `"discussion"`.
*   **`showTool(tool)`**: A method on `GristDoc` used to open a specific tool in the right panel.
*   **`_getToolContent`**: A method in `GristDoc` that maps the `RightPanelTool` string to actual panel content (e.g., `"discussion"` maps to `DiscussionPanel`).
*   **`DiscussionPanel`**: A good reference implementation for a chat-like side panel. It uses `DiscussionEditor.ts` and renders within the right panel space.

## Technical Implementation Plan

To add a general AI chat box to the side of Grist, the most idiomatic approach is to create a new `RightPanelTool`.

### 1. Extend `RightPanelTool`
Update the `RightPanelTool` definition in `app/client/components/GristDoc.ts` to include `"assistant"`:
```typescript
const RightPanelTool = StringUnion("none", "docHistory", "validations", "discussion", "assistant");
```

### 2. Create the `AssistantPanel` Widget
Create a new file, e.g., `app/client/widgets/AssistantPanel.ts` (or reuse/extend the existing `AssistantPopup` concepts).
This panel should:
*   Instantiate the existing `Assistant` chat widget (from `app/client/widgets/Assistant.ts`).
*   Manage a broader context than the `FormulaAssistant`. It needs access to `GristDoc` methods to read schema, view data, and apply actions.

### 3. Wire into `GristDoc`
Update `_getToolContent` in `app/client/components/GristDoc.ts` to render the new panel:
```typescript
private _getToolContent(tool: typeof RightPanelTool.type): IExtraTool | null {
  switch (tool) {
    // ... existing tools ...
    case "assistant": {
      return { icon: "Chat", label: "AI Assistant", content: this._assistantPanel };
    }
  }
}
```
*Note: Ensure `this._assistantPanel` is initialized in `GristDoc`.*

### 4. UI Triggers
Add a button or command to trigger `gristDoc.showTool("assistant")`.
*   A logical place is the left panel tools menu (`app/client/ui/Tools.ts`), where a button like `buildOpenAssistantButton` is already stubbed.
*   Add a command in `app/client/components/commandList.ts` (like `"openAssistantPanel"`) to allow opening it via keyboard shortcuts.

### 5. Backend LLM Integration for Document Control
To allow the LLM to control the spreadsheet and forms, the backend `IAssistant` interface (and `OpenAIAssistantV1` implementation) will need to be extended.
*   The LLM needs "tools" or "functions" it can call.
*   These tools must map to `DocActions` (e.g., `AddTable`, `AddColumn`, `UpdateRecord`, `CreateViewSection`).
*   When the user types a prompt into the `AssistantPanel`, the prompt is sent to the backend. The LLM determines if an action is needed, returns a function call, and the backend/frontend executes the corresponding `DocAction`.

## Summary
By leveraging the existing `RightPanelTool` infrastructure and the `Assistant` chat widget, we can seamlessly integrate a general-purpose AI chat box into the Grist UI. The critical next step after UI integration will be bridging the LLM's outputs to Grist's internal `DocAction` system.
