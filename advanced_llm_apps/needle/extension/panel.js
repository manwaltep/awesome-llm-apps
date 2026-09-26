import {
  isOfficialRetailerUrl,
  retailersFromRequest,
  retailerSearchTerm,
} from "./catalogue.js";
import {
  createVoiceCatalogueResultsEvent,
  createVoiceIntroductionEvent,
  microphonePermissionMessage,
  needsMicrophonePermissionTab,
  prepareVoiceCatalogueOffers,
  resolveVoiceCatalogueConfirmation,
} from "./voice.js";

const $ = (selector) => document.querySelector(selector);
const searchForm = $("#search-form");
const queryInput = $("#query");
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
const retailerOrigins = [
  "https://woolworths.com.au/*",
  "https://*.woolworths.com.au/*",
  "https://coles.com.au/*",
  "https://*.coles.com.au/*",
];

let shoppingList = [];
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
let introPending = false;
let pendingCatalogueSearch = null;
let receivedItems = new Set();
let pendingVoiceOffers = [];
let voiceResponseInProgress = false;
let queuedVoiceResponse = null;
let catalogueSearchSequence = 0;
let voiceTurnSequence = 0;

function setStatus(node, message, error = false) {
  node.textContent = message;
  node.classList.toggle("error", Boolean(error));
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
    if (item.store === "Coles" || item.store === "Woolworths") {
      const store = document.createElement("span");
      store.className = `item-store${item.store === "Coles" ? " coles" : ""}`;
      store.textContent = item.store;
      row.append(checkbox, name, store);
    } else {
      row.append(checkbox, name);
    }
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
    row.append(remove);
    listNode.append(row);
  }
}

function addManualItem(name, store = "") {
  const clean = String(name || "")
    .trim()
    .replace(/\s+/g, " ");
  const sourceStore = ["Coles", "Woolworths"].includes(store) ? store : "";
  if (
    !clean ||
    shoppingList.some((item) => {
      const sameName =
        item.name.toLocaleLowerCase() === clean.toLocaleLowerCase();
      const sameStore =
        !sourceStore || !item.store || item.store === sourceStore;
      return sameName && sameStore;
    })
  )
    return false;
  shoppingList = [
    ...shoppingList,
    {
      id: crypto.randomUUID(),
      name: clean,
      ...(sourceStore ? { store: sourceStore } : {}),
      checked: false,
    },
  ];
  chrome.storage.local.set({ shoppingList });
  renderList();
  return true;
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
    card.append(link);
    offersNode.append(card);
  }
}

