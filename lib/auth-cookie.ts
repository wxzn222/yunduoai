/**
 * 判断当前请求是不是走的 HTTPS。
 *
 * 登录凭证 Cookie 的名字会跟着协议变：HTTPS 下叫 __Secure-authjs.session-token，
 * HTTP 下叫 authjs.session-token。读 Cookie 时必须用对名字，否则读不到登录状态，
 * 页面会陷进"一直跳去登录、登录又跳回来"的死循环。
 *
 * 网站挂在 nginx 后面，应用自己看到的是 127.0.0.1 的 HTTP 请求，
 * 所以要看 nginx 通过 X-Forwarded-Proto 头传进来的真实协议。
 */
export function isSecureRequest(request: {
  headers: Headers;
  url: string;
}): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = (
    forwardedProto?.split(",")[0] ?? new URL(request.url).protocol
  )
    .trim()
    .replace(/:$/, "");

  return protocol.toLowerCase() === "https";
}
