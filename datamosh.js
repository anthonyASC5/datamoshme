const canvas = document.getElementById("mosh-canvas");
const ctx = canvas.getContext("2d", { alpha: false });

const previewButton = document.getElementById("preview-button");
const stopButton = document.getElementById("stop-button");
const exportButton = document.getElementById("export-button");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");

const videoAInput = document.getElementById("video-a-input");
const videoBInput = document.getElementById("video-b-input");
const videoA = document.getElementById("video-a");
const videoB = document.getElementById("video-b");
const videoAMeta = document.getElementById("video-a-meta");
const videoBMeta = document.getElementById("video-b-meta");
const videoALight = document.getElementById("video-a-light");
const videoBLight = document.getElementById("video-b-light");

const clipAEndSlider = document.getElementById("clip-a-end");
const clipBStartSlider = document.getElementById("clip-b-start");
const transitionDurationSlider = document.getElementById("transition-duration");
const moshAmountSlider = document.getElementById("mosh-amount");
const blockSizeSlider = document.getElementById("block-size");
const frameHoldSlider = document.getElementById("frame-hold");
const refreshFailureSlider = document.getElementById("refresh-failure");
const motionSmearSlider = document.getElementById("motion-smear");

const clipAEndOutput = document.getElementById("clip-a-end-output");
const clipBStartOutput = document.getElementById("clip-b-start-output");
const transitionDurationOutput = document.getElementById("transition-duration-output");
const moshAmountOutput = document.getElementById("mosh-amount-output");
const blockSizeOutput = document.getElementById("block-size-output");
const frameHoldOutput = document.getElementById("frame-hold-output");
const refreshFailureOutput = document.getElementById("refresh-failure-output");
const motionSmearOutput = document.getElementById("motion-smear-output");

const freezeCanvas = document.createElement("canvas");
const freezeCtx = freezeCanvas.getContext("2d", { alpha: false });
const prevBCanvas = document.createElement("canvas");
const prevBCtx = prevBCanvas.getContext("2d", { alpha: false });
const currBCanvas = document.createElement("canvas");
const currBCtx = currBCanvas.getContext("2d", { alpha: false });
const MOTION_LIMIT = 6;
const INTRO_HOLD_FRAMES = 3;
const INTRO_FPS = 24;
const EARLY_REVEAL_PHASE = 0.38;
const MOSH_PLAYBACK_RATE = 0.45;
const FREEZE_PULL = 0.18;

