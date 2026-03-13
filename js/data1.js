const stageCanvas = document.getElementById("stage-canvas");
const sourceVideo = document.getElementById("source-video");
const startButton = document.getElementById("camera-button");
const importButton = document.getElementById("import-button");
const playButton = document.getElementById("play-button");
const pauseButton = document.getElementById("pause-button");
const stopButton = document.getElementById("stop-button");
const restartButton = document.getElementById("restart-button");
const startMoshButton = document.getElementById("start-mosh-button");
const stopMoshButton = document.getElementById("stop-mosh-button");
const recordButton = document.getElementById("record-button");
const resetButton = document.getElementById("reset-button");
const fileInput = document.getElementById("file-input");
const speedSlider = document.getElementById("speed-slider");
const speedOutput = document.getElementById("speed-output");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const sourceMeta = document.getElementById("source-meta");
const logOutput = document.getElementById("log-output");

// this canvas is the final stage output for the data1 relay.
const stageCtx = stageCanvas.getContext("2d", { alpha: false });

let encoder = null;
let decoder = null;
let animationFrame = 0;
let isWebCodecsReady = false;
let speed = 2;
let useKeyFrame = false;
let webcamStream = null;
let fileObjectUrl = null;
let activeSourceMode = "";
let isMoshActive = false;
let recorder = null;
let recordedChunks = [];
let recordingStream = null;

// mediarecorder support changes by browser, so this picks the first usable webm profile.
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

function waitForVideoData() {
  return new Promise((resolve, reject) => {
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Video data could not be loaded."));
    };
    const cleanup = () => {
      sourceVideo.removeEventListener("loadeddata", handleLoaded);
      sourceVideo.removeEventListener("error", handleError);
    };

    sourceVideo.addEventListener("loadeddata", handleLoaded, { once: true });
    sourceVideo.addEventListener("error", handleError, { once: true });
  });
}

// the stage follows the browser viewport so the relay always fills the shell.
function updateCanvasSize() {
  stageCanvas.width = Math.max(640, window.innerWidth);
  stageCanvas.height = Math.max(360, window.innerHeight);
}

function clearStage() {
  stageCtx.fillStyle = "#000000";
  stageCtx.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
}

function drawSourceFrame() {
  if (sourceVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    clearStage();
    return;
  }

  stageCtx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
  stageCtx.drawImage(sourceVideo, 0, 0, stageCanvas.width, stageCanvas.height);
}

function shouldAnimateSource() {
  return Boolean(activeSourceMode && !sourceVideo.paused);
}

function requestStageRefresh() {
  if (!activeSourceMode || animationFrame) {
    return;
  }

  animationFrame = requestAnimationFrame(drawLoop);
}

function stopLoop() {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
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
  isMoshActive = false;
  setSourceButtonState("");
  setMoshButtonState();
}

function sourceLabel() {
  return activeSourceMode === "file" ? "Video" : "Camera";
}

function setSourceButtonState(mode) {
  startButton.classList.toggle("active", mode === "camera");
  importButton.classList.toggle("active", mode === "file");
}

function setMoshButtonState() {
  const hasSource = Boolean(activeSourceMode);
  startMoshButton.disabled = !hasSource || isMoshActive;
  stopMoshButton.disabled = !hasSource || !isMoshActive;
  startMoshButton.classList.toggle("primary", isMoshActive);
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

// webcodecs replays non-key frames multiple times to create the simple data1 smear.
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
  if (!isMoshActive) {
    frame.close();
    return;
  }

  stageCtx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
  stageCtx.drawImage(frame, 0, 0, stageCanvas.width, stageCanvas.height);
  setTimeline(`Mosh • x${speed}`);
  frame.close();
}

function drawLoop() {
  if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (isMoshActive && isWebCodecsReady) {
      try {
        const frame = new VideoFrame(sourceVideo);
        encoder.encode(frame, { keyFrame: useKeyFrame });
        useKeyFrame = false;
        frame.close();
      } catch (error) {
        appendLog(`Frame encode skipped: ${error.message}`);
      }
    } else {
      drawSourceFrame();
      setTimeline(`${sourceLabel()} • clean`);
    }
  }

  if (shouldAnimateSource()) {
    animationFrame = requestAnimationFrame(drawLoop);
    return;
  }

  animationFrame = 0;
}

async function loadCameraSource() {
  stopLoop();
  clearStage();
  setStatus("Starting webcam...");
  stopSource();
  setMoshButtonState();
  await destroyCodecs();
  await startWebcam();
  drawSourceFrame();
  setTimeline("Camera • clean");
  setStatus("Camera ready. Mosh off.");
  setMoshButtonState();
  requestStageRefresh();
}

