#!/bin/bash
# AI 云朵 · 服务器端部署脚本
#
# 由 scripts/deploy.ps1 通过 ssh 调用，负责：解包新版本 → 应用数据库结构变更 →
# 切换目录 → 重启服务 → 健康检查 → 失败自动回滚。
#
# 依赖处理方式：发布包里不带 node_modules。服务器上有一份"共享依赖目录"，
# 每个版本通过软链接使用它，只有 package.json 变化时才重新安装。
# 这样既避开了 pnpm 符号链接在 Windows 打包时被破坏的问题，
# 也不用每次都在这台 1.6G 内存的小机器上跑一遍安装。
#
# 用法：deploy-remote.sh <已上传到服务器的 tar.gz 路径>
set -euo pipefail

TARBALL="${1:?用法: deploy-remote.sh <tarball 路径>}"

APP=/home/ubuntu/apps/yunduo
SHARED=/home/ubuntu/apps/yunduo-deps
LOG_DIR=/home/ubuntu/logs
LOG_FILE="$LOG_DIR/yunduo.log"
NODE_BIN=/home/ubuntu/apps/node/bin/node
NPM_BIN=/home/ubuntu/apps/node/bin/npm
NPM_REGISTRY=https://registry.npmmirror.com
MIGRATE_DEPS=/home/ubuntu/apps/migrate-deps
UNIT_FILE=/etc/systemd/system/yunduo.service
HEALTH_URL=http://127.0.0.1:3000/ping
ROOT_URL=http://127.0.0.1:3000/
KEEP_BACKUPS=3

# npm 的启动脚本靠 PATH 找 node，ssh 非交互执行时 PATH 里没有它
export PATH="/home/ubuntu/apps/node/bin:$PATH"

STAMP=$(date +%Y%m%d-%H%M%S)
NEW="$APP.new.$STAMP"
OLD="$APP.old.$STAMP"
DEPLOYED=0

log() { printf '[部署] %s\n' "$*"; }
die() { printf '[部署] 失败：%s\n' "$*" >&2; exit 1; }

remove_tree() {
  # 只允许删除应用目录下带时间戳的目录，避免误删
  case "$1" in
    "$APP".new.* | "$APP".old.*) rm -rf -- "$1" ;;
  esac
}

cleanup_incomplete() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$DEPLOYED" = "0" ] && [ -d "$NEW" ]; then
    log "本次部署未完成，清理临时目录 $NEW"
    remove_tree "$NEW"
  fi
}
trap cleanup_incomplete EXIT

healthy() {
  local attempt ping_code root_code
  for attempt in $(seq 1 30); do
    ping_code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$HEALTH_URL" 2>/dev/null || true)
    root_code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$ROOT_URL" 2>/dev/null || true)
    # /ping 走中间件，200 说明服务已起来；
    # 根路径未登录时会跳到访客登录接口、返回 307，两种都算正常。
    if [ "$ping_code" = "200" ] && { [ "$root_code" = "200" ] || [ "$root_code" = "307" ]; }; then
      return 0
    fi
    sleep 2
  done
  return 1
}

[ -f "$TARBALL" ] || die "找不到上传的压缩包：$TARBALL"
[ -f "$APP/.env" ] || die "现有部署里找不到 .env，先确认服务器状态再部署"
[ -f "$APP/server.js" ] || die "现有部署看起来不完整（没有 server.js），先确认服务器状态再部署"

# 清掉上一次没走完留下的临时目录和上传包
{
  ls -1dt "$APP".new.* 2>/dev/null || true
} | while read -r stale; do
  case "$stale" in
    "$APP".new.*) rm -rf -- "$stale" ;;
  esac
done
for stale_tarball in /home/ubuntu/apps/yunduo-upload-*.tar.gz; do
  case "$stale_tarball" in
    /home/ubuntu/apps/yunduo-upload-*.tar.gz)
      [ "$stale_tarball" = "$TARBALL" ] || rm -f -- "$stale_tarball"
      ;;
  esac
done

# 1. 解包到新目录，先不碰正在运行的版本
log "解包到 $NEW"
mkdir -p "$NEW"
tar -xzf "$TARBALL" -C "$NEW"
[ -d "$NEW/migrations" ] || die "发布包里缺少 migrations 目录"
[ -f "$NEW/server.js" ] || die "发布包里缺少 server.js"

# 2. 沿用服务器上现有的 .env（密钥不放进发布包，也就不经过开发机）
log "沿用服务器上现有的 .env"
cp -p "$APP/.env" "$NEW/.env"
chmod 600 "$NEW/.env"
chown -R ubuntu:ubuntu "$NEW"

# 3. 依赖：首次把现有安装复制成共享目录，之后所有版本共用
if [ ! -d "$SHARED/node_modules/next" ]; then
  log "首次建立共享依赖目录（从当前版本复制，需要一会儿）"
  mkdir -p "$SHARED/node_modules"
  cp -a "$APP/node_modules/." "$SHARED/node_modules/"
  chown -R ubuntu:ubuntu "$SHARED"
  # 复制过来的依赖跟当前版本的 package.json 是配套的，把这个指纹记下来，
  # 本次部署就能跳过安装；之后依赖真的变了才会重装。
  cp -f "$APP/package.json" "$SHARED/package.json"
  sha256sum "$SHARED/package.json" | cut -d' ' -f1 > "$SHARED/package.json.sha256"
fi

