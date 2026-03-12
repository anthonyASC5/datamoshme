const PREVIEW_FPS = 30;
const MAX_RENDER_WIDTH = 1280;
const SAMPLE_INTERVAL = 1 / PREVIEW_FPS;
const MAX_SEARCH_RADIUS = 14;
const DEFAULT_MOSH_SECONDS = 2;
const DEFAULT_REVEAL_SECONDS = 1;

const moshCanvas = document.getElementById("moshCanvas");
const moshCtx = moshCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
const analysisCanvas = document.getElementById("analysis-canvas");
const analysisCtx = analysisCanvas.getContext("2d", { alpha: false, willReadFrequently: true });

const uploadAButton = document.getElementById("upload-a-button");
const uploadBButton = document.getElementById("upload-b-button");
const videoAInput = document.getElementById("video-a-input");
const videoBInput = document.getElementById("video-b-input");
const playButton = document.getElementById("play-button");
const exportButton = document.getElementById("export-button");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const statsText = document.getElementById("stats-text");
const videoAMeta = document.getElementById("video-a-meta");
const videoBMeta = document.getElementById("video-b-meta");

const videoA = document.getElementById("video-a");
const videoB = document.getElementById("video-b");

const clipAEndSlider = document.getElementById("clip-a-end");
const flowStrengthSlider = document.getElementById("flow-strength");
const dupeAmountSlider = document.getElementById("trail-decay");
const pulseEverySlider = document.getElementById("hue-transfer");
const pulseLengthSlider = document.getElementById("flow-resolution");
const colorBleedSlider = document.getElementById("color-bleed");
const blockResolutionSlider = document.getElementById("block-resolution");

const clipAEndOutput = document.getElementById("clip-a-end-output");
const flowStrengthOutput = document.getElementById("flow-strength-output");
const dupeAmountOutput = document.getElementById("trail-decay-output");
const pulseEveryOutput = document.getElementById("hue-transfer-output");
const pulseLengthOutput = document.getElementById("flow-resolution-output");
const colorBleedOutput = document.getElementById("color-bleed-output");
const blockResolutionOutput = document.getElementById("block-resolution-output");

const freezeCanvas = document.createElement("canvas");
const freezeCtx = freezeCanvas.getContext("2d", { alpha: false, willReadFrequently: true });

const state = {
  urls: { a: null, b: null },
  rafId: 0,
  previewMode: "idle",
  exporting: false,
  playingSource: null,
  freezeFrame: null,
  processedFrames: [],
  frameMeta: [],
  lastDupedFrames: 0,
  lastAverageMotion: 0,
  lastBleed: 0,
  autoRenderTimer: 0,
  renderNonce: 0,
};

