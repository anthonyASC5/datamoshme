import { createVideoVolumeController } from "./video-volume.js";

const stageCanvas = document.getElementById("stage-canvas");
const sourceVideo = document.getElementById("source-video");
const startButton = document.getElementById("camera-button");
const importButton = document.getElementById("import-button");
const playButton = document.getElementById("play-button");
const pauseButton = document.getElementById("pause-button");
const stopButton = document.getElementById("stop-button");
const restartButton = document.getElementById("restart-button");
const recordButton = document.getElementById("record-button");
const resetButton = document.getElementById("reset-button");
const splitVerticalButton = document.getElementById("split-vertical-button");
const splitHorizontalButton = document.getElementById("split-horizontal-button");
const datamoshToggle = document.getElementById("datamosh-toggle");
const audioToggle = document.getElementById("audio-toggle");
const optimizationPanel = document.getElementById("optimization-panel");
const optimizationToggle = document.getElementById("optimization-toggle");
const videoEditorPanel = document.getElementById("video-editor-panel");
const videoEditorToggle = document.getElementById("video-editor-toggle");
const fpsSelect = document.getElementById("fps-select");
const qualitySelect = document.getElementById("quality-select");
const renderHudStatus = document.getElementById("render-hud-status");
const moshPresetButtons = Array.from(document.querySelectorAll("[data-mosh-preset]"));
const moshBlendModeSelect = document.getElementById("mosh-blend-mode-select");
const bwGritToggle = document.getElementById("bw-grit-toggle");
const fileInput = document.getElementById("file-input");
const videoDropButton = document.getElementById("video-drop-button");
const stageShell = document.querySelector(".stage-shell");
const shell = document.querySelector(".shell");
const speedSlider = document.getElementById("speed-slider");
const speedOutput = document.getElementById("speed-output");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const sourceMeta = document.getElementById("source-meta");
const logOutput = document.getElementById("log-output");
const frameCounter = document.getElementById("frame-counter");
const editorControls = Array.from(document.querySelectorAll("[data-editor-control]"));

const stageCtx = stageCanvas.getContext("2d", { alpha: false });
const renderCanvas = document.createElement("canvas");
const renderCtx = renderCanvas.getContext("2d", { alpha: false });
const moshCanvas = document.createElement("canvas");
const moshCtx = moshCanvas.getContext("2d", { alpha: false });
const editCanvas = document.createElement("canvas");
const editCtx = editCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
const differenceCanvas = document.createElement("canvas");
const differenceCtx = differenceCanvas.getContext("2d");
const SPLIT_MODES = Object.freeze({
  off: "off",
  vertical: "vertical",
  horizontal: "horizontal",
});
const EDITOR_DEFAULTS = Object.freeze({
  brightness: 0,
  contrast: 100,
  highlights: 0,
  sharpness: 0,
});
const BLEND_MODES = Object.freeze([
  "source-over",
  "difference",
  "exclusion",
  "screen",
  "darken",
  "multiply",
]);
const MOSH_PRESETS = Object.freeze({
  default: {
    label: "DEFAULT",
    keyframeMode: "default",
  },
  heavy: {
    label: "HEAVY MOSH",
    speed: 8,
    renderScale: 0.3,
    fpsCap: 24,
    keyframeMode: "minimal",
    maxFramesWithoutReset: 180,
  },
  controlled: {
    label: "CONTROLLED TRAILS",
    speed: 3,
    renderScale: 0.5,
    fpsCap: 30,
    keyframeMode: "interval",
    keyframeInterval: 100,
    blendMode: "difference",
    blendOpacity: 0.7,
  },
});

let encoder = null;
let decoder = null;
let animationFrame = 0;
let isWebCodecsReady = false;
let speed = 2;
let useKeyFrame = false;
let isDatamoshEnabled = true;
let webcamStream = null;
let fileObjectUrl = null;
let activeSourceMode = "";
let recorder = null;
let recordedChunks = [];
let recordingStream = null;
let renderScale = Number(qualitySelect?.value || 0.3);
let fpsCap = Number(fpsSelect?.value || 30);
const DEFAULT_MOSH_SETTINGS = Object.freeze({
  speed,
  renderScale,
  fpsCap,
});
let lastRenderTime = 0;
let dropMouthTimer = 0;
let splitMode = SPLIT_MODES.off;
let hasMoshFrame = false;
let activePresetName = "default";
let keyframeMode = MOSH_PRESETS.default.keyframeMode;
let framesSinceKeyframe = 0;
let presetFrameCounter = 0;
let forcePresetKeyFrame = false;
let blendMode = "source-over";
let blendOpacity = 1;
let isBwGritEnabled = false;
const editorState = { ...EDITOR_DEFAULTS };
const frameStats = {
  output: 0,
  editor: 0,
  decoded: 0,
  skipped: 0,
  errors: 0,
  mediaTotal: 0,
  mediaDropped: 0,
};
const volumeController = createVideoVolumeController({
  media: sourceVideo,
  toggleButton: audioToggle,
  defaultVolume: 0,
  muteLabel: "MUTE AUDIO",
  unmuteLabel: "UNMUTE AUDIO",
  unavailableLabel: "NO AUDIO",
});

function getRecordingMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  for (const mimeType of candidates) {
    if (window.MediaRecorder?.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return "";
}

function setRecordingState(isRecording) {
  recordButton.textContent = isRecording ? "STOP REC" : "RECORD WEBM";
  recordButton.classList.toggle("button--primary", isRecording);
}

function downloadRecording(blob) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `datamosh-${timestamp}.webm`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function startRecording() {
  if (!activeSourceMode) {
    setStatus("NO SOURCE");
    return;
  }

  if (!stageCanvas.captureStream || !window.MediaRecorder) {
    setStatus("REC UNSUPPORTED");
    appendLog("REC UNAVAILABLE / CAPTURESTREAM OR MEDIARECORDER MISSING");
    return;
  }

  if (recorder && recorder.state !== "inactive") {
    setStatus("REC ACTIVE");
    return;
  }

  const mimeType = getRecordingMimeType();
  recordingStream = stageCanvas.captureStream(fpsCap || 30);
  recordedChunks = [];

  recorder = new MediaRecorder(recordingStream, mimeType ? {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  } : {
    videoBitsPerSecond: 8_000_000,
  });

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", () => {
    const blob = new Blob(recordedChunks, { type: mimeType || "video/webm" });
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = null;
    recorder = null;
    setRecordingState(false);

    if (!blob.size) {
      setStatus("REC EMPTY");
      appendLog("REC STOP / NO DATA");
      return;
    }

    downloadRecording(blob);
    setStatus("REC SAVED");
    appendLog(`REC SAVED / ${Math.round(blob.size / 1024)} KB`);
  });

  recorder.addEventListener("error", (event) => {
    const message = event.error?.message || "UNKNOWN REC ERROR";
    setStatus("REC ERROR");
    appendLog(`REC ERROR / ${message}`);
    setRecordingState(false);
  });

  recorder.start(250);
  setRecordingState(true);
  setStatus("REC ACTIVE");
  appendLog(`REC START${mimeType ? ` / ${mimeType}` : ""}`);
}

function stopRecording() {
  if (!recorder || recorder.state === "inactive") {
    return;
  }

  recorder.stop();
}

