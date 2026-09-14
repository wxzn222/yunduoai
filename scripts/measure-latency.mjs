// 测量一次对话在各阶段的耗时，用于核对"5 秒内返回完整回复"这类要求。
//
// 用法（在项目根目录）：
//   node scripts/measure-latency.mjs
//   node scripts/measure-latency.mjs http://1.2.3.4/ 5
//
// 依据：应用在调用模型前后会推两个 transient 状态事件
//   data-waiting-status(phase=waiting) → 准备阶段结束
//   data-waiting-status(phase=thinking) → 开始调用模型
//   text-delta 收到第一个字 → 模型返回
// 用完即删。
const base = process.argv[2] ?? "http://8.137.149.17";
const rounds = Number.parseInt(process.argv[3] ?? "3", 10);

// 建立一个访客身份
let cookie = "";
{
  let url = `${base}/`;
  for (let hop = 0; hop < 5; hop += 1) {
    const res = await fetch(url, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const item of setCookie) {
      const [pair] = item.split(";");
      const name = pair.split("=")[0];
      const others = cookie
        .split("; ")
        .filter((entry) => entry && !entry.startsWith(`${name}=`));
      cookie = [...others, pair].join("; ");
    }
    const location = res.headers.get("location");
    if (!location) {
      break;
    }
    url = new URL(location, url).toString();
  }
}

const samples = [];

for (let round = 1; round <= rounds; round += 1) {
  const started = Date.now();
  const res = await fetch(`${base}/api/chat`, {
    body: JSON.stringify({
      id: crypto.randomUUID(),
      message: {
        id: crypto.randomUUID(),
        parts: [
          {
            text: "今天上课被老师点名回答问题，我完全不会，特别丢脸",
            type: "text",
          },
        ],
        role: "user",
      },
      selectedChatModel: "qwen/qwen3.7-plus",
      selectedVisibilityType: "private",
    }),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let thinkingAt = null;
  let textAt = null;
  let finishedAt = null;
  let reply = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      finishedAt = Date.now();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (
        payload.type === "data-waiting-status" &&
        payload.data?.phase === "thinking"
      ) {
        thinkingAt ??= Date.now();
      }
      if (payload.type === "text-delta" && textAt === null) {
        textAt = Date.now();
        reply = payload.delta ?? "";
      }
      if (payload.type === "finish") {
        finishedAt = Date.now();
      }
    }
  }

  const total = (finishedAt ?? Date.now()) - started;
  const prep = (thinkingAt ?? started) - started;
  const model = (textAt ?? thinkingAt ?? started) - (thinkingAt ?? started);
  const tail = (finishedAt ?? Date.now()) - (textAt ?? finishedAt ?? started);
  samples.push({ model, prep, tail, total });
  console.log(
    `第 ${round} 次：总 ${total}ms ＝ 准备 ${prep}ms ＋ 模型 ${model}ms ＋ 收尾 ${tail}ms　回复：「${reply.slice(0, 30)}」`
  );
}

const average = (key) =>
  Math.round(
    samples.reduce((sum, item) => sum + item[key], 0) / samples.length
  );

console.log("\n=== 平均 ===");
console.log(`总耗时　${average("total")}ms`);
console.log(`准备　　${average("prep")}ms`);
console.log(`模型　　${average("model")}ms`);
console.log(`收尾　　${average("tail")}ms`);
