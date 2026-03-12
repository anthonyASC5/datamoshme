import { trackEvent } from "./analytics.js";

const PREVIEW_FPS = 30;
const SAMPLE_INTERVAL = 1 / PREVIEW_FPS;
const MAX_RENDER_WIDTH = 1280;
const MAX_BLOBS = 24;

const outputCanvas = document.getElementById("outputCanvas");
const outputCtx = outputCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
const inputCanvasA = document.getElementById("inputCanvasA");
const inputCanvasB = document.getElementById("inputCanvasB");
const maskCanvas = document.getElementById("maskCanvas");
const inputCtxA = inputCanvasA.getContext("2d", { alpha: false, willReadFrequently: true });
const inputCtxB = inputCanvasB.getContext("2d", { alpha: false, willReadFrequently: true });
const maskCtx = maskCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
const boxCanvas = document.createElement("canvas");
const boxCtx = boxCanvas.getContext("2d", { alpha: true, willReadFrequently: true });

const uploadAButton = document.getElementById("upload-a-button");
const uploadBButton = document.getElementById("upload-b-button");
const playButton = document.getElementById("play-button");
const transitionButton = document.getElementById("transition-button");
const exportButton = document.getElementById("export-button");
const videoAInput = document.getElementById("video-a-input");
const videoBInput = document.getElementById("video-b-input");
const videoA = document.getElementById("video-a");
const videoB = document.getElementById("video-b");
const videoAMeta = document.getElementById("video-a-meta");
const videoBMeta = document.getElementById("video-b-meta");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const statsText = document.getElementById("stats-text");

const durationSlider = document.getElementById("transition-duration");
const blobScaleGrowthSlider = document.getElementById("blob-scale-growth");
const boxReplicationSlider = document.getElementById("box-replication-count");
const flashStrengthSlider = document.getElementById("flash-strength");
const invertStrengthSlider = document.getElementById("invert-strength");

const durationOutput = document.getElementById("transition-duration-output");
const blobScaleGrowthOutput = document.getElementById("blob-scale-growth-output");
const boxReplicationOutput = document.getElementById("box-replication-count-output");
const flashStrengthOutput = document.getElementById("flash-strength-output");
const invertStrengthOutput = document.getElementById("invert-strength-output");

const state = {
  urls: { a: null, b: null },
  previewMode: "idle",
  rafId: 0,
  exporting: false,
  looping: false,
  transitionActive: false,
  recorder: null,
  recordChunks: [],
  phaseStartTime: 0,
  phaseDirection: 1,
  previousBaseFrame: null,
  lastFrameTime: 0,
  lastBoxCount: 0,
  processedFrames: [],
  frameMeta: [],
  lastBlobs: [],
};

function setStatus(message) {
  statusText.textContent = message;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatSeconds(value) {
  return `${Number(value).toFixed(2)}s`;
}

function updateOutputs() {
  durationOutput.value = formatSeconds(durationSlider.value);
  blobScaleGrowthOutput.value = `${Math.round(Number(blobScaleGrowthSlider.value))}%`;
  boxReplicationOutput.value = `${Math.round(Number(boxReplicationSlider.value))}`;
  flashStrengthOutput.value = `${Math.round(Number(flashStrengthSlider.value))}%`;
  invertStrengthOutput.value = `${Math.round(Number(invertStrengthSlider.value))}%`;
}

function updateStats(blobCount = state.lastBlobs.length, boxCount = 0) {
  statsText.innerHTML = `
    <span>Detected blobs: ${blobCount}</span>
    <span>Mask boxes: ${boxCount}</span>
    <span>Transition: ${state.transitionActive ? "running" : "idle"}</span>
  `;
}

function isSupportedVideoFile(file) {
  if (!file) {
    return false;
  }

  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type === "video/mp4" ||
    type === "video/webm" ||
    type === "video/quicktime" ||
    name.endsWith(".mp4") ||
    name.endsWith(".webm") ||
    name.endsWith(".mov")
  );
}

function releaseObjectUrl(key) {
  if (state.urls[key]) {
    URL.revokeObjectURL(state.urls[key]);
    state.urls[key] = null;
  }
}