function normalizeUiText(message) {
  return String(message).replace(/[•.]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function getUiState(message) {
  const normalized = normalizeUiText(message);
  if (/\b(ERROR|FAILED|UNSUPPORTED|UNAVAILABLE)\b/.test(normalized)) {
    return "error";
  }
  if (/\b(START|LOAD|REC ACTIVE|ENCODE|DECODE|RESET|PROCESS)\b/.test(normalized)) {
    return "processing";
  }
  if (/\b(ACTIVE|RUNNING|PLAY|READY|SAVED|LOOP)\b/.test(normalized)) {
    return "active";
  }
  return "idle";
}

function setStatus(message) {
  const normalized = normalizeUiText(message);
  statusText.textContent = normalized;
  shell?.setAttribute("data-state", getUiState(normalized));
}

function setTimeline(message) {
  timelineLabel.textContent = normalizeUiText(message);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  logOutput.textContent = `[${timestamp}] ${normalizeUiText(message)}\n${logOutput.textContent}`.slice(0, 16000);
}

function refreshFrameCounter() {
  if (!frameCounter) {
    return;
  }

  const quality = sourceVideo.getVideoPlaybackQuality?.();
  if (quality) {
    frameStats.mediaTotal = quality.totalVideoFrames || 0;
    frameStats.mediaDropped = quality.droppedVideoFrames || 0;
  }

  frameCounter.textContent = [
    `FRAME ${frameStats.output}`,
    `EDIT ${frameStats.editor}`,
    `DECODE ${frameStats.decoded}`,
    `SKIP ${frameStats.skipped}`,
    `DROP ${frameStats.mediaDropped}/${frameStats.mediaTotal}`,
    `ERR ${frameStats.errors}`,
  ].join(" / ");
}

function resetFrameStats() {
  Object.keys(frameStats).forEach((key) => {
    frameStats[key] = 0;
  });
  refreshFrameCounter();
}

function updateCanvasSize() {
  stageCanvas.width = Math.max(640, window.innerWidth);
  stageCanvas.height = Math.max(360, window.innerHeight);
  moshCanvas.width = stageCanvas.width;
  moshCanvas.height = stageCanvas.height;
  differenceCanvas.width = stageCanvas.width;
  differenceCanvas.height = stageCanvas.height;
  moshCtx.imageSmoothingEnabled = false;
  syncRenderCanvasSize();
}

function syncEditCanvasSize(width, height) {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  if (editCanvas.width !== targetWidth || editCanvas.height !== targetHeight) {
    editCanvas.width = targetWidth;
    editCanvas.height = targetHeight;
  }
  editCtx.imageSmoothingEnabled = false;
}

function syncRenderCanvasSize() {
  const videoWidth = sourceVideo.videoWidth || 1280;
  const videoHeight = sourceVideo.videoHeight || 720;
  renderCanvas.width = Math.max(64, Math.round(videoWidth * renderScale));
  renderCanvas.height = Math.max(36, Math.round(videoHeight * renderScale));
  renderCtx.imageSmoothingEnabled = false;
}

function clearStage() {
  stageCtx.fillStyle = "#000000";
  stageCtx.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
  moshCtx.fillStyle = "#000000";
  moshCtx.fillRect(0, 0, moshCanvas.width, moshCanvas.height);
  hasMoshFrame = false;
}

function drawFrameToRect(source, x, y, width, height) {
  stageCtx.drawImage(source, x, y, width, height);
}

function hasEditorAdjustments() {
  return isBwGritEnabled
    || editorState.brightness !== EDITOR_DEFAULTS.brightness
    || editorState.contrast !== EDITOR_DEFAULTS.contrast
    || editorState.highlights !== EDITOR_DEFAULTS.highlights
    || editorState.sharpness !== EDITOR_DEFAULTS.sharpness;
}

function applySharpness(data, width, height, amount) {
  if (amount <= 0 || width < 3 || height < 3) {
    return;
  }

  const source = new Uint8ClampedArray(data);
  const strength = amount / 100;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        const center = source[index + channel];
        const blur = (
          source[index - 4 + channel] +
          source[index + 4 + channel] +
          source[index - width * 4 + channel] +
          source[index + width * 4 + channel]
        ) * 0.25;
        data[index + channel] = clamp(center + (center - blur) * strength, 0, 255);
      }
    }
  }
}

function applyEditorAdjustments() {
  if (!hasEditorAdjustments()) {
    return;
  }

  const width = editCanvas.width;
  const height = editCanvas.height;
  const imageData = editCtx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const brightness = editorState.brightness * 2.55;
  const contrast = editorState.contrast / 100;
  const highlights = editorState.highlights * 2.55;
  const hasColorAdjustments = editorState.brightness !== 0 || editorState.contrast !== 100 || editorState.highlights !== 0;

  if (isBwGritEnabled) {
    for (let index = 0; index < data.length; index += 4) {
      const luma = (data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114);
      const noise = (((index * 17) + frameStats.output * 31) % 37) - 18;
      let value = ((luma - 128) * 1.75) + 128 + noise;
      value = value > 132 ? Math.min(255, value + 18) : Math.max(0, value - 24);
      value = clamp(value, 0, 255);
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
    }
  } else if (hasColorAdjustments) {
    for (let index = 0; index < data.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = (data[index + channel] - 128) * contrast + 128 + brightness;
        value += highlights * clamp((value - 128) / 127, 0, 1);

        data[index + channel] = clamp(value, 0, 255);
      }
    }
  }

  applySharpness(data, width, height, editorState.sharpness);
  editCtx.putImageData(imageData, 0, 0);
}

function drawEditedFrameToRect(source, x, y, width, height) {
  if (!hasEditorAdjustments()) {
    stageCtx.drawImage(source, x, y, width, height);
    return;
  }

  syncEditCanvasSize(width, height);
  editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
  editCtx.drawImage(source, 0, 0, editCanvas.width, editCanvas.height);
  applyEditorAdjustments();
  stageCtx.drawImage(editCanvas, x, y, width, height);
  frameStats.editor += 1;
}

