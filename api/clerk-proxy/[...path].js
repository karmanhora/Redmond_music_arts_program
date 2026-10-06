const CLERK_FRONTEND_API = "https://frontend-api.clerk.dev";
const CLERK_PROXY_URL = "https://rhs-musicandarts.vercel.app/_clerk";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function clerkProxy(req, res) {
  if (!process.env.CLERK_SECRET_KEY) {
    res.status(503).send("Clerk proxy is missing its server-side secret configuration.");
    return;
  }

  const method = req.method ?? "GET";
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method)) {
    res.setHeader("Allow", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    res.status(405).send("Method not allowed");
    return;
  }

  const incomingUrl = new URL(req.url ?? "/", "https://rhs-musicandarts.vercel.app");
  const proxyPath = incomingUrl.pathname.replace(
    /^\/(?:api\/)?(?:_clerk|clerk-proxy)\/?/,
    ""
  );
  const targetUrl = new URL(`/${proxyPath}${incomingUrl.search}`, CLERK_FRONTEND_API);
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    const normalizedName = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(normalizedName) ||
      normalizedName.startsWith("x-forwarded-") ||
      normalizedName === "clerk-secret-key" ||
      normalizedName === "clerk-proxy-url"
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const forwardedFor = req.headers["x-forwarded-for"];
  const clientIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim();
  if (clientIp) headers.set("X-Forwarded-For", clientIp);

  headers.set("Clerk-Proxy-Url", CLERK_PROXY_URL);
  headers.set("Clerk-Secret-Key", process.env.CLERK_SECRET_KEY);

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : req,
      ...(method === "GET" || method === "HEAD" ? {} : { duplex: "half" }),
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, name) => {
      const normalizedName = name.toLowerCase();
      if (
        !HOP_BY_HOP_HEADERS.has(normalizedName) &&
        normalizedName !== "content-encoding"
      ) {
        res.setHeader(name, value);
      }
    });

    const cookies = upstream.headers.getSetCookie?.();
    if (cookies?.length) res.setHeader("set-cookie", cookies);

    if (method === "HEAD" || !upstream.body) {
      res.end();
      return;
    }

    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error("Clerk frontend proxy request failed", error);
    res.status(502).send("Clerk frontend API is unavailable.");
  }
}