async function updateRetailerAccessButton() {
  try {
    retailerAccessButton.hidden = await chrome.permissions.contains({
      origins: retailerOrigins,
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
  { announceToVoice = false, voiceTurnId = null } = {},
) {
  const clean = String(query || "").trim();
  if (!clean) return;
  const searchId = ++catalogueSearchSequence;
  pendingVoiceOffers = [];
  queuedVoiceResponse = null;
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
  try {
    granted = permissionRequest
      ? await permissionRequest
      : await chrome.permissions.contains({ origins: retailerOrigins });
  } catch {
    granted = false;
  }
  if (!granted) {
    pendingCatalogueSearch = {
      query: clean,
      retailerQuery: cleanRetailerQuery,
      stores: requestedStores,
      announceToVoice,
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
    renderOffers(result.offers || [], result.productsSeen || 0);
    setStatus(
      searchStatus,
      result.offers?.length
        ? `Jev found ${result.offers.length} sourced match${result.offers.length === 1 ? "" : "es"} in ${result.elapsedMs} ms.`
        : "Search complete. No catalogue match passed Jev’s relevance threshold.",
    );
    if (
      announceToVoice &&
      sessionReady &&
      voiceTurnId === voiceTurnSequence &&
      voiceSocket?.readyState === WebSocket.OPEN
    ) {
      pendingVoiceOffers = prepareVoiceCatalogueOffers(result.offers || []);
      queueVoiceResponse(
        createVoiceCatalogueResultsEvent({
          query: clean,
          offers: result.offers || [],
          productsSeen: result.productsSeen || 0,
        }),
        voiceTurnId,
      );
    }
  } catch (error) {
    if (searchId !== catalogueSearchSequence) return;
    setStatus(searchStatus, error.message, true);
  }
}

function queueVoiceResponse(event, voiceTurnId) {
  if (
    !sessionReady ||
    voiceTurnId !== voiceTurnSequence ||
    voiceSocket?.readyState !== WebSocket.OPEN
  )
    return;
  queuedVoiceResponse = { event, voiceTurnId };
  flushQueuedVoiceResponse();
}

function flushQueuedVoiceResponse() {
  if (
    voiceResponseInProgress ||
    !queuedVoiceResponse ||
    !sessionReady ||
    queuedVoiceResponse.voiceTurnId !== voiceTurnSequence ||
    voiceSocket?.readyState !== WebSocket.OPEN
  )
    return;
  voiceSocket.send(JSON.stringify(queuedVoiceResponse.event));
  queuedVoiceResponse = null;
}

function isListOnlyFallback(text) {
  const hasAction =
    /\b(?:add|put|include|found|got|picked up|grabbed|bought|purchased|collected|check off)\b/i.test(
      text,
    );
  const hasTarget =
    /\b(?:my list|shopping list|trolley|cart|basket|shelf|aisle|store|shop)\b/i.test(
      text,
    );
  const mentionsListedItem = shoppingList.some((item) =>
    text.toLocaleLowerCase().includes(item.name.toLocaleLowerCase()),
  );
  return hasAction && (hasTarget || mentionsListedItem);
}

async function applyVoiceTranscript(text, itemId) {
  const clean = String(text || "").trim();
  if (!clean || (itemId && receivedItems.has(itemId))) return;
  if (itemId) receivedItems.add(itemId);
  const voiceTurnId = ++voiceTurnSequence;
  addTranscript("You", clean);
  if (pendingVoiceOffers.length) {
    const choice = resolveVoiceCatalogueConfirmation(clean, pendingVoiceOffers);
    if (choice.kind === "accepted") {
      const store = choice.offer.store;
      if (addManualItem(choice.offer.title, store))
        actionNote.textContent = `Jev added ${choice.offer.title} from ${store} to your shopping list.`;
      else
        actionNote.textContent = `${choice.offer.title} is already on your shopping list.`;
      pendingVoiceOffers = [];
      return;
    }
    if (choice.kind === "declined") {
      pendingVoiceOffers = [];
      actionNote.textContent =
        "Jev did not add a catalogue match to your list.";
      return;
    }
    if (choice.kind === "ambiguous") {
      actionNote.textContent =
        "Choose one exact catalogue result by name or number, or say no.";
      return;
    }
    // A new request or unrelated reply clears the old choice before processing it.
    pendingVoiceOffers = [];
  }
  let intent = null;
  try {
    const data = await chrome.runtime.sendMessage({
      type: "SHOPPING_INTENT",
      payload: { transcript: clean, items: shoppingList },
    });
    if (!data || data.error)
      throw new Error(data?.error || "Text list updates are unavailable.");
    intent = data;
    const intentStore =
      intent.stores?.length === 1
        ? intent.stores[0] === "coles"
          ? "Coles"
          : "Woolworths"
        : "";
    for (const name of intent.addItems || []) {
      if (addManualItem(name, intentStore))
        actionNote.textContent = `Jev added ${name}${intentStore ? ` from ${intentStore}` : ""} to your shopping list.`;
    }
    const completed = new Set(intent.completedItems || []);
    const justCompleted = shoppingList.filter(
      (item) => completed.has(item.id) && !item.checked,
    );
    if (justCompleted.length) {
      shoppingList = shoppingList.map((item) =>
        completed.has(item.id) ? { ...item, checked: true } : item,
      );
      await chrome.storage.local.set({ shoppingList });
      renderList();
      actionNote.textContent = `Jev checked off ${justCompleted.map((item) => item.name).join(", ")} after your confirmation: “${clean}”`;
    }
  } catch (error) {
    voiceStatus.textContent = `Text update unavailable: ${error.message}`;
  }
  if (
    intent?.catalogueQuery?.trim() ||
    (!intent && !isListOnlyFallback(clean))
  ) {
    const retailQuery =
      intent?.catalogueQuery?.trim() || retailerSearchTerm(clean) || clean;
    await searchCatalogues(
      clean,
      retailQuery,
      null,
      intent?.stores || retailersFromRequest(clean),
      { announceToVoice: true, voiceTurnId },
    );
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
  introPending = false;
  voiceResponseInProgress = false;
  queuedVoiceResponse = null;
  pendingVoiceOffers = [];
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
            introPending = true;
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
      if (data.type === "response.created") {
        voiceResponseInProgress = true;
        return;
      }
      if (data.type === "response.done") {
        voiceResponseInProgress = false;
        if (introPending) {
          introPending = false;
          setStatus(
            voiceStatus,
            "Connected and listening. Ask Voice to find a product or help update your list.",
          );
        }
        flushQueuedVoiceResponse();
        return;
      }
      if (
        data.type === "conversation.item.input_audio_transcription.completed"
      ) {
        await applyVoiceTranscript(data.transcript, data.item_id);
        return;
      }
      if (data.type === "response.output_audio.delta") {
        playPcm(data.delta);
        return;
      }
      if (
        data.type === "response.output_audio_transcript.done" &&
        data.transcript
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

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!queryInput.value.trim()) return;
  // Request optional retailer access synchronously from this user action.
  const permissionRequest = chrome.permissions.request({
    origins: retailerOrigins,
  });
  searchCatalogues(
    queryInput.value,
    retailerSearchTerm(queryInput.value) || queryInput.value,
    permissionRequest,
    retailersFromRequest(queryInput.value),
  );
});

retailerAccessButton.addEventListener("click", () => {
  // Chrome requires optional-permission requests to originate from a user action.
  let permissionRequest;
  try {
    permissionRequest = chrome.permissions.request({
      origins: retailerOrigins,
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
            announceToVoice: pending.announceToVoice,
            voiceTurnId: pending.voiceTurnId,
          },
        );
      else setStatus(searchStatus, "Jev can now search both catalogues.");
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
});

chrome.storage.local
  .get(["shoppingList", "shoppingNotes", "server", "token"])
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
    renderList();
  });

updateRetailerAccessButton();
