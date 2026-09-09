export type CrisisRiskLevel = "HIGH" | "MEDIUM" | "LOW";

export function buildCrisisScreeningSuffix(): string {
  return `回复用户前，先判断用户最近发言是否存在自伤或自杀风险。判断必须结合整段对话上下文。

输出格式：第一行必须且只能是 RISK:HIGH、RISK:MEDIUM 或 RISK:LOW；空一行后再输出给用户的回复。不要在 RISK 行之前或之后写任何其它内容。

判定口径：
- RISK:HIGH：存在明确的生死暗示，或告别式隐喻。告别式隐喻哪怕也能解释成“我先下线了”，只要语境像在向世界或生命道别，仍判 HIGH。示例：我该走了（告别语境）、如果我不在了、以后不会麻烦大家了、把想说的话都说完了、今晚月色真美（告别语境）。
- RISK:MEDIUM：存在明显情绪困扰（如持续失眠、自我否定、长期低落、撑不下去），但没有生死暗示。
- RISK:LOW：正常聊天；以及明显日常用语，例如“想死你了”“笑死我了”“我先走了，晚安”（没有告别语境时）。`;
}

export function parseCrisisRiskTag(
  output: string
): { risk: CrisisRiskLevel; reply: string } | null {
  const normalized = output.replace(/^\uFEFF/, "");
  const firstLineBreak = normalized.indexOf("\n");
  const firstLine = (
    firstLineBreak === -1 ? normalized : normalized.slice(0, firstLineBreak)
  )
    .trim()
    .toUpperCase();

  const match = /^RISK:(HIGH|MEDIUM|LOW)$/.exec(firstLine);
  if (!match) {
    return null;
  }

  const risk = match[1] as CrisisRiskLevel;
  const rest =
    firstLineBreak === -1 ? "" : normalized.slice(firstLineBreak + 1);
  const reply = rest.replace(/^\n+/, "").trimStart();
  return { reply, risk };
}
