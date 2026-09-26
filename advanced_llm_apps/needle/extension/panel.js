import { isOfficialRetailerUrl, retailerSearchTerm } from "./catalogue.js";

const $ = (selector) => document.querySelector(selector);
const searchForm = $("#search-form");
const queryInput = $("#query");
const searchStatus = $("#search-status");
const offersNode = $("#offers");
const voiceButton = $("#voice-toggle");
const voiceLabel = $("#voice-button-label");
const voiceStatus = $("#voice-status");
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
let receivedItems = new Set();

function setStatus(node, message, error = false) {
  node.textContent = message;
  node.classList.toggle("error", Boolean(error));
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
    row.append(checkbox, name, remove);
    listNode.append(row);
  }
}

function addManualItem(name) {
  const clean = String(name || "")
    .trim()
    .replace(/\s+/g, " ");
  if (
    !clean ||
    shoppingList.some(
      (item) => item.name.toLocaleLowerCase() === clean.toLocaleLowerCase(),
    )
  )
    return false;
  shoppingList = [
    ...shoppingList,
    { id: crypto.randomUUID(), name: clean, checked: false },
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

async function ensureRetailerPermission() {
  const permission = { origins: retailerOrigins };
  if (await chrome.permissions.contains(permission)) return true;
  return chrome.permissions.request(permission);
}

async function searchCatalogues(query, retailerQuery = query) {
  const clean = String(query || "").trim();
  if (!clean) return;
  queryInput.value = clean;
  setStatus(searchStatus, "Checking access to the official catalogue pages…");
  let granted = false;
  try {
    granted = await ensureRetailerPermission();
  } catch {
    granted = false;
  }
  if (!granted) {
    setStatus(
      searchStatus,
      "Allow Needle to read Woolworths and Coles pages to search their catalogues.",
      true,
    );
    return;
  }
  setStatus(searchStatus, "Jev is searching both catalogue tabs…");
  offersNode.replaceChildren();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "CATALOGUE_SEARCH",
      query: clean,
      retailerQuery: String(retailerQuery || clean).trim(),
    });
    if (!result || result.error)
      throw new Error(result?.error || "Jev could not complete this search.");
    renderOffers(result.offers || [], result.productsSeen || 0);
    setStatus(
      searchStatus,
      result.offers?.length
        ? `Jev found ${result.offers.length} sourced match${result.offers.length === 1 ? "" : "es"} in ${result.elapsedMs} ms.`
        : "Search complete. No catalogue match passed Jev’s relevance threshold.",
    );
  } catch (error) {
    setStatus(searchStatus, error.message, true);
  }
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
  addTranscript("You", clean);
  let intent = null;
  try {
    const data = await chrome.runtime.sendMessage({
      type: "SHOPPING_INTENT",
      payload: { transcript: clean, items: shoppingList },
    });
    if (!data || data.error)
      throw new Error(data?.error || "Text list updates are unavailable.");
    intent = data;
    for (const name of intent.addItems || []) {
      if (addManualItem(name))
        actionNote.textContent = `Jev added ${name} after your explicit request.`;
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
    await searchCatalogues(clean, retailQuery);
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
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new AudioContext({ sampleRate: 24000 });
  await audioContext.resume();
  micSource = audioContext.createMediaStreamSource(micStream);
  processor = audioContext.createScriptProcessor(1024, 1, 1);
  muteNode = audioContext.createGain();
  muteNode.gain.value = 0;
  processor.onaudioprocess = (event) => sendAudio(event.inputBuffer);
  micSource.connect(processor);
  processor.connect(muteNode);
  muteNode.connect(audioContext.destination);
  setStatus(
    voiceStatus,
    "Listening. Your speech is transcribed for Jev and shown above.",
  );
}

function closeVoice(message = "Microphone is off.") {
  sessionReady = false;
  startingVoice = false;
  voiceButton.setAttribute("aria-pressed", "false");
  voiceLabel.textContent = "Start voice";
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
  startingVoice = true;
  receivedItems = new Set();
  voiceButton.setAttribute("aria-pressed", "true");
  voiceLabel.textContent = "Connecting…";
  setStatus(voiceStatus, "Connecting Voice and checking catalogue access…");
  try {
    const retailerPermissionGranted = await ensureRetailerPermission();
    const server = new URL(settings.server);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(server.hostname))
      throw new Error(
        "Realtime Voice currently needs the local Needle server.",
      );
    const protocol = server.protocol === "https:" ? "wss:" : "ws:";
    voiceSocket = new WebSocket(`${protocol}//${server.host}/ws/voice`);
    voiceSocket.addEventListener("open", () => {
      voiceSocket?.send(
        JSON.stringify({ type: "needle.auth", token: settings.token || "" }),
      );
      voiceLabel.textContent = "Connecting…";
    });
    voiceSocket.addEventListener("message", async (event) => {
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
            sessionReady = true;
            voiceLabel.textContent = "Stop voice";
            voiceButton.setAttribute("aria-pressed", "true");
            if (!retailerPermissionGranted)
              setStatus(
                voiceStatus,
                "Listening. Grant Woolworths and Coles access with a text search before asking Jev to search.",
              );
          } catch (error) {
            closeVoice(`Microphone unavailable: ${error.message}`);
          }
        }
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
    voiceSocket.addEventListener("error", () =>
      closeVoice(
        "Voice cannot reach the local server. Start Needle and check its settings.",
      ),
    );
    voiceSocket.addEventListener("close", () => {
      if (voiceSocket) closeVoice("Voice connection closed.");
    });
  } catch (error) {
    closeVoice(`Voice could not start: ${error.message}`);
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchCatalogues(
    queryInput.value,
    retailerSearchTerm(queryInput.value) || queryInput.value,
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