function resetState() {
  state.processedFrames = [];
  state.frameMeta = [];
  state.lastBlobs = [];
  state.previousBaseFrame = null;
  state.lastBoxCount = 0;
  updateStats(0, 0);
}

function copyImageData(imageData) {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function drawVideoFit(video, targetCtx) {
  const sw = video.videoWidth || video.width;
  const sh = video.videoHeight || video.height;
  if (!sw || !sh) {
    return;
  }

  const dw = targetCtx.canvas.width;
  const dh = targetCtx.canvas.height;
  const scale = Math.max(dw / sw, dh / sh);
  const width = sw * scale;
  const height = sh * scale;
  const dx = (dw - width) * 0.5;
  const dy = (dh - height) * 0.5;

  targetCtx.fillStyle = "#000000";
  targetCtx.fillRect(0, 0, dw, dh);
  targetCtx.drawImage(video, dx, dy, width, height);
}

function resizeCanvases(width, height) {
  const scale = Math.min(MAX_RENDER_WIDTH / width, 1);
  const renderWidth = Math.max(320, Math.round(width * scale));
  const renderHeight = Math.max(180, Math.round(height * scale));
  [outputCanvas, inputCanvasA, inputCanvasB, maskCanvas, boxCanvas].forEach((canvas) => {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  });
}

function clearOutput() {
  outputCtx.fillStyle = "#000000";
  outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
}

function drawIdleCard() {
  clearOutput();
  outputCtx.save();
  outputCtx.strokeStyle = "rgba(255,242,102,0.28)";
  outputCtx.lineWidth = 2;
  outputCtx.strokeRect(18, 18, outputCanvas.width - 36, outputCanvas.height - 36);
  outputCtx.fillStyle = "#ffffff";
  outputCtx.textAlign = "center";
  outputCtx.font = '20px "Press Start 2P", monospace';
  outputCtx.fillText("BLOBTRANSITION V1", outputCanvas.width / 2, outputCanvas.height / 2 - 20);
  outputCtx.fillStyle = "#b6b191";
  outputCtx.font = '16px "Orbitron", sans-serif';
  outputCtx.fillText("Load Video A and Video B to build the tracked portal transition.", outputCanvas.width / 2, outputCanvas.height / 2 + 24);
  outputCtx.restore();
}

async function ensureVideoReady(video) {
  if (video.readyState >= 2) {
    return;
  }

  await new Promise((resolve) => {
    const onLoaded = () => resolve();
    video.addEventListener("loadeddata", onLoaded, { once: true });
  });
}

async function seekVideo(video, time) {
  await ensureVideoReady(video);
  const target = clamp(time, 0, Math.max(0, video.duration || 0));
  if (Math.abs(video.currentTime - target) < 0.01) {
    return;
  }

  await new Promise((resolve) => {
    const onSeeked = () => resolve();
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = target;
  });
}

function describeFile(file, video) {
  return `${file.name} • ${video.duration.toFixed(2)}s • ${video.videoWidth}x${video.videoHeight}`;
}

async function loadClip(file, video, key, metaNode) {
  if (!isSupportedVideoFile(file)) {
    setStatus("Use MP4, MOV, or WebM files.");
    return;
  }

  if (state.transitionActive) {
    stopTransitionLoop();
  }

  releaseObjectUrl(key);
  const url = URL.createObjectURL(file);
  state.urls[key] = url;
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.load();

  await new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video failed to load."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
  });

  metaNode.textContent = describeFile(file, video);
  const source = videoA.videoWidth && videoA.videoHeight ? videoA : videoB;
  if (source.videoWidth && source.videoHeight) {
    resizeCanvases(source.videoWidth, source.videoHeight);
  }
  resetState();
  drawIdleCard();
  setStatus(`${key === "a" ? "Video A" : "Video B"} loaded.`);
}

function validateReady() {
  if (!videoA.src || !videoB.src) {
    setStatus("Load Video A and Video B first.");
    return false;
  }

  if (!Number.isFinite(videoA.duration) || !Number.isFinite(videoB.duration)) {
    setStatus("One of the clips is still loading.");
    return false;
  }

  return true;
}

