<#
.SYNOPSIS
    AI 云朵 · 一键部署到服务器

.DESCRIPTION
    在你自己的电脑上执行这一条命令，它会：
      1. 构建生产版本
      2. 把成品打成发布包
      3. 上传到服务器
      4. 在服务器上应用数据库结构变更、切换版本、重启服务
      5. 健康检查，不通过就自动回滚到上一版本

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\deploy.ps1

.EXAMPLE
    # 已经构建过，想直接重新部署（跳过构建，省几分钟）
    powershell -ExecutionPolicy Bypass -File .\scripts\deploy.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
    [string]$Server = "8.137.149.17",
    [string]$SshUser = "root",
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StagingRoot = Join-Path $ProjectRoot ".deploy"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$TarballPath = Join-Path $StagingRoot "yunduo-$Stamp.tar.gz"
$RemoteTarball = "/home/ubuntu/apps/yunduo-upload-$Stamp.tar.gz"
$RemoteScript = "/home/ubuntu/apps/deploy-remote.sh"
$SshTarget = "$SshUser@$Server"
$SshOptions = @(
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15"
)

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-LastExitCode([string]$What) {
    if ($LASTEXITCODE -ne 0) {
        throw "$What 失败（退出码 $LASTEXITCODE）"
    }
}

try {
    Set-Location $ProjectRoot

    Write-Step "检查能否连上服务器 $Server"
    & ssh @SshOptions $SshTarget "echo connected"
    Assert-LastExitCode "连接服务器"
    Write-Host "服务器连接正常。"

    if (-not $SkipBuild) {
        Write-Step "构建生产版本（跳过本地数据库迁移，数据库变更由服务器端执行）"
        & corepack pnpm exec next build
        Assert-LastExitCode "构建"
    }
    else {
        Write-Step "按要求跳过构建，使用已有的 .next 产物"
    }

    $standaloneDir = Join-Path $ProjectRoot ".next\standalone"
    if (-not (Test-Path -LiteralPath (Join-Path $standaloneDir "server.js"))) {
        throw "找不到构建产物 .next\standalone\server.js，请先去掉 -SkipBuild 重新构建"
    }

    # 发布包不携带本地 node_modules：
    #   pnpm 的依赖目录靠符号链接组织，Windows 上打包会把链接"解开"，
    #   解开后 next 找不到自己的依赖（实测缺 @swc/helpers，服务启动即崩）。
    #   改为在服务器上安装生产依赖，顺带装上 Linux 版本的二进制包。
    Write-Step "把静态资源与迁移文件放进构建产物"
    $staticTarget = Join-Path $standaloneDir ".next\static"
    New-Item -ItemType Directory -Force -Path $staticTarget | Out-Null
    Copy-Item -Path (Join-Path $ProjectRoot ".next\static\*") -Destination $staticTarget -Recurse -Force

    $publicTarget = Join-Path $standaloneDir "public"
    New-Item -ItemType Directory -Force -Path $publicTarget | Out-Null
    Copy-Item -Path (Join-Path $ProjectRoot "public\*") -Destination $publicTarget -Recurse -Force

    $migrationsTarget = Join-Path $standaloneDir "migrations"
    New-Item -ItemType Directory -Force -Path $migrationsTarget | Out-Null
    Copy-Item -Path (Join-Path $ProjectRoot "lib\db\migrations\*") -Destination $migrationsTarget -Recurse -Force

    Write-Step "整理构建产物（移除本地依赖、精简 package.json）"
    & node (Join-Path $PSScriptRoot "prepare-standalone-for-deploy.mjs") $standaloneDir
    Assert-LastExitCode "整理构建产物"

    Write-Step "打包"
    New-Item -ItemType Directory -Force -Path $StagingRoot | Out-Null
    & tar -czf $TarballPath -C $standaloneDir .
    Assert-LastExitCode "打包"
    $tarballMb = [Math]::Round((Get-Item -LiteralPath $TarballPath).Length / 1MB, 1)
    Write-Host "发布包大小 $tarballMb MB"

    Write-Step "核对发布包完整性"
    $listing = & tar -tzf $TarballPath
    Assert-LastExitCode "读取发布包"
    if ($listing | Where-Object { $_ -like "./node_modules*" }) {
        throw "发布包里仍带着顶层 node_modules，依赖应由服务器提供，已中止上传。"
    }
    $aliasDir = Join-Path $standaloneDir ".next\node_modules"
    if ((Test-Path -LiteralPath $aliasDir) -and -not ($listing | Where-Object { $_ -like "./.next/node_modules/*" })) {
        throw "发布包里缺少 .next/node_modules 里的外部模块别名，运行时会报模块找不到，已中止上传。"
    }
    foreach ($required in @(
        "./server.js",
        "./package.json",
        "./.next/static",
        "./public",
        "./migrations"
    )) {
        if (-not ($listing | Where-Object { $_ -like "$required*" })) {
            throw "发布包里缺少 $required，已中止上传。"
        }
    }
    Write-Host "核对通过：代码、静态资源、外部模块别名与迁移文件齐全。"

    Write-Step "上传到服务器"
    & scp @SshOptions $TarballPath "${SshTarget}:$RemoteTarball"
    Assert-LastExitCode "上传发布包"
    & scp @SshOptions (Join-Path $PSScriptRoot "deploy-remote.sh") "${SshTarget}:$RemoteScript"
    Assert-LastExitCode "上传部署脚本"

    Write-Step "在服务器上切换版本（包含数据库迁移、重启与健康检查）"
    & ssh @SshOptions $SshTarget "chmod +x $RemoteScript && $RemoteScript $RemoteTarball"
    Assert-LastExitCode "服务器端部署"

    Write-Step "从外网确认网站可访问"
    $httpCode = & curl.exe -s -o NUL -w "%{http_code}" --max-time 20 "http://$Server/ping"
    if ($httpCode -eq "200") {
        Write-Host "外网访问正常（http://$Server/ping 返回 200）" -ForegroundColor Green
    }
    else {
        Write-Warning "外网检查返回 $httpCode，请手动打开 http://$Server/ 确认"
    }

    Write-Host ""
    Write-Host "部署完成。网站：http://$Server/" -ForegroundColor Green
}
finally {
    Write-Verbose "发布包保存在 $StagingRoot"
}
