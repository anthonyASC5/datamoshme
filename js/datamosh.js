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
const fileInput = document.getElementById("file-input");
const speedSlider = document.getElementById("speed-slider");
const speedOutput = document.getElementById("speed-output");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const sourceMeta = document.getElementById("source-meta");
const logOutput = document.getElementById("log-output");

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
let recorder = null;
let recordedChunks = [];
let recordingStream = null;

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
}

function clearStage() {
  stageCtx.fillStyle = "#000000";
  stageCtx.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
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
}

function sourceLabel() {
  return activeSourceMode === "file" ? "Video" : "Camera";
}

function setSourceButtonState(mode) {
  startButton.classList.toggle("active", mode === "camera");
  importButton.classList.toggle("active", mode === "file");
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

function drawLoop() {
  if (isWebCodecsReady && sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    try {
      const frame = new VideoFrame(sourceVideo);
      encoder.encode(frame, { keyFrame: useKeyFrame });
      useKeyFrame = false;
      frame.close();
      setTimeline(`Live • x${speed}`);
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
  await startUploadedVideo(file);
  await setupWebCodecs();
  setStatus("Datamosh running.");
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
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  startDatamoshUpload(file).catch((error) => {
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
setStatus("Use Camera or Upload Video to start.");
appendLog("Datamosh ready.");
setRecordingState(false);
