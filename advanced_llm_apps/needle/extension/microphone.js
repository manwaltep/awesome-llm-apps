const allowButton = document.querySelector("#allow-microphone");
const returnButton = document.querySelector("#return-to-needle");
const status = document.querySelector("#status");
const help = document.querySelector("#help");

function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function returnToNeedle() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) await chrome.tabs.remove(tab.id);
}

async function notifyPanel(result) {
  try {
    await chrome.runtime.sendMessage({
      type: "NEEDLE_MIC_PERMISSION_RESULT",
      ...result,
    });
  } catch {
    // The panel may have closed while Chrome switched to this setup tab.
  }
}

async function checkAlreadyGranted() {
  try {
    const permission = await navigator.permissions.query({
      name: "microphone",
    });
    if (permission.state === "granted") {
      allowButton.hidden = true;
      returnButton.hidden = false;
      showStatus(
        "Needle already has microphone access. Return to the panel and click Start voice.",
      );
      await notifyPanel({ granted: true });
    }
  } catch {
    // The explicit button request below remains available as a fallback.
  }
}

allowButton.addEventListener("click", async () => {
  allowButton.disabled = true;
  showStatus("Requesting microphone access…");
  help.hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    allowButton.hidden = true;
    returnButton.hidden = false;
    showStatus(
      "Microphone access is enabled. The setup check stopped the mic without sending audio. Return to Needle and click Start voice.",
    );
    await notifyPanel({ granted: true });
  } catch (error) {
    allowButton.disabled = false;
    help.hidden = false;
    showStatus(
      "Chrome did not grant microphone access. Follow the steps below, then try again.",
      true,
    );
    await notifyPanel({ granted: false, error: { name: error.name } });
  }
});

returnButton.addEventListener("click", () => {
  returnToNeedle().catch(() => {
    showStatus("Close this tab to return to Needle.");
  });
});

checkAlreadyGranted();