function drawOutputFrame(editedSource = sourceVideo) {
  const editedFrame = editedSource || sourceVideo;
  stageCtx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
  stageCtx.fillStyle = "#000000";
  stageCtx.fillRect(0, 0, stageCanvas.width, stageCanvas.height);

  if (splitMode === SPLIT_MODES.vertical) {
    const halfWidth = stageCanvas.width / 2;
    drawEditedFrameToRect(editedFrame, 0, 0, halfWidth, stageCanvas.height);
    drawFrameToRect(sourceVideo, halfWidth, 0, halfWidth, stageCanvas.height);
    return;
  }

  if (splitMode === SPLIT_MODES.horizontal) {
    const halfHeight = stageCanvas.height / 2;
    drawFrameToRect(sourceVideo, 0, 0, stageCanvas.width, halfHeight);
    drawEditedFrameToRect(editedFrame, 0, halfHeight, stageCanvas.width, halfHeight);
    return;
  }

  drawEditedFrameToRect(editedFrame, 0, 0, stageCanvas.width, stageCanvas.height);
}

function drawBlendedOutput() {
  const width = stageCanvas.width;
  const height = stageCanvas.height;
  differenceCtx.clearRect(0, 0, width, height);
  differenceCtx.globalCompositeOperation = "source-over";
  differenceCtx.globalAlpha = 1;
  differenceCtx.drawImage(sourceVideo, 0, 0, width, height);
  differenceCtx.globalCompositeOperation = blendMode;
  differenceCtx.globalAlpha = blendOpacity;
  differenceCtx.drawImage(moshCanvas, 0, 0, width, height);
  differenceCtx.globalCompositeOperation = "source-over";
  differenceCtx.globalAlpha = 1;

  drawOutputFrame(differenceCanvas);
}

function isBlendModeActive() {
  return blendMode !== "source-over";
}

function updateSplitButtons() {
  splitVerticalButton?.classList.toggle("button--primary", splitMode === SPLIT_MODES.vertical);
  splitHorizontalButton?.classList.toggle("button--primary", splitMode === SPLIT_MODES.horizontal);
}

function setSplitMode(nextMode) {
  splitMode = splitMode === nextMode ? SPLIT_MODES.off : nextMode;
  updateSplitButtons();
  requestKeyFrame();

  if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (isBlendModeActive() && hasMoshFrame) {
      drawBlendedOutput();
    } else {
      drawOutputFrame(hasMoshFrame ? moshCanvas : sourceVideo);
    }
  }

  setStatus(splitMode === SPLIT_MODES.off ? "SPLIT OFF" : `${splitMode} SPLIT`);
}

function updateDatamoshToggle() {
  datamoshToggle.textContent = isDatamoshEnabled ? "DATAMOSH ON" : "DATAMOSH OFF";
  datamoshToggle.classList.toggle("button--primary", isDatamoshEnabled);
}

function updateOptimizationHud() {
  renderHudStatus.textContent = `${Math.round(renderScale * 100)}% / ${fpsCap} FPS`;
}

