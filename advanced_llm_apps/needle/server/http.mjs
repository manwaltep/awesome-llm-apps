export const MAX_REQUEST_BYTES = 512_000;

export function isAllowedBrowserOrigin(headers = {}) {
  const origin = headers.origin;
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const validPath =
    parsed.pathname === "/" ||
    (parsed.protocol === "chrome-extension:" && parsed.pathname === "");
  if (
    parsed.username ||
    parsed.password ||
    !validPath ||
    parsed.search ||
    parsed.hash
  )
    return false;
  if (
    parsed.protocol === "chrome-extension:" &&
    /^[a-p]{32}$/.test(parsed.hostname)
  )
    return true;
  return Boolean(
    headers.host &&
    ["http:", "https:"].includes(parsed.protocol) &&
    parsed.host.toLowerCase() === String(headers.host).toLowerCase(),
  );
}

export function accessError(headers, env = process.env) {
  if (!env.VERCEL && !isAllowedBrowserOrigin(headers))
    return {
      status: 403,
      error: "Requests from this browser origin are not allowed.",
    };
  const token = env.NEEDLE_ACCESS_TOKEN?.trim();
  if (env.VERCEL && !token)
    return {
      status: 503,
      error:
        "Set NEEDLE_ACCESS_TOKEN on the server before sharing this deployment.",
    };
  if (token && headers["x-needle-token"] !== token)
    return { status: 401, error: "Set the Needle access token in settings." };
  return null;
}