async function loadUploadedSource(file) {
  stopLoop();
  clearStage();
  setStatus("Loading uploaded video...");
  stopSource();
  setMoshButtonState();
  await destroyCodecs();
  await startUploadedVideo(file);
  drawSourceFrame();
  setTimeline("Video • clean");
  setStatus("Video ready. Mosh off.");
  setMoshButtonState();
  requestStageRefresh();
}

async function startMosh() {
  if (!activeSourceMode) {
    setStatus("Load a source first.");
    return;
  }

  if (isMoshActive) {
    return;
  }

  await setupWebCodecs();
  isMoshActive = true;
  useKeyFrame = true;
  setMoshButtonState();
  setStatus("Mosh running.");
  appendLog("Mosh started.");
  requestStageRefresh();
}

function stopMosh() {
  if (!activeSourceMode || !isMoshActive) {
    return;
  }

  isMoshActive = false;
  useKeyFrame = true;
  drawSourceFrame();
  setTimeline(`${sourceLabel()} • clean`);
  setStatus("Mosh stopped.");
  appendLog("Mosh stopped.");
  setMoshButtonState();
  requestStageRefresh();
}

async function playActiveSource() {
  if (!activeSourceMode) {
    setStatus("Load a source first.");
    return;
  }
  await sourceVideo.play();
  requestStageRefresh();
  setStatus(`${sourceLabel()} playing.`);
}

function pauseActiveSource() {
  if (!activeSourceMode) {
    setStatus("Load a source first.");
    return;
  }
  sourceVideo.pause();
  requestStageRefresh();
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
  requestStageRefresh();
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
  requestStageRefresh();
  setStatus(`${sourceLabel()} restarted.`);
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

  await waitForVideoData();

  await sourceVideo.play();
  activeSourceMode = "camera";
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
  sourceVideo.load();

  await waitForVideoData();

  await sourceVideo.play();
  activeSourceMode = "file";
  setSourceButtonState("file");
  sourceMeta.textContent = `${file.name} • ${sourceVideo.duration.toFixed(2)}s • ${sourceVideo.videoWidth}x${sourceVideo.videoHeight}`;
  appendLog(`Video ready: ${sourceMeta.textContent}`);
}

async function setupWebCodecs() {
  if (!window.VideoEncoder || !window.VideoDecoder || !window.VideoFrame) {
    throw new Error("This browser does not support VideoEncoder, VideoDecoder, and VideoFrame.");
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
    width: stageCanvas.width,
    height: stageCanvas.height,
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
  appendLog(`WebCodecs ready at ${stageCanvas.width}x${stageCanvas.height}`);
}

// these actions switch sources, transport state, and keyframe timing.

startButton.addEventListener("click", () => {
  loadCameraSource().catch((error) => {
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
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  loadUploadedSource(file).catch((error) => {
    console.error(error);
    setStatus("Upload failed.");
    appendLog(`ERROR: ${error.message}`);
  });
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

startMoshButton.addEventListener("click", () => {
  startMosh().catch((error) => {
    console.error(error);
    setStatus("Mosh start failed.");
    appendLog(`ERROR: ${error.message}`);
  });
});

stopMoshButton.addEventListener("click", () => {
  stopMosh();
});

resetButton.addEventListener("click", () => {
  useKeyFrame = true;
  setStatus("Next frame forced as keyframe.");
  appendLog("Keyframe reset requested.");
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

// resize rebuilds the codec chain so the relay matches the new canvas size.
window.addEventListener("resize", async () => {
  updateCanvasSize();
  clearStage();
  if (!webcamStream && !fileObjectUrl) {
    return;
  }
  if (isMoshActive || isWebCodecsReady) {
    await setupWebCodecs();
  }
  useKeyFrame = true;
  requestStageRefresh();
});

sourceVideo.addEventListener("play", () => {
  requestStageRefresh();
});

sourceVideo.addEventListener("pause", () => {
  requestStageRefresh();
});

sourceVideo.addEventListener("seeked", () => {
  requestStageRefresh();
});

sourceVideo.addEventListener("ended", () => {
  requestStageRefresh();
});

window.addEventListener("beforeunload", async () => {
  stopRecording();
  stopLoop();
  stopSource();
  await destroyCodecs();
});

// this final setup primes the idle ui before any source is loaded.
updateCanvasSize();
clearStage();
speedOutput.value = String(speed);
setTimeline("Idle");
setStatus("Use Camera or Upload Video to start.");
appendLog("Datamosh ready.");
setRecordingState(false);
setMoshButtonState();
