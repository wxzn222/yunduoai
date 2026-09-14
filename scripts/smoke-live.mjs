// 线上冒烟测试：用真实浏览器打开部署好的站点，发一条消息，确认能收到回复。
//
// 用法（在项目根目录）：
//   node scripts/smoke-live.mjs
//   node scripts/smoke-live.mjs http://1.2.3.4/
//
// 为什么要单独有这个脚本：
//   本地的端到端测试跑在 http://localhost 上，而浏览器把 localhost 当作"安全环境"，
//   很多只在非安全环境（http + IP 地址）下才会暴露的问题，本地永远测不出来。
//   之前就出过一次：客户端一个组件的请求拦截器在自建服务器上卡死，
//   导致手机端发消息完全没有反应，而本地测试全绿。
import { chromium } from "@playwright/test";

const target = process.argv[2] ?? "http://8.137.149.17/";
const iphoneUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1";

const browser = await chromium.launch();
const context = await browser.newContext({
  userAgent: iphoneUserAgent,
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();

const postRequests = [];
const problems = [];
page.on("request", (request) => {
  if (request.method() === "POST") {
    postRequests.push(request.url());
  }
});
page.on("console", (message) => {
  if (message.type() === "error") {
    problems.push(message.text().slice(0, 200));
  }
});
page.on("pageerror", (error) => {
  problems.push(`PAGEERROR: ${error.message.slice(0, 200)}`);
});

console.log(`打开 ${target}`);
await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(3000);

const acknowledge = page.getByRole("button", { name: "我知道了" });
if (await acknowledge.count()) {
  await acknowledge.first().click();
}

const input = page.locator("textarea").first();
await input.waitFor({ state: "visible", timeout: 30_000 });
await input.fill("你好，今天有点累");

const sendButton = page.getByRole("button", { name: /send|发送/i });
if (await sendButton.count()) {
  await sendButton.first().click();
} else {
  await input.press("Enter");
}

let reply = "";
for (let attempt = 0; attempt < 40; attempt += 1) {
  await page.waitForTimeout(2000);
  const text = await page.locator("body").innerText();
  if (!/Thinking|Waiting|Still waiting/i.test(text) && attempt >= 1) {
    reply = text;
    break;
  }
}

const lines = reply
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 1 && line !== "Edit" && line !== "Copy");

console.log(`\n发出去的 POST 请求：${postRequests.length ? postRequests.join("、") : "一条都没有"}`);
console.log(`页面最后几行：\n${lines.slice(-6).join("\n")}`);
if (problems.length) {
  console.log(`\n浏览器报错：\n${problems.join("\n")}`);
}

await browser.close();

if (postRequests.length === 0) {
  console.error("\n结果：失败——消息根本没有发出去");
  process.exit(1);
}
if (/Thinking|Waiting/i.test(reply) || lines.length === 0) {
  console.error("\n结果：失败——没有等到回复");
  process.exit(1);
}
console.log("\n结果：通过");
