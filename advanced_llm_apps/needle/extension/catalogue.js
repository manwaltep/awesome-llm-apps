const RETAILER_DOMAINS = {
  woolworths: ["woolworths.com.au"],
  coles: ["coles.com.au"],
};

function hostnameFor(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" ? url.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

export function isOfficialRetailerUrl(store, rawUrl) {
  const host = hostnameFor(rawUrl);
  return Boolean(
    host &&
    RETAILER_DOMAINS[store]?.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    ),
  );
}

export function retailerForUrl(rawUrl) {
  return Object.keys(RETAILER_DOMAINS).find((store) =>
    isOfficialRetailerUrl(store, rawUrl),
  );
}

export function retailerSearchUrl(store, query) {
  const term = String(query || "").trim();
  if (!RETAILER_DOMAINS[store]) throw new Error("Unsupported retailer.");
  if (!term) throw new Error("Enter a product or catalogue search.");
  const encoded = encodeURIComponent(term);
  if (store === "woolworths")
    return `https://www.woolworths.com.au/shop/search/products?searchTerm=${encoded}`;
  return `https://www.coles.com.au/search?q=${encoded}`;
}

export function retailerSearchTerm(query) {
  return String(query || "")
    .trim()
    .replace(
      /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:find(?: me)?|search(?: for)?|look(?:ing)? for|show(?: me)?|compare|check(?: for)?)\s+/i,
      "",
    )
    .replace(/^(?:i|we)\s+(?:need|want)\s+(?:some\s+)?/i, "")
    .replace(
      /\s+(?:at|from|in)\s+(?:woolworths?|woolies?|coles)(?: supermarket)?[.!?]*$/i,
      "",
    )
    .trim();
}

export function normalizeRetailerCards(store, pageUrl, entries) {
  if (!RETAILER_DOMAINS[store] || retailerForUrl(pageUrl) !== store) return [];
  const output = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const title = String(entry?.title || "")
      .replace(/\s+/g, " ")
      .trim();
    const detail = String(entry?.detail || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length > 180 || detail.length > 600) continue;
    const generic = /^(?:add to trolley|add to cart|view details|shop now)$/i;
    if (generic.test(title)) continue;
    let url;
    try {
      url = new URL(entry?.href || pageUrl, pageUrl).href;
    } catch {
      continue;
    }
    if (!isOfficialRetailerUrl(store, url)) continue;
    const key = `${title.toLocaleLowerCase()}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      id: `b${output.length}`,
      store,
      title,
      detail,
      text: [title, detail].filter(Boolean).join("\n"),
      url,
    });
    if (output.length >= 160) break;
  }
  return output;
}

// This function is injected into a retailer tab by chrome.scripting. Keep it
// self-contained so Chrome can serialize it into the page's execution context.
export function extractRetailerPage() {
  const visible = (element) =>
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden";
  const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
  const titleSelectors =
    "h2,h3,h4,[data-testid*='title'],[class*='product-title'],[class*='ProductTitle']";
  const cardSelectors = [
    "main article",
    "main [data-testid*='product']",
    "main [data-testid*='Product']",
    "main [class*='productTile']",
    "main [class*='ProductTile']",
    "main [class*='product-card']",
    "main [class*='ProductCard']",
    "main [class*='productCard']",
  ].join(",");
  const productLink = (element) =>
    [...element.querySelectorAll("a[href]")].find((link) => {
      try {
        const url = new URL(link.href, location.href);
        return (
          url.hostname === location.hostname &&
          /product|item/i.test(`${url.pathname} ${url.search}`)
        );
      } catch {
        return false;
      }
    });
  const candidates = [...document.querySelectorAll(cardSelectors)]
    .filter(visible)
    .filter((element) => {
      const text = normalize(element.innerText);
      return text.length >= 8 && text.length <= 1000 && productLink(element);
    })
    .sort(
      (a, b) => normalize(a.innerText).length - normalize(b.innerText).length,
    );
  const roots = candidates.filter(
    (element) =>
      !candidates.some((other) => other !== element && other.contains(element)),
  );
  const entries = [];
  for (const element of roots) {
    const link = productLink(element);
    const text = element.innerText || "";
    const lines = text
      .split(/\n+/)
      .map(normalize)
      .filter(
        (line) =>
          line && !/^(?:add to trolley|add to cart|view details)$/i.test(line),
      );
    const heading = element.querySelector(titleSelectors);
    const imageTitle = element.querySelector("img[alt]")?.alt;
    const title = normalize(
      heading?.innerText || imageTitle || link?.innerText || lines[0],
    );
    if (!title || title.length > 180) continue;
    const detail = lines
      .filter((line) => line !== title)
      .join(" · ")
      .slice(0, 600);
    entries.push({ title, detail, href: link?.href || location.href });
    if (entries.length >= 160) break;
  }
  return entries;
}