function syncPresetControls() {
  if (speedSlider) {
    speedSlider.value = String(speed);
  }
  if (speedOutput) {
    speedOutput.value = String(speed);
    speedOutput.textContent = String(speed);
  }
  if (qualitySelect) {
    qualitySelect.value = String(renderScale);
  }
  if (fpsSelect) {
    fpsSelect.value = String(fpsCap);
  }
  moshPresetButtons.forEach((button) => {
    const isActive = button.dataset.moshPreset === activePresetName;
    button.classList.toggle("button--primary", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  if (moshBlendModeSelect) {
    moshBlendModeSelect.value = blendMode;
  }
}

function updateBwGritToggle() {
  bwGritToggle?.classList.toggle("is-active", isBwGritEnabled);
  bwGritToggle?.setAttribute("aria-pressed", String(isBwGritEnabled));
}

function resetPresetCounters() {
  framesSinceKeyframe = 0;
  presetFrameCounter = 0;
}

function requestKeyFrame(isHardReset = false) {
  useKeyFrame = true;
  forcePresetKeyFrame = forcePresetKeyFrame || isHardReset;
}

function setBlendMode(nextBlendMode) {
  blendMode = BLEND_MODES.includes(nextBlendMode) ? nextBlendMode : "source-over";
  syncPresetControls();
  refreshPausedFrame();
  appendLog(`BLEND ${blendMode === "source-over" ? "NORMAL" : blendMode}`);
}

function setBwGritEnabled(isEnabled) {
  isBwGritEnabled = isEnabled;
  updateBwGritToggle();
  requestKeyFrame();
  refreshPausedFrame();
  appendLog(isBwGritEnabled ? "B/W GRIT ON" : "B/W GRIT OFF");
}

function applyPreset(name) {
  const preset = MOSH_PRESETS[name] || MOSH_PRESETS.default;
  activePresetName = MOSH_PRESETS[name] ? name : "default";
  keyframeMode = preset.keyframeMode;

  if (activePresetName === "default") {
    speed = DEFAULT_MOSH_SETTINGS.speed;
    renderScale = DEFAULT_MOSH_SETTINGS.renderScale;
    fpsCap = DEFAULT_MOSH_SETTINGS.fpsCap;
    blendMode = "source-over";
    blendOpacity = 1;
  } else {
    speed = preset.speed;
    renderScale = preset.renderScale;
    fpsCap = preset.fpsCap;
    blendMode = BLEND_MODES.includes(preset.blendMode) ? preset.blendMode : "source-over";
    blendOpacity = preset.blendOpacity ?? 1;
    isDatamoshEnabled = true;
    updateDatamoshToggle();
  }

  resetPresetCounters();
  syncPresetControls();
  syncRenderCanvasSize();
  updateOptimizationHud();
  requestKeyFrame(true);
  appendLog(`PRESET ${preset.label}`);

  if (activeSourceMode) {
    setupWebCodecs().catch((error) => {
      console.error(error);
      setStatus("PRESET ERROR");
      appendLog(`ERROR: ${error.message}`);
    });
  }
}

function shouldEncodeKeyFrame() {
  if (keyframeMode === "minimal") {
    const preset = MOSH_PRESETS.heavy;
    if (forcePresetKeyFrame || framesSinceKeyframe > preset.maxFramesWithoutReset) {
      framesSinceKeyframe = 0;
      forcePresetKeyFrame = false;
      return true;
    }
    framesSinceKeyframe += 1;
    forcePresetKeyFrame = false;
    return false;
  }

  if (keyframeMode === "interval") {
    const preset = MOSH_PRESETS.controlled;
    if (useKeyFrame || forcePresetKeyFrame) {
      presetFrameCounter = 1;
      forcePresetKeyFrame = false;
      return true;
    }
    const shouldReset = presetFrameCounter % preset.keyframeInterval === 0;
    presetFrameCounter += 1;
    forcePresetKeyFrame = false;
    return shouldReset;
  }

  forcePresetKeyFrame = false;
  return useKeyFrame;
}

function refreshPausedFrame() {
  if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (isBlendModeActive() && hasMoshFrame) {
      drawBlendedOutput();
    } else {
      drawOutputFrame(hasMoshFrame ? moshCanvas : sourceVideo);
    }
  }
}

function syncEditorControl(control) {
  const key = control.dataset.editorControl;
  const value = Number(control.value);
  editorState[key] = value;
  const output = document.getElementById(`${key}-output`);
  if (output) {
    output.value = String(value);
    output.textContent = String(value);
  }
}

function bindEditorControls() {
  editorControls.forEach((control) => {
    syncEditorControl(control);
    control.addEventListener("input", () => {
      syncEditorControl(control);
      requestKeyFrame();
      refreshPausedFrame();
    });
  });
}

function applyOptimizationSettings() {
  renderScale = Number(qualitySelect?.value || renderScale);
  fpsCap = Number(fpsSelect?.value || fpsCap);
  syncRenderCanvasSize();
  updateOptimizationHud();
  requestKeyFrame();
  appendLog(`RENDER ${Math.round(renderScale * 100)}% / ${fpsCap} FPS`);

  if (activeSourceMode) {
    setupWebCodecs().catch((error) => {
      console.error(error);
      setStatus("RENDER ERROR");
      appendLog(`ERROR: ${error.message}`);
    });
  }
}

function stopLoop() {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  lastRenderTime = 0;
}

async function destroyCodecs() {
  isWebCodecsReady = false;

  if (encoder) {
    try {
      await encoder.flush();
    } catch (error) {
      appendLog(`ENCODER FLUSH SKIP / ${error.message}`);
    }
    encoder.close();
    encoder = null;
  }

  if (decoder) {
    try {
      await decoder.flush();
    } catch (error) {
      appendLog(`DECODER FLUSH SKIP / ${error.message}`);
    }
    decoder.close();
    decoder = null;
  }
}

function stopSource() {
  if (webcamStream) {
    webcamStream.getTracks().forEach((track) => track.stop());
    webcamStream = null;
  }

  if (fileObjectUrl) {
    URL.revokeObjectURL(fileObjectUrl);
    fileObjectUrl = null;
  }

  sourceVideo.pause();
  sourceVideo.srcObject = null;
  sourceVideo.removeAttribute("src");
  sourceVideo.load();
  activeSourceMode = "";
  volumeController.setAvailable(false);
  hasMoshFrame = false;
}

function sourceLabel() {
  return activeSourceMode === "file" ? "VIDEO" : "CAMERA";
}

function setSourceButtonState(mode) {
  startButton.classList.toggle("active", mode === "camera");
  importButton.classList.toggle("active", mode === "file");
  startButton.classList.toggle("button--primary", mode === "camera");
  importButton.classList.toggle("button--primary", mode === "file");
  videoDropButton?.classList.toggle("has-source", Boolean(mode));
}

function setDropMouthOpen(isOpen, duration = 0) {
  window.clearTimeout(dropMouthTimer);
  videoDropButton?.classList.toggle("drag-over", isOpen);

  if (isOpen && duration > 0) {
    dropMouthTimer = window.setTimeout(() => {
      videoDropButton?.classList.remove("drag-over");
    }, duration);
  }
}

function isVideoUploadFile(file) {
  const fileName = file?.name?.toLowerCase() || "";
  return Boolean(file?.type?.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(fileName));
}

function getVideoFileFromTransfer(dataTransfer) {
  return Array.from(dataTransfer?.files || []).find(isVideoUploadFile) || null;
}

function handleUploadFile(file) {
  if (!file) {
    return;
  }

  if (!isVideoUploadFile(file)) {
    setStatus("BAD FILE");
    return;
  }

  startDatamoshUpload(file).catch((error) => {
    console.error(error);
    setStatus("UPLOAD ERROR");
    appendLog(`ERROR: ${error.message}`);
  });
}

function cloneChunk(chunk) {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return new EncodedVideoChunk({
    type: chunk.type,
    timestamp: chunk.timestamp,
    duration: chunk.duration,
    data,
  });
}

function handleEncodedChunk(chunk) {
  if (!decoder || decoder.state !== "configured") {
    return;
  }

  if (chunk.type === "key") {
    decoder.decode(cloneChunk(chunk));
  } else {
    for (let i = 0; i < speed; i += 1) {
      decoder.decode(cloneChunk(chunk));
    }
  }
}

function handleDecodedFrame(frame) {
  moshCtx.clearRect(0, 0, moshCanvas.width, moshCanvas.height);
  moshCtx.drawImage(frame, 0, 0, moshCanvas.width, moshCanvas.height);
  hasMoshFrame = true;
  frameStats.decoded += 1;
  if (isBlendModeActive()) {
    drawBlendedOutput();
  } else {
    drawOutputFrame(moshCanvas);
  }
  frame.close();
}

function shouldRenderFrame(timestamp) {
  if (!fpsCap || fpsCap <= 0) {
    return true;
  }

  const frameInterval = 1000 / fpsCap;
  if (timestamp - lastRenderTime < frameInterval) {
    frameStats.skipped += 1;
    refreshFrameCounter();
    return false;
  }

  lastRenderTime = timestamp;
  return true;
}

function getFrameTimestampUs(timestamp) {
  return Math.max(0, Math.round(timestamp * 1000));
}

function drawLoop(timestamp = 0) {
  if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && shouldRenderFrame(timestamp)) {
    try {
      if (isDatamoshEnabled && isWebCodecsReady) {
        renderCtx.drawImage(sourceVideo, 0, 0, renderCanvas.width, renderCanvas.height);
        const frame = new VideoFrame(renderCanvas, {
          timestamp: getFrameTimestampUs(timestamp),
        });
        encoder.encode(frame, { keyFrame: shouldEncodeKeyFrame() });
        frame.close();
      } else {
        drawOutputFrame(sourceVideo);
      }

      useKeyFrame = false;
      frameStats.output += 1;
      refreshFrameCounter();
      setTimeline(`${isDatamoshEnabled ? "DATAMOSH" : "CLEAN"} X${speed} ${Math.round(renderScale * 100)}% ${fpsCap} FPS`);
    } catch (error) {
      frameStats.errors += 1;
      refreshFrameCounter();
      appendLog(`FRAME SKIP / ${error.message}`);
    }
  }

  animationFrame = requestAnimationFrame(drawLoop);
}

async function startWebcam() {
  webcamStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user",
    },
    audio: false,
  });

  sourceVideo.srcObject = webcamStream;
  sourceVideo.playsInline = true;
  volumeController.setAvailable(false);

  await new Promise((resolve) => {
    sourceVideo.onloadeddata = () => resolve();
  });

  await sourceVideo.play();
  activeSourceMode = "camera";
  syncRenderCanvasSize();
  setSourceButtonState("camera");
  sourceMeta.textContent = `CAMERA ${sourceVideo.videoWidth}X${sourceVideo.videoHeight}`;
  appendLog(`CAMERA READY / ${sourceMeta.textContent}`);
}

