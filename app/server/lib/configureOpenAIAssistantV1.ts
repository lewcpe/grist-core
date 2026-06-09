import { getAssistantV2Options } from "app/server/lib/Assistant";
import { IAssistant } from "app/server/lib/IAssistant";
import { EchoAssistantV1 } from "app/server/lib/OpenAIAssistantV1";
import { OpenAIAssistantV2 } from "app/server/lib/OpenAIAssistantV2";

export function configureOpenAIAssistantV1(): IAssistant | undefined {
  const options = getAssistantV2Options();
  if (options.apiKey === "test") {
    return new EchoAssistantV1();
  }
  return new OpenAIAssistantV2(options);
}
