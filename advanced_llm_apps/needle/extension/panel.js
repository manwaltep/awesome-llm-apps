import {
  isOfficialRetailerUrl,
  retailersFromRequest,
  retailerSearchTerm,
} from "./catalogue.js";
import {
  createVoiceIntroductionEvent,
  catalogueQueryForVoiceTurn,
  classifyBareVoiceReply,
  microphonePermissionMessage,
  needsMicrophonePermissionTab,
  createVoiceListCheckEvent,
  prepareVoiceCatalogueOffers,
  prepareVisibleCatalogueOffers,
  resolveJevVisibleCatalogueMatch,
  resolveVoiceCatalogueConfirmation,
} from "./voice.js";
import {
  isGenericListRemoval,
  isGenericListReference,
  parseVoiceShoppingActions,
  parseVoiceShoppingRemovals,
  isVoiceShoppingRemoval,
} from "./shopping.js";

const $ = (selector) => document.querySelector(selector);
const searchForm = $("#search-form");
const queryInput = $("#query");
const storeScopeButtons = [...document.querySelectorAll("[data-store-scope]")];
const scopeHelp = $("#scope-help");
const searchStatus = $("#search-status");
const offersNode = $("#offers");
const retailerAccessButton = $("#retailer-access");
const voiceButton = $("#voice-toggle");
const voiceLabel = $("#voice-button-label");
const voiceStatus = $("#voice-status");
const voiceConnection = $("#voice-connection");
const voiceConnectionLabel = $("#voice-connection-label");
const transcriptNode = $("#transcript");
const listNode = $("#shopping-list");
const actionNote = $("#action-note");
const notesInput = $("#notes");
const retailerOrigins = {
  woolworths: ["https://woolworths.com.au/*", "https://*.woolworths.com.au/*"],
  coles: ["https://coles.com.au/*", "https://*.coles.com.au/*"],
};

let shoppingList = [];
let editingListItemId = null;
let retailerScope = "auto";
let notes = "";
let settings = { server: "http://127.0.0.1:4199", token: "" };
let savingNotes;
let voiceSocket;
let audioContext;
let micStream;
let micSource;
let processor;
let muteNode;
let playhead = 0;
let playingSources = new Set();
let sessionReady = false;
let startingVoice = false;
let voiceAttempt = 0;
let activeVoiceResponse = null;
let pendingListReadback = false;
let pendingCatalogueSearch = null;
let receivedItems = new Set();
let pendingVoiceOffers = [];
let visibleCatalogueOffers = [];
let catalogueSearchSequence = 0;
let voiceTurnSequence = 0;
let awaitingSearchTerms = false;
let awaitingSearchStores = [];

function setStatus(node, message, error = false) {
  node.textContent = message;
  node.classList.toggle("error", Boolean(error));
}

function storesForScope(requestedStores, query) {
  if (retailerScope === "coles") return ["coles"];
  if (retailerScope === "woolworths") return ["woolworths"];
  if (retailerScope === "both") return ["woolworths", "coles"];
  return requestedStores?.length
    ? requestedStores
    : retailersFromRequest(query);
}

function originsForStores(stores) {
  return [
    ...new Set(
      (Array.isArray(stores) ? stores : []).flatMap(
        (store) => retailerOrigins[store] || [],
      ),
    ),
  ];
}

function setRetailerScope(scope, persist = true) {
  retailerScope = ["auto", "both", "coles", "woolworths"].includes(scope)
    ? scope
    : "auto";
  for (const button of storeScopeButtons)
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.storeScope === retailerScope),
    );
  scopeHelp.textContent =
    retailerScope === "auto"
      ? "Auto follows a retailer named in your request, or searches both."
      : retailerScope === "both"
        ? "Searches both, regardless of retailer named."
        : retailerScope === "coles"
          ? "Searches Coles only, regardless of retailer named."
          : "Searches Woolworths only, regardless of retailer named.";
  if (persist) chrome.storage.local.set({ retailerScope });
  updateRetailerAccessButton();
}

function setVoiceConnection(state, label) {
  voiceConnection.dataset.state = state;
  voiceConnectionLabel.textContent = label;
  voiceConnection.setAttribute("aria-label", `Voice ${label.toLowerCase()}`);
}

function addTranscript(speaker, text) {
  const placeholder = transcriptNode.querySelector(".transcript-placeholder");
  placeholder?.remove();
  const row = document.createElement("p");
  const label = document.createElement("span");
  label.className = "speaker";
  label.textContent = `${speaker}: `;
  row.append(label, document.createTextNode(text));
  transcriptNode.append(row);
  while (transcriptNode.children.length > 12)
    transcriptNode.firstElementChild.remove();
  transcriptNode.scrollTop = transcriptNode.scrollHeight;
}

