export type WarmListenerViolationKind =
  | "advice"
  | "cliche"
  | "boundary"
  | "diagnosis"
  | "pii-probe";

export type WarmListenerViolation = {
  kind: WarmListenerViolationKind;
  reason: string;
};

const violationRules: Array<{
  kind: WarmListenerViolationKind;
  reason: string;
  pattern: RegExp;
}> = [
  {
    kind: "advice",
    reason: "给建议",
    pattern: /你应该|我建议你|你必须|我劝你|不要(?:再)?难过了|想开一点|坚强一点/g,
  },
  {
    kind: "cliche",
    reason: "灌鸡汤",
    pattern: /一切都会好的|会好起来的|加油[！!。.…\s]*$|乐观一点|别想太多/g,
  },
  {
    kind: "boundary",
    reason: "越界自称专业身份",
    pattern: /我是(?:你的)?(?:心理咨询师|心理医生|治疗师|疗愈师)/g,
  },
  {
    kind: "diagnosis",
    reason: "给用户贴诊断标签",
    pattern: /你(?:可能)?(?:是|有|得了)(?:抑郁症|焦虑症|躁郁症|心理疾病)/g,
  },
  {
    kind: "pii-probe",
    reason: "追问隐私信息",
    pattern:
      /你(?:在|读|上)(?:哪所|什么|哪个)学校|告诉我(?:你的)?(?:姓名|名字|学校|住址|手机号|微信号|真实身份)/g,
  },
];

export function detectWarmListenerViolations(
  reply: string
): WarmListenerViolation[] {
  const violations: WarmListenerViolation[] = [];

  for (const rule of violationRules) {
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(reply);
    if (match) {
      violations.push({ kind: rule.kind, reason: rule.reason });
    }
  }

  return violations;
}
