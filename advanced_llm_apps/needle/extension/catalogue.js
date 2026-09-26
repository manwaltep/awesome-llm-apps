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

export function isRetailerSearchPage(store, rawUrl) {
  if (!isOfficialRetailerUrl(store, rawUrl)) return false;
  try {
    const pathname = new URL(rawUrl).pathname.toLocaleLowerCase();
    return store === "woolworths"
      ? /^\/shop\/search\/products(?:\/|$)/.test(pathname)
      : /^\/search(?:\/|$)/.test(pathname);
  } catch {
    return false;
  }
}

export function retailersFromRequest(request) {
  const text = String(request || "").toLocaleLowerCase();
  const mentions = [];
  for (const [store, pattern] of [
    ["woolworths", /\bwoolworths?\b|\bwoolies?\b/gi],
    ["coles", /\bcoles\b/gi],
  ]) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index - 48), match.index);
      const negated =
        /\b(?:not|never|without|except|rather than|instead of|don't|do not)(?:\s+\w+){0,3}\s*$/i.test(
          before,
        );
      mentions.push({ store, negated });
    }
  }

  if (!mentions.length) return ["woolworths", "coles"];
  const selected = [
    ...new Set(
      mentions.filter((item) => !item.negated).map((item) => item.store),
    ),
  ];
  if (selected.length) return selected;
  const excluded = new Set(mentions.map((item) => item.store));
  return ["woolworths", "coles"].filter((store) => !excluded.has(store));
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
      /^(?:(?:no|nope|nah|yes|yeah|yep|yup|sure|okay|ok|alright)\s*[,;:.!?]\s*)+/i,
      "",
    )
    .replace(
      /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:find(?: me)?|search(?: for)?|look(?:ing)?(?: up)?(?: for)?|show(?: me)?|compare|check(?: for)?|(?:get|grab)(?:\s+me)?|look up)\s+/i,
      "",
    )
    .replace(
      /^(?:i|we)\s+(?:need|want|would like|need to find)\s+(?:some\s+)?/i,
      "",
    )
    .replace(/^(?:some|a|an)\s+/i, "")
    .replace(
      /\s+(?:at|from|in)\s+(?:woolworths?|woolies?|coles)(?: supermarket)?[.!?]*$/i,
      "",
    )
    .replace(/\s+(?:please|as well|too)[.!?]*$/i, "")
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
  const isProductLink = (link) => {
    try {
      const url = new URL(link.href, location.href);
      return (
        url.hostname === location.hostname &&
        /product|item/i.test(`${url.pathname} ${url.search}`)
      );
    } catch {
      return false;
    }
  };
  const isMetaLine = (line) =>
    /^(?:add to (?:cart|trolley)|save to list|view details|shop now|sold by\b)/i.test(
      line,
    ) ||
    /(?:A?\$|\bAUD\s*)\s*\d/i.test(line) ||
    /\b(?:save|half price|special|off)\b/i.test(line) ||
    /^\d+(?:\.\d+)?\s*\/\s*\d+/i.test(line);
  const findCard = (link) => {
    let element = link;
    for (let depth = 0; element && depth < 9; depth += 1) {
      if (!visible(element)) {
        element = element.parentElement;
        continue;
      }
      const text = normalize(element.innerText);
      if (text.length > 1000) break;
      const hasPrice = /(?:A?\$|\bAUD\s*)\s*\d/i.test(text);
      const hasAction =
        /\badd to (?:cart|trolley)\b|\bsave to list\b/i.test(text);
      const hasTitle =
        [...element.querySelectorAll(titleSelectors)].some(
          (heading) => normalize(heading.innerText).length > 2,
        ) ||
        normalize(link.innerText).length > 2 ||
        normalize(element.querySelector("img[alt]")?.alt).length > 2;
      if (text.length >= 12 && (hasPrice || hasAction) && hasTitle)
        return element;
      element = element.parentElement;
    }
    return null;
  };
  const links = [...document.querySelectorAll("a[href]")]
    .filter(visible)
    .filter(isProductLink);
  const entries = [];
  const seen = new Set();
  for (const link of links) {
    const element = findCard(link);
    if (!element) continue;
    const text = element.innerText || "";
    const lines = text
      .split(/\n+/)
      .map(normalize)
      .filter(Boolean);
    const heading = [...element.querySelectorAll(titleSelectors)].find(
      (candidate) => {
        const value = normalize(candidate.innerText);
        return value.length > 2 && !isMetaLine(value);
      },
    );
    const linkText = normalize(link.innerText);
    const imageTitle = normalize(element.querySelector("img[alt]")?.alt);
    const descriptiveLines = lines.filter((line) => !isMetaLine(line));
    const priceIndex = lines.findIndex((line) =>
      /(?:A?\$|\bAUD\s*)\s*\d/i.test(line),
    );
    const afterPrice =
      priceIndex >= 0
        ? lines.slice(priceIndex + 1).filter((line) => !isMetaLine(line))
        : [];
    const fallbackTitleLines = afterPrice.length ? afterPrice : descriptiveLines;
    const title = normalize(
      heading?.innerText ||
        (!isMetaLine(linkText) ? linkText : "") ||
        imageTitle ||
        fallbackTitleLines.join(" "),
    );
    if (!title || title.length > 180) continue;
    const key = `${title.toLocaleLowerCase()}|${link.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const detail = lines
      .filter((line) => line !== title)
      .join(" · ")
      .slice(0, 600);
    entries.push({ title, detail, href: link.href });
    if (entries.length >= 160) break;
  }
  return entries;
}
