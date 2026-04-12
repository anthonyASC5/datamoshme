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
const renderPresetLowButton = document.getElementById("render-preset-low");
const renderPresetMidButton = document.getElementById("render-preset-mid");
const renderHudStatus = document.getElementById("render-hud-status");
const fileInput = document.getElementById("file-input");
const videoDropButton = document.getElementById("video-drop-button");
const stageShell = document.querySelector(".stage-shell");
const speedSlider = document.getElementById("speed-slider");
const speedOutput = document.getElementById("speed-output");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const sourceMeta = document.getElementById("source-meta");
const logOutput = document.getElementById("log-output");

const stageCtx = stageCanvas.getContext("2d", { alpha: false });
const renderCanvas = document.createElement("canvas");
const renderCtx = renderCanvas.getContext("2d", { alpha: false });

const RENDER_PRESETS = Object.freeze({
  low: { label: "10% • 10 FPS", scale: 0.1, fpsCap: 10 },
  mid: { label: "30% • 20 FPS", scale: 0.3, fpsCap: 20 },
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
let activeRenderPresetKey = "mid";
let renderScale = RENDER_PRESETS[activeRenderPresetKey].scale;
let fpsCap = RENDER_PRESETS[activeRenderPresetKey].fpsCap;
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
  recordButton.textContent = isRecording ? "Stop Rec" : "Record";
  recordButton.classList.toggle("primary", isRecording);
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
    setStatus("Load a source before recording.");
    return;
  }

  if (!stageCanvas.captureStream || !window.MediaRecorder) {
    setStatus("Recording is not supported in this browser.");
    appendLog("Recording unavailable: captureStream or MediaRecorder missing.");
    return;
  }

  if (recorder && recorder.state !== "inactive") {
    setStatus("Recording already in progress.");
    return;
  }

  const mimeType = getRecordingMimeType();
  recordingStream = stageCanvas.captureStream(30);
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
      setStatus("Recording stopped, but no video was captured.");
      appendLog("Recording stopped with no data.");
      return;
    }

    downloadRecording(blob);
    setStatus("Recording stopped. Downloaded WebM.");
    appendLog(`Recording saved (${Math.round(blob.size / 1024)} KB).`);
  });

  recorder.addEventListener("error", (event) => {
    const message = event.error?.message || "Unknown recorder error.";
    setStatus("Recording failed.");
    appendLog(`Recording error: ${message}`);
    setRecordingState(false);
  });

  recorder.start(250);
  setRecordingState(true);
  setStatus("Recording stage output...");
  appendLog(`Recording started${mimeType ? ` (${mimeType})` : ""}.`);
}

function stopRecording() {
  if (!recorder || recorder.state === "inactive") {
    return;
  }

  recorder.stop();
}

function setStatus(message) {
  statusText.textContent = message;
}

function setTimeline(message) {
  timelineLabel.textContent = message;
}

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  logOutput.textContent = `[${timestamp}] ${message}\n${logOutput.textContent}`.slice(0, 16000);
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
  datamoshToggle.classList.toggle("primary", isDatamoshEnabled);
}

function updateOptimizationHud() {
  renderPresetLowButton.classList.toggle("primary", activeRenderPresetKey === "low");
  renderPresetMidButton.classList.toggle("primary", activeRenderPresetKey === "mid");
  renderHudStatus.textContent = `ACTIVE: ${Math.round(renderScale * 100)}% RENDER SCALE WITH A ${fpsCap} FPS CAP.`;
}