function getConfig() {
  return {
    duration: Number(durationSlider.value),
    blobScaleGrowth: Number(blobScaleGrowthSlider.value) / 100,
    boxReplication: Math.round(Number(boxReplicationSlider.value)),
    flashStrength: Number(flashStrengthSlider.value) / 100,
    invertStrength: Number(invertStrengthSlider.value) / 100,
  };
}

function readLuma(data, width, height, x, y) {
  const px = clamp(x, 0, width - 1);
  const py = clamp(y, 0, height - 1);
  const index = (py * width + px) * 4;
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

function detectBlobs(currentFrame, previousFrame, progress) {
  const { width, height, data } = currentFrame;
  const prevData = previousFrame ? previousFrame.data : null;
  const clusterSpan = Math.max(18, Math.round(22 - progress * 6));
  const step = Math.max(4, Math.round(10 - progress * 3));
  const clusters = new Map();

  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const edgeX = readLuma(data, width, height, x + 1, y) - readLuma(data, width, height, x - 1, y);
      const edgeY = readLuma(data, width, height, x, y + 1) - readLuma(data, width, height, x, y - 1);
      const edge = Math.abs(edgeX) + Math.abs(edgeY);
      const motion = prevData ? Math.abs(readLuma(data, width, height, x, y) - readLuma(prevData, width, height, x, y)) : edge * 0.8;
      const density = edge * 0.62 + motion * 1.4;
      if (density < 34) {
        continue;
      }

      const key = `${Math.floor(x / clusterSpan)}:${Math.floor(y / clusterSpan)}`;
      const cluster = clusters.get(key) || {
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
        sumX: 0,
        sumY: 0,
        weight: 0,
        energy: 0,
        count: 0,
      };
      const normalized = clamp((density - 34) / 180, 0, 1);
      cluster.minX = Math.min(cluster.minX, x);
      cluster.minY = Math.min(cluster.minY, y);
      cluster.maxX = Math.max(cluster.maxX, x);
      cluster.maxY = Math.max(cluster.maxY, y);
      cluster.sumX += x * normalized;
      cluster.sumY += y * normalized;
      cluster.weight += normalized;
      cluster.energy += density;
      cluster.count += 1;
      clusters.set(key, cluster);
    }
  }

  return Array.from(clusters.values())
    .map((cluster) => {
      const centerWeight = Math.max(cluster.weight, 0.001);
      return {
        x: cluster.sumX / centerWeight,
        y: cluster.sumY / centerWeight,
        width: Math.max(18, cluster.maxX - cluster.minX + 16),
        height: Math.max(18, cluster.maxY - cluster.minY + 16),
        energy: clamp(cluster.energy / Math.max(cluster.count, 1) / 180, 0, 1),
      };
    })
    .filter((blob) => blob.energy > 0.12)
    .sort((a, b) => b.energy - a.energy)
    .slice(0, MAX_BLOBS);
}

function generateBoxes(blobs, progress, config, width, height) {
  const growth = 1 + progress * (1.4 + config.blobScaleGrowth * 2.2);
  const replication = config.boxReplication;
  const spread = 8 + progress * 34 * (0.6 + config.blobScaleGrowth);
  const finalSurge = progress > 0.88 ? 1 + (progress - 0.88) / 0.12 * 4.5 : 1;
  const boxes = [];

  blobs.forEach((blob) => {
    const baseW = blob.width * growth * finalSurge;
    const baseH = blob.height * growth * finalSurge;
    boxes.push({
      x: blob.x - baseW * 0.5,
      y: blob.y - baseH * 0.5,
      width: baseW,
      height: baseH,
      energy: blob.energy,
    });

    if (replication <= 0) {
      return;
    }

    const ring = Math.ceil(Math.sqrt(replication));
    let created = 0;
    for (let gy = -ring; gy <= ring; gy += 1) {
      for (let gx = -ring; gx <= ring; gx += 1) {
        if (gx === 0 && gy === 0) {
          continue;
        }
        if (created >= replication) {
          break;
        }
        const jitter = (created % 3) * 2.4;
        const scale = 0.36 + progress * 0.42;
        const x = blob.x + gx * spread + gy * jitter;
        const y = blob.y + gy * spread - gx * jitter;
        const boxW = baseW * scale;
        const boxH = baseH * scale;
        boxes.push({
          x: x - boxW * 0.5,
          y: y - boxH * 0.5,
          width: boxW,
          height: boxH,
          energy: blob.energy * 0.8,
        });
        created += 1;
      }
    }
  });

  return boxes.map((box) => ({
    ...box,
    x: clamp(box.x, -box.width * 0.5, width - box.width * 0.2),
    y: clamp(box.y, -box.height * 0.5, height - box.height * 0.2),
  }));
}