function setStatus(message) {
  statusText.textContent = message;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function formatSeconds(value) {
  return `${Number(value).toFixed(2)}s`;
}

function updateOutputs() {
  clipAEndOutput.value = formatSeconds(clipAEndSlider.value);
  flowStrengthOutput.value = `${Math.round(Number(flowStrengthSlider.value))}%`;
  dupeAmountOutput.value = `${Math.round(Number(dupeAmountSlider.value))}x`;
  pulseEveryOutput.value = `${Math.round(Number(pulseEverySlider.value))}f`;
  pulseLengthOutput.value = `${Math.round(Number(pulseLengthSlider.value))}f`;
  colorBleedOutput.value = `${Math.round(Number(colorBleedSlider.value))}%`;
  blockResolutionOutput.value = `${Math.round(Number(blockResolutionSlider.value))} px`;
}

function updateStats() {
  statsText.innerHTML = `
    <span>Duped frames: ${state.lastDupedFrames}</span>
    <span>Avg motion: ${state.lastAverageMotion.toFixed(2)} px</span>
    <span>Bleed mix: ${Math.round(state.lastBleed * 100)}%</span>
  `;
}

function clearAutoRenderTimer() {
  if (state.autoRenderTimer) {
    clearTimeout(state.autoRenderTimer);
    state.autoRenderTimer = 0;
  }
}

function releaseObjectUrl(key) {
  if (state.urls[key]) {
    URL.revokeObjectURL(state.urls[key]);
    state.urls[key] = null;
  }
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

function copyImageData(imageData) {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function blendImageData(aFrame, bFrame, mix) {
  const ratio = clamp(mix, 0, 1);
  const output = new Uint8ClampedArray(aFrame.data.length);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.round(lerp(aFrame.data[index], bFrame.data[index], ratio));
  }
  return new ImageData(output, aFrame.width, aFrame.height);
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

  targetCtx.fillStyle = "#000";
  targetCtx.fillRect(0, 0, dw, dh);
  targetCtx.drawImage(video, dx, dy, width, height);
}

function clearCanvas() {
  moshCtx.fillStyle = "#000";
  moshCtx.fillRect(0, 0, moshCanvas.width, moshCanvas.height);
}

function drawIdleCard() {
  clearCanvas();
  moshCtx.save();
  moshCtx.strokeStyle = "rgba(103,255,212,0.26)";
  moshCtx.lineWidth = 2;
  moshCtx.strokeRect(18, 18, moshCanvas.width - 36, moshCanvas.height - 36);
  moshCtx.fillStyle = "#fff";
  moshCtx.textAlign = "center";
  moshCtx.font = '20px "Press Start 2P", monospace';
  moshCtx.fillText("DATAMOSHER V2", moshCanvas.width / 2, moshCanvas.height / 2 - 20);
  moshCtx.fillStyle = "#8ea79f";
  moshCtx.font = '16px "Orbitron", sans-serif';
  moshCtx.fillText("Clip A holds, clip B glitches in, then reveals clean.", moshCanvas.width / 2, moshCanvas.height / 2 + 24);
  moshCtx.restore();
}

function resizeCanvases(width, height) {
  const scale = Math.min(MAX_RENDER_WIDTH / width, 1);
  const renderWidth = Math.max(320, Math.round(width * scale));
  const renderHeight = Math.max(180, Math.round(height * scale));
  [moshCanvas, analysisCanvas, freezeCanvas].forEach((canvas) => {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  });
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

function updateClipAEndBounds() {
  clipAEndSlider.max = Math.max(0.05, Number((videoA.duration || 2).toFixed(2)));
  clipAEndSlider.value = Math.min(videoA.duration || 2, 2).toFixed(2);
}

async function loadClip(file, video, key, metaNode) {
  if (!isSupportedVideoFile(file)) {
    setStatus("Use MP4, MOV, or WebM files.");
    return false;
  }

  releaseObjectUrl(key);
  const url = URL.createObjectURL(file);
  state.urls[key] = url;
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.loop = true;
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
  if (videoA.src) {
    updateClipAEndBounds();
  }

  resetState();
  drawIdleCard();
  updateOutputs();
  setStatus(`${key === "a" ? "Clip A" : "Clip B"} loaded.`);
  return true;
}

function resetState() {
  state.freezeFrame = null;
  state.processedFrames = [];
  state.frameMeta = [];
  state.lastDupedFrames = 0;
  state.lastAverageMotion = 0;
  state.lastBleed = 0;
  clearAutoRenderTimer();
  updateStats();
}

function validateReady() {
  if (!videoA.src || !videoB.src) {
    setStatus("Load clip A and clip B first.");
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
    clipAEnd: clamp(Number(clipAEndSlider.value), 0.05, videoA.duration || 0.05),
    flowStrength: Number(flowStrengthSlider.value) / 100,
    dupeAmount: Math.round(Number(dupeAmountSlider.value)),
    pulseEvery: Math.round(Number(pulseEverySlider.value)),
    pulseLength: Math.round(Number(pulseLengthSlider.value)),
    colorBleed: Number(colorBleedSlider.value) / 100,
    blockResolution: Math.round(Number(blockResolutionSlider.value)),
    moshDuration: Math.min(DEFAULT_MOSH_SECONDS, Math.max(SAMPLE_INTERVAL, videoB.duration || DEFAULT_MOSH_SECONDS)),
    revealDuration: Math.min(DEFAULT_REVEAL_SECONDS, Math.max(SAMPLE_INTERVAL, videoB.duration || DEFAULT_REVEAL_SECONDS)),
  };
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

function writePixel(buffer, width, x, y, pixel) {
  const index = (y * width + x) * 4;
  buffer[index] = pixel.r;
  buffer[index + 1] = pixel.g;
  buffer[index + 2] = pixel.b;
  buffer[index + 3] = pixel.a ?? 255;
}

function rgbToHsl(r, g, b) {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) {
    return { h: 0, s: 0, l };
  }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case nr:
      h = (ng - nb) / d + (ng < nb ? 6 : 0);
      break;
    case ng:
      h = (nb - nr) / d + 2;
      break;
    default:
      h = (nr - ng) / d + 4;
      break;
  }

  return { h: h / 6, s, l };
}

function hueToRgb(p, q, t) {
  let value = t;
  if (value < 0) {
    value += 1;
  }
  if (value > 1) {
    value -= 1;
  }
  if (value < 1 / 6) {
    return p + (q - p) * 6 * value;
  }
  if (value < 1 / 2) {
    return q;
  }
  if (value < 2 / 3) {
    return p + (q - p) * (2 / 3 - value) * 6;
  }
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  };
}

function blendPixels(a, b, mix) {
  const ratio = clamp(mix, 0, 1);
  return {
    r: Math.round(lerp(a.r, b.r, ratio)),
    g: Math.round(lerp(a.g, b.g, ratio)),
    b: Math.round(lerp(a.b, b.b, ratio)),
    a: 255,
  };
}

function applyHueTransfer(basePixel, colorPixel, amount) {
  if (amount <= 0) {
    return basePixel;
  }

  const baseHsl = rgbToHsl(basePixel.r, basePixel.g, basePixel.b);
  const colorHsl = rgbToHsl(colorPixel.r, colorPixel.g, colorPixel.b);
  const mixed = hslToRgb(
    lerp(baseHsl.h, colorHsl.h, amount),
    lerp(baseHsl.s, colorHsl.s, amount * 0.92),
    lerp(baseHsl.l, colorHsl.l, amount * 0.14),
  );

  return { ...mixed, a: 255 };
}

function renderImage(imageData) {
  if (imageData) {
    moshCtx.putImageData(imageData, 0, 0);
  }
}

function captureFrame(video) {
  drawVideoFit(video, analysisCtx);
  return analysisCtx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
}

function blockLumaScore(prevFrame, currentFrame, x, y, blockSize, dx, dy) {
  const width = currentFrame.width;
  const height = currentFrame.height;
  const step = Math.max(2, Math.floor(blockSize / 4));
  let total = 0;
  let samples = 0;

  for (let sy = 0; sy < blockSize; sy += step) {
    for (let sx = 0; sx < blockSize; sx += step) {
      const currX = clamp(x + sx, 0, width - 1);
      const currY = clamp(y + sy, 0, height - 1);
      const prevX = clamp(currX + dx, 0, width - 1);
      const prevY = clamp(currY + dy, 0, height - 1);
      const currIndex = (currY * width + currX) * 4;
      const prevIndex = (prevY * width + prevX) * 4;
      const currLuma =
        currentFrame.data[currIndex] * 0.299 +
        currentFrame.data[currIndex + 1] * 0.587 +
        currentFrame.data[currIndex + 2] * 0.114;
      const prevLuma =
        prevFrame.data[prevIndex] * 0.299 +
        prevFrame.data[prevIndex + 1] * 0.587 +
        prevFrame.data[prevIndex + 2] * 0.114;
      total += Math.abs(currLuma - prevLuma);
      samples += 1;
    }
  }

  return samples ? total / samples : 0;
}

function computeFlowField(prevFrame, currentFrame, blockSize) {
  const width = currentFrame.width;
  const height = currentFrame.height;
  const searchRadius = clamp(Math.round(blockSize * 0.7), 2, MAX_SEARCH_RADIUS);
  const vectors = [];
  let totalMagnitude = 0;

  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      let bestDx = 0;
      let bestDy = 0;
      let bestScore = Infinity;

      for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
        for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
          const score = blockLumaScore(prevFrame, currentFrame, x, y, blockSize, dx, dy);
          if (score < bestScore) {
            bestScore = score;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }

      const magnitude = Math.hypot(bestDx, bestDy);
      totalMagnitude += magnitude;
      vectors.push({
        x,
        y,
        dx: -bestDx,
        dy: -bestDy,
        magnitude,
        confidence: 1 - clamp(bestScore / 64, 0, 1),
      });
    }
  }

  return {
    vectors,
    averageMotion: vectors.length ? totalMagnitude / vectors.length : 0,
  };
}

