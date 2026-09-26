import test from "node:test";
import assert from "node:assert/strict";
import { realtimeSessionUpdate } from "../server/realtime.mjs";
import {
  catalogueQueryForVoiceTurn,
  classifyBareVoiceReply,
  createVoiceClarificationEvent,
  createVoiceCatalogueResultsEvent,
  createVoiceIntroductionEvent,
  createVoiceListCheckEvent,
  microphonePermissionMessage,
  needsMicrophonePermissionTab,
  prepareVoiceCatalogueOffers,
  prepareVisibleCatalogueOffers,
  resolveJevVisibleCatalogueMatch,
  resolveVoiceCatalogueConfirmation,
} from "../extension/voice.js";

test("voice is speech-to-speech and exposes a separate visible transcript", () => {
  const event = realtimeSessionUpdate();
  assert.equal(event.type, "session.update");
  assert.equal(event.session.model, "gpt-realtime-2.1");
  assert.deepEqual(event.session.output_modalities, ["audio"]);
  assert.equal(
    event.session.audio.input.transcription.model,
    "gpt-4o-mini-transcribe",
  );
  assert.equal(event.session.audio.output.voice, "marin");
  assert.equal(event.session.audio.input.turn_detection.create_response, false);
  assert.match(event.session.instructions, /Jev/i);
  assert.match(event.session.instructions, /explicitly asks/i);
});

test("Voice starts with an audio introduction that explains Jev and list actions", () => {
  const event = createVoiceIntroductionEvent();
  assert.equal(event.type, "response.create");
  assert.deepEqual(event.response.input, []);
  assert.deepEqual(event.response.output_modalities, ["audio"]);
  assert.match(event.response.instructions, /Woolworths and Coles/i);
  assert.match(event.response.instructions, /shared shopping list/i);
  assert.match(event.response.instructions, /read it back whenever you ask/i);
});

test("Jev results are passed to Voice as sourced choices without repeat confirmation", () => {
  const offers = [
    {
      title: "Premium Beef Steak 500g",
      store: "coles",
      detail: "$12 per pack",
      url: "https://coles.com.au/product/secret-path",
    },
    { title: "Rump Steak", store: "woolworths", detail: "$10 per pack" },
  ];
  const event = createVoiceCatalogueResultsEvent({
    query: "steak",
    offers,
    productsSeen: 40,
  });
  assert.equal(event.type, "response.create");
  assert.deepEqual(event.response.output_modalities, ["audio"]);
  assert.match(event.response.instructions, /Premium Beef Steak 500g/);
  assert.match(event.response.instructions, /Woolworths/);
  assert.match(
    event.response.instructions,
    /ask which number, name, or retailer/i,
  );
  assert.match(
    event.response.instructions,
    /do not ask them to confirm again/i,
  );
  assert.match(event.response.instructions, /do not say it was added/i);
  assert.doesNotMatch(event.response.instructions, /secret-path/);
  const prepared = prepareVoiceCatalogueOffers(offers);
  assert.equal(prepared.length, 2);
  assert.equal(prepared[0].price, "$12");
});