function createListEditForm(item) {
  const form = document.createElement("form");
  form.className = "list-edit";

  const name = document.createElement("input");
  name.className = "list-edit-name";
  name.type = "text";
  name.maxLength = 100;
  name.required = true;
  name.value = item.name;
  name.setAttribute("aria-label", "Item name");

  const price = document.createElement("input");
  price.type = "text";
  price.maxLength = 24;
  price.value = item.price || "";
  price.placeholder = "Price";
  price.setAttribute("aria-label", "Item price");

  const store = document.createElement("select");
  store.setAttribute("aria-label", "Retailer");
  for (const [value, label] of [
    ["", "No retailer"],
    ["Coles", "Coles"],
    ["Woolworths", "Woolworths"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    store.append(option);
  }
  store.value = item.store || "";

  const actions = document.createElement("div");
  actions.className = "list-edit-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "list-edit-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editingListItemId = null;
    renderList();
  });
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "list-edit-save";
  save.textContent = "Save";
  actions.append(cancel, save);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const cleanName = name.value.trim().replace(/\s+/g, " ");
    if (!cleanName) {
      actionNote.textContent = "Enter an item name before saving.";
      name.focus();
      return;
    }
    const cleanPrice = price.value.trim();
    const selectedStore = store.value;
    shoppingList = shoppingList.map((entry) => {
      if (entry.id !== item.id) return entry;
      const updated = { ...entry, name: cleanName };
      if (cleanPrice) updated.price = cleanPrice;
      else delete updated.price;
      if (selectedStore) updated.store = selectedStore;
      else delete updated.store;
      return updated;
    });
    editingListItemId = null;
    await chrome.storage.local.set({ shoppingList });
    actionNote.textContent = `You updated ${cleanName}.`;
    renderList();
  });

  form.append(name, price, store, actions);
  return form;
}

