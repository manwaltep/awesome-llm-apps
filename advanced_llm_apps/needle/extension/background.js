import {
  extractRetailerPage,
  isOfficialRetailerUrl,
  normalizeRetailerCards,
  retailerSearchUrl,
} from "./catalogue.js";

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  if (reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() =>
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }),
);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "needle-search-page") return;
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["text-range.js", "content.js"],
    });
  } catch {
    await chrome.runtime.openOptionsPage();
  }
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isSearchPage(store, rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (
      isOfficialRetailerUrl(store, rawUrl) &&
      (store === "woolworths"
        ? url.pathname.includes("/shop/search/products")
        : url.pathname === "/search")
    );
  } catch {
    return false;
  }
}

async function openSearchTab(store, query, previousId) {
  const url = retailerSearchUrl(store, query);
  let existing;
  if (previousId)
    existing = await chrome.tabs.get(previousId).catch(() => null);
  const tab =
    existing && isSearchPage(store, existing.url)
      ? await chrome.tabs.update(existing.id, { url, active: false })
      : await chrome.tabs.create({ url, active: false });
  const deadline = Date.now() + 20000;
  let ready = tab;
  while (Date.now() < deadline) {
    ready = await chrome.tabs.get(tab.id).catch(() => null);
    if (!ready || ready.status === "complete") break;
    await pause(250);
  }
  await pause(900);
  return ready;
}

async function readCardsWithRetry(store, tab) {
  if (!tab?.id || !isOfficialRetailerUrl(store, tab.url)) return [];
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const [capture] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractRetailerPage,
      });
      const cards = normalizeRetailerCards(store, tab.url, capture?.result);
      if (cards.length) return cards;
    } catch {
      // The retailer page may still be replacing its initial app shell.
    }
    await pause(750);
  }
  return [];
}

async function searchCatalogues(query, retailerQuery = query) {
  if (typeof query !== "string" || !query.trim() || query.length > 400)
    return { error: "Describe a product or offer to search for." };
  if (
    typeof retailerQuery !== "string" ||
    !retailerQuery.trim() ||
    retailerQuery.length > 200
  )
    return { error: "Jev could not prepare an official catalogue search." };
  const { server = "http://127.0.0.1:4199", token = "" } =
    await chrome.storage.local.get(["server", "token"]);
  const { jevSearchTabs = {} } =
    await chrome.storage.session.get("jevSearchTabs");
  chrome.runtime
    .sendMessage({
      type: "CATALOGUE_PROGRESS",
      text: "Opening official Woolworths and Coles search pages…",
    })
    .catch(() => {});
  const stores = ["woolworths", "coles"];
  const tabs = await Promise.all(
    stores.map((store) =>
      openSearchTab(store, retailerQuery.trim(), jevSearchTabs[store]),
    ),
  );
  const updatedTabIds = {};
  const cardsByStore = await Promise.all(
    stores.map(async (store, index) => {
      const tab = tabs[index];
      if (!tab?.id || !isOfficialRetailerUrl(store, tab.url)) return [];
      updatedTabIds[store] = tab.id;
      return readCardsWithRetry(store, tab);
    }),
  );
  await chrome.storage.session.set({ jevSearchTabs: updatedTabIds });
  const cards = [];
  let totalTextLength = 0;
  for (const card of cardsByStore.flat()) {
    if (cards.length >= 160 || totalTextLength + card.text.length > 60000)
      break;
    cards.push({ ...card, id: `b${cards.length}` });
    totalTextLength += card.text.length;
  }
  if (!cards.length)
    return {
      error:
        "The catalogue pages did not expose readable product cards. Check the two search tabs and try again.",
    };
  chrome.runtime
    .sendMessage({
      type: "CATALOGUE_PROGRESS",
      text: `Jev is comparing ${cards.length} visible catalogue products…`,
    })
    .catch(() => {});
  let response;
  try {
    response = await fetch(`${server}/api/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-needle-token": token } : {}),
      },
      body: JSON.stringify({
        query: query.trim(),
        blocks: cards.map(({ id, text }) => ({ id, text })),
      }),
      signal: AbortSignal.timeout(55000),
    });
    const result = await response.json();
    if (!response.ok)
      return {
        error: result.error || "Jev could not search these catalogues.",
      };
    const byId = new Map(cards.map((card) => [card.id, card]));
    return {
      query: query.trim(),
      elapsedMs: result.elapsedMs,
      offers: (result.matches || [])
        .map((match) => ({
          ...byId.get(match.id),
          probability: match.probability,
          focus: match.focus,
        }))
        .filter((offer) => offer.title && offer.url),
      productsSeen: cards.length,
    };
  } catch {
    return {
      error:
        "Cannot reach Jev. Check the local Needle server and its Gateway key.",
    };
  }
}

async function interpretShoppingIntent(payload) {
  const { server = "http://127.0.0.1:4199", token = "" } =
    await chrome.storage.local.get(["server", "token"]);
  try {
    const response = await fetch(`${server}/api/shopping-intent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-needle-token": token } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    const data = await response.json();
    return response.ok
      ? data
      : { error: data.error || "Text list updates are unavailable." };
  } catch {
    return { error: "Cannot reach the Needle server for text list updates." };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "NEEDLE_SETTINGS") {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (message.type === "CATALOGUE_SEARCH") {
    searchCatalogues(message.query, message.retailerQuery).then(
      sendResponse,
      () =>
        sendResponse({
          error: "Jev could not complete this catalogue search.",
        }),
    );
    return true;
  }
  if (message.type === "SHOPPING_INTENT") {
    interpretShoppingIntent(message.payload).then(sendResponse, () =>
      sendResponse({ error: "Text list updates are unavailable." }),
    );
    return true;
  }
  if (message.type === "NEEDLE_START_PAGE_SEARCH") {
    chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => {
        if (!tab?.id)
          return sendResponse({ error: "No active page is available." });
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: ["text-range.js", "content.js"],
          })
          .then(
            () => sendResponse({ ok: true }),
            () => sendResponse({ error: "This page cannot be searched." }),
          );
      });
    return true;
  }
  if (message.type !== "NEEDLE_SEARCH" || !sender.tab) return;
  (async () => {
    const { server = "http://127.0.0.1:4199", token = "" } =
      await chrome.storage.local.get(["server", "token"]);
    try {
      const response = await fetch(`${server}/api/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-needle-token": token } : {}),
        },
        body: JSON.stringify(message.payload),
        signal: AbortSignal.timeout(55000),
      });
      const data = await response.json();
      sendResponse(
        response.ok
          ? data
          : {
              error: data.error || "Search failed. Check your server settings.",
            },
      );
    } catch {
      sendResponse({
        error:
          "Cannot reach Needle. Start the server or check extension settings.",
      });
    }
  })();
  return true;
});