test("Voice reads the Needle list only in an explicitly requested check", () => {
  const event = createVoiceListCheckEvent([
    {
      name: "Allen's Peaches and Cream",
      store: "Woolworths",
      price: "$2.50",
      checked: false,
    },
  ]);
  assert.equal(event.type, "response.create");
  assert.deepEqual(event.response.output_modalities, ["audio"]);
  assert.match(event.response.instructions, /explicitly asked/i);
  assert.match(event.response.instructions, /Allen's Peaches and Cream/);
  assert.match(event.response.instructions, /Woolworths/);
  assert.match(event.response.instructions, /\$2.50/);
});

test("short clarifications contain only the one needed question", () => {
  const event = createVoiceClarificationEvent(
    "ask what product name they want Jev to search for.",
  );
  assert.deepEqual(event.response.output_modalities, ["audio"]);
  assert.match(event.response.instructions, /one short sentence/i);
  assert.match(event.response.instructions, /what product name/i);
});

test("catalogue result replies add only the explicitly selected offer", () => {
  const offers = [
    { choice: "1", title: "Premium Beef Steak 500g", store: "Coles" },
    { choice: "2", title: "Rump Steak", store: "Woolworths" },
  ];
  assert.deepEqual(resolveVoiceCatalogueConfirmation("yes", offers), {
    kind: "ambiguous",
  });
  assert.deepEqual(
    resolveVoiceCatalogueConfirmation("the second one, please", offers),
    { kind: "accepted", offer: offers[1] },
  );
  assert.deepEqual(
    resolveVoiceCatalogueConfirmation("the Woolies one", offers),
    { kind: "accepted", offer: offers[1] },
  );
  assert.deepEqual(resolveVoiceCatalogueConfirmation("no thanks", offers), {
    kind: "declined",
  });
  assert.deepEqual(
    resolveVoiceCatalogueConfirmation("find chicken instead", offers),
    { kind: "none" },
  );
  assert.deepEqual(
    resolveVoiceCatalogueConfirmation("yes please", [offers[0]]),
    { kind: "accepted", offer: offers[0] },
  );
});

test("a retailer-specific spoken choice resolves to its stored catalogue match", () => {
  const offer = {
    choice: "1",
    title: "Allen's Peaches and Cream Peach Lollies 150g",
    store: "Woolworths",
  };
  const result = resolveVoiceCatalogueConfirmation(
    "Can you get the Woolies ones? They're $2.50, Alan's peaches and cream.",
    [offer],
  );
  assert.deepEqual(result, { kind: "accepted", offer });
});

test("a spoken add request resolves to the visible Jev result and its metadata", () => {
  const offer = {
    choice: "1",
    title: "Allen's Peaches and Cream Peach Lollies 150g",
    store: "Woolworths",
    price: "$2.50",
  };
  assert.deepEqual(
    resolveVoiceCatalogueConfirmation(
      "Add Alan's Peaches and Cream to the list.",
      [offer],
    ),
    { kind: "accepted", offer },
  );
  assert.deepEqual(
    resolveVoiceCatalogueConfirmation("Add this one to the list", [offer]),
    { kind: "accepted", offer },
  );
  assert.deepEqual(
    resolveVoiceCatalogueConfirmation("Add this one to the list", [
      offer,
      { ...offer, choice: "2", store: "Coles" },
    ]),
    { kind: "ambiguous" },
  );
});

test("Jev resolves a named add against visible offers and preserves the exact source", () => {
  const woolworths = {
    choice: "1",
    title: "Allen's Peaches and Cream Peach Lollies 150g",
    store: "Woolworths",
    price: "$2.50",
  };
  const coles = {
    choice: "2",
    title: "Allen's Peaches and Cream 180g",
    store: "Coles",
    price: "$3.00",
  };
  assert.deepEqual(
    resolveJevVisibleCatalogueMatch(
      [{ id: "b1", probability: 0.91 }],
      "Add Allen's Peaches and Cream from Coles to the list",
      [woolworths, coles],
    ),
    { kind: "accepted", offer: coles },
  );
  assert.deepEqual(
    resolveJevVisibleCatalogueMatch(
      [
        { id: "b0", probability: 0.9 },
        { id: "b1", probability: 0.89 },
      ],
      "Add Allen's Peaches and Cream to the list",
      [woolworths, coles],
    ),
    { kind: "ambiguous" },
  );
  assert.deepEqual(
    resolveJevVisibleCatalogueMatch(
      [
        { id: "b0", probability: 0.9 },
        { id: "b1", probability: 0.89 },
      ],
      "Add Allen's Peaches and Cream peach lollies to the list",
      [woolworths, coles],
    ),
    { kind: "accepted", offer: woolworths },
  );
});

test("visible Jev offers keep full product details while voice summaries stay short", () => {
  const detail = "Pack size and offer details. ".repeat(12);
  const source = [
    {
      title: "Allen's Peaches and Cream",
      store: "woolworths",
      detail,
      focus: { text: "Save on the 150 g bag." },
      price: "$2.50",
    },
  ];
  assert.equal(prepareVoiceCatalogueOffers(source)[0].detail.length, 180);
  assert.equal(prepareVisibleCatalogueOffers(source)[0].detail.length, 347);
  assert.equal(
    prepareVisibleCatalogueOffers(source)[0].focus,
    "Save on the 150 g bag.",
  );
});

test("bare yes/no replies never become catalogue queries", () => {
  assert.equal(classifyBareVoiceReply("Yes."), "affirmative");
  assert.equal(classifyBareVoiceReply("No, thanks."), "negative");
  assert.equal(classifyBareVoiceReply("Thanks."), "acknowledgement");
  assert.equal(classifyBareVoiceReply("Yes, peach lollies"), null);
  assert.equal(
    catalogueQueryForVoiceTurn({
      transcript: "Yes.",
      intentAvailable: false,
    }),
    "",
  );
  assert.equal(catalogueQueryForVoiceTurn({ transcript: "Thanks." }), "");
  assert.equal(
    catalogueQueryForVoiceTurn({
      transcript: "Yes.",
      proposedQuery: "Yes",
      intentAvailable: true,
      awaitingSearchTerms: true,
    }),
    "",
  );
  assert.equal(
    catalogueQueryForVoiceTurn({
      transcript: "Allen's Peaches and Cream.",
      intentAvailable: true,
      awaitingSearchTerms: true,
    }),
    "Allen's Peaches and Cream.",
  );
});

test("ungranted microphone access must be requested from a full extension tab", () => {
  assert.equal(needsMicrophonePermissionTab("granted"), false);
  assert.equal(needsMicrophonePermissionTab("prompt"), true);
  assert.equal(needsMicrophonePermissionTab("denied"), true);
});

test("dismissed microphone access points to extension site settings", () => {
  const message = microphonePermissionMessage({
    name: "NotAllowedError",
    message: "Permission dismissed",
  });
  assert.match(message, /did not connect/i);
  assert.match(message, /chrome:\/\/extensions/);
  assert.match(message, /Site settings/i);
});
