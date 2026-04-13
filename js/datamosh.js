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
const fpsSelect = document.getElementById("fps-select");
const qualitySelect = document.getElementById("quality-select");
const renderHudStatus = document.getElementById("render-hud-status");
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
const curveCanvas = document.getElementById("curve-canvas");
const curveOutput = document.getElementById("curve-output");
const curveCtx = curveCanvas?.getContext("2d");

const stageCtx = stageCanvas.getContext("2d", { alpha: false });
const renderCanvas = document.createElement("canvas");
const renderCtx = renderCanvas.getContext("2d", { alpha: false });
const moshCanvas = document.createElement("canvas");
const moshCtx = moshCanvas.getContext("2d", { alpha: false });
const editCanvas = document.createElement("canvas");
const editCtx = editCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
const SPLIT_MODES = Object.freeze({
  off: "off",
  vertical: "vertical",
  horizontal: "horizontal",
});
const EDITOR_DEFAULTS = Object.freeze({
  brightness: 0,
  contrast: 100,
  highlights: 0,
  curve: 0,
  sharpness: 0,
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
let lastRenderTime = 0;
let dropMouthTimer = 0;
let splitMode = SPLIT_MODES.off;
let hasMoshFrame = false;
let isDraggingCurve = false;
const curvePoint = { x: 0.5, y: 0.5 };
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
  return Object.entries(EDITOR_DEFAULTS).some(([key, value]) => editorState[key] !== value);
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
  const curve = editorState.curve / 100;

  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      let value = data[index + channel];
      value = (value - 128) * contrast + 128 + brightness;

      const highlightMask = clamp((value - 128) / 127, 0, 1);
      value += highlights * highlightMask;

      if (curve !== 0) {
        const lift = curve > 0 ? curve * 34 : 0;
        const crush = curve < 0 ? -curve * 34 : 0;
        value = ((value - lift) / Math.max(1, 255 - lift - crush)) * 255;
        const normalized = clamp(value / 255, 0, 1);
        const sCurve = normalized * normalized * (3 - 2 * normalized);
        const flatCurve = 0.5 + (normalized - 0.5) * 0.55;
        const target = curve > 0 ? sCurve : flatCurve;
        value = (normalized + (target - normalized) * Math.abs(curve)) * 255;
      }

      data[index + channel] = clamp(value, 0, 255);
    }
  }

  applySharpness(data, width, height, editorState.sharpness);
  editCtx.putImageData(imageData, 0, 0);
}

function drawEditedFrameToRect(source, x, y, width, height) {
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

function updateSplitButtons() {
  splitVerticalButton?.classList.toggle("button--primary", splitMode === SPLIT_MODES.vertical);
  splitHorizontalButton?.classList.toggle("button--primary", splitMode === SPLIT_MODES.horizontal);
}

function setSplitMode(nextMode) {
  splitMode = splitMode === nextMode ? SPLIT_MODES.off : nextMode;
  updateSplitButtons();
  useKeyFrame = true;

  if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    drawOutputFrame(hasMoshFrame ? moshCanvas : sourceVideo);
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

function refreshPausedFrame() {
  if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    drawOutputFrame(hasMoshFrame ? moshCanvas : sourceVideo);
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
      useKeyFrame = true;
      refreshPausedFrame();
    });
  });
}

function drawCurveGraph() {
  if (!curveCanvas || !curveCtx) {
    return;
  }

  const width = curveCanvas.width;
  const height = curveCanvas.height;
  curveCtx.clearRect(0, 0, width, height);
  curveCtx.fillStyle = "#000000";
  curveCtx.fillRect(0, 0, width, height);
  curveCtx.lineWidth = 1;
  curveCtx.strokeStyle = "rgba(128, 128, 128, 0.55)";

  for (let step = 1; step < 4; step += 1) {
    const x = (width / 4) * step;
    const y = (height / 4) * step;
    curveCtx.beginPath();
    curveCtx.moveTo(x, 0);
    curveCtx.lineTo(x, height);
    curveCtx.moveTo(0, y);
    curveCtx.lineTo(width, y);
    curveCtx.stroke();
  }

  curveCtx.strokeStyle = "rgba(120, 120, 120, 0.7)";
  curveCtx.beginPath();
  curveCtx.moveTo(0, height);
  curveCtx.lineTo(width, 0);
  curveCtx.stroke();

  const pointX = curvePoint.x * width;
  const pointY = curvePoint.y * height;
  curveCtx.lineWidth = 2;
  curveCtx.strokeStyle = "#ff1d00";
  curveCtx.shadowColor = "#ff3b00";
  curveCtx.shadowBlur = 8;
  curveCtx.beginPath();
  curveCtx.moveTo(0, height);
  curveCtx.lineTo(pointX, pointY);
  curveCtx.lineTo(width, 0);
  curveCtx.stroke();
  curveCtx.shadowBlur = 0;

  curveCtx.fillStyle = "#ff3b00";
  curveCtx.strokeStyle = "#ffffff";
  curveCtx.lineWidth = 1;
  curveCtx.beginPath();
  curveCtx.rect(pointX - 3, pointY - 3, 6, 6);
  curveCtx.fill();
  curveCtx.stroke();
}