function moshDuplicateFrame(freezeFrame, prevOutput, currentFrame, flowField, options) {
  const width = freezeFrame.width;
  const height = freezeFrame.height;
  const output = new Uint8ClampedArray(width * height * 4);
  let bleedTotal = 0;

  for (const vector of flowField.vectors) {
    const motionWeight = clamp(vector.magnitude / Math.max(1, options.blockResolution * 0.8), 0, 1);
    const confidence = clamp(vector.confidence, 0.08, 1);
    const dupeBoost = 1 + options.dupeProgress * 1.6;
    const warpDx = vector.dx * (0.75 + options.flowStrength * 2.2) * dupeBoost;
    const warpDy = vector.dy * (0.75 + options.flowStrength * 2.2) * dupeBoost;
    const bleedMix = clamp(
      options.colorBleed * 0.45 +
        motionWeight * 0.16 +
        options.dupeProgress * 0.14,
      0.02,
      0.38,
    );
    const anchorMix = clamp(0.03 + options.progress * 0.04, 0.03, 0.08);
    const trailMix = clamp(0.72 + options.dupeProgress * 0.22, 0.72, 0.94);
    const maxY = Math.min(height, vector.y + options.blockResolution);
    const maxX = Math.min(width, vector.x + options.blockResolution);

    for (let py = vector.y; py < maxY; py += 1) {
      for (let px = vector.x; px < maxX; px += 1) {
        const anchorPixel = readPixel(freezeFrame.data, width, height, px - warpDx * 0.24, py - warpDy * 0.24);
        const heldPixel = readPixel(prevOutput.data, width, height, px - warpDx * trailMix, py - warpDy * trailMix);
        const currentPixel = readPixel(currentFrame.data, width, height, px, py);
        const edgePixel = readPixel(currentFrame.data, width, height, px + warpDx * 0.18, py + warpDy * 0.18);
        const anchored = blendPixels(heldPixel, anchorPixel, anchorMix);
        const colorShifted = applyHueTransfer(anchored, edgePixel, options.colorBleed * 0.65 * confidence);
        const finalPixel = blendPixels(colorShifted, currentPixel, bleedMix * confidence);
        writePixel(output, width, px, py, finalPixel);
      }
    }

    bleedTotal += bleedMix * confidence;
  }

  return {
    imageData: new ImageData(output, width, height),
    bleedMix: flowField.vectors.length ? bleedTotal / flowField.vectors.length : 0,
  };
}

