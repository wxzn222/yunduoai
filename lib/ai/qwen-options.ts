/**
 * 通义千问的调用参数。
 *
 * qwen3.7-plus 默认是"思考型"：回答前会先写一段思维过程（实测 500～800 字），
 * 单次回复 6 秒里有 95% 花在这上面。
 *
 * 关掉之后实测：
 *   平均耗时 8252ms → 1697ms
 *   风险判定结果完全一致（11 条样本，含明确危机、告别式隐喻、中度困扰和日常用语）
 *
 * 这里的 qwen 对应 providers.ts 里 createOpenAICompatible({ name: "qwen" })，
 * 这个键会被该 provider 原样合并进请求体。
 */
export const qwenNoThinking = {
  providerOptions: {
    qwen: { enable_thinking: false },
  },
} as const;
