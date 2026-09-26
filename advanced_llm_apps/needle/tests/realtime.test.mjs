import test from "node:test";
import assert from "node:assert/strict";
import { realtimeSessionUpdate } from "../server/realtime.mjs";
import {
  createVoiceCatalogueResultsEvent,
  createVoiceIntroductionEvent,
  microphonePermissionMessage,
  needsMicrophonePermissionTab,
  prepareVoiceCatalogueOffers,
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
  assert.match(event.session.instructions, /Jev/i);
});

test("Voice starts with an audio introduction that explains Jev and list actions", () => {
  const event = createVoiceIntroductionEvent();
  assert.equal(event.type, "response.create");
  assert.deepEqual(event.response.input, []);
  assert.deepEqual(event.response.output_modalities, ["audio"]);
  assert.match(event.response.instructions, /separate text-only agent/i);
  assert.match(event.response.instructions, /Woolworths and Coles/i);
  assert.match(event.response.instructions, /shared shopping list/i);
  assert.match(event.response.instructions, /pass Jev's sourced matches/i);
});

test("Jev results are passed to Voice as sourced choices with a list confirmation", () => {
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
  assert.match(event.response.instructions, /which exact item/i);
  assert.match(event.response.instructions, /shared shopping list/i);
  assert.doesNotMatch(event.response.instructions, /secret-path/);
  assert.equal(prepareVoiceCatalogueOffers(offers).length, 2);
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
