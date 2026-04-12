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
const datamoshToggle = document.getElementById("datamosh-toggle");
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

const stageCtx = stageCanvas.getContext("2d", { alpha: false });
const renderCanvas = document.createElement("canvas");
const renderCtx = renderCanvas.getContext("2d", { alpha: false });

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

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  logOutput.textContent = `[${timestamp}] ${normalizeUiText(message)}\n${logOutput.textContent}`.slice(0, 16000);
}

function updateCanvasSize() {
  stageCanvas.width = Math.max(640, window.innerWidth);
  stageCanvas.height = Math.max(360, window.innerHeight);
  syncRenderCanvasSize();
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
}

function drawSourceToStage() {
  stageCtx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
  stageCtx.drawImage(sourceVideo, 0, 0, stageCanvas.width, stageCanvas.height);
}

function updateDatamoshToggle() {
  datamoshToggle.textContent = isDatamoshEnabled ? "DATAMOSH ON" : "DATAMOSH OFF";
  datamoshToggle.classList.toggle("button--primary", isDatamoshEnabled);
}

function updateOptimizationHud() {
  renderHudStatus.textContent = `${Math.round(renderScale * 100)}% / ${fpsCap} FPS`;
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
  stageCtx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
  stageCtx.drawImage(frame, 0, 0, stageCanvas.width, stageCanvas.height);
  frame.close();
}

function shouldRenderFrame(timestamp) {
  if (!fpsCap || fpsCap <= 0) {
    return true;
  }

  const frameInterval = 1000 / fpsCap;
  if (timestamp - lastRenderTime < frameInterval) {
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
        drawSourceToStage();
      }

      useKeyFrame = false;
      setTimeline(`${isDatamoshEnabled ? "DATAMOSH" : "CLEAN"} X${speed} ${Math.round(renderScale * 100)}% ${fpsCap} FPS`);
    } catch (error) {
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
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;

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
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;
  sourceVideo.loop = false;

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

datamoshToggle.addEventListener("click", () => {
  isDatamoshEnabled = !isDatamoshEnabled;
  useKeyFrame = true;
  updateDatamoshToggle();
  setStatus(isDatamoshEnabled ? "DATAMOSH ACTIVE" : "CLEAN ACTIVE");
});

optimizationToggle.addEventListener("click", () => {
  const isCollapsed = optimizationPanel.classList.toggle("collapsed");
  optimizationToggle.textContent = isCollapsed ? "EXPAND" : "MINIMIZE";
  optimizationToggle.setAttribute("aria-expanded", String(!isCollapsed));
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
updateDatamoshToggle();
updateOptimizationHud();
