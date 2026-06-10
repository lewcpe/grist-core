import { GristDoc } from "app/client/components/GristDoc";
import { AgenticLog, ChatHistory } from "app/client/models/ChatHistory";
import { IAssistantPopup } from "app/client/ui/IAssistantPopup";
import {
  cssLinkText,
  cssPageButton,
  cssPageEntry,
  cssPageIcon,
} from "app/client/ui/LeftPanelCommon";
import { primaryButton, textButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { Assistant, cssAiImage, cssAiMessage, cssAvatar } from "app/client/widgets/Assistant";
import { AssistantState } from "app/common/ActiveDocAPI";
import { getGristConfig } from "app/common/urlUtils";

import { Disposable, dom, DomElementArg, makeTestId, Observable, styled } from "grainjs";

const testId = makeTestId("test-assistant-popup-");

export class AssistantPopup extends Disposable implements IAssistantPopup {
  private _gristDoc: GristDoc;
  private _history = Observable.create<ChatHistory>(this, { messages: [] });
  private _isOpen = Observable.create(this, false);
  private _isMinimized = Observable.create(this, false);
  private _chat: Assistant;
  private _dom: HTMLElement | null = null;
  private _fabDom: HTMLElement | null = null;
  private _showSettings = Observable.create(this, false);

  // Inputs for Settings
  private _apiKeyInput = Observable.create(this, localStorage.getItem("grist_assistant_api_key") || "");
  private _baseUrlInput = Observable.create(this, localStorage.getItem("grist_assistant_base_url") || "");
  private _modelInput = Observable.create(this, localStorage.getItem("grist_assistant_model") || "");

  constructor(gristDoc: GristDoc) {
    super();
    this._gristDoc = gristDoc;

    const storageKey = `grist_assistant_history_${gristDoc.docId()}`;
    const saved = localStorage.getItem(storageKey);
    let initialHistory: ChatHistory = { messages: [] };
    if (saved) {
      try {
        initialHistory = JSON.parse(saved);
      } catch (e) {
        // ignore parsing errors
      }
    }
    this._history.set(initialHistory);

    this.autoDispose(this._history.addListener((history) => {
      localStorage.setItem(storageKey, JSON.stringify(history));
    }));

    this._chat = Assistant.create(this, {
      history: this._history,
      gristDoc: this._gristDoc,
      onSend: this._sendMessage.bind(this),
      buildIntroMessage: this._buildIntroMessage.bind(this),
      onEscape: () => this._isOpen.set(false),
    });

    this._dom = this._buildDom();
    this._fabDom = this._buildFab();
    document.body.appendChild(this._dom);
    document.body.appendChild(this._fabDom);

    this.onDispose(() => {
      this._dom?.parentNode?.removeChild(this._dom);
      this._fabDom?.parentNode?.removeChild(this._fabDom);
    });
  }

  public open() {
    this._isOpen.set(true);
    this._isMinimized.set(false);
    setTimeout(() => this._chat.focus(), 50);
  }

  public setState(state: AssistantState) {
    const prompt = state.prompt;
    if (prompt) {
      this._isOpen.set(true);
      this._isMinimized.set(false);
      this._chat.send(prompt).catch(reportError);
    }
  }

  private _minimize() {
    this._isMinimized.set(true);
  }

  private _restore() {
    this._isMinimized.set(false);
    setTimeout(() => this._chat.focus(), 50);
  }

  private _buildDom() {
    return cssPopupContainer(
      dom.show(use => use(this._isOpen) && !use(this._isMinimized)),
      testId("container"),
      cssPopupHeader(
        cssHeaderTitle(
          cssHeaderIcon("Sparks"),
          "Grist AI Assistant",
        ),
        cssHeaderButtons(
          cssClearButton(
            icon("Remove"),
            dom.on("click", () => this._clearHistory()),
            dom.show(use => use(this._history).messages.length > 0),
            testId("clear-history"),
            dom.attr("title", "Clear Chat History"),
          ),
          cssSettingsButton(
            icon("Settings"),
            dom.on("click", () => this._showSettings.set(!this._showSettings.get())),
            testId("settings-toggle"),
          ),
          cssMinimizeButton(
            icon("Minimize"),
            dom.on("click", () => this._minimize()),
            testId("minimize"),
            dom.attr("title", "Minimize"),
          ),
          cssCloseButton(
            icon("CrossBig"),
            dom.on("click", () => this._isOpen.set(false)),
            testId("close"),
          ),
        ),
      ),
      cssPopupBodyContainer(
        cssPopupBody(
          dom.show(use => !use(this._showSettings)),
          this._chat.buildDom(),
        ),
        cssSettingsPanel(
          dom.show(this._showSettings),
          cssSettingsTitle("AI Assistant Configuration"),
          cssFormGroup(
            cssLabel("OpenAI API Key"),
            cssInput({ type: "password", placeholder: "sk-..." },
              dom.on("change", (e: any) => this._apiKeyInput.set(e.target.value)),
              dom.prop("value", this._apiKeyInput),
              testId("api-key-input"),
            ),
          ),
          cssFormGroup(
            cssLabel("API Base URL (optional)"),
            cssInput({ type: "text", placeholder: "https://api.openai.com/v1" },
              dom.on("change", (e: any) => this._baseUrlInput.set(e.target.value)),
              dom.prop("value", this._baseUrlInput),
              testId("base-url-input"),
            ),
          ),
          cssFormGroup(
            cssLabel("Model"),
            cssInput({ type: "text", placeholder: "gpt-4o" },
              dom.on("change", (e: any) => this._modelInput.set(e.target.value)),
              dom.prop("value", this._modelInput),
              testId("model-input"),
            ),
          ),
          cssSettingsActions(
            primaryButton("Save Settings", dom.on("click", () => this._saveSettings()), testId("save-settings")),
            textButton("Cancel", dom.on("click", () => this._showSettings.set(false))),
          ),
        ),
      ),
    );
  }

  private _saveSettings() {
    localStorage.setItem("grist_assistant_api_key", this._apiKeyInput.get());
    localStorage.setItem("grist_assistant_base_url", this._baseUrlInput.get());
    localStorage.setItem("grist_assistant_model", this._modelInput.get());
    this._showSettings.set(false);
  }

  private _clearHistory() {
    this._chat.clear();
    const storageKey = `grist_assistant_history_${this._gristDoc.docId()}`;
    localStorage.removeItem(storageKey);
  }

  private _buildFab() {
    return cssFab(
      dom.show(use => use(this._isOpen) && use(this._isMinimized)),
      dom.on("click", () => this._restore()),
      cssFabIcon("Sparks"),
      cssFabBadge(
        dom.show(use => {
          const msgs = use(this._history).messages;
          return msgs.length > 0 && msgs[msgs.length - 1]?.sender === "ai";
        }),
      ),
      testId("fab"),
      dom.attr("title", "Restore AI Assistant"),
    );
  }

  private async _sendMessage(message: string) {
    const model = this._modelInput.get() || undefined;
    const baseUrl = this._baseUrlInput.get() || undefined;
    const apiKey = this._apiKeyInput.get() || undefined;

    const params = {
      conversationId: this._chat.conversationId,
      context: {},
      text: message,
      state: this._history.get().state,
      model,
      baseUrl,
      apiKey,
    } as any;

    // Try streaming first
    try {
      const docApi = this._gristDoc.docApi;
      const stream = docApi.getAssistanceStream(params);
      let fullReply = "";
      const agenticLogs: AgenticLog[] = [];
      let finalState: any = undefined;

      // Start a streaming message in the UI
      this._chat.startStreamingMessage();

      for await (const event of stream) {
        if (event.type === "text") {
          fullReply += event.content;
          this._chat.updateStreamingMessage(event.content);
        } else if (event.type === "tool_start") {
          agenticLogs.push({
            toolName: event.name,
            arguments: event.arguments,
            success: true,
          });
        } else if (event.type === "tool_end") {
          const log = agenticLogs.find(l => l.toolName === event.name && l.success === true && !l.details);
          if (log) {
            log.success = !event.result?.error;
            log.error = event.result?.error;
            log.details = event.result;
          }
        } else if (event.type === "done") {
          finalState = event.state;
        } else if (event.type === "error") {
          throw new Error(event.error);
        }
      }

      // Finalize the streaming message
      this._chat.finalizeStreamingMessage(agenticLogs.length > 0 ? agenticLogs : undefined);

      // Update history state
      if (finalState) {
        this._history.set({ ...this._history.get(), state: finalState });
      }

      // Return a fake response for compatibility
      return { reply: fullReply, state: finalState };
    } catch (e) {
      // If streaming fails, fall back to non-streaming
      console.warn("Streaming failed, falling back to non-streaming:", e);
      return await this._gristDoc.docComm.getAssistance(params);
    }
  }

  private _buildIntroMessage(...args: DomElementArg[]) {
    return cssAiIntroMessage(
      cssAvatar(cssAiImage()),
      dom("div",
        cssAiMessageParagraph("Hi, I'm the Grist AI Assistant."),
        cssAiMessageParagraph(
          "I can help you build tables, format/style columns, " +
          "write access rules, modify document data, and more!",
        ),
        cssAiMessageParagraph("Try asking me to:"),
        dom("ul", { style: "padding-left: 20px; margin: 8px 0; font-size: 13px; line-height: 1.5;" },
          dom("li", "Create a table called Tasks with columns Title, Due_Date, and Done"),
          dom("li", "Add some mock tasks about planning a party"),
          dom("li", "Style the column Due_Date to have background color green"),
          dom("li", "Explain the current access rules"),
        ),
      ),
      ...args,
    );
  }
}

export function buildAssistantPopup(gristDoc: GristDoc): IAssistantPopup | null {
  if (!getGristConfig().assistant) {
    return null;
  }
  return new AssistantPopup(gristDoc);
}

export function buildOpenAssistantButton(
  gristDoc: GristDoc,
  ...args: DomElementArg[]
) {
  if (!getGristConfig().assistant) {
    return null;
  }
  return cssPageEntry(
    cssPageButton(
      cssPageIcon("Sparks"),
      cssLinkText("AI Assistant"),
      dom.on("click", () => {
        (gristDoc as any).openAssistantPopup();
      }),
    ),
    ...args,
  );
}

const cssPopupContainer = styled("div", `
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 400px;
  height: 600px;
  background-color: ${theme.pageBg};
  border: 1px solid ${theme.controlBorder};
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  overflow: hidden;
  font-family: ${vars.fontFamily};
`);

const cssPopupHeader = styled("div", `
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background-color: ${theme.leftPanelBg};
  border-bottom: 1px solid ${theme.controlBorder};
`);

const cssHeaderTitle = styled("div", `
  display: flex;
  align-items: center;
  font-weight: 600;
  color: ${theme.text};
  font-size: 14px;
`);

const cssHeaderIcon = styled(icon, `
  margin-right: 8px;
  background-color: ${theme.accentIcon};
  width: 16px;
  height: 16px;
`);

const cssHeaderButtons = styled("div", `
  display: flex;
  gap: 8px;
`);

const cssSettingsButton = styled("button", `
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: ${theme.controlFg};
  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssCloseButton = styled(cssSettingsButton, `
`);

const cssMinimizeButton = styled(cssSettingsButton, `
`);

const cssClearButton = styled(cssSettingsButton, `
`);

const cssPopupBodyContainer = styled("div", `
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  overflow: hidden;
  position: relative;
`);

const cssPopupBody = styled("div", `
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  overflow: hidden;
`);

const cssSettingsPanel = styled("div", `
  display: flex;
  flex-direction: column;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 24px;
  background-color: ${theme.pageBg};
  gap: 16px;
  overflow-y: auto;
  z-index: 10;
`);

const cssSettingsTitle = styled("div", `
  font-size: 16px;
  font-weight: 600;
  color: ${theme.text};
  margin-bottom: 8px;
`);

const cssFormGroup = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
`);

const cssLabel = styled("label", `
  font-size: 12px;
  font-weight: 500;
  color: ${theme.mediumText};
`);

const cssInput = styled("input", `
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid ${theme.controlBorder};
  background-color: ${theme.inputBg};
  color: ${theme.inputFg};
  font-size: 13px;
  &:focus {
    border-color: ${theme.controlPrimaryBg};
    outline: none;
  }
`);

const cssSettingsActions = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
`);

const cssAiIntroMessage = styled(cssAiMessage, `
  border-top: unset;
`);

const cssAiMessageParagraph = styled("div", `
  margin-bottom: 8px;
`);

const cssFab = styled("div", `
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background-color: ${theme.controlPrimaryBg};
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  transition: transform 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  }

  &:active {
    transform: scale(0.95);
  }
`);

const cssFabIcon = styled(icon, `
  width: 28px;
  height: 28px;
  --icon-color: white;
`);

const cssFabBadge = styled("div", `
  position: absolute;
  top: -2px;
  right: -2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background-color: #2bab6e;
  border: 2px solid ${theme.pageBg};
`);