const state = {
  urls: { a: null, b: null },
  animationId: 0,
  previewRunning: false,
  exporting: false,
  recorder: null,
  stream: null,
  chunks: [],
  mode: "idle",
  transitionStartMs: 0,
  freezeImageData: null,
  moshImageData: null,
  prevBImageData: null,
  seedBImageData: null,
  transitionPrevBImageData: null,
  transitionBImageData: null,
  moshCells: [],
  moshCols: 0,
  moshRows: 0,
  lastMoshStepAt: 0,
  holdStepCount: 0,
  moshFrameIndex: 0,
  introHoldRemainingMs: 0,
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

function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function updateOutputs() {
  clipAEndOutput.value = formatSeconds(clipAEndSlider.value);
  clipBStartOutput.value = formatSeconds(clipBStartSlider.value);
  transitionDurationOutput.value = formatSeconds(transitionDurationSlider.value);
  moshAmountOutput.value = Number(moshAmountSlider.value).toFixed(2);
  blockSizeOutput.value = `${Math.round(blockSizeSlider.value)}px`;
  frameHoldOutput.value = `${Math.round(frameHoldSlider.value)}f`;
  refreshFailureOutput.value = formatPercent(refreshFailureSlider.value);
  motionSmearOutput.value = Number(motionSmearSlider.value).toFixed(2);
}

function setLightState(lightNode, ready) {
  lightNode.classList.toggle("ready", ready);
}

function updateCanvasSize() {
  const sourceA = videoA.videoWidth && videoA.videoHeight ? { width: videoA.videoWidth, height: videoA.videoHeight } : null;
  const sourceB = videoB.videoWidth && videoB.videoHeight ? { width: videoB.videoWidth, height: videoB.videoHeight } : null;
  const source = sourceA || sourceB || { width: 1280, height: 720 };
  const maxWidth = 1280;
  const maxHeight = 720;
  const scale = Math.min(maxWidth / source.width, maxHeight / source.height, 1);
  const width = Math.max(320, Math.round(source.width * scale));
  const height = Math.max(180, Math.round(source.height * scale));

  canvas.width = width;
  canvas.height = height;
  freezeCanvas.width = width;
  freezeCanvas.height = height;
  prevBCanvas.width = width;
  prevBCanvas.height = height;
  currBCanvas.width = width;
  currBCanvas.height = height;
}

function clearMainCanvas() {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawFrameFit(source, targetCtx) {
  const sw = source.videoWidth || source.width;
  const sh = source.videoHeight || source.height;
  if (!sw || !sh) {
    return;
  }

  const targetWidth = targetCtx.canvas.width;
  const targetHeight = targetCtx.canvas.height;
  const scale = Math.max(targetWidth / sw, targetHeight / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (targetWidth - dw) / 2;
  const dy = (targetHeight - dh) / 2;

  targetCtx.fillStyle = "#000000";
  targetCtx.fillRect(0, 0, targetWidth, targetHeight);
  targetCtx.drawImage(source, dx, dy, dw, dh);
}

function drawIdleCard() {
  clearMainCanvas();
  ctx.save();
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(148,255,102,0.22)";
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = '20px "Press Start 2P", monospace';
  ctx.fillText("DATAMOSH", canvas.width / 2, canvas.height / 2 - 18);
  ctx.fillStyle = "#98b09d";
  ctx.font = '16px "Orbitron", sans-serif';
  ctx.fillText("Load clip A and clip B to build a block-corrupted cut.", canvas.width / 2, canvas.height / 2 + 24);
  ctx.restore();
}

function describeFile(file, video) {
  const duration = Number.isFinite(video.duration) ? `${video.duration.toFixed(2)}s` : "unknown";
  return `${file.name} • ${duration} • ${video.videoWidth || "?"}x${video.videoHeight || "?"}`;
}

async function ensureVideoReady(video) {
  if (video.readyState >= 2) {
    return;
  }

  await new Promise((resolve) => {
    const onLoaded = () => {
      video.removeEventListener("loadeddata", onLoaded);
      resolve();
    };
    video.addEventListener("loadeddata", onLoaded);
  });
}

async function seekVideo(video, time) {
  await ensureVideoReady(video);
  const target = clamp(time, 0, Math.max(0, video.duration || 0));
  if (Math.abs(video.currentTime - target) < 0.04) {
    return;
  }

  await new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = target;
  });
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

async function loadVideoFile(file, targetVideo, key, metaNode, rangeSlider, defaultValueMode) {
  if (!isSupportedVideoFile(file)) {
    setStatus("Use an MP4, MOV, or WebM file.");
    return;
  }

  if (state.urls[key]) {
    URL.revokeObjectURL(state.urls[key]);
  }

  const url = URL.createObjectURL(file);
  state.urls[key] = url;
  targetVideo.src = url;
  targetVideo.muted = true;
  targetVideo.playsInline = true;
  targetVideo.preload = "auto";
  targetVideo.load();

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
      targetVideo.removeEventListener("loadedmetadata", onLoaded);
      targetVideo.removeEventListener("error", onError);
    };

    targetVideo.addEventListener("loadedmetadata", onLoaded);
    targetVideo.addEventListener("error", onError);
  });

  metaNode.textContent = describeFile(file, targetVideo);
  rangeSlider.max = Math.max(0.01, Number(targetVideo.duration.toFixed(2)));

  if (defaultValueMode === "end") {
    rangeSlider.value = Math.min(targetVideo.duration, Math.max(0.08, targetVideo.duration * 0.82)).toFixed(2);
  } else {
    rangeSlider.value = Math.min(targetVideo.duration, Math.max(0, targetVideo.duration * 0.08)).toFixed(2);
  }

  updateCanvasSize();
  resetMoshState();
  updateOutputs();
  drawIdleCard();
  setLightState(key === "a" ? videoALight : videoBLight, true);
  setStatus(`${key === "a" ? "Clip A" : "Clip B"} loaded.`);
}

function validateReady() {
  if (!videoA.src || !videoB.src) {
    setStatus("Load both videos first.");
    return false;
  }

  if (!Number.isFinite(videoA.duration) || !Number.isFinite(videoB.duration)) {
    setStatus("One of the videos is still loading.");
    return false;
  }

  return true;
}

