// 用人工标注的样本集核对危机识别，输出漏检与误检明细。
//
// 用法（在项目根目录）：
//   node scripts/eval-crisis-samples.mjs                       跑 1 轮（关闭模型思考，与线上一致）
//   node scripts/eval-crisis-samples.mjs 2                     跑 2 轮，对比一致性
//   node scripts/eval-crisis-samples.mjs 1 --thinking          开启模型思考，用于对比
//
// 样本来自 docs/crisis-samples-<日期>.md 里的表格，改那个文件即可，不用改代码。
// 脚本要用到真实的模型接口，因此需要在服务器上执行（或本地配置好 DASHSCOPE_API_KEY）。
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const useThinking = args.includes("--thinking");
const rulesOnly = args.includes("--rules-only");
const rounds = Number.parseInt(args.find((arg) => /^\d+$/.test(arg)) ?? "1", 10);
const samplesFile =
  args.find((arg) => arg.endsWith(".md")) ?? "docs/crisis-samples-2026-09-14.md";
const endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const key = process.env.DASHSCOPE_API_KEY;

if (!key) {
  console.error("缺少 DASHSCOPE_API_KEY");
  process.exit(1);
}

const markdown = fs.readFileSync(path.resolve(samplesFile), "utf8");
const samples = markdown
  .split("\n")
  .filter((line) => /^\|\s*\d+\s*\|/.test(line))
  .map((line) => {
    const cells = line.split("|").map((cell) => cell.trim());
    return { category: cells[2], expect: cells[4], id: cells[1], text: cells[3] };
  });

console.log(`读取样本 ${samples.length} 条，共跑 ${rounds} 轮\n`);

// 这里用与线上完全一致的判定口径
const { buildWarmListenerSystemPrompt } = await import("../lib/ai/yunduo/persona.ts");
const { assessCrisis } = await import("../lib/safety/crisis.ts");
const { buildCrisisScreeningSuffix } = await import("../lib/safety/crisis-screening.ts");
const system = `${buildWarmListenerSystemPrompt()}\n\n${buildCrisisScreeningSuffix()}`;

// 规则表是纯本地的字符串匹配，先把它的覆盖情况统计出来：
// 规则命中的样本根本不经过模型，模型判得再好也不会改变结果。
console.log("=== 规则表（本地正则）的覆盖情况 ===");
const ruleCoverage = { moderate: [], none: [], severe: [] };
for (const sample of samples) {
  const level = assessCrisis(sample.text).level;
  ruleCoverage[level].push(sample);
}
console.log(`规则表命中「重度」：${ruleCoverage.severe.length} 条`);
console.log(`规则表命中「中度」：${ruleCoverage.moderate.length} 条`);
console.log(`规则表未命中：${ruleCoverage.none.length} 条（这 ${ruleCoverage.none.length} 条要靠模型判断）`);

const missedByRule = samples.filter(
  (sample) => sample.expect === "HIGH" && assessCrisis(sample.text).level !== "severe"
);
console.log(`\n期望为 HIGH 但规则表没拦住的（共 ${missedByRule.length} 条，全部依赖模型）：`);
for (const sample of missedByRule) {
  console.log(`  第${sample.id}条「${sample.text}」`);
}

console.log("\n=== 规则表逐类覆盖 ===");
console.log("分类 | 条数 | 规则表命中重度 | 命中中度 | 完全没命中");
for (const category of ["明确危机", "告别式隐喻", "中度困扰", "日常用语"]) {
  const group = samples.filter((sample) => sample.category === category);
  if (group.length === 0) {
    continue;
  }
  const count = (level) =>
    group.filter((sample) => assessCrisis(sample.text).level === level).length;
  console.log(
    `${category} | ${group.length} | ${count("severe")} | ${count("moderate")} | ${count("none")}`
  );
}

if (rulesOnly) {
  console.log("\n（--rules-only：只检查规则表，不调用模型）");
  process.exit(0);
}

console.log(`\n模型思考模式：${useThinking ? "开启" : "关闭（线上配置）"}\n`);

async function judge(text) {
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      messages: [
        { content: system, role: "system" },
        { content: text, role: "user" },
      ],
      model: "qwen3.7-plus",
      ...(useThinking ? {} : { enable_thinking: false }),
    }),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    method: "POST",
  });
  const json = await response.json();
  const content = json.choices?.[0]?.message?.content ?? "";
  return /RISK:(HIGH|MEDIUM|LOW)/.exec(content)?.[1] ?? "无法解析";
}

const results = [];

for (let round = 1; round <= rounds; round += 1) {
  process.stdout.write(`第 ${round} 轮：`);
  for (const sample of samples) {
    const actual = await judge(sample.text);
    results.push({ ...sample, actual, round });
    process.stdout.write(actual === sample.expect ? "." : "✗");
  }
  console.log("");
}

const byCategory = new Map();
for (const item of results) {
  const bucket = byCategory.get(item.category) ?? { miss: 0, total: 0, wrong: 0 };
  bucket.total += 1;
  if (item.actual !== item.expect) {
    bucket.wrong += 1;
    // 漏检＝该拦没拦，误检＝不该拦却拦了，两者性质不同，分开统计
    const missed = item.expect === "HIGH" && item.actual !== "HIGH";
    const falseAlarm = item.expect === "LOW" && item.actual === "HIGH";
    if (missed) {
      bucket.miss += 1;
    }
    if (falseAlarm) {
      bucket.falseAlarm = (bucket.falseAlarm ?? 0) + 1;
    }
  }
  byCategory.set(item.category, bucket);
}

console.log("\n=== 分类统计 ===");
console.log("分类 | 条数 | 判定不符 | 其中漏检 | 其中误检");
for (const [category, bucket] of byCategory) {
  console.log(
    `${category} | ${bucket.total} | ${bucket.wrong} | ${bucket.miss} | ${bucket.falseAlarm ?? 0}`
  );
}

const mismatches = results.filter((item) => item.actual !== item.expect);
console.log(`\n=== 判定不符明细（${mismatches.length} 条）===`);
for (const item of mismatches) {
  const kind = item.expect === "HIGH" && item.actual !== "HIGH" ? "漏检" : "误检或偏差";
  console.log(`[${kind}] 第${item.id}条「${item.text}」期望 ${item.expect}，实际 ${item.actual}（第 ${item.round} 轮）`);
}

if (rounds > 1) {
  const unstable = samples.filter((sample) => {
    const set = new Set(
      results.filter((item) => item.id === sample.id).map((item) => item.actual)
    );
    return set.size > 1;
  });
  console.log(`\n=== 多轮结果不稳定的样本（${unstable.length} 条）===`);
  for (const sample of unstable) {
    const values = results
      .filter((item) => item.id === sample.id)
      .map((item) => item.actual)
      .join(" / ");
    console.log(`第${sample.id}条「${sample.text}」：${values}`);
  }
}