function renderList() {
  listNode.replaceChildren();
  const pending = shoppingList.filter((item) => !item.checked).length;
  $("#list-count").textContent = String(pending);
  if (!shoppingList.length) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = "Your list is ready for items.";
    listNode.append(empty);
    return;
  }
  for (const item of shoppingList) {
    const row = document.createElement("li");
    if (editingListItemId === item.id) {
      row.className = "list-row list-row-editing";
      row.append(createListEditForm(item));
      listNode.append(row);
      continue;
    }
    row.className = `list-row${item.checked ? " checked" : ""}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(item.checked);
    checkbox.setAttribute(
      "aria-label",
      `${item.checked ? "Uncheck" : "Check off"} ${item.name}`,
    );
    checkbox.addEventListener("change", () => {
      shoppingList = shoppingList.map((entry) =>
        entry.id === item.id ? { ...entry, checked: checkbox.checked } : entry,
      );
      chrome.storage.local.set({ shoppingList });
      actionNote.textContent = checkbox.checked
        ? `You checked off ${item.name}.`
        : `You moved ${item.name} back to your list.`;
      renderList();
    });
    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = item.name;
    row.append(checkbox, name);
    if (item.price) {
      const price = document.createElement("span");
      price.className = "item-price";
      price.textContent = item.price;
      row.append(price);
    }
    if (item.store === "Coles" || item.store === "Woolworths") {
      const store = document.createElement("span");
      store.className = `item-store${item.store === "Coles" ? " coles" : ""}`;
      store.textContent = item.store;
      row.append(store);
    }
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "edit-item";
    edit.setAttribute("aria-label", `Edit ${item.name}`);
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editingListItemId = item.id;
      renderList();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-item";
    remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      shoppingList = shoppingList.filter((entry) => entry.id !== item.id);
      chrome.storage.local.set({ shoppingList });
      actionNote.textContent = `You removed ${item.name} from the list.`;
      renderList();
    });
    row.append(edit, remove);
    listNode.append(row);
  }
}

function addManualItem(name, metadata = {}) {
  const clean = String(name || "")
    .trim()
    .replace(/\s+/g, " ");
  const options =
    typeof metadata === "string" ? { store: metadata } : metadata || {};
  const store = options.store;
  const price = String(options.price || "").trim();
  const sourceStore = ["Coles", "Woolworths"].includes(store) ? store : "";
  if (!clean) return false;
  const existing = shoppingList.find((item) => {
    const sameName =
      item.name.toLocaleLowerCase() === clean.toLocaleLowerCase();
    const sameStore = !sourceStore || !item.store || item.store === sourceStore;
    return sameName && sameStore;
  });
  if (existing) {
    const updated = {
      ...existing,
      ...(sourceStore && !existing.store ? { store: sourceStore } : {}),
      ...(price && !existing.price ? { price } : {}),
    };
    if (updated.store !== existing.store || updated.price !== existing.price) {
      shoppingList = shoppingList.map((item) =>
        item.id === existing.id ? updated : item,
      );
      chrome.storage.local.set({ shoppingList });
      renderList();
    }
    return false;
  }
  shoppingList = [
    ...shoppingList,
    {
      id: crypto.randomUUID(),
      name: clean,
      ...(sourceStore ? { store: sourceStore } : {}),
      ...(price ? { price } : {}),
      checked: false,
    },
  ];
  chrome.storage.local.set({ shoppingList });
  renderList();
  return true;
}

function addCatalogueOfferToList(offer) {
  if (!offer) return false;
  const store = offer.store === "coles" ? "Coles" : "Woolworths";
  const price =
    offer.price || offer.detail?.match(/\$\s?\d+(?:[.,]\d{1,2})?/)?.[0] || "";
  return addManualItem(offer.title, { store, price });
}

function bestJevOffer(matches, offers) {
  for (const match of Array.isArray(matches) ? matches : []) {
    const index = Number(String(match?.id || "").replace(/^b/, ""));
    if (Number.isInteger(index) && offers[index]) return offers[index];
  }
  return null;
}

function preferredOfferForTranscript(transcript, offers) {
  const choices = Array.isArray(offers) ? offers : [];
  if (!choices.length) return null;
  const mentionsRetailer = /\b(?:coles|woolworths|woolies)\b/i.test(
    String(transcript || ""),
  );
  const requestedStores = mentionsRetailer
    ? retailersFromRequest(transcript).map((store) =>
        store === "coles" ? "Coles" : "Woolworths",
      )
    : [];
  const scopedChoices = requestedStores.length
    ? choices.filter((offer) => requestedStores.includes(offer.store))
    : choices;
  if (!scopedChoices.length) return null;
  const resolved = resolveVoiceCatalogueConfirmation(transcript, scopedChoices);
  if (resolved.kind === "accepted") return resolved.offer;
  if (
    resolved.kind === "ambiguous" ||
    isGenericListReference(transcript) ||
    isGenericListRemoval(transcript)
  )
    return scopedChoices[0];
  return null;
}

function removeCatalogueOfferFromList(offer) {
  if (!offer?.title) return false;
  const name = String(offer.title).normalize("NFKC").toLocaleLowerCase();
  const store = offer.store === "coles" ? "Coles" : "Woolworths";
  const match = shoppingList.find(
    (item) =>
      item.name.normalize("NFKC").toLocaleLowerCase() === name &&
      (!item.store || item.store === store),
  );
  if (!match) return false;
  shoppingList = shoppingList.filter((item) => item.id !== match.id);
  chrome.storage.local.set({ shoppingList });
  renderList();
  return true;
}

function sendPendingListReadback() {
  if (
    !pendingListReadback ||
    !sessionReady ||
    activeVoiceResponse ||
    voiceSocket?.readyState !== WebSocket.OPEN
  )
    return;
  pendingListReadback = false;
  activeVoiceResponse = "list-check";
  voiceSocket.send(JSON.stringify(createVoiceListCheckEvent(shoppingList)));
}

function safeUrl(store, rawUrl) {
  return isOfficialRetailerUrl(store, rawUrl) ? new URL(rawUrl).href : null;
}

function renderOffers(offers, productsSeen = 0) {
  offersNode.replaceChildren();
  if (!offers.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const icon = document.createElement("span");
    icon.className = "empty-spark";
    icon.textContent = "⌕";
    const message = document.createElement("p");
    message.textContent = productsSeen
      ? `Jev found no close match among ${productsSeen} visible catalogue products.`
      : "Jev did not find a catalogue match.";
    empty.append(icon, message);
    offersNode.append(empty);
    return;
  }
  for (const offer of offers) {
    const source = safeUrl(offer.store, offer.url);
    if (!source) continue;
    const card = document.createElement("article");
    card.className = "offer-card";
    const top = document.createElement("div");
    top.className = "offer-top";
    const badge = document.createElement("span");
    badge.className = `store-badge${offer.store === "coles" ? " coles" : ""}`;
    badge.textContent = offer.store === "coles" ? "Coles" : "Woolworths";
    const tag = document.createElement("span");
    tag.className = "offer-match";
    tag.textContent = "Jev match";
    top.append(badge, tag);
    const title = document.createElement("h3");
    title.textContent = offer.title;
    const detail = document.createElement("p");
    detail.textContent =
      offer.detail || "Open the official retailer page for current details.";
    const link = document.createElement("a");
    link.href = source;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open retailer page ↗";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "offer-add";
    addButton.textContent = "Add to list";
    addButton.addEventListener("click", () => addCatalogueOfferToList(offer));
    card.append(top, title, detail);
    if (
      offer.focus?.text &&
      offer.focus.text !== offer.title &&
      offer.focus.text !== offer.detail
    ) {
      const focus = document.createElement("p");
      focus.className = "focus";
      focus.textContent = `Jev matched: ${offer.focus.text}`;
      card.append(focus);
    }
    const actions = document.createElement("div");
    actions.className = "offer-actions";
    actions.append(link, addButton);
    card.append(actions);
    offersNode.append(card);
  }
}

async function updateRetailerAccessButton() {
  try {
    retailerAccessButton.hidden = await chrome.permissions.contains({
      origins: originsForStores(storesForScope(["woolworths", "coles"], "")),
    });
  } catch {
    retailerAccessButton.hidden = false;
  }
}

async function searchCatalogues(
  query,
  retailerQuery = query,
  permissionRequest = null,
  requestedStores = retailersFromRequest(query),
  { voiceTurnId = null } = {},
) {
  const clean = String(query || "").trim();
  if (!clean) return;
  const searchId = ++catalogueSearchSequence;
  pendingVoiceOffers = [];
  visibleCatalogueOffers = [];
  awaitingSearchTerms = false;
  awaitingSearchStores = [];
  if (!Array.isArray(requestedStores) || requestedStores.length === 0) {
    setStatus(
      searchStatus,
      "Choose Woolworths, Coles, or both to search.",
      true,
    );
    return;
  }
  queryInput.value = clean;
  const cleanRetailerQuery = String(retailerQuery || clean).trim();
  setStatus(searchStatus, "Checking catalogue access…");
  let granted = false;
  const requiredOrigins = originsForStores(requestedStores);
  try {
    granted = permissionRequest
      ? await permissionRequest
      : await chrome.permissions.contains({ origins: requiredOrigins });
  } catch {
    granted = false;
  }
  if (!granted) {
    pendingCatalogueSearch = {
      query: clean,
      retailerQuery: cleanRetailerQuery,
      stores: requestedStores,
      voiceTurnId,
    };
    retailerAccessButton.hidden = false;
    setStatus(
      searchStatus,
      "Allow Jev catalogue access below to run this search.",
      true,
    );
    return;
  }
  retailerAccessButton.hidden = true;
  pendingCatalogueSearch = null;
  const storeLabels = requestedStores.map((store) =>
    store === "coles" ? "Coles" : "Woolworths",
  );
  setStatus(
    searchStatus,
    `Jev is searching the ${storeLabels.join(" and ")} catalogue ${requestedStores.length === 1 ? "tab" : "tabs"}…`,
  );
  offersNode.replaceChildren();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "CATALOGUE_SEARCH",
      query: clean,
      retailerQuery: cleanRetailerQuery,
      stores: requestedStores,
    });
    if (!result || result.error)
      throw new Error(result?.error || "Jev could not complete this search.");
    if (searchId !== catalogueSearchSequence) return;
    visibleCatalogueOffers = prepareVisibleCatalogueOffers(result.offers || []);
    renderOffers(result.offers || [], result.productsSeen || 0);
    setStatus(
      searchStatus,
      result.offers?.length
        ? `Jev found ${result.offers.length} sourced match${result.offers.length === 1 ? "" : "es"} in ${result.elapsedMs} ms.`
        : "Search complete. No catalogue match passed Jev’s relevance threshold.",
    );
    if (
      voiceTurnId !== null &&
      sessionReady &&
      voiceTurnId === voiceTurnSequence &&
      voiceSocket?.readyState === WebSocket.OPEN
    ) {
      pendingVoiceOffers = prepareVoiceCatalogueOffers(result.offers || []);
      if (pendingVoiceOffers.length) awaitingSearchStores = [];
      else awaitingSearchStores = [...requestedStores];
      awaitingSearchTerms = pendingVoiceOffers.length === 0;
    }
  } catch (error) {
    if (searchId !== catalogueSearchSequence) return;
    setStatus(searchStatus, error.message, true);
  }
}

async function applyVoiceTranscript(text, itemId) {
  const clean = String(text || "").trim();
  if (!clean || (itemId && receivedItems.has(itemId))) return;
  if (itemId) receivedItems.add(itemId);
  const voiceTurnId = ++voiceTurnSequence;
  const wasAwaitingSearchTerms = awaitingSearchTerms;
  const followupStores = [...awaitingSearchStores];
  addTranscript("You", clean);
  const localActions = parseVoiceShoppingActions(clean, shoppingList);
  const genericListReference = isGenericListReference(clean);
  const bareReply = classifyBareVoiceReply(clean);
  if (localActions.listCheck) {
    $(".list-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    actionNote.textContent = "Your shopping list is shown below.";
    pendingListReadback = true;
    sendPendingListReadback();
    return;
  }

  if (isVoiceShoppingRemoval(clean)) {
    const removalIds = parseVoiceShoppingRemovals(clean, shoppingList);
    if (removalIds.length) {
      const removed = new Set(removalIds);
      shoppingList = shoppingList.filter((item) => !removed.has(item.id));
      chrome.storage.local.set({ shoppingList });
      renderList();
    } else if (isGenericListRemoval(clean)) {
      const offers = pendingVoiceOffers.length
        ? pendingVoiceOffers
        : visibleCatalogueOffers;
      removeCatalogueOfferFromList(preferredOfferForTranscript(clean, offers));
    }
    return;
  }

  if (pendingVoiceOffers.length && !localActions.addItems.length) {
    const choice = resolveVoiceCatalogueConfirmation(clean, pendingVoiceOffers);
    if (choice.kind === "accepted") {
      addCatalogueOfferToList(choice.offer);
      pendingVoiceOffers = [];
      return;
    }
    if (choice.kind === "declined") {
      pendingVoiceOffers = [];
      return;
    }
    if (choice.kind === "ambiguous") {
      if (bareReply === "affirmative") return;
      const offer = preferredOfferForTranscript(clean, pendingVoiceOffers);
      if (offer) {
        addCatalogueOfferToList(offer);
        pendingVoiceOffers = [];
        return;
      }
    }
    if (genericListReference) {
      addCatalogueOfferToList(
        preferredOfferForTranscript(clean, pendingVoiceOffers),
      );
      return;
    }
    // A new request or unrelated reply clears the old choice before processing it.
    pendingVoiceOffers = [];
  }
  if (wasAwaitingSearchTerms && bareReply === "affirmative") {
    actionNote.textContent =
      "No close catalogue match. Say another product name to Jev.";
    return;
  }
  if (wasAwaitingSearchTerms && bareReply === "negative") {
    awaitingSearchTerms = false;
    awaitingSearchStores = [];
    return;
  }
  if (wasAwaitingSearchTerms) {
    awaitingSearchTerms = false;
    awaitingSearchStores = [];
  }
  if (bareReply) return;
  if (!localActions.addItems.length && visibleCatalogueOffers.length) {
    const selection = resolveVoiceCatalogueConfirmation(
      clean,
      visibleCatalogueOffers,
    );
    if (selection.kind === "accepted" || selection.kind === "ambiguous") {
      setStatus(
        searchStatus,
        "Jev is matching your choice to the visible offers…",
      );
      const result = await chrome.runtime
        .sendMessage({
          type: "CATALOGUE_RESOLVE_VISIBLE",
          query: clean,
          offers: visibleCatalogueOffers,
        })
        .catch(() => ({
          matches: [],
          error: "Jev could not reach the matcher.",
        }));
      const jevBest = bestJevOffer(result?.matches, visibleCatalogueOffers);
      const selectedOffer =
        jevBest ||
        (selection.kind === "accepted" ? selection.offer : null) ||
        preferredOfferForTranscript(clean, visibleCatalogueOffers);
      addCatalogueOfferToList(selectedOffer);
      return;
    }
  }
  if (localActions.addItems.length) {
    let visibleChoice = { kind: "none" };
    if (visibleCatalogueOffers.length) {
      const item = localActions.addItems[0];
      const query = [item.name, item.store, item.price]
        .filter(Boolean)
        .join(" ");
      setStatus(
        searchStatus,
        "Jev is matching your item to the visible offers…",
      );
      const result = await chrome.runtime
        .sendMessage({
          type: "CATALOGUE_RESOLVE_VISIBLE",
          query,
          offers: visibleCatalogueOffers,
        })
        .catch(() => ({
          matches: [],
          error: "Jev could not reach the matcher.",
        }));
      visibleChoice = resolveJevVisibleCatalogueMatch(
        result?.matches,
        clean,
        visibleCatalogueOffers,
      );
      const jevBest = bestJevOffer(result?.matches, visibleCatalogueOffers);
      if (visibleChoice.kind !== "accepted" && jevBest)
        visibleChoice = { kind: "accepted", offer: jevBest };
      if (result?.error) {
        setStatus(
          searchStatus,
          visibleChoice.kind === "accepted"
            ? "Jev follow-up was unavailable; using the matching visible offer."
            : "Jev matching is unavailable; using the spoken item details.",
        );
      } else if (visibleChoice.kind === "accepted" && result?.matches?.length) {
        setStatus(searchStatus, "Jev matched the item to a visible offer.");
      } else if (visibleChoice.kind === "accepted") {
        setStatus(searchStatus, "Using the matching visible catalogue offer.");
      } else if (visibleChoice.kind === "ambiguous") {
        setStatus(searchStatus, "Using Jev’s top matching offer.");
      } else {
        setStatus(
          searchStatus,
          "No visible offer matched; using the spoken item details.",
        );
      }
    }
    if (visibleChoice.kind === "accepted") {
      addCatalogueOfferToList(visibleChoice.offer);
      return;
    }
    if (visibleChoice.kind === "ambiguous") {
      addCatalogueOfferToList(
        preferredOfferForTranscript(clean, visibleCatalogueOffers),
      );
      return;
    }
    for (const item of localActions.addItems) addManualItem(item.name, item);
    await chrome.storage.local.set({ shoppingList });
    renderList();
    return;
  }
  if (localActions.completedItems.length) {
    const completed = new Set(localActions.completedItems);
    shoppingList = shoppingList.map((item) =>
      completed.has(item.id) ? { ...item, checked: true } : item,
    );
    await chrome.storage.local.set({ shoppingList });
    renderList();
    return;
  }
  if (genericListReference) {
    if (visibleCatalogueOffers.length) {
      const choice = resolveVoiceCatalogueConfirmation(
        clean,
        visibleCatalogueOffers,
      );
      if (choice.kind === "accepted") {
        addCatalogueOfferToList(choice.offer);
        return;
      }
      addCatalogueOfferToList(
        preferredOfferForTranscript(clean, visibleCatalogueOffers),
      );
      return;
    }
    return;
  }
  const catalogueQuery = catalogueQueryForVoiceTurn({
    transcript: clean,
    awaitingSearchTerms: wasAwaitingSearchTerms,
  });
  if (catalogueQuery) {
    const retailQuery = retailerSearchTerm(catalogueQuery) || catalogueQuery;
    const namesRetailer = /\b(?:woolworths|woolies|coles)\b/i.test(clean);
    const inferredStores = namesRetailer
      ? retailersFromRequest(clean)
      : wasAwaitingSearchTerms && followupStores.length
        ? followupStores
        : retailersFromRequest(clean);
    const requestedStores = storesForScope(inferredStores, clean);
    await searchCatalogues(clean, retailQuery, null, requestedStores, {
      voiceTurnId,
    });
  }
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 2048)
    binary += String.fromCharCode(...bytes.subarray(index, index + 2048));
  return btoa(binary);
}

function playPcm(delta) {
  if (!audioContext || !delta) return;
  const raw = atob(delta);
  const samples = Math.floor(raw.length / 2);
  if (!samples) return;
  const buffer = audioContext.createBuffer(1, samples, 24000);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < samples; index++) {
    const value =
      raw.charCodeAt(index * 2) | (raw.charCodeAt(index * 2 + 1) << 8);
    channel[index] = (value & 0x8000 ? value - 0x10000 : value) / 32768;
  }
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  const startAt = Math.max(audioContext.currentTime + 0.02, playhead);
  source.start(startAt);
  playhead = startAt + buffer.duration;
  playingSources.add(source);
  source.onended = () => playingSources.delete(source);
}

function stopPlayback() {
  for (const source of playingSources) {
    try {
      source.stop();
    } catch {}
  }
  playingSources.clear();
  if (audioContext) playhead = audioContext.currentTime;
}

function sendAudio(frame) {
  if (
    !voiceSocket ||
    voiceSocket.readyState !== WebSocket.OPEN ||
    !sessionReady
  )
    return;
  const samples = frame.getChannelData(0);
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = value < 0 ? value * 32768 : value * 32767;
  }
  voiceSocket.send(
    JSON.stringify({
      type: "input_audio_buffer.append",
      audio: bytesToBase64(pcm.buffer),
    }),
  );
}

async function beginCapture() {
  if (!micStream || !audioContext)
    throw new Error("Microphone access was not ready.");
  if (audioContext.state !== "running") await audioContext.resume();
  if (audioContext.state !== "running")
    throw new Error("Chrome did not start audio playback.");
  micSource = audioContext.createMediaStreamSource(micStream);
  processor = audioContext.createScriptProcessor(1024, 1, 1);
  muteNode = audioContext.createGain();
  muteNode.gain.value = 0;
  processor.onaudioprocess = (event) => sendAudio(event.inputBuffer);
  micSource.connect(processor);
  processor.connect(muteNode);
  muteNode.connect(audioContext.destination);
}

function closeVoice(message = "Microphone is off.") {
  voiceAttempt += 1;
  sessionReady = false;
  startingVoice = false;
  activeVoiceResponse = null;
  pendingListReadback = false;
  pendingVoiceOffers = [];
  awaitingSearchTerms = false;
  awaitingSearchStores = [];
  voiceButton.setAttribute("aria-pressed", "false");
  voiceLabel.textContent = "Start voice";
  setVoiceConnection(
    message === "Microphone is off." ? "off" : "error",
    message === "Microphone is off." ? "Off" : "Not connected",
  );
  setStatus(voiceStatus, message);
  processor?.disconnect();
  micSource?.disconnect();
  muteNode?.disconnect();
  micStream?.getTracks().forEach((track) => track.stop());
  audioContext?.close().catch(() => {});
  processor = micSource = muteNode = micStream = audioContext = null;
  stopPlayback();
  const socket = voiceSocket;
  voiceSocket = null;
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
}

async function startVoice() {
  if (startingVoice) return;
  const attempt = ++voiceAttempt;
  startingVoice = true;
  receivedItems = new Set();
  voiceButton.setAttribute("aria-pressed", "true");
  voiceLabel.textContent = "Connecting…";
  setVoiceConnection("requesting", "Microphone");
  setStatus(voiceStatus, "Requesting microphone access…");

  let microphoneRequest;
  let audioContextRequest;
  let permissionState = "prompt";
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Chrome cannot access the microphone in this panel.");
    // Start playback synchronously from the click so Chrome retains its gesture.
    audioContext = new AudioContext({ sampleRate: 24000 });
    audioContextRequest = audioContext.resume();
    audioContextRequest.catch(() => {});
    try {
      permissionState = (
        await navigator.permissions.query({ name: "microphone" })
      ).state;
    } catch {
      // Older Chrome builds may not expose microphone permission state here.
    }
  } catch (error) {
    if (attempt === voiceAttempt)
      closeVoice(microphonePermissionMessage(error));
    return;
  }

  if (attempt !== voiceAttempt) return;
  if (needsMicrophonePermissionTab(permissionState)) {
    startingVoice = false;
    voiceButton.setAttribute("aria-pressed", "false");
    voiceLabel.textContent = "Start voice";
    setVoiceConnection("off", "Off");
    setStatus(
      voiceStatus,
      "Chrome needs a one-time microphone check in a full Needle tab. Allow the mic there, return here, then click Start voice again.",
    );
    stopPlayback();
    audioContext?.close().catch(() => {});
    audioContext = null;
    chrome.tabs
      .create({ url: chrome.runtime.getURL("microphone.html"), active: true })
      .catch(() => {
        setVoiceConnection("error", "Not connected");
        setStatus(
          voiceStatus,
          "Could not open Needle’s microphone setup tab. Open the extension’s details and allow its microphone, then try again.",
          true,
        );
      });
    return;
  }

  let acquiredStream;
  try {
    microphoneRequest = navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    acquiredStream = await microphoneRequest;
  } catch (error) {
    if (attempt === voiceAttempt)
      closeVoice(microphonePermissionMessage(error));
    return;
  }
  if (attempt !== voiceAttempt) {
    acquiredStream.getTracks().forEach((track) => track.stop());
    return;
  }
  micStream = acquiredStream;

  try {
    await audioContextRequest;
    if (audioContext?.state !== "running")
      throw new Error("Chrome did not start audio playback.");
    setVoiceConnection("connecting", "Connecting");
    setStatus(voiceStatus, "Microphone allowed. Connecting to Voice…");
    const server = new URL(settings.server);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(server.hostname))
      throw new Error(
        "Realtime Voice currently needs the local Needle server.",
      );
    const protocol = server.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${server.host}/ws/voice`);
    voiceSocket = socket;
    socket.addEventListener("open", () => {
      if (attempt !== voiceAttempt || voiceSocket !== socket) return;
      socket.send(
        JSON.stringify({ type: "needle.auth", token: settings.token || "" }),
      );
      voiceLabel.textContent = "Connecting…";
    });
    socket.addEventListener("message", async (event) => {
      if (attempt !== voiceAttempt || voiceSocket !== socket) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "app.error") {
        closeVoice(data.message || "Voice could not connect.");
        return;
      }
      if (data.type === "session.updated") {
        if (!sessionReady) {
          try {
            await beginCapture();
            if (attempt !== voiceAttempt || voiceSocket !== socket) return;
            startingVoice = false;
            sessionReady = true;
            activeVoiceResponse = "intro";
            voiceLabel.textContent = "Stop voice";
            voiceButton.setAttribute("aria-pressed", "true");
            setVoiceConnection("connected", "Connected");
            setStatus(
              voiceStatus,
              "Connected. Voice is introducing itself; you can speak any time.",
            );
            socket.send(JSON.stringify(createVoiceIntroductionEvent()));
          } catch (error) {
            if (attempt === voiceAttempt)
              closeVoice(
                `Voice connected, but audio could not start: ${error.message}`,
              );
          }
        }
        return;
      }
      if (data.type === "response.done") {
        const completedResponse = activeVoiceResponse;
        activeVoiceResponse = null;
        if (completedResponse === "intro") {
          setStatus(
            voiceStatus,
            "Connected and listening. Jev results and your shopping list appear in this panel.",
          );
        }
        if (completedResponse === "list-check")
          actionNote.textContent = "Your shopping list is shown below.";
        sendPendingListReadback();
        return;
      }
      if (
        data.type === "conversation.item.input_audio_transcription.completed"
      ) {
        await applyVoiceTranscript(data.transcript, data.item_id);
        return;
      }
      if (data.type === "response.output_audio.delta") {
        if (activeVoiceResponse) playPcm(data.delta);
        return;
      }
      if (
        data.type === "response.output_audio_transcript.done" &&
        data.transcript &&
        activeVoiceResponse
      ) {
        addTranscript("Voice", data.transcript);
        return;
      }
      if (data.type === "input_audio_buffer.speech_started") stopPlayback();
      if (data.type === "error")
        setStatus(
          voiceStatus,
          data.error?.message || "Voice returned an error.",
          true,
        );
    });
    socket.addEventListener("error", () => {
      if (attempt === voiceAttempt && voiceSocket === socket)
        closeVoice(
          "Voice cannot reach the local server. Start Needle and check its settings.",
        );
    });
    socket.addEventListener("close", () => {
      if (attempt === voiceAttempt && voiceSocket === socket)
        closeVoice("Voice connection closed.");
    });
  } catch (error) {
    if (attempt === voiceAttempt)
      closeVoice(`Voice could not connect: ${error.message}`);
  }
}