function stopPreview() {
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.previewMode = "idle";
  videoA.pause();
  videoB.pause();
  state.playingSource = null;
  playButton.textContent = "Play / Pause";
}

async function playSource(video, label) {
  stopPreview();
  state.previewMode = "source";
  state.playingSource = video;
  playButton.textContent = "Pause";
  video.currentTime = 0;
  video.loop = true;

  try {
    await video.play();
  } catch {
    setStatus("Playback was blocked by the browser.");
    stopPreview();
    return;
  }

  const tick = () => {
    if (state.previewMode !== "source" || state.playingSource !== video) {
      return;
    }
    if (video.paused) {
      stopPreview();
      return;
    }
    drawVideoFit(video, moshCtx);
    timelineLabel.textContent = `${label} ${video.currentTime.toFixed(2)}s / ${video.duration.toFixed(2)}s`;
    state.rafId = requestAnimationFrame(tick);
  };

  state.rafId = requestAnimationFrame(tick);
}

function playProcessedPreview() {
  if (!state.processedFrames.length) {
    return;
  }

  stopPreview();
  state.previewMode = "processed";
  playButton.textContent = "Pause";
  let startTime = performance.now();

  const tick = (now) => {
    if (state.previewMode !== "processed") {
      return;
    }

    let index = Math.floor((now - startTime) / (1000 / PREVIEW_FPS));
    if (index >= state.processedFrames.length) {
      startTime = now;
      index = 0;
    }

    renderImage(state.processedFrames[index]);
    const meta = state.frameMeta[index];
    timelineLabel.textContent = `${meta.time.toFixed(2)}s • ${meta.mode} • flow ${meta.averageMotion.toFixed(2)} px`;
    state.rafId = requestAnimationFrame(tick);
  };

  state.rafId = requestAnimationFrame(tick);
}