function syncCurveOutput() {
  if (curveOutput) {
    curveOutput.value = String(editorState.curve);
    curveOutput.textContent = String(editorState.curve);
  }
  curveCanvas?.setAttribute("aria-valuenow", String(editorState.curve));
}

function setCurveValue(value) {
  editorState.curve = Math.round(clamp(value, -100, 100));
  curvePoint.x = 0.5;
  curvePoint.y = clamp(0.5 - (editorState.curve / 200), 0.05, 0.95);
  syncCurveOutput();
  drawCurveGraph();
  useKeyFrame = true;
  refreshPausedFrame();
}

function setCurveFromPointer(event) {
  if (!curveCanvas) {
    return;
  }

  const bounds = curveCanvas.getBoundingClientRect();
  curvePoint.x = clamp((event.clientX - bounds.left) / bounds.width, 0.05, 0.95);
  curvePoint.y = clamp((event.clientY - bounds.top) / bounds.height, 0.05, 0.95);
  const diagonalY = 1 - curvePoint.x;
  editorState.curve = Math.round(clamp((diagonalY - curvePoint.y) * 200, -100, 100));
  syncCurveOutput();
  drawCurveGraph();
  useKeyFrame = true;
  refreshPausedFrame();
}

function bindCurveEditor() {
  syncCurveOutput();
  drawCurveGraph();

  curveCanvas?.addEventListener("pointerdown", (event) => {
    isDraggingCurve = true;
    curveCanvas.setPointerCapture?.(event.pointerId);
    setCurveFromPointer(event);
  });

  curveCanvas?.addEventListener("pointermove", (event) => {
    if (isDraggingCurve) {
      setCurveFromPointer(event);
    }
  });

  curveCanvas?.addEventListener("pointerup", () => {
    isDraggingCurve = false;
  });

  curveCanvas?.addEventListener("pointercancel", () => {
    isDraggingCurve = false;
  });

  curveCanvas?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
    setCurveValue(editorState.curve + direction * 5);
  });
}

function applyOptimizationSettings() {
  renderScale = Number(qualitySelect?.value || renderScale);
  fpsCap = Number(fpsSelect?.value || fpsCap);
  syncRenderCanvasSize();
  updateOptimizationHud();
  useKeyFrame = true;
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
  drawOutputFrame(moshCanvas);
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
        encoder.encode(frame, { keyFrame: useKeyFrame });
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
  useKeyFrame = true;
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
  useKeyFrame = true;
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
  useKeyFrame = true;
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
  useKeyFrame = true;
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
  useKeyFrame = true;
  updateDatamoshToggle();
  setStatus(isDatamoshEnabled ? "DATAMOSH ACTIVE" : "CLEAN ACTIVE");
});

optimizationToggle.addEventListener("click", () => {
  const isCollapsed = optimizationPanel.classList.toggle("collapsed");
  optimizationToggle.textContent = isCollapsed ? "+" : "-";
  optimizationToggle.setAttribute("aria-expanded", String(!isCollapsed));
  optimizationToggle.setAttribute("aria-label", isCollapsed ? "Expand optimize panel" : "Collapse optimize panel");
});

fpsSelect?.addEventListener("change", applyOptimizationSettings);

qualitySelect?.addEventListener("change", applyOptimizationSettings);

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
  useKeyFrame = true;
});

window.addEventListener("beforeunload", async () => {
  stopRecording();
  stopLoop();
  stopSource();
  await destroyCodecs();
});

updateCanvasSize();
clearStage();
speedOutput.value = String(speed);
setTimeline("IDLE");
setStatus("IDLE");
appendLog("DATAMOSH READY");
setRecordingState(false);
setSourceButtonState("");
updateSplitButtons();
updateDatamoshToggle();
updateOptimizationHud();
bindEditorControls();
bindCurveEditor();
refreshFrameCounter();