function resetMoshState() {
  state.freezeImageData = null;
  state.moshImageData = null;
  state.prevBImageData = null;
  state.seedBImageData = null;
  state.transitionPrevBImageData = null;
  state.transitionBImageData = null;
  state.moshCells = [];
  state.moshCols = 0;
  state.moshRows = 0;
  state.lastMoshStepAt = 0;
  state.holdStepCount = 0;
  state.moshFrameIndex = 0;
  state.introHoldRemainingMs = 0;
}

function cleanupRecorder() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  state.recorder = null;
  state.exporting = false;
  exportButton.disabled = false;
}

function stopPlayback(options = {}) {
  cancelAnimationFrame(state.animationId);
  state.animationId = 0;
  state.previewRunning = false;
  state.mode = "idle";
  videoA.pause();
  videoB.pause();
  resetMoshState();

  if (state.exporting && !options.keepRecorder && state.recorder && state.recorder.state !== "inactive") {
    state.recorder.stop();
  }

  if (!options.keepFrame) {
    drawIdleCard();
    timelineLabel.textContent = "Load two clips to begin";
  }
}

function captureFreezeFrame() {
  drawFrameFit(videoA, freezeCtx);
  state.freezeImageData = freezeCtx.getImageData(0, 0, freezeCanvas.width, freezeCanvas.height);
  state.moshImageData = new ImageData(
    new Uint8ClampedArray(state.freezeImageData.data),
    state.freezeImageData.width,
    state.freezeImageData.height,
  );
}

