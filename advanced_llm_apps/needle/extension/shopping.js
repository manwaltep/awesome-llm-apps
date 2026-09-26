const LIST_CHECK =
  /\b(?:check|confirm|read|review|show|summari[sz]e|recap|tell me|what(?:'s| is)|what do i have|what have i got)\b.{0,48}\b(?:my|our|the)?\s*(?:shopping\s+)?list\b/i;
const SEARCH_REQUEST = /\b(?:find|search|look for|compare|check for)\b/i;
const PRICE_PATTERN =
  /\$\s?\d{1,4}(?:[.,]\d{1,2})?|\b\d{1,4}(?:[.,]\d{1,2})?\s*(?:dollars?|bucks)\b|\b\d{1,4}\s+dollars?\s+and\s+\d{1,2}\s+cents?\b/i;

const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function isExplicitListCheck(transcript) {
  const text = String(transcript || "").trim();
  return (
    LIST_CHECK.test(text) ||
    /\b(?:my|our|the)\s+(?:shopping\s+)?list\b.{0,32}\b(?:check|confirm|read|review|show)\b/i.test(
      text,
    )
  );
}

function storeFromText(text) {
  if (/\bcoles\b/i.test(text)) return "Coles";
  if (/\b(?:woolworths|woolies)\b/i.test(text)) return "Woolworths";
  return "";
}

function priceFromText(text) {
  const spokenAmount = text.match(
    /\b(\d{1,4})\s+dollars?\s+and\s+(\d{1,2})\s+cents?\b/i,
  );
  if (spokenAmount)
    return `$${spokenAmount[1]}.${spokenAmount[2].padStart(2, "0")}`;
  const match = text.match(PRICE_PATTERN)?.[0];
  if (!match) return "";
  const amount = match.replace(/^(?:\$|AUD\s*)/i, "").trim();
  if (/\b(?:dollars?|bucks)\b/i.test(amount)) {
    const number = amount.match(/\d+(?:[.,]\d{1,2})?/)?.[0];
    return number ? formatPrice(number) : "";
  }
  return formatPrice(amount);
}

function formatPrice(amount) {
  const [dollars, cents = ""] = String(amount).replace(",", ".").split(".");
  return `$${dollars}.${cents.padEnd(2, "0").slice(0, 2)}`;
}

function matchesListedItem(text, items) {
  const normalizedText = ` ${normalize(text)} `;
  return (Array.isArray(items) ? items : []).filter((item) => {
    const name = normalize(item?.name);
    return name && normalizedText.includes(` ${name} `);
  });
}

function hasStoreAcquisitionIntent(text) {
  return /\b(?:i want|i need|i(?:'d| would) like|can you get|could you get|would you get|i(?:'m| am) looking at|looking at|i saw|i found|i got|grab|pick up|buy|please get)\b/i.test(
    text,
  );
}

function explicitlyLookingAt(text) {
  return /\b(?:i(?:'m| am) looking at|looking at)\b/i.test(text);
}

function hasAddIntent(text) {
  return /\b(?:add|put|include)\b/i.test(text);
}

function isFoundOrBought(text) {
  return /\b(?:i found|found|i got|got|picked up|grabbed|bought|purchased|collected|checked off|crossed off|already have|put .{1,50} (?:in|into) (?:my )?(?:trolley|cart|basket))\b/i.test(
    text,
  );
}

function candidateItemName(text) {
  let item = String(text || "").trim();
  const price = item.match(PRICE_PATTERN);
  if (price?.index !== undefined) item = item.slice(0, price.index).trim();

  const retailerClause = item.match(
    /\b(?:from|at|in)\s+(?:the\s+)?(?:woolworths?|woolies?|coles)\b/i,
  );
  if (retailerClause?.index !== undefined)
    item = item.slice(0, retailerClause.index).trim();
  else {
    const retailer = item.match(/\b(?:woolworths?|woolies?|coles)\b/i);
    if (retailer?.index !== undefined)
      item = item.slice(0, retailer.index).trim();
  }

  item = item
    .replace(
      /\b(?:to|on)\s+(?:my\s+)?(?:shopping\s+)?(?:list|cart|trolley|basket)\b.*$/i,
      "",
    )
    .replace(/[.!?,;:]+$/g, "")
    .trim();
  let previous = "";
  while (item && item !== previous) {
    previous = item;
    item = item
      .replace(
        /^(?:hey\s+)?(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:add|put|include|get|grab|buy|pick\s+up|i\s+(?:want|need|found|got|saw)|i(?:'m| am)\s+looking\s+at|looking\s+at|i(?:'d| would)\s+like)\s+/i,
        "",
      )
      .replace(/^(?:the|a|an|some)\s+/i, "")
      .trim();
  }
  return item.replace(/[.!?,;:]+$/g, "").trim();
}

export function parseVoiceShoppingActions(transcript, items = []) {
  const text = String(transcript || "").trim();
  const addItems = [];
  const completedItems = [];
  const listCheck = isExplicitListCheck(text);
  if (!text || listCheck) return { addItems, completedItems, listCheck };

  const matchedItems = matchesListedItem(text, items);
  if (isFoundOrBought(text) && matchedItems.length) {
    completedItems.push(...matchedItems.map((item) => item.id));
    return { addItems, completedItems, listCheck };
  }

  if (SEARCH_REQUEST.test(text)) return { addItems, completedItems, listCheck };

  const store = storeFromText(text);
  const addIntent = hasAddIntent(text);
  const identifiedItemIntent =
    (store && hasStoreAcquisitionIntent(text)) || explicitlyLookingAt(text);
  if (!addIntent && !identifiedItemIntent)
    return { addItems, completedItems, listCheck };

  const name = candidateItemName(text);
  if (
    !name ||
    /^(?:it|this|that|one|ones|item|product|the item|that one|this one)$/i.test(
      name,
    )
  )
    return { addItems, completedItems, listCheck };
  addItems.push({ name, store, price: priceFromText(text) });
  return { addItems, completedItems, listCheck };
}