function renderMask(boxes) {
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  maskCtx.fillStyle = "#ffffff";
  boxes.forEach((box) => {
    maskCtx.fillRect(box.x, box.y, box.width, box.height);
  });
}

function drawInvertedBackground(frameA, frameB, progress, config) {
  const { width, height, data } = frameA;
  const bgReveal = progress < 0.64 ? 0 : clamp((progress - 0.64) / 0.28, 0, 1);
  const flash = progress > 0.92 ? clamp((progress - 0.92) / 0.08, 0, 1) * config.flashStrength : 0;
  const output = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = (r * 0.299 + g * 0.587 + b * 0.114);
    const darken = 0.2 + (1 - config.invertStrength) * 0.45;
    const inverted = {
      r: (255 - r) * config.invertStrength + r * (1 - config.invertStrength),
      g: (255 - g) * config.invertStrength + g * (1 - config.invertStrength),
      b: (255 - b) * config.invertStrength + b * (1 - config.invertStrength),
    };

    let bgR = inverted.r * darken + luma * 0.06;
    let bgG = inverted.g * darken + luma * 0.06;
    let bgB = inverted.b * darken + luma * 0.06;

    if (bgReveal > 0) {
      bgR = bgR * (1 - bgReveal) + frameB.data[i] * bgReveal;
      bgG = bgG * (1 - bgReveal) + frameB.data[i + 1] * bgReveal;
      bgB = bgB * (1 - bgReveal) + frameB.data[i + 2] * bgReveal;
    }

    output[i] = clamp(bgR + flash * 255, 0, 255);
    output[i + 1] = clamp(bgG + flash * 255, 0, 255);
    output[i + 2] = clamp(bgB + flash * 255, 0, 255);
    output[i + 3] = 255;
  }

  return new ImageData(output, width, height);
}

function compositeFrame(frameA, frameB, boxes, progress, config) {
  renderMask(boxes);
  const background = drawInvertedBackground(frameA, frameB, progress, config);
  outputCtx.putImageData(background, 0, 0);

  boxCtx.clearRect(0, 0, boxCanvas.width, boxCanvas.height);
  boxCtx.drawImage(inputCanvasB, 0, 0);
  boxCtx.globalCompositeOperation = "destination-in";
  boxCtx.drawImage(maskCanvas, 0, 0);
  boxCtx.globalCompositeOperation = "source-over";
  outputCtx.drawImage(boxCanvas, 0, 0);

  outputCtx.save();
  outputCtx.strokeStyle = `rgba(255,255,255,${0.22 + (1 - progress) * 0.24})`;
  outputCtx.lineWidth = 1;
  boxes.slice(0, Math.min(boxes.length, 48)).forEach((box) => {
    outputCtx.strokeRect(box.x, box.y, box.width, box.height);
  });
  outputCtx.restore();
}

