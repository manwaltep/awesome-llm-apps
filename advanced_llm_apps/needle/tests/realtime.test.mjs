import test from "node:test";
import assert from "node:assert/strict";
import { realtimeSessionUpdate } from "../server/realtime.mjs";
import {
  createVoiceIntroductionEvent,
  microphonePermissionMessage,
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
  assert.match(event.response.instructions, /shared list/i);
});

test("dismissed microphone access explains how to allow it and confirms no connection", () => {
  const message = microphonePermissionMessage({
    name: "NotAllowedError",
    message: "Permission dismissed",
  });
  assert.match(message, /did not connect/i);
  assert.match(message, /chrome:\/\/settings\/content\/microphone/);
});
