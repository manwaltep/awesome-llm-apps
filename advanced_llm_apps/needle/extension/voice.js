export const VOICE_INTRO_INSTRUCTIONS =
  "You are Voice, the spoken grocery-shopping assistant. This is your first response. Briefly welcome the shopper and explain that you can talk with them while they shop. Explain that Jev is a separate text-only agent that searches Woolworths and Coles catalogues and shows sourced matches in this panel. Explain that you can help with the shared list when they explicitly ask to add an item, or confirm that they found a listed item in store, put it in a trolley, or bought it. You do not receive catalogue results, so do not invent products, prices, or availability. End by asking what they are looking for.";

export function createVoiceIntroductionEvent() {
  return {
    type: "response.create",
    response: {
      input: [],
      output_modalities: ["audio"],
      instructions: VOICE_INTRO_INSTRUCTIONS,
    },
  };
}

export function microphonePermissionMessage(error) {
  const name = String(error?.name || "");
  const detail = String(error?.message || "")
    .trim()
    .slice(0, 180);
  if (
    name === "NotAllowedError" ||
    /permission (?:dismissed|denied)|notallowed/i.test(detail)
  ) {
    return "Chrome dismissed microphone access, so Voice did not connect. Choose Allow on the microphone prompt. If it no longer appears, allow the microphone for Needle in chrome://settings/content/microphone, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "Chrome could not find a microphone. Connect or enable one, then try Voice again.";
  return `Microphone unavailable${detail ? `: ${detail}` : "."}`;
}