function captureFrame(video, targetCtx) {
  drawVideoFit(video, targetCtx);
  return targetCtx.getImageData(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
}

function renderImage(imageData) {
  if (imageData) {
    outputCtx.putImageData(imageData, 0, 0);
  }
}

function stopPreview() {
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.previewMode = "idle";
  if (!state.transitionActive) {
    videoA.pause();
    videoB.pause();
  }
  playButton.textContent = "Play / Pause";
}

async function playSource(video, label) {
  stopPreview();
  state.previewMode = "source";
  playButton.textContent = "Pause";
  video.currentTime = 0;

  try {
    await video.play();
  } catch {
    setStatus("Playback was blocked by the browser.");
    stopPreview();
    return;
  }

  const tick = () => {
    if (state.previewMode !== "source") {
      return;
    }
    if (video.paused || video.ended) {
      stopPreview();
      return;
    }
    drawVideoFit(video, outputCtx);
    timelineLabel.textContent = `${label} ${video.currentTime.toFixed(2)}s / ${video.duration.toFixed(2)}s`;
    state.rafId = requestAnimationFrame(tick);
  };

  state.rafId = requestAnimationFrame(tick);
}

function playProcessedPreview() {
  if (!state.processedFrames.length || state.transitionActive) {
    return;
  }

  stopPreview();
  state.previewMode = "processed";
  playButton.textContent = "Pause";
  const startTime = performance.now();

  const tick = (now) => {
    if (state.previewMode !== "processed") {
      return;
    }

    const index = Math.min(state.processedFrames.length - 1, Math.floor((now - startTime) / (1000 / PREVIEW_FPS)));
    renderImage(state.processedFrames[index]);
    const meta = state.frameMeta[index];
    timelineLabel.textContent = `${meta.progressLabel} • blobs ${meta.blobs}`;

    if (index >= state.processedFrames.length - 1) {
      stopPreview();
      renderImage(state.processedFrames[state.processedFrames.length - 1]);
      return;
    }

    state.rafId = requestAnimationFrame(tick);
  };

  state.rafId = requestAnimationFrame(tick);
}

function updateTransportLabels() {
  transitionButton.textContent = state.transitionActive ? "Stop BlobTransition" : "Start BlobTransition";
  exportButton.textContent = state.exporting ? "Stop Recording" : "Record WebM";
}

function getPhaseVideos() {
  return state.phaseDirection === 1
    ? { baseVideo: videoA, revealVideo: videoB, baseLabel: "A", revealLabel: "B" }
    : { baseVideo: videoB, revealVideo: videoA, baseLabel: "B", revealLabel: "A" };
}

async function startPhase(now = performance.now()) {
  state.phaseStartTime = now;
  state.previousBaseFrame = null;
  const { baseVideo, revealVideo } = getPhaseVideos();
  await Promise.all([seekVideo(baseVideo, 0), seekVideo(revealVideo, 0)]);

  try {
    await Promise.all([baseVideo.play(), revealVideo.play()]);
  } catch {
    setStatus("Playback was blocked by the browser.");
    stopTransitionLoop();
  }
}

function finishRecording() {
  if (!state.recordChunks.length) {
    state.exporting = false;
    state.recorder = null;
    updateTransportLabels();
    setStatus("Recording stopped.");
    return;
  }

  const blob = new Blob(state.recordChunks, { type: "video/webm" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `blob-transition-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.webm`;
  anchor.click();
  URL.revokeObjectURL(url);
  state.recordChunks = [];
  state.exporting = false;
  state.recorder = null;
  updateTransportLabels();
  setStatus("Recording complete.");
}

function startRecording() {
  if (state.exporting) {
    return;
  }
  if (!state.transitionActive) {
    setStatus("Start BlobTransition first.");
    return;
  }

  const stream = outputCanvas.captureStream(PREVIEW_FPS);
  const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
  state.recordChunks = [];
  state.exporting = true;
  state.recorder = recorder;
  updateTransportLabels();
  setStatus("Recording BlobTransition WebM.");

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size) {
      state.recordChunks.push(event.data);
    }
  });

  recorder.addEventListener(
    "stop",
    () => {
      stream.getTracks().forEach((track) => track.stop());
      finishRecording();
    },
    { once: true },
  );

  recorder.start();
}

function stopRecording() {
  if (!state.exporting || !state.recorder) {
    return;
  }
  const recorder = state.recorder;
  state.recorder = null;
  if (recorder.state !== "inactive") {
    recorder.stop();
  }
}