for (const button of storeScopeButtons)
  button.addEventListener("click", () =>
    setRetailerScope(button.dataset.storeScope),
  );

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!queryInput.value.trim()) return;
  const requestedStores = storesForScope(
    retailersFromRequest(queryInput.value),
    queryInput.value,
  );
  // Request optional retailer access synchronously from this user action.
  const permissionRequest = chrome.permissions.request({
    origins: originsForStores(requestedStores),
  });
  searchCatalogues(
    queryInput.value,
    retailerSearchTerm(queryInput.value) || queryInput.value,
    permissionRequest,
    requestedStores,
  );
});

retailerAccessButton.addEventListener("click", () => {
  // Chrome requires optional-permission requests to originate from a user action.
  let permissionRequest;
  try {
    const pending = pendingCatalogueSearch;
    const stores =
      pending?.stores || storesForScope(["woolworths", "coles"], "");
    permissionRequest = chrome.permissions.request({
      origins: originsForStores(stores),
    });
  } catch {
    setStatus(searchStatus, "Chrome could not request catalogue access.", true);
    return;
  }
  Promise.resolve(permissionRequest)
    .then(async (granted) => {
      if (!granted) {
        setStatus(
          searchStatus,
          "Catalogue access was not granted. Jev cannot search the retailer pages yet.",
          true,
        );
        return;
      }
      retailerAccessButton.hidden = true;
      const pending = pendingCatalogueSearch;
      pendingCatalogueSearch = null;
      if (pending)
        await searchCatalogues(
          pending.query,
          pending.retailerQuery,
          Promise.resolve(true),
          pending.stores,
          {
            voiceTurnId: pending.voiceTurnId,
          },
        );
      else
        setStatus(searchStatus, "Jev can now search the selected catalogues.");
    })
    .catch(() =>
      setStatus(
        searchStatus,
        "Chrome could not request catalogue access.",
        true,
      ),
    );
});

