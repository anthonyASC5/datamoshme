import { MP4Demuxer } from "./mp4-demuxer.js";
import { DatamoshEngine } from "./datamosh-engine.js";

const pickAButton = document.getElementById("pick-a-button");
const pickBButton = document.getElementById("pick-b-button");
const videoAInput = document.getElementById("video-a-input");
const videoBInput = document.getElementById("video-b-input");
const videoAMetaSource = document.getElementById("video-a-meta-source");
const videoBMetaSource = document.getElementById("video-b-meta-source");
const videoAMeta = document.getElementById("video-a-meta");
const videoBMeta = document.getElementById("video-b-meta");
const transitionSlider = document.getElementById("transition-slider");
const transitionOutput = document.getElementById("transition-output");
const renderButton = document.getElementById("render-button");
const preview = document.getElementById("preview");
const canvas = document.getElementById("render-canvas");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const logOutput = document.getElementById("log-output");
const compatibilityNote = document.getElementById("compatibility-note");

const demuxer = new MP4Demuxer();
const engine = new DatamoshEngine({
  freezeSeconds: 0.5,
  corruptionSeconds: 1.0,
});

const state = {
  clipA: null,
  clipB: null,
  clipADuration: 0,
  clipBDuration: 0,
  previewUrl: null,
  metaUrls: {
    a: null,
    b: null,
  },
};

function setStatus(message) {
  statusText.textContent = message;
}

function setTimeline(message) {
  timelineLabel.textContent = message;
}

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  logOutput.textContent = `[${timestamp}] ${message}\n${logOutput.textContent}`.slice(0, 12000);
}

function updateTransitionOutput() {
  transitionOutput.value = `${Number(transitionSlider.value).toFixed(2)}s`;
}

function revokePreviewUrl() {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
}

function revokeMetaUrl(key, videoNode) {
  if (!state.metaUrls[key]) {
    return;
  }
  URL.revokeObjectURL(state.metaUrls[key]);
  state.metaUrls[key] = null;
  videoNode.removeAttribute("src");
  videoNode.load();
}

async function loadVideoMeta(file, videoNode, key) {
  revokeMetaUrl(key, videoNode);
  const url = URL.createObjectURL(file);
  state.metaUrls[key] = url;
  videoNode.src = url;
  videoNode.load();

  await new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to read video metadata."));
    };
    const cleanup = () => {
      videoNode.removeEventListener("loadedmetadata", onLoaded);
      videoNode.removeEventListener("error", onError);
    };

    videoNode.addEventListener("loadedmetadata", onLoaded, { once: true });
    videoNode.addEventListener("error", onError, { once: true });
  });
}

function updateSliderBounds() {
  if (!state.clipADuration) {
    return;
  }

  const max = Math.max(0.05, Number((state.clipADuration - 0.05).toFixed(2)));
  transitionSlider.max = String(max);
  transitionSlider.value = String(Math.min(max, 2));
  updateTransitionOutput();
}

function describeMeta(file, videoNode) {
  return `${file.name} • ${videoNode.duration.toFixed(2)}s • ${videoNode.videoWidth}x${videoNode.videoHeight}`;
}

function validateReady() {
  if (!state.clipA || !state.clipB) {
    setStatus("Load clip A and clip B first.");
    return false;
  }

  if (!window.VideoDecoder || !window.VideoEncoder) {
    setStatus("This browser does not support WebCodecs VideoDecoder/VideoEncoder.");
    return false;
  }

  return true;
}

async function renderDatamosh() {
  if (!validateReady()) {
    return;
  }

  renderButton.disabled = true;
  revokePreviewUrl();
  preview.removeAttribute("src");
  preview.load();

  try {
    setStatus("Demuxing clip A...");
    setTimeline("Reading MP4 sample tables");
    appendLog("Demuxing clip A");
    const trackA = await demuxer.extractChunks(state.clipA);

    setStatus("Demuxing clip B...");
    appendLog("Demuxing clip B");
    const trackB = await demuxer.extractChunks(state.clipB);

    compatibilityNote.textContent = `A ${trackA.decoderConfig.codec} ${trackA.decoderConfig.codedWidth}x${trackA.decoderConfig.codedHeight} | B ${trackB.decoderConfig.codec} ${trackB.decoderConfig.codedWidth}x${trackB.decoderConfig.codedHeight}`;
    compatibilityNote.classList.toggle("warning", trackA.decoderConfig.codec !== trackB.decoderConfig.codec);

    const transitionStart = Math.min(Number(transitionSlider.value), Math.max(0.05, state.clipADuration - 0.05));
    appendLog(`Transition start ${transitionStart.toFixed(2)}s`);

    const result = await engine.render({
      trackA,
      trackB,
      transitionSeconds: transitionStart,
      canvas,
      onStatus: setStatus,
      onTimeline: setTimeline,
      onLog: appendLog,
    });

    state.previewUrl = URL.createObjectURL(result.blob);
    preview.src = state.previewUrl;
    preview.currentTime = 0;
    preview.play().catch(() => {});

    setStatus("Datamosh V4 render complete.");
    setTimeline("Render complete");
    appendLog(`Render complete in offline mode. Output ${Math.round(result.outputDuration * 100) / 100}s, ${Math.round(result.blob.size / 1024)} KB.`);
  } catch (error) {
    console.error(error);
    setStatus("Datamosh V4 failed.");
    setTimeline("Render failed");
    appendLog(`ERROR: ${error.message}`);
  } finally {
    renderButton.disabled = false;
  }
}

pickAButton.addEventListener("click", () => {
  videoAInput.click();
});

pickBButton.addEventListener("click", () => {
  videoBInput.click();
});

videoAInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    await loadVideoMeta(file, videoAMetaSource, "a");
    state.clipA = file;
    state.clipADuration = videoAMetaSource.duration;
    videoAMeta.textContent = describeMeta(file, videoAMetaSource);
    updateSliderBounds();
    setStatus("Clip A loaded.");
    appendLog(`Clip A loaded: ${videoAMeta.textContent}`);
  } catch (error) {
    setStatus("Clip A failed to load.");
    appendLog(`ERROR: ${error.message}`);
  }
});

videoBInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    await loadVideoMeta(file, videoBMetaSource, "b");
    state.clipB = file;
    state.clipBDuration = videoBMetaSource.duration;
    videoBMeta.textContent = describeMeta(file, videoBMetaSource);
    setStatus("Clip B loaded.");
    appendLog(`Clip B loaded: ${videoBMeta.textContent}`);
  } catch (error) {
    setStatus("Clip B failed to load.");
    appendLog(`ERROR: ${error.message}`);
  }
});

transitionSlider.addEventListener("input", updateTransitionOutput);
renderButton.addEventListener("click", () => {
  renderDatamosh();
});

window.addEventListener("beforeunload", () => {
  revokePreviewUrl();
  revokeMetaUrl("a", videoAMetaSource);
  revokeMetaUrl("b", videoBMetaSource);
});

setTimeline("Waiting for two MP4 clips");
updateTransitionOutput();
