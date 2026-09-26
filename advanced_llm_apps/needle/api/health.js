import { getKey, getProvider, modelForProvider } from "../server/search.mjs";
import { REALTIME_MODEL, TRANSCRIPTION_MODEL } from "../server/realtime.mjs";
import { INTENT_MODEL } from "../server/shopping.mjs";
export default function handler(req, res) {
  const jevProvider = getProvider();
  const jevModel = modelForProvider(jevProvider);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    configured: Boolean(getKey()),
    model: jevModel,
    jevConfigured: Boolean(getKey()),
    voiceConfigured: Boolean(process.env.OPENAI_API_KEY),
    shoppingIntentConfigured: Boolean(process.env.OPENAI_API_KEY),
    models: {
      jev: jevModel,
      realtime: REALTIME_MODEL,
      transcription: TRANSCRIPTION_MODEL,
      shoppingIntent: INTENT_MODEL,
    },
  });
}