$("#add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const field = $("#new-item");
  if (addManualItem(field.value))
    actionNote.textContent = `You added ${field.value.trim()}.`;
  field.value = "";
});

notesInput.addEventListener("input", () => {
  clearTimeout(savingNotes);
  notes = notesInput.value;
  savingNotes = setTimeout(
    () => chrome.storage.local.set({ shoppingNotes: notes }),
    250,
  );
});

voiceButton.addEventListener("click", () => {
  if (voiceSocket || startingVoice) closeVoice();
  else startVoice();
});

$("#settings").addEventListener("click", () =>
  chrome.runtime.sendMessage({ type: "NEEDLE_SETTINGS" }),
);

$("#page-search").addEventListener("click", async (event) => {
  event.preventDefault();
  await chrome.runtime.sendMessage({ type: "NEEDLE_START_PAGE_SEARCH" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "CATALOGUE_PROGRESS")
    setStatus(searchStatus, message.text);
  if (message.type === "NEEDLE_MIC_PERMISSION_RESULT") {
    if (message.granted) {
      setVoiceConnection("off", "Off");
      setStatus(
        voiceStatus,
        "Microphone enabled for Needle. Return here and click Start voice to connect.",
      );
    } else {
      setVoiceConnection("error", "Not connected");
      setStatus(
        voiceStatus,
        message.message || microphonePermissionMessage(message.error),
        true,
      );
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.shoppingList) {
    shoppingList = Array.isArray(changes.shoppingList.newValue)
      ? changes.shoppingList.newValue
      : [];
    renderList();
  }
  if (changes.shoppingNotes) {
    notes = changes.shoppingNotes.newValue || "";
    if (notesInput.value !== notes) notesInput.value = notes;
  }
  if (changes.retailerScope)
    setRetailerScope(changes.retailerScope.newValue, false);
});

chrome.storage.local
  .get(["shoppingList", "shoppingNotes", "server", "token", "retailerScope"])
  .then((stored) => {
    shoppingList = Array.isArray(stored.shoppingList)
      ? stored.shoppingList
      : [];
    notes = stored.shoppingNotes || "";
    notesInput.value = notes;
    settings = {
      server: stored.server || settings.server,
      token: stored.token || "",
    };
    setRetailerScope(stored.retailerScope || "auto", false);
    renderList();
  });

setRetailerScope(retailerScope, false);
updateRetailerAccessButton();