async function startUploadedVideo(file) {
  fileObjectUrl = URL.createObjectURL(file);
  sourceVideo.src = fileObjectUrl;
  sourceVideo.playsInline = true;
  sourceVideo.loop = false;
  volumeController.setVolume(0);
  volumeController.setAvailable(true);

  await new Promise((resolve) => {
    sourceVideo.onloadeddata = () => resolve();
  });

  let autoplayBlocked = false;
  try {
    await sourceVideo.play();
  } catch {
    autoplayBlocked = true;
  }

  activeSourceMode = "file";
  syncRenderCanvasSize();
  setSourceButtonState("file");
  sourceMeta.textContent = `VIDEO ${sourceVideo.videoWidth}X${sourceVideo.videoHeight} ${sourceVideo.duration.toFixed(2)}S`;
  appendLog(`VIDEO READY / ${sourceMeta.textContent}`);
  return { autoplayBlocked };
}

async function setupWebCodecs() {
  if (!window.VideoEncoder || !window.VideoDecoder || !window.VideoFrame) {
    throw new Error("VIDEO CODEC UNSUPPORTED");
  }

  await destroyCodecs();

  encoder = new VideoEncoder({
    output: handleEncodedChunk,
    error: (error) => {
      console.error("Encoder error:", error);
      appendLog(`ENCODER ERROR / ${error.message}`);
      setStatus("ENCODER ERROR");
    },
  });

  encoder.configure({
    codec: "vp8",
    width: renderCanvas.width,
    height: renderCanvas.height,
  });

  decoder = new VideoDecoder({
    output: handleDecodedFrame,
    error: (error) => {
      console.error("Decoder error:", error);
      appendLog(`DECODER ERROR / ${error.message}`);
      setStatus("DECODER ERROR");
    },
  });

  decoder.configure({ codec: "vp8" });
  isWebCodecsReady = true;
  appendLog(`CODEC READY / ${renderCanvas.width}X${renderCanvas.height}`);
}

