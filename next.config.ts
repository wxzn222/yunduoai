import type { NextConfig } from "next";

const basePath = process.env.IS_DEMO === "1" ? "/demo" : "";

const nextConfig: NextConfig = {
  ...(basePath
    ? {
        assetPrefix: "/demo-assets",
        basePath,
        redirects: async () => [
          {
            basePath: false,
            destination: basePath,
            permanent: false,
            source: "/",
          },
        ],
      }
    : {}),
  cacheComponents: true,
  devIndicators: false,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  experimental: {
    appNewScrollHandler: true,
    cachedNavigations: true,
    inlineCss: true,
    prefetchInlining: true,
    turbopackFileSystemCacheForDev: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: "avatar.vercel.sh",
      },
      {
        hostname: "*.public.blob.vercel-storage.com",
        protocol: "https",
      },
    ],
  },
  logging: {
    fetches: {
      fullUrl: false,
    },
    incomingRequests: false,
  },
  output: "standalone",
  poweredByHeader: false,
  reactCompiler: true,
};

// 这里原来包了一层 withBotId（Vercel 平台的机器人识别）。
// 自建服务器上用不了：它会往页面里注入一段挑战脚本，脚本路径由 Vercel 提供，
// 我们的服务器返回的是"页面不存在"，脚本加载失败，
// 而客户端的 fetch 拦截器会一直等这个脚本的回调，导致发消息的请求根本发不出去。
export default nextConfig;
