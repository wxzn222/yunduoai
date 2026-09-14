export type CrisisLevel = "none" | "moderate" | "severe";

export type CrisisAssessment = {
  level: CrisisLevel;
  matchedRuleIds: string[];
};

const severeRules: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "suicide-wish",
    pattern: /不想活(?:了|下去)?|不想(?:再)?(?:活着|活下去|醒来)/,
  },
  {
    id: "suicide-intent",
    pattern: /(?:想|要|准备)(?:去)?自杀|自杀了|正在自杀/,
  },
  {
    id: "self-harm-action",
    pattern: /割腕|跳楼|上吊|安眠药|吞药|结束(?:自己)?(?:的)?生命/,
  },
  {
    id: "suicide-plan",
    pattern: /(?:已经|正在|计划好|准备好).{0,8}(?:自杀|结束生命|离开这个世界)/,
  },
];

const moderateRules: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "persistent-insomnia",
    pattern: /(?:最近|一直|经常|连续)(?:都)?(?:睡不好|失眠)/,
  },
  {
    id: "self-devaluation",
    pattern: /觉得自己(?:很|好|特别|越来越)?(?:没用|差劲|是废物|不如别人)/,
  },
  {
    id: "persistent-sadness",
    pattern:
      /(?:总是|一直|动不动就|经常)想哭|情绪(?:一直|最近|总是)(?:很低落|不好|很差)/,
  },
  {
    id: "hopelessness",
    pattern: /撑不下去|看不到希望|没有希望|不知道活着有什么意义/,
  },
  {
    id: "possible-depression",
    pattern: /我(?:可能|好像)?(?:有|得了)(?:抑郁症|焦虑症)/,
  },
];

export function assessCrisis(input: string): CrisisAssessment {
  const matchedRuleIds: string[] = [];

  for (const rule of severeRules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(input)) {
      matchedRuleIds.push(rule.id);
    }
  }

  if (matchedRuleIds.length > 0) {
    return { level: "severe", matchedRuleIds };
  }

  for (const rule of moderateRules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(input)) {
      matchedRuleIds.push(rule.id);
    }
  }

  return {
    level: matchedRuleIds.length > 0 ? "moderate" : "none",
    matchedRuleIds,
  };
}

export const SEVERE_CRISIS_RESPONSE =
  "听到你这么说，我很担心。你现在还好吗？如果很难受，请一定联系学校心理中心，或拨打全国心理援助热线：400-161-9995。有人可以陪你一起面对，你不需要一个人扛着。";

export const MODERATE_CONTEXT_RULE = `用户此刻可能处于中度情绪困扰（例如持续失眠、自我否定或长期低落）。
请你继续保持陪伴和倾听，不贴标签、不诊断；如果语境自然，可以温和地提醒用户考虑联系学校心理中心或专业支持渠道，但不要显得像在推走用户。`;