async function startDatamoshVideo() {
  stopLoop();
  clearStage();
  resetFrameStats();
  setStatus("CAMERA START");
  stopSource();
  await startWebcam();
  await setupWebCodecs();
  requestKeyFrame(true);
  setStatus("DATAMOSH ACTIVE");
  drawLoop();
}

async function startDatamoshUpload(file) {
  stopLoop();
  clearStage();
  resetFrameStats();
  setStatus("VIDEO LOAD");
  stopSource();
  const { autoplayBlocked } = await startUploadedVideo(file);
  await setupWebCodecs();
  requestKeyFrame(true);
  setStatus(autoplayBlocked ? "PLAY REQUIRED" : "DATAMOSH ACTIVE");
  drawLoop();
}

async function playActiveSource() {
  if (!activeSourceMode) {
    setStatus("NO SOURCE");
    return;
  }
  await sourceVideo.play();
  setStatus(`${sourceLabel()} PLAY`);
}

async function handleVideoEnded() {
  if (activeSourceMode !== "file") {
    return;
  }

  sourceVideo.currentTime = 0;
  requestKeyFrame(true);
  try {
    await sourceVideo.play();
    setStatus("VIDEO LOOP");
  } catch (error) {
    appendLog(`LOOP BLOCKED / ${error.message}`);
    setStatus("PLAY REQUIRED");
  }
}

function pauseActiveSource() {
  if (!activeSourceMode) {
    setStatus("NO SOURCE");
    return;
  }
  sourceVideo.pause();
  setStatus(`${sourceLabel()} PAUSE`);
}

function stopActiveSource() {
  if (!activeSourceMode) {
    setStatus("NO SOURCE");
    return;
  }
  sourceVideo.pause();
  if (activeSourceMode === "file") {
    sourceVideo.currentTime = 0;
  }
  requestKeyFrame();
  setStatus(`${sourceLabel()} STOP`);
}

async function restartActiveSource() {
  if (!activeSourceMode) {
    setStatus("NO SOURCE");
    return;
  }
  if (activeSourceMode === "file") {
    sourceVideo.currentTime = 0;
  }
  requestKeyFrame(true);
  await sourceVideo.play();
  setStatus(`${sourceLabel()} RESTART`);
}

startButton.addEventListener("click", () => {
  startDatamoshVideo().catch((error) => {
    console.error(error);
    setStatus("CAMERA ERROR");
    appendLog(`ERROR: ${error.message}`);
  });
});

