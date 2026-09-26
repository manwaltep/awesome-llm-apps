import test from "node:test";
import assert from "node:assert/strict";
import { realtimeSessionUpdate } from "../server/realtime.mjs";

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