async function appendClipFrames(video, startTime, endTime, modeLabel) {
  for (let time = startTime; time < endTime - 0.001; time += SAMPLE_INTERVAL) {
    await seekVideo(video, Math.min(endTime, time));
    const frame = captureFrame(video);
    state.processedFrames.push(copyImageData(frame));
    state.frameMeta.push({ time, averageMotion: 0, bleedMix: 0, mode: modeLabel });
  }
}

async function startMosh() {
  if (!validateReady()) {
    return;
  }

  const renderNonce = ++state.renderNonce;
  stopPreview();
  resetState();
  const config = getConfig();
  const clipAEnd = clamp(config.clipAEnd, SAMPLE_INTERVAL, videoA.duration || config.clipAEnd);
  const moshEndTime = clamp(config.moshDuration, SAMPLE_INTERVAL, videoB.duration || config.moshDuration);
  const revealEndTime = clamp(moshEndTime + config.revealDuration, 0, videoB.duration || moshEndTime);
  const blockResolution = clamp(config.blockResolution, 8, 36);
  let dupedFrames = 0;

  setStatus("Rendering clip A lead-in.");
  await appendClipFrames(videoA, 0, clipAEnd, "clip-a");
  if (renderNonce !== state.renderNonce) {
    return;
  }

  await seekVideo(videoA, clipAEnd);
  drawVideoFit(videoA, freezeCtx);
  state.freezeFrame = freezeCtx.getImageData(0, 0, freezeCanvas.width, freezeCanvas.height);
  let prevOutput = copyImageData(state.freezeFrame);
  state.processedFrames.push(copyImageData(prevOutput));
  state.frameMeta.push({ time: clipAEnd, averageMotion: 0, bleedMix: 0, mode: "anchor" });
  renderImage(prevOutput);

  await seekVideo(videoB, 0);
  let prevFrame = captureFrame(videoB);
  let sourceFrameIndex = 0;

  while (videoB.currentTime < moshEndTime - 0.001) {
    if (renderNonce !== state.renderNonce) {
      return;
    }

    const targetTime = Math.min(moshEndTime, (sourceFrameIndex + 1) * SAMPLE_INTERVAL);
    await seekVideo(videoB, targetTime);
    const currentFrame = captureFrame(videoB);
    const progress = clamp(videoB.currentTime / Math.max(moshEndTime, SAMPLE_INTERVAL), 0, 1);
    const flowField = computeFlowField(prevFrame, currentFrame, blockResolution);
    const pulseIndex = sourceFrameIndex % Math.max(1, config.pulseEvery);
    const shouldDupe = pulseIndex < config.pulseLength;
    const repeatCount = shouldDupe ? config.dupeAmount : 1;

    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
      const dupeProgress = repeatCount > 1 ? repeatIndex / (repeatCount - 1) : 0;
      const result = moshDuplicateFrame(state.freezeFrame, prevOutput, currentFrame, flowField, {
        progress,
        flowStrength: config.flowStrength,
        dupeProgress,
        colorBleed: config.colorBleed,
        blockResolution,
      });

      prevOutput = result.imageData;
      state.processedFrames.push(copyImageData(result.imageData));
      state.frameMeta.push({
        time: clipAEnd + videoB.currentTime,
        averageMotion: flowField.averageMotion,
        bleedMix: result.bleedMix,
        mode: shouldDupe ? `dupe ${repeatIndex + 1}/${repeatCount}` : "delta",
      });

      if (shouldDupe) {
        dupedFrames += 1;
      }
      state.lastDupedFrames = dupedFrames;
      state.lastAverageMotion = flowField.averageMotion;
      state.lastBleed = result.bleedMix;
      updateStats();
      renderImage(result.imageData);
      timelineLabel.textContent = `${videoB.currentTime.toFixed(2)}s / ${moshEndTime.toFixed(2)}s`;
      setStatus(
        shouldDupe
          ? `P-duping clip B motion. Repeat ${repeatIndex + 1}/${repeatCount}.`
          : `Dragging clip B delta frames.`,
      );
    }

    prevFrame = currentFrame;
    sourceFrameIndex += 1;
  }

  setStatus("Revealing clip B.");
  for (let time = moshEndTime; time < (videoB.duration || 0) - 0.001; time += SAMPLE_INTERVAL) {
    if (renderNonce !== state.renderNonce) {
      return;
    }

    await seekVideo(videoB, time);
    const cleanFrame = captureFrame(videoB);
    const revealProgress = revealEndTime > moshEndTime
      ? clamp((time - moshEndTime) / Math.max(revealEndTime - moshEndTime, SAMPLE_INTERVAL), 0, 1)
      : 1;
    const revealFrame = revealProgress < 1
      ? blendImageData(prevOutput, cleanFrame, revealProgress)
      : cleanFrame;

    prevOutput = copyImageData(revealFrame);
    state.processedFrames.push(copyImageData(revealFrame));
    state.frameMeta.push({
      time: clipAEnd + time,
      averageMotion: state.lastAverageMotion,
      bleedMix: Math.max(0, 1 - revealProgress) * state.lastBleed,
      mode: revealProgress < 1 ? "reveal" : "clip-b",
    });
  }

  setStatus("Datamosher V2 ready.");
  timelineLabel.textContent = `${state.processedFrames.length} frames rendered`;
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