async function renderTransitionFrame(now) {
  if (!state.transitionActive) {
    return;
  }

  const config = getConfig();
  const durationMs = Math.max(120, config.duration * 1000);
  const elapsed = now - state.phaseStartTime;
  const progress = clamp(elapsed / durationMs, 0, 1);
  const { baseVideo, revealVideo, baseLabel, revealLabel } = getPhaseVideos();

  if (baseVideo.ended || baseVideo.currentTime >= Math.max(0, Math.min(baseVideo.duration || config.duration, config.duration) - 0.03)) {
    baseVideo.pause();
    baseVideo.currentTime = 0;
    baseVideo.play().catch(() => {});
  }
  if (revealVideo.ended || revealVideo.currentTime >= Math.max(0, Math.min(revealVideo.duration || config.duration, config.duration) - 0.03)) {
    revealVideo.pause();
    revealVideo.currentTime = 0;
    revealVideo.play().catch(() => {});
  }

  const frameA = captureFrame(baseVideo, inputCtxA);
  const frameB = captureFrame(revealVideo, inputCtxB);
  const blobs = detectBlobs(frameA, state.previousBaseFrame, progress);
  state.lastBlobs = blobs;
  const boxes = generateBoxes(blobs, progress, config, outputCanvas.width, outputCanvas.height);
  state.lastBoxCount = boxes.length;
  compositeFrame(frameA, frameB, boxes, progress, config);
  state.previousBaseFrame = copyImageData(frameA);
  state.lastFrameTime = now;

  timelineLabel.textContent = `${baseLabel} -> ${revealLabel} • ${Math.round(progress * 100)}% • ${boxes.length} boxes`;
  setStatus(`BlobTransition looping. ${blobs.length} blobs tracked.`);
  updateStats(blobs.length, boxes.length);

  if (progress >= 1) {
    state.phaseDirection *= -1;
    await startPhase(now);
    return;
  }

  state.rafId = requestAnimationFrame((time) => {
    renderTransitionFrame(time).catch(() => {
      setStatus("Blob Transition failed.");
      stopTransitionLoop();
    });
  });
}

async function startTransitionLoop() {
  if (!validateReady()) {
    return;
  }

  stopPreview();
  resetState();
  state.transitionActive = true;
  state.phaseDirection = 1;
  updateTransportLabels();
  await startPhase();
  state.previewMode = "loop";
  trackEvent("blobtransition_v1_start", {
    direction: "A_to_B",
  });
  state.rafId = requestAnimationFrame((now) => {
    renderTransitionFrame(now).catch(() => {
      setStatus("Blob Transition failed.");
      stopTransitionLoop();
    });
  });
}

function stopTransitionLoop() {
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.transitionActive = false;
  state.previewMode = "idle";
  videoA.pause();
  videoB.pause();
  if (state.exporting) {
    stopRecording();
  }
  updateTransportLabels();
  playButton.textContent = "Play / Pause";
  timelineLabel.textContent = state.lastBoxCount ? `Loop stopped • ${state.lastBoxCount} boxes` : "Load two clips to begin";
  updateStats(state.lastBlobs.length, state.lastBoxCount);
}

function pickMimeType() {
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    return "video/webm;codecs=vp9";
  }
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
    return "video/webm;codecs=vp8";
  }
  return "video/webm";
}

function toggleRecording() {
  if (state.exporting) {
    stopRecording();
    return;
  }

  startRecording();
}

uploadAButton.addEventListener("click", () => {
  videoAInput.click();
});

uploadBButton.addEventListener("click", () => {
  videoBInput.click();
});

videoAInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    await loadClip(file, videoA, "a", videoAMeta);
  } catch {
    setStatus("Video A failed to load.");
  }
});

videoBInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    await loadClip(file, videoB, "b", videoBMeta);
  } catch {
    setStatus("Video B failed to load.");
  }
});

playButton.addEventListener("click", () => {
  if (state.transitionActive) {
    stopTransitionLoop();
    return;
  }

  if (state.previewMode === "source" || state.previewMode === "processed") {
    stopPreview();
    drawIdleCard();
    return;
  }

  if (videoA.src) {
    playSource(videoA, "Video A");
  } else {
    setStatus("Load Video A first.");
  }
});

transitionButton.addEventListener("click", () => {
  if (state.transitionActive) {
    stopTransitionLoop();
    return;
  }
  startTransitionLoop().catch(() => {
    setStatus("Blob Transition failed.");
    stopTransitionLoop();
  });
});

exportButton.addEventListener("click", toggleRecording);

[
  durationSlider,
  blobScaleGrowthSlider,
  boxReplicationSlider,
  flashStrengthSlider,
  invertStrengthSlider,
].forEach((slider) => {
  slider.addEventListener("input", updateOutputs);
});

window.addEventListener("beforeunload", () => {
  releaseObjectUrl("a");
  releaseObjectUrl("b");
});

updateOutputs();
updateStats(0, 0);
updateTransportLabels();
drawIdleCard();
