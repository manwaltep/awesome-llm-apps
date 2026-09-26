import {
  extractRetailerPage,
  isOfficialRetailerUrl,
  isRetailerSearchPage,
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
const searchTabOperations = new Map();
let searchTabStorageQueue = Promise.resolve();

function rememberSearchTab(store, tabId) {
  const update = searchTabStorageQueue
    .catch(() => {})
    .then(async () => {
      const { jevSearchTabs = {} } =
        await chrome.storage.session.get("jevSearchTabs");
      await chrome.storage.session.set({
        jevSearchTabs: { ...jevSearchTabs, [store]: tabId },
      });
    });
  searchTabStorageQueue = update;
  return update;
}

async function openSearchTabNow(store, query, previousId) {
  const url = retailerSearchUrl(store, query);
  let existing;
  if (previousId)
    existing = await chrome.tabs.get(previousId).catch(() => null);
  if (!isRetailerSearchPage(store, existing?.url)) {
    const openTabs = await chrome.tabs.query({});
    existing = openTabs
      .filter((tab) => isRetailerSearchPage(store, tab.url))
      .sort((left, right) => Number(right.active) - Number(left.active))[0];
  }
  const tab = existing?.id
    ? await chrome.tabs.update(existing.id, { url, active: false })
    : await chrome.tabs.create({ url, active: false });
  await rememberSearchTab(store, tab.id);
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

function openSearchTab(store, query, previousId) {
  const previousOperation = searchTabOperations.get(store) || Promise.resolve();
  const operation = previousOperation
    .catch(() => null)
    .then(async () => {
      const { jevSearchTabs = {} } =
        await chrome.storage.session.get("jevSearchTabs");
      return openSearchTabNow(store, query, jevSearchTabs[store] || previousId);
    });
  searchTabOperations.set(store, operation);
  return operation.finally(() => {
    if (searchTabOperations.get(store) === operation)
      searchTabOperations.delete(store);
  });
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

async function searchCatalogues(query, retailerQuery = query, requestedStores) {
  if (typeof query !== "string" || !query.trim() || query.length > 400)
    return { error: "Describe a product or offer to search for." };
  if (
    typeof retailerQuery !== "string" ||
    !retailerQuery.trim() ||
    retailerQuery.length > 200
  )
    return { error: "Jev could not prepare an official catalogue search." };
  const supportedStores = ["woolworths", "coles"];
  const stores = Array.isArray(requestedStores)
    ? [
        ...new Set(
          requestedStores.filter((store) => supportedStores.includes(store)),
        ),
      ]
    : supportedStores;
  if (!stores.length)
    return { error: "Choose Woolworths, Coles, or both for this search." };
  const { server = "http://127.0.0.1:4199", token = "" } =
    await chrome.storage.local.get(["server", "token"]);
  const { jevSearchTabs = {} } =
    await chrome.storage.session.get("jevSearchTabs");
  const storeLabels = stores.map((store) =>
    store === "coles" ? "Coles" : "Woolworths",
  );
  chrome.runtime
    .sendMessage({
      type: "CATALOGUE_PROGRESS",
      text: `Opening the official ${storeLabels.join(" and ")} search ${stores.length === 1 ? "tab" : "tabs"}…`,
    })
    .catch(() => {});
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
  if (Object.keys(updatedTabIds).length) {
    const update = searchTabStorageQueue
      .catch(() => {})
      .then(async () => {
        const { jevSearchTabs: latestTabs = {} } =
          await chrome.storage.session.get("jevSearchTabs");
        await chrome.storage.session.set({
          jevSearchTabs: { ...latestTabs, ...updatedTabIds },
        });
      });
    searchTabStorageQueue = update;
    await update;
  }
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
      text: `Jev is comparing ${cards.length} visible ${storeLabels.join(" and ")} catalogue products…`,
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
    searchCatalogues(message.query, message.retailerQuery, message.stores).then(
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