function exportMosh() {
  if (!state.processedFrames.length) {
    setStatus("Load both clips first.");
    return;
  }

  if (state.exporting) {
    return;
  }

  stopPreview();
  state.exporting = true;
  setStatus("Exporting WebM from moshCanvas.");

  const stream = moshCanvas.captureStream(PREVIEW_FPS);
  const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
  const chunks = [];
  const frameDuration = 1000 / PREVIEW_FPS;
  let index = 0;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size) {
      chunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `crtwrld-datamosher-v2-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.webm`;
    anchor.click();
    URL.revokeObjectURL(url);
    stream.getTracks().forEach((track) => track.stop());
    state.exporting = false;
    setStatus("Export complete.");
    timelineLabel.textContent = `${state.processedFrames.length} frames exported`;
  });

  recorder.start();
  const pushFrame = () => {
    renderImage(state.processedFrames[index]);
    const meta = state.frameMeta[index];
    timelineLabel.textContent = `${meta.time.toFixed(2)}s • exporting ${index + 1}/${state.processedFrames.length}`;
    index += 1;
    if (index >= state.processedFrames.length) {
      setTimeout(() => recorder.stop(), frameDuration);
      return;
    }
    setTimeout(pushFrame, frameDuration);
  };

  renderImage(state.processedFrames[0]);
  setTimeout(pushFrame, frameDuration);
}

async function renderAndPreview() {
  await startMosh();
  if (state.processedFrames.length) {
    playProcessedPreview();
  }
}

function scheduleAutoRender() {
  if (!videoA.src || !videoB.src) {
    return;
  }
  clearAutoRenderTimer();
  state.autoRenderTimer = setTimeout(() => {
    renderAndPreview().catch(() => {
      setStatus("Datamosher V2 failed.");
    });
  }, 160);
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
    const loaded = await loadClip(file, videoA, "a", videoAMeta);
    if (loaded) {
      await playSource(videoA, "Clip A");
      scheduleAutoRender();
    }
  } catch {
    setStatus("Clip A failed to load.");
  }
});

videoBInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const loaded = await loadClip(file, videoB, "b", videoBMeta);
    if (loaded) {
      await playSource(videoB, "Clip B");
      scheduleAutoRender();
    }
  } catch {
    setStatus("Clip B failed to load.");
  }
});

playButton.addEventListener("click", () => {
  if (state.previewMode === "source" || state.previewMode === "processed") {
    stopPreview();
    if (state.processedFrames.length) {
      renderImage(state.processedFrames[state.processedFrames.length - 1]);
    } else {
      drawIdleCard();
    }
    return;
  }

  if (state.processedFrames.length) {
    playProcessedPreview();
    return;
  }

  if (videoB.src) {
    playSource(videoB, "Clip B");
    return;
  }

  if (videoA.src) {
    playSource(videoA, "Clip A");
    return;
  }

  setStatus("Load clip A first.");
});

exportButton.addEventListener("click", exportMosh);

[
  clipAEndSlider,
  flowStrengthSlider,
  dupeAmountSlider,
  pulseEverySlider,
  pulseLengthSlider,
  colorBleedSlider,
  blockResolutionSlider,
].forEach((slider) => {
  slider.addEventListener("input", () => {
    updateOutputs();
    scheduleAutoRender();
  });
});

window.addEventListener("beforeunload", () => {
  releaseObjectUrl("a");
  releaseObjectUrl("b");
});

updateOutputs();
updateStats();
drawIdleCard();