function applyRenderPreset(presetKey) {
  const preset = RENDER_PRESETS[presetKey];
  if (!preset) {
    return;
  }

  activeRenderPresetKey = presetKey;
  renderScale = preset.scale;
  fpsCap = preset.fpsCap;
  syncRenderCanvasSize();
  updateOptimizationHud();
  useKeyFrame = true;
  appendLog(`Render preset set to ${preset.label}.`);

  if (activeSourceMode) {
    setupWebCodecs().catch((error) => {
      console.error(error);
      setStatus("Render preset failed.");
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
      appendLog(`Encoder flush skipped: ${error.message}`);
    }
    encoder.close();
    encoder = null;
  }

  if (decoder) {
    try {
      await decoder.flush();
    } catch (error) {
      appendLog(`Decoder flush skipped: ${error.message}`);
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
  return activeSourceMode === "file" ? "Video" : "Camera";
}

function setSourceButtonState(mode) {
  startButton.classList.toggle("active", mode === "camera");
  importButton.classList.toggle("active", mode === "file");
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
    setStatus("Choose an MP4, WebM, or MOV video file.");
    return;
  }

  startDatamoshUpload(file).catch((error) => {
    console.error(error);
    setStatus("Upload failed.");
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
      setTimeline(`${isDatamoshEnabled ? "Datamosh" : "Clean"} • x${speed} • ${Math.round(renderScale * 100)}% • ${fpsCap} FPS`);
    } catch (error) {
      appendLog(`Frame encode skipped: ${error.message}`);
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
  sourceMeta.textContent = `Camera • ${sourceVideo.videoWidth}x${sourceVideo.videoHeight}`;
  appendLog(`Camera ready: ${sourceMeta.textContent}`);
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
  sourceMeta.textContent = `${file.name} • ${sourceVideo.duration.toFixed(2)}s • ${sourceVideo.videoWidth}x${sourceVideo.videoHeight}`;
  appendLog(`Video ready: ${sourceMeta.textContent}`);
  return { autoplayBlocked };
}

async function setupWebCodecs() {
  if (!window.VideoEncoder || !window.VideoDecoder || !window.VideoFrame) {
    throw new Error("This browser does not support the video codec tools needed for datamosh.");
  }

  await destroyCodecs();

  encoder = new VideoEncoder({
    output: handleEncodedChunk,
    error: (error) => {
      console.error("Encoder error:", error);
      appendLog(`Encoder error: ${error.message}`);
      setStatus("Encoder error.");
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
      appendLog(`Decoder error: ${error.message}`);
      setStatus("Decoder error.");
    },
  });

  decoder.configure({ codec: "vp8" });
  isWebCodecsReady = true;
  appendLog(`Video codec ready at ${renderCanvas.width}x${renderCanvas.height}`);
}

async function startDatamoshVideo() {
  stopLoop();
  clearStage();
  setStatus("Starting webcam...");
  stopSource();
  await startWebcam();
  await setupWebCodecs();
  setStatus("Datamosh running.");
  drawLoop();
}

async function startDatamoshUpload(file) {
  stopLoop();
  clearStage();
  setStatus("Loading uploaded video...");
  stopSource();
  const { autoplayBlocked } = await startUploadedVideo(file);
  await setupWebCodecs();
  setStatus(autoplayBlocked ? "Video loaded. Press Play if autoplay is blocked." : "Datamosh running.");
  drawLoop();
}

async function playActiveSource() {
  if (!activeSourceMode) {
    setStatus("Load a source first.");
    return;
  }
  await sourceVideo.play();
  setStatus(`${sourceLabel()} playing.`);
}

async function handleVideoEnded() {
  if (activeSourceMode !== "file") {
    return;
  }

  sourceVideo.currentTime = 0;
  useKeyFrame = true;
  try {
    await sourceVideo.play();
    setStatus("Video looped.");
  } catch (error) {
    appendLog(`Loop restart blocked: ${error.message}`);
    setStatus("Video ended. Press Play to restart.");
  }
}

function pauseActiveSource() {
  if (!activeSourceMode) {
    setStatus("Load a source first.");
    return;
  }
  sourceVideo.pause();
  setStatus(`${sourceLabel()} paused.`);
}

function stopActiveSource() {
  if (!activeSourceMode) {
    setStatus("Load a source first.");
    return;
  }
  sourceVideo.pause();
  if (activeSourceMode === "file") {
    sourceVideo.currentTime = 0;
  }
  useKeyFrame = true;
  setStatus(`${sourceLabel()} stopped.`);
}

async function restartActiveSource() {
  if (!activeSourceMode) {
    setStatus("Load a source first.");
    return;
  }
  if (activeSourceMode === "file") {
    sourceVideo.currentTime = 0;
  }
  useKeyFrame = true;
  await sourceVideo.play();
  setStatus(`${sourceLabel()} restarted.`);
}

startButton.addEventListener("click", () => {
  startDatamoshVideo().catch((error) => {
    console.error(error);
    setStatus("Camera start failed.");
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
    setStatus("Drop an MP4, WebM, or MOV video file.");
    return;
  }

  handleUploadFile(file);
});

playButton.addEventListener("click", () => {
  playActiveSource().catch((error) => {
    console.error(error);
    setStatus("Play failed.");
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
    setStatus("Restart failed.");
    appendLog(`ERROR: ${error.message}`);
  });
});

resetButton.addEventListener("click", () => {
  useKeyFrame = true;
  setStatus("Next frame forced as keyframe.");
  appendLog("Keyframe reset requested.");
});

datamoshToggle.addEventListener("click", () => {
  isDatamoshEnabled = !isDatamoshEnabled;
  useKeyFrame = true;
  updateDatamoshToggle();
  setStatus(isDatamoshEnabled ? "Datamosh enabled." : "Datamosh bypass enabled.");
});

optimizationToggle.addEventListener("click", () => {
  const isCollapsed = optimizationPanel.classList.toggle("collapsed");
  optimizationToggle.textContent = isCollapsed ? "EXPAND" : "MINIMIZE";
  optimizationToggle.setAttribute("aria-expanded", String(!isCollapsed));
});

renderPresetLowButton.addEventListener("click", () => {
  applyRenderPreset("low");
});

renderPresetMidButton.addEventListener("click", () => {
  applyRenderPreset("mid");
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
});

sourceVideo.addEventListener("ended", () => {
  handleVideoEnded().catch((error) => {
    console.error(error);
    appendLog(`Loop error: ${error.message}`);
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
setTimeline("Idle");
setStatus("Idle.");
appendLog("Datamosh ready.");
setRecordingState(false);
updateDatamoshToggle();
updateOptimizationHud();