DEPS_HASH_FILE="$SHARED/package.json.sha256"
NEW_DEPS_HASH=$(sha256sum "$NEW/package.json" | cut -d' ' -f1)
if [ ! -f "$DEPS_HASH_FILE" ] || [ "$(cat "$DEPS_HASH_FILE" 2>/dev/null)" != "$NEW_DEPS_HASH" ]; then
  log "依赖清单有变化，更新共享依赖（这一步较慢，会短暂停服）"
  systemctl stop yunduo || true
  cp -f "$NEW/package.json" "$SHARED/package.json"
  cd "$SHARED"
  if ! "$NPM_BIN" install --omit=dev --legacy-peer-deps --no-audit --no-fund \
    --registry="$NPM_REGISTRY" >/tmp/yunduo-npm-install.log 2>&1; then
    tail -30 /tmp/yunduo-npm-install.log
    systemctl start yunduo || true
    die "依赖安装失败，详见 /tmp/yunduo-npm-install.log"
  fi
  chown -R ubuntu:ubuntu "$SHARED"
  echo "$NEW_DEPS_HASH" > "$DEPS_HASH_FILE"
  log "共享依赖更新完成"
else
  log "依赖没有变化，直接复用共享目录"
fi

ln -sfn "$SHARED/node_modules" "$NEW/node_modules"

# 4. 日志挪到应用目录之外，这样每次部署不会把日志一起换掉
mkdir -p "$LOG_DIR"
chown ubuntu:ubuntu "$LOG_DIR"
if [ ! -f "$UNIT_FILE" ] || ! grep -q "StandardOutput=append:$LOG_FILE" "$UNIT_FILE"; then
  log "调整日志位置到 $LOG_FILE"
  cat > "$UNIT_FILE" <<UNIT_EOF
[Unit]
Description=AI YunDuo (Next.js standalone)
After=network.target postgresql.service redis-server.service
Wants=postgresql.service redis-server.service

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=$APP
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=$NODE_BIN --env-file=$APP/.env $APP/server.js
Restart=always
RestartSec=5
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=multi-user.target
UNIT_EOF
  chmod 644 "$UNIT_FILE"
  if [ -f "$APP/app.log" ] && [ ! -s "$LOG_FILE" ]; then
    cp -p "$APP/app.log" "$LOG_FILE"
  fi
  systemctl daemon-reload
fi

cat > /etc/logrotate.d/yunduo <<ROTATE_EOF
$LOG_DIR/*.log {
    weekly
    size 10M
    rotate 6
    missingok
    notifempty
    copytruncate
    compress
    delaycompress
}
ROTATE_EOF
chmod 644 /etc/logrotate.d/yunduo

# 5. 准备数据库迁移环境（只装一次，之后复用）
if [ ! -d "$MIGRATE_DEPS/node_modules/drizzle-orm" ] || [ ! -d "$MIGRATE_DEPS/node_modules/postgres" ]; then
  log "首次准备数据库迁移环境，需要一两分钟"
  mkdir -p "$MIGRATE_DEPS"
  cd "$MIGRATE_DEPS"
  [ -f package.json ] || "$NPM_BIN" init -y >/dev/null 2>&1
  "$NPM_BIN" install --no-audit --no-fund --registry="$NPM_REGISTRY" \
    drizzle-orm@0.45.2 postgres >/dev/null
fi

cat > "$MIGRATE_DEPS/migrate.mjs" <<'MIGRATE_EOF'
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.POSTGRES_URL;
const folder = process.env.MIGRATIONS_FOLDER;

if (!url) {
  console.error("POSTGRES_URL 未设置");
  process.exit(1);
}
if (!folder) {
  console.error("MIGRATIONS_FOLDER 未设置");
  process.exit(1);
}

const connection = postgres(url, { max: 1 });

try {
  await migrate(drizzle(connection), { migrationsFolder: folder });
  console.log("数据库结构已是最新");
} catch (error) {
  console.error("数据库迁移失败");
  console.error(error);
  process.exitCode = 1;
} finally {
  await connection.end();
}
MIGRATE_EOF

# 6. 先迁移数据库，再切换代码。迁移失败就原地放弃，正在运行的版本不受影响。
log "应用数据库结构变更"
if ! MIGRATIONS_FOLDER="$NEW/migrations" \
  "$NODE_BIN" --env-file="$APP/.env" "$MIGRATE_DEPS/migrate.mjs"; then
  log "迁移失败，保持现有版本不变"
  exit 1
fi

# 7. 切换目录并重启
log "切换版本并重启服务"
mv "$APP" "$OLD"
mv "$NEW" "$APP"
DEPLOYED=1
systemctl restart yunduo

# 8. 健康检查，不通过就自动退回上一版
if ! healthy; then
  log "新版本健康检查未通过，开始回滚"
  mv "$APP" "$NEW.failed"
  mv "$OLD" "$APP"
  systemctl restart yunduo
  if healthy; then
    log "已回滚到上一版本，网站恢复正常"
  else
    log "回滚后仍不健康，需要人工检查：journalctl -u yunduo -n 100 --no-pager"
  fi
  exit 1
fi

# 9. 清理旧的备份和失败的版本，只保留最近几份
log "清理旧备份，保留最近 $KEEP_BACKUPS 份"
{
  ls -1dt "$APP".old.* 2>/dev/null || true
} | tail -n +$((KEEP_BACKUPS + 1)) | while read -r path; do
  case "$path" in
    "$APP".old.*) rm -rf -- "$path" ;;
  esac
done
{
  ls -1dt "$APP".new.* 2>/dev/null || true
} | while read -r path; do
  case "$path" in
    "$APP".new.*) rm -rf -- "$path" ;;
  esac
done
rm -f "$TARBALL"

log "部署完成"
log "服务状态：$(systemctl is-active yunduo)"
log "当前版本：$APP"
log "可回滚版本：$(ls -1d "$APP".old.* 2>/dev/null | wc -l || true) 份"
