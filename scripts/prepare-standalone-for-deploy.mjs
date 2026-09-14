// 打包前的整理工作，由 deploy.ps1 调用。
//
// 1) 删掉 standalone/node_modules
//    依赖改由服务器上的共享依赖目录提供（见 deploy-remote.sh）。
//    这里必须真正删除，而不是靠 tar 的 --exclude 规则排除：
//    bsdtar 的排除匹配比预期宽松，会把 .next/node_modules 下面的
//    Turbopack 外部模块别名一起排掉，导致运行时找不到 shiki。
// 2) 精简 package.json
//    去掉 scripts（其中的 prepare 会调用 husky）和 devDependencies，
//    服务器只按依赖清单装生产依赖。
import fs from "node:fs";
import path from "node:path";

const standaloneDir = process.argv[2];

if (!standaloneDir || !fs.existsSync(standaloneDir)) {
  console.error("用法: node prepare-standalone-for-deploy.mjs <standalone 目录>");
  process.exit(1);
}

const nodeModulesDir = path.join(standaloneDir, "node_modules");
if (fs.existsSync(nodeModulesDir)) {
  fs.rmSync(nodeModulesDir, { force: true, maxRetries: 3, recursive: true });
  console.log("已移除本地 node_modules（依赖改由服务器提供）");
}

const packageJsonPath = path.join(standaloneDir, "package.json");
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

delete pkg.scripts;
delete pkg.devDependencies;
delete pkg["lint-staged"];
delete pkg.packageManager;

fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log("已精简 package.json");

const aliasDir = path.join(standaloneDir, ".next", "node_modules");
if (fs.existsSync(aliasDir)) {
  console.log(
    `.next/node_modules 外部模块别名保留：${fs.readdirSync(aliasDir).join("、")}`
  );
}
