import { getKey, MODEL } from "../server/search.mjs";
import { REALTIME_MODEL, TRANSCRIPTION_MODEL } from "../server/realtime.mjs";
import { INTENT_MODEL } from "../server/shopping.mjs";
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    configured: Boolean(getKey()),
    model: MODEL,
    jevConfigured: Boolean(getKey()),
    voiceConfigured: Boolean(process.env.OPENAI_API_KEY),
    shoppingIntentConfigured: Boolean(process.env.OPENAI_API_KEY),
    models: {
      jev: MODEL,
      realtime: REALTIME_MODEL,
      transcription: TRANSCRIPTION_MODEL,
      shoppingIntent: INTENT_MODEL,
    },
  });
}
