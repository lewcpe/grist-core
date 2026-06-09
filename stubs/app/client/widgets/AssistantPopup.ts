import { GristDoc } from "app/client/components/GristDoc";
import { IAssistantPopup } from "app/client/ui/IAssistantPopup";
import { Assistant, cssAiImage, cssAiMessage, cssAvatar } from "app/client/widgets/Assistant";
import { ChatHistory } from "app/client/models/ChatHistory";
import { AssistantState } from "app/common/ActiveDocAPI";
import { getGristConfig } from "app/common/urlUtils";
import {
  cssPageEntry,
  cssPageButton,
  cssPageIcon,
  cssLinkText
} from "app/client/ui/LeftPanelCommon";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { primaryButton, textButton } from "app/client/ui2018/buttons";

import { Disposable, dom, DomElementArg, Observable, styled, makeTestId } from "grainjs";

const testId = makeTestId("test-assistant-popup-");

export class AssistantPopup extends Disposable implements IAssistantPopup {
  private _gristDoc: GristDoc;
  private _history = Observable.create<ChatHistory>(this, { messages: [] });
  private _isOpen = Observable.create(this, false);
  private _chat: Assistant;
  private _dom: HTMLElement | null = null;
  private _showSettings = Observable.create(this, false);

  // Inputs for Settings
  private _apiKeyInput = Observable.create(this, localStorage.getItem("grist_assistant_api_key") || "");
  private _baseUrlInput = Observable.create(this, localStorage.getItem("grist_assistant_base_url") || "");
  private _modelInput = Observable.create(this, localStorage.getItem("grist_assistant_model") || "");

  constructor(gristDoc: GristDoc) {
    super();
    this._gristDoc = gristDoc;
    this._chat = Assistant.create(this, {
      history: this._history,
      gristDoc: this._gristDoc,
      onSend: this._sendMessage.bind(this),
      buildIntroMessage: this._buildIntroMessage.bind(this),
      onEscape: () => this._isOpen.set(false)
    });

    this._dom = this._buildDom();
    document.body.appendChild(this._dom);

    this.onDispose(() => {
      if (this._dom && this._dom.parentNode) {
        this._dom.parentNode.removeChild(this._dom);
      }
    });
  }

  public open() {
    this._isOpen.set(true);
    setTimeout(() => this._chat.focus(), 50);
  }

  public setState(state: AssistantState) {
    const prompt = state.prompt;
    if (prompt) {
      this._isOpen.set(true);
      this._chat.send(prompt).catch(reportError);
    }
  }

  private _buildDom() {
    return cssPopupContainer(
      dom.show(this._isOpen),
      testId("container"),
      cssPopupHeader(
        cssHeaderTitle(
          cssHeaderIcon("Sparks"),
          "Grist AI Assistant"
        ),
        cssHeaderButtons(
          cssSettingsButton(
            icon("Settings"),
            dom.on("click", () => this._showSettings.set(!this._showSettings.get())),
            testId("settings-toggle")
          ),
          cssCloseButton(
            icon("CrossBig"),
            dom.on("click", () => this._isOpen.set(false)),
            testId("close")
          )
        )
      ),
      cssPopupBodyContainer(
        cssPopupBody(
          dom.show(use => !use(this._showSettings)),
          this._chat.buildDom()
        ),
        cssSettingsPanel(
          dom.show(this._showSettings),
          cssSettingsTitle("AI Assistant Configuration"),
          cssFormGroup(
            cssLabel("OpenAI API Key"),
            cssInput({ type: "password", placeholder: "sk-..." },
              dom.on("change", (e: any) => this._apiKeyInput.set(e.target.value)),
              dom.prop("value", this._apiKeyInput),
              testId("api-key-input")
            )
          ),
          cssFormGroup(
            cssLabel("API Base URL (optional)"),
            cssInput({ type: "text", placeholder: "https://api.openai.com/v1" },
              dom.on("change", (e: any) => this._baseUrlInput.set(e.target.value)),
              dom.prop("value", this._baseUrlInput),
              testId("base-url-input")
            )
          ),
          cssFormGroup(
            cssLabel("Model"),
            cssInput({ type: "text", placeholder: "gpt-4o" },
              dom.on("change", (e: any) => this._modelInput.set(e.target.value)),
              dom.prop("value", this._modelInput),
              testId("model-input")
            )
          ),
          cssSettingsActions(
            primaryButton("Save Settings", dom.on("click", () => this._saveSettings()), testId("save-settings")),
            textButton("Cancel", dom.on("click", () => this._showSettings.set(false)))
          )
        )
      )
    );
  }

  private _saveSettings() {
    localStorage.setItem("grist_assistant_api_key", this._apiKeyInput.get());
    localStorage.setItem("grist_assistant_base_url", this._baseUrlInput.get());
    localStorage.setItem("grist_assistant_model", this._modelInput.get());
    this._showSettings.set(false);
  }

  private async _sendMessage(message: string) {
    const model = this._modelInput.get() || undefined;
    const baseUrl = this._baseUrlInput.get() || undefined;
    const apiKey = this._apiKeyInput.get() || undefined;

    return await this._gristDoc.docComm.getAssistance({
      conversationId: this._chat.conversationId,
      context: {},
      text: message,
      state: this._history.get().state,
      model,
      baseUrl,
      apiKey
    } as any);
  }

  private _buildIntroMessage(...args: DomElementArg[]) {
    return cssAiIntroMessage(
      cssAvatar(cssAiImage()),
      dom("div",
        cssAiMessageParagraph("Hi, I'm the Grist AI Assistant."),
        cssAiMessageParagraph("I can help you build tables, format/style columns, write access rules, modify document data, and more!"),
        cssAiMessageParagraph("Try asking me to:"),
        dom("ul", { style: "padding-left: 20px; margin: 8px 0; font-size: 13px; line-height: 1.5;" },
          dom("li", "Create a table called Tasks with columns Title, Due_Date, and Done"),
          dom("li", "Add some mock tasks about planning a party"),
          dom("li", "Style the column Due_Date to have background color green"),
          dom("li", "Explain the current access rules")
        )
      ),
      ...args
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
      })
    ),
    ...args
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