importButton.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  handleUploadFile(fileInput.files?.[0]);
});

videoDropButton?.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

stageShell?.addEventListener("dragenter", (event) => {
  event.preventDefault();
  setDropMouthOpen(true);
});

stageShell?.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setDropMouthOpen(true);
});

stageShell?.addEventListener("dragleave", (event) => {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    setDropMouthOpen(false);
  }
});

stageShell?.addEventListener("drop", (event) => {
  event.preventDefault();
  setDropMouthOpen(true, 700);
  const file = getVideoFileFromTransfer(event.dataTransfer);
  if (!file) {
    setStatus("BAD FILE");
    return;
  }

  handleUploadFile(file);
});

playButton.addEventListener("click", () => {
  playActiveSource().catch((error) => {
    console.error(error);
    setStatus("PLAY ERROR");
    appendLog(`ERROR: ${error.message}`);
  });
});

pauseButton.addEventListener("click", () => {
  pauseActiveSource();
});

stopButton.addEventListener("click", () => {
  stopActiveSource();
});

restartButton.addEventListener("click", () => {
  restartActiveSource().catch((error) => {
    console.error(error);
    setStatus("RESTART ERROR");
    appendLog(`ERROR: ${error.message}`);
  });
});

resetButton.addEventListener("click", () => {
  requestKeyFrame(true);
  setStatus("KEYFRAME RESET");
  appendLog("KEYFRAME RESET");
});

splitVerticalButton?.addEventListener("click", () => {
  setSplitMode(SPLIT_MODES.vertical);
});

splitHorizontalButton?.addEventListener("click", () => {
  setSplitMode(SPLIT_MODES.horizontal);
});

datamoshToggle.addEventListener("click", () => {
  isDatamoshEnabled = !isDatamoshEnabled;
  requestKeyFrame();
  updateDatamoshToggle();
  setStatus(isDatamoshEnabled ? "DATAMOSH ACTIVE" : "CLEAN ACTIVE");
});

optimizationToggle.addEventListener("click", () => {
  const isCollapsed = optimizationPanel.classList.toggle("collapsed");
  optimizationToggle.textContent = isCollapsed ? "+" : "-";
  optimizationToggle.setAttribute("aria-expanded", String(!isCollapsed));
  optimizationToggle.setAttribute("aria-label", isCollapsed ? "Expand optimize panel" : "Collapse optimize panel");
});

videoEditorToggle.addEventListener("click", () => {
  const isCollapsed = videoEditorPanel.classList.toggle("collapsed");
  videoEditorToggle.textContent = isCollapsed ? "+" : "-";
  videoEditorToggle.setAttribute("aria-expanded", String(!isCollapsed));
  videoEditorToggle.setAttribute("aria-label", isCollapsed ? "Expand video editor panel" : "Collapse video editor panel");
});

fpsSelect?.addEventListener("change", applyOptimizationSettings);

qualitySelect?.addEventListener("change", applyOptimizationSettings);

moshPresetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyPreset(button.dataset.moshPreset);
  });
});

moshBlendModeSelect?.addEventListener("change", () => {
  setBlendMode(moshBlendModeSelect.value);
});

bwGritToggle?.addEventListener("click", () => {
  setBwGritEnabled(!isBwGritEnabled);
});

recordButton.addEventListener("click", () => {
  if (recorder && recorder.state !== "inactive") {
    stopRecording();
    return;
  }

  startRecording();
});

speedSlider.addEventListener("input", () => {
  speed = Number(speedSlider.value);
  speedOutput.value = String(speed);
  speedOutput.textContent = String(speed);
});

sourceVideo.addEventListener("ended", () => {
  handleVideoEnded().catch((error) => {
    console.error(error);
    appendLog(`LOOP ERROR / ${error.message}`);
  });
});

window.addEventListener("resize", async () => {
  updateCanvasSize();
  clearStage();
  if (!webcamStream && !fileObjectUrl) {
    return;
  }
  await setupWebCodecs();
  requestKeyFrame();
});

window.addEventListener("beforeunload", async () => {
  stopRecording();
  stopLoop();
  stopSource();
  await destroyCodecs();
});

updateCanvasSize();
clearStage();
syncPresetControls();
setTimeline("IDLE");
setStatus("IDLE");
appendLog("DATAMOSH READY");
setRecordingState(false);
setSourceButtonState("");
updateSplitButtons();
updateDatamoshToggle();
updateOptimizationHud();
updateBwGritToggle();
bindEditorControls();
refreshFrameCounter();
