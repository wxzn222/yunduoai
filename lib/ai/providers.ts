import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider, gateway } from "ai";
import { isTestEnvironment } from "../constants";
import { titleModel } from "./models";

const qwenProvider = createOpenAICompatible({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL:
    process.env.DASHSCOPE_BASE_URL ??
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  name: "qwen",
});

function getQwenModelId(modelId: string) {
  return modelId.startsWith("qwen/") ? modelId.slice("qwen/".length) : modelId;
}

export const myProvider = isTestEnvironment
  ? (() => {
      const {
        chatModel,
        titleModel: mockTitleModel,
      } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": mockTitleModel,
        },
      });
    })()
  : null;

export function getLanguageModel(modelId: string) {
  if (modelId.startsWith("qwen/")) {
    return qwenProvider.languageModel(getQwenModelId(modelId));
  }

  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  return gateway.languageModel(modelId);
}

export function getTitleModel() {
  if (titleModel.id.startsWith("qwen/")) {
    return qwenProvider.languageModel(getQwenModelId(titleModel.id));
  }

  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }
  return gateway.languageModel(titleModel.id);
}