function snapshotVideo(video, targetCtx) {
  drawFrameFit(video, targetCtx);
  return targetCtx.getImageData(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
}

async function seedTransitionFrames(config) {
  const frameStep = 1 / 24;
  const prevTime = Math.max(0, config.clipBStart - frameStep);
  await seekVideo(videoB, prevTime);
  state.prevBImageData = snapshotVideo(videoB, prevBCtx);
  await seekVideo(videoB, config.clipBStart);
  state.seedBImageData = snapshotVideo(videoB, currBCtx);
  state.transitionPrevBImageData = new ImageData(
    new Uint8ClampedArray(state.prevBImageData.data),
    state.prevBImageData.width,
    state.prevBImageData.height,
  );
  state.transitionBImageData = new ImageData(
    new Uint8ClampedArray(state.seedBImageData.data),
    state.seedBImageData.width,
    state.seedBImageData.height,
  );
}

function drawImageData(imageData) {
  if (!imageData) {
    return;
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawVideoFrame(video) {
  clearMainCanvas();
  drawFrameFit(video, ctx);
}

function getConfig() {
  const clipAEnd = clamp(Number(clipAEndSlider.value), 0.05, videoA.duration || 0.05);
  const clipBStart = clamp(Number(clipBStartSlider.value), 0, Math.max(0, (videoB.duration || 0) - 0.05));
  const transitionDuration = Number(transitionDurationSlider.value);
  const blockSize = Math.round(Number(blockSizeSlider.value));
  return {
    clipAEnd,
    clipBStart,
    transitionDuration,
    moshAmount: Number(moshAmountSlider.value),
    blockSize,
    frameHoldFrames: Math.round(Number(frameHoldSlider.value)),
    refreshFailure: Number(refreshFailureSlider.value),
    motionSmear: Number(motionSmearSlider.value),
  };
}

function updateTimeline(text) {
  timelineLabel.textContent = text;
}

function initMoshCells(config) {
  const cols = Math.ceil(canvas.width / config.blockSize);
  const rows = Math.ceil(canvas.height / config.blockSize);
  if (state.moshCells.length && state.moshCols === cols && state.moshRows === rows) {
    return;
  }

  state.moshCols = cols;
  state.moshRows = rows;
  state.moshCells = Array.from({ length: cols * rows }, () => ({
    hold: config.frameHoldFrames,
    dx: 0,
    dy: 0,
    energy: 0,
    refreshGate: Math.random(),
    revealThreshold: Math.random(),
  }));
}

function lumaAt(data, width, x, y) {
  const clampedX = clamp(Math.round(x), 0, width - 1);
  const clampedY = clamp(Math.round(y), 0, data.height - 1);
  const index = (clampedY * width + clampedX) * 4;
  return data.data[index] * 0.299 + data.data[index + 1] * 0.587 + data.data[index + 2] * 0.114;
}

function estimateBlockMotion(prevFrame, currFrame, blockX, blockY, blockSize, smear) {
  const width = currFrame.width;
  const height = currFrame.height;
  const span = Math.max(1, Math.round(blockSize * (0.14 + smear * 0.45)));
  const candidates = [
    [0, 0],
    [span, 0],
    [-span, 0],
    [0, span],
    [0, -span],
    [span, span],
    [-span, span],
    [span, -span],
    [-span, -span],
  ];
  const samplePoints = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
    [0.5, 0.5],
  ];

  let bestScore = Infinity;
  let best = [0, 0];

  for (const [dx, dy] of candidates) {
    let score = 0;
    for (const [sx, sy] of samplePoints) {
      const px = clamp(blockX + Math.round(blockSize * sx), 0, width - 1);
      const py = clamp(blockY + Math.round(blockSize * sy), 0, height - 1);
      score += Math.abs(
        lumaAt(currFrame, width, px, py) - lumaAt(prevFrame, width, px - dx, py - dy),
      );
    }
    if (score < bestScore) {
      bestScore = score;
      best = [dx, dy];
    }
  }

  return { dx: best[0], dy: best[1], energy: clamp(bestScore / 255, 0, 1.6) };
}

function readPixel(buffer, width, height, x, y) {
  const px = clamp(Math.round(x), 0, width - 1);
  const py = clamp(Math.round(y), 0, height - 1);
  const index = (py * width + px) * 4;
  return {
    r: buffer[index],
    g: buffer[index + 1],
    b: buffer[index + 2],
    a: buffer[index + 3],
  };
}

function writeBlock(target, width, height, blockX, blockY, blockSize, writePixel) {
  const maxX = Math.min(width, blockX + blockSize);
  const maxY = Math.min(height, blockY + blockSize);
  for (let y = blockY; y < maxY; y += 1) {
    for (let x = blockX; x < maxX; x += 1) {
      const index = (y * width + x) * 4;
      const pixel = writePixel(x, y);
      target[index] = pixel.r;
      target[index + 1] = pixel.g;
      target[index + 2] = pixel.b;
      target[index + 3] = 255;
    }
  }
}

function sampleMotionPixel(buffer, width, height, x, y, dx, dy) {
  const sample = readPixel(buffer, width, height, x - dx, y - dy);
  return {
    r: sample.r,
    g: sample.g,
    b: sample.b,
  };
}

function blendPixels(primary, secondary, mix) {
  const ratio = clamp(mix, 0, 1);
  return {
    r: primary.r * (1 - ratio) + secondary.r * ratio,
    g: primary.g * (1 - ratio) + secondary.g * ratio,
    b: primary.b * (1 - ratio) + secondary.b * ratio,
  };
}

function renderMoshStep(config, progress) {
  if (!state.freezeImageData) {
    captureFreezeFrame();
  }

  initMoshCells(config);

  const useHeldBFrame = progress < EARLY_REVEAL_PHASE && state.transitionBImageData && state.transitionPrevBImageData;
  const currBImage = useHeldBFrame
    ? state.transitionBImageData
    : state.seedBImageData || snapshotVideo(videoB, currBCtx);
  const prevBImage = useHeldBFrame
    ? state.transitionPrevBImageData
    : state.prevBImageData || snapshotVideo(videoB, prevBCtx);
  const prevOutput = state.moshImageData
    ? new Uint8ClampedArray(state.moshImageData.data)
    : new Uint8ClampedArray(state.freezeImageData.data);
  const nextOutput = new Uint8ClampedArray(prevOutput);

  const width = currBImage.width;
  const height = currBImage.height;
  const amount = config.moshAmount;

  for (let row = 0; row < state.moshRows; row += 1) {
    for (let col = 0; col < state.moshCols; col += 1) {
      const cellIndex = row * state.moshCols + col;
      const cell = state.moshCells[cellIndex];
      const blockX = col * config.blockSize;
      const blockY = row * config.blockSize;
      const rawMotion = estimateBlockMotion(prevBImage, currBImage, blockX, blockY, config.blockSize, config.motionSmear);
      const smoothedDx = clamp(cell.dx + (rawMotion.dx - cell.dx) * 0.3, -MOTION_LIMIT, MOTION_LIMIT);
      const smoothedDy = clamp(cell.dy + (rawMotion.dy - cell.dy) * 0.3, -MOTION_LIMIT, MOTION_LIMIT);
      const dragBias = progress < EARLY_REVEAL_PHASE ? 1.12 : 1;
      const dragScale = (0.45 + config.motionSmear * 0.5 + amount * 0.45) * dragBias;
      const dragDx = clamp(Math.round(smoothedDx * dragScale), -MOTION_LIMIT, MOTION_LIMIT);
      const dragDy = clamp(Math.round(smoothedDy * dragScale), -MOTION_LIMIT, MOTION_LIMIT);
      const motionMagnitude = Math.hypot(smoothedDx, smoothedDy);
      const motionEnergy = clamp(motionMagnitude / MOTION_LIMIT, 0, 1);
      const baseRefreshRate = 1 - config.refreshFailure;
      const dissolveLift = amount * 0.22 + config.motionSmear * 0.14;
      const revealPhase =
        progress < 0.4
          ? baseRefreshRate * 0.4
          : progress < 0.7
            ? baseRefreshRate * 0.4 + ((progress - 0.4) / 0.3) * (baseRefreshRate * 1.5)
            : baseRefreshRate * 1.9 + ((progress - 0.7) / 0.3) * (0.26 + baseRefreshRate * 1.8);
      const refreshBudget = clamp(
        revealPhase + dissolveLift + motionEnergy * (progress < 0.4 ? 0.08 : 0.22 + progress * 0.22),
        0,
        0.96,
      );
      const maskPass = cell.refreshGate < refreshBudget;
      const revealPass = cell.revealThreshold < clamp(progress * 1.18 + motionEnergy * 0.35, 0, 1);
      const lifetime = Math.max(1, Math.round(config.frameHoldFrames * Math.max(0.15, 1 - motionEnergy)));
      const shouldRefresh = cell.hold <= 0 && maskPass && revealPass;
      writeBlock(nextOutput, width, height, blockX, blockY, config.blockSize, (x, y) => {
        const warped = sampleMotionPixel(prevOutput, width, height, x, y, dragDx, dragDy);
        const freezeGhost = readPixel(state.freezeImageData.data, width, height, x - dragDx * FREEZE_PULL, y - dragDy * FREEZE_PULL);
        const edgeGhost = readPixel(currBImage.data, width, height, x + dragDx * 0.18, y + dragDy * 0.18);
        return blendPixels(
          blendPixels(warped, freezeGhost, 0.18 + (1 - progress) * 0.12),
          edgeGhost,
          0.08 + motionEnergy * 0.12,
        );
      });

      if (shouldRefresh) {
        writeBlock(nextOutput, width, height, blockX, blockY, config.blockSize, (x, y) => {
          const refreshed = readPixel(currBImage.data, width, height, x, y);
          const warped = sampleMotionPixel(prevOutput, width, height, x, y, dragDx, dragDy);
          const freezeGhost = readPixel(state.freezeImageData.data, width, height, x, y);
          const refreshMix = clamp(0.45 + progress * 0.32 + amount * 0.16, 0.32, 0.88);
          return blendPixels(
            blendPixels(warped, freezeGhost, 0.2 + (1 - progress) * 0.14),
            refreshed,
            refreshMix,
          );
        });
        cell.hold = lifetime;
      } else {
        cell.hold = Math.max(0, cell.hold - 1);
      }

      cell.dx = smoothedDx;
      cell.dy = smoothedDy;
      cell.energy = motionEnergy;
    }
  }

  if (!useHeldBFrame) {
    state.prevBImageData = currBImage;
  }
  state.seedBImageData = null;
  state.moshImageData = new ImageData(nextOutput, width, height);
  state.moshFrameIndex += 1;
}

function maybeRenderMoshFrame(now, config, progress) {
  const stepMs = 1000 / 12;
  if (state.lastMoshStepAt && now - state.lastMoshStepAt < stepMs) {
    drawImageData(state.moshImageData || state.freezeImageData);
    return;
  }

  state.lastMoshStepAt = now;
  renderMoshStep(config, progress);
  drawImageData(state.moshImageData);
}

function beginTransition(now) {
  state.mode = "hold";
  state.transitionStartMs = now;
  state.introHoldRemainingMs = (INTRO_HOLD_FRAMES / INTRO_FPS) * 1000;
  captureFreezeFrame();
  videoA.pause();
  videoB.pause();
  videoB.currentTime = clamp(Number(clipBStartSlider.value), 0, videoB.duration || 0);
  videoB.playbackRate = MOSH_PLAYBACK_RATE;
  videoB.play().catch(() => {});
}

function finishPreview() {
  setStatus("Preview complete.");
  if (state.exporting && state.recorder && state.recorder.state !== "inactive") {
    state.recorder.stop();
  } else {
    stopPlayback({ keepFrame: true });
  }
}

async function startPreview() {
  if (!validateReady()) {
    return;
  }

  stopPlayback({ keepFrame: true, keepRecorder: true });
  updateCanvasSize();

  const config = getConfig();
  state.previewRunning = true;
  state.mode = "clipA";
  resetMoshState();

  await Promise.all([seekVideo(videoA, 0), seekVideo(videoB, config.clipBStart)]);
  await seedTransitionFrames(config);

  videoA.muted = true;
  videoB.muted = true;
  videoA.playbackRate = 1;
  videoB.playbackRate = 1;

  try {
    await videoA.play();
  } catch {
    state.previewRunning = false;
    state.mode = "idle";
    setStatus("Playback is blocked. Press play on a clip once, then preview again.");
    return;
  }
  setStatus(state.exporting ? "Exporting transition..." : "Preview running.");
  updateTimeline("Clip A • 0.00s");

  const loop = (now) => {
    if (!state.previewRunning) {
      return;
    }

    const bEndPoint = Math.min(videoB.duration, config.clipBStart + config.transitionDuration + 2.5);

    if (state.mode === "clipA") {
      drawVideoFrame(videoA);
      updateTimeline(`Clip A • ${videoA.currentTime.toFixed(2)}s`);
      if (videoA.currentTime >= config.clipAEnd || videoA.ended) {
        beginTransition(now);
      }
      state.animationId = requestAnimationFrame(loop);
      return;
    }

    if (state.mode === "hold") {
      drawImageData(state.freezeImageData);
      updateTimeline("Frame Hold • A");
      if (now - state.transitionStartMs >= state.introHoldRemainingMs) {
        state.mode = "mosh";
        state.transitionStartMs = now;
      }
      state.animationId = requestAnimationFrame(loop);
      return;
    }

    if (state.mode === "mosh") {
      const moshElapsed = (now - state.transitionStartMs) / 1000;
      const progress = clamp(moshElapsed / config.transitionDuration, 0, 1);
      maybeRenderMoshFrame(now, config, progress);
      updateTimeline(`Datamosh • ${Math.round(progress * 100)}%`);
      if (moshElapsed >= config.transitionDuration) {
        videoB.playbackRate = 1;
        state.mode = "clipB";
      }
      state.animationId = requestAnimationFrame(loop);
      return;
    }

    if (state.mode === "clipB") {
      drawVideoFrame(videoB);
      updateTimeline(`Clip B • ${videoB.currentTime.toFixed(2)}s`);
      if (videoB.currentTime >= bEndPoint || videoB.ended) {
        finishPreview();
        return;
      }
      state.animationId = requestAnimationFrame(loop);
    }
  };

  state.animationId = requestAnimationFrame(loop);
}

async function exportPreview() {
  if (!validateReady() || state.exporting) {
    return;
  }

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";

  state.stream = canvas.captureStream(30);
  state.chunks = [];
  state.exporting = true;
  exportButton.disabled = true;

  state.recorder = new MediaRecorder(state.stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  });

  state.recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.chunks.push(event.data);
    }
  };

  state.recorder.onerror = () => {
    cleanupRecorder();
    setStatus("Export failed.");
  };

  state.recorder.onstop = () => {
    const blob = new Blob(state.chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "datamosh-transition.webm";
    anchor.click();
    URL.revokeObjectURL(url);
    cleanupRecorder();
    stopPlayback({ keepFrame: true, keepRecorder: true });
    setStatus("Export complete. Downloaded `datamosh-transition.webm`.");
  };

  state.recorder.start();
  await startPreview();
}

videoAInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  loadVideoFile(file, videoA, "a", videoAMeta, clipAEndSlider, "end").catch((error) => {
    setStatus(error.message);
  });
});

videoBInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  loadVideoFile(file, videoB, "b", videoBMeta, clipBStartSlider, "start").catch((error) => {
    setStatus(error.message);
  });
});

[
  clipAEndSlider,
  clipBStartSlider,
  transitionDurationSlider,
  moshAmountSlider,
  blockSizeSlider,
  frameHoldSlider,
  refreshFailureSlider,
  motionSmearSlider,
].forEach((slider) => {
  slider.addEventListener("input", () => {
    updateOutputs();
    if (slider === blockSizeSlider) {
      resetMoshState();
    }
  });
});

previewButton.addEventListener("click", () => {
  startPreview();
});

stopButton.addEventListener("click", () => {
  stopPlayback();
  setStatus("Stopped.");
});

exportButton.addEventListener("click", () => {
  exportPreview();
});

drawIdleCard();
updateOutputs();
