import { createVideoVolumeController } from "./video-volume.js";

const MAX_EXPORT_WIDTH = 1280;
const MIN_RENDER_WIDTH = 64;
const MIN_RENDER_HEIGHT = 36;
const SPLIT_SCREEN_MODES = Object.freeze({
  off: "off",
  side: "side",
  stack: "stack",
});
const QUALITY_PRESETS = Object.freeze({
  micro: {
    label: "Micro",
    scale: 0.1,
    clusterStepScale: 3.4,
    clusterLimitScale: 0.18,
  },
  low: {
    label: "Low",
    scale: 0.3,
    clusterStepScale: 2.05,
    clusterLimitScale: 0.34,
  },
  performance: {
    label: "Performance",
    scale: 0.55,
    clusterStepScale: 1.45,
    clusterLimitScale: 0.55,
  },
  balanced: {
    label: "Balanced",
    scale: 0.72,
    clusterStepScale: 1.18,
    clusterLimitScale: 0.8,
  },
  quality: {
    label: "Quality",
    scale: 1,
    clusterStepScale: 1,
    clusterLimitScale: 1,
  },
});
const BLEND_MODE_OPTIONS = Object.freeze([
  { value: "normal", label: "Normal" },
  { value: "darken", label: "Darken" },
  { value: "multiply", label: "Multiply" },
  { value: "lighten", label: "Lighten" },
  { value: "screen", label: "Screen" },
  { value: "dodge", label: "Color Dodge" },
  { value: "add", label: "Linear Dodge" },
  { value: "overlay", label: "Overlay" },
  { value: "softLight", label: "Soft Light" },
  { value: "hardLight", label: "Hard Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "subtract", label: "Subtract" },
]);
const BLEND_MODE_MAP = Object.freeze({
  normal: "source-over",
  darken: "darken",
  multiply: "multiply",
  lighten: "lighten",
  screen: "screen",
  dodge: "color-dodge",
  add: "lighter",
  overlay: "overlay",
  softLight: "soft-light",
  hardLight: "hard-light",
  difference: "difference",
  exclusion: "exclusion",
  subtract: "subtract",
});
const RANDOM_BLEND_OPTIONS = Object.freeze([
  "normal",
  "screen",
  "lighten",
  "overlay",
  "softLight",
  "hardLight",
  "add",
  "difference",
  "exclusion",
]);
const RANDOM_EFFECT_GROUP_RULES = Object.freeze({
  color: Object.freeze({ min: 1, max: 3, label: "color effect" }),
  tracking: Object.freeze({ min: 3, max: 4, label: "tracking effect" }),
  particles: Object.freeze({ min: 0, max: 1, label: "particle tracker" }),
});
const PRESET_FILE_VERSION = 1;
const PRESET_APP_ID = "motion-video-preset";
const FPS_SAMPLE_WINDOW_MS = 500;
const FPS_SMOOTHING = 0.32;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothMetric(previous, next, amount = FPS_SMOOTHING) {
  if (!Number.isFinite(next)) {
    return previous;
  }
  if (!Number.isFinite(previous)) {
    return next;
  }
  return previous + (next - previous) * amount;
}

function setOutput(output, value, digits = 2) {
  if (!output) {
    return;
  }
  const nextValue = typeof value === "number" ? value.toFixed(digits) : value;
  output.value = nextValue;
  output.textContent = nextValue;
}

function setContextSampling(targetCtx) {
  if (!targetCtx) {
    return;
  }
  targetCtx.imageSmoothingEnabled = false;
}

function drawVideoFit(video, targetCtx) {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) {
    return;
  }

  const targetWidth = targetCtx.canvas.width;
  const targetHeight = targetCtx.canvas.height;
  const scale = Math.min(targetWidth / sw, targetHeight / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (targetWidth - dw) * 0.5;
  const dy = (targetHeight - dh) * 0.5;

  targetCtx.clearRect(0, 0, targetWidth, targetHeight);
  targetCtx.fillStyle = "#000000";
  targetCtx.fillRect(0, 0, targetWidth, targetHeight);
  targetCtx.drawImage(video, dx, dy, dw, dh);
}

function drawSourceCover(source, targetCtx, dx, dy, dw, dh) {
  const sw = source.videoWidth || source.width;
  const sh = source.videoHeight || source.height;
  if (!sw || !sh) {
    return;
  }

  const sourceAspect = sw / sh;
  const destAspect = dw / dh;
  let sx = 0;
  let sy = 0;
  let sWidth = sw;
  let sHeight = sh;

  if (sourceAspect > destAspect) {
    sWidth = sh * destAspect;
    sx = (sw - sWidth) * 0.5;
  } else {
    sHeight = sw / destAspect;
    sy = (sh - sHeight) * 0.5;
  }

  targetCtx.drawImage(source, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
}

function createLayerRuntime(width, height, sharedFrameRuntime = null) {
  const canvas = sharedFrameRuntime?.canvas || document.createElement("canvas");
  const ctx = sharedFrameRuntime?.ctx || canvas.getContext("2d", { alpha: true });
  const ghostCanvas = document.createElement("canvas");
  const ghostCtx = ghostCanvas.getContext("2d", { alpha: true });
  const auxCanvas = document.createElement("canvas");
  const auxCtx = auxCanvas.getContext("2d", { alpha: true });
  const bufferCanvas = document.createElement("canvas");
  const bufferCtx = bufferCanvas.getContext("2d", { alpha: true });
  [ctx, ghostCtx, auxCtx, bufferCtx].forEach(setContextSampling);
  [canvas, ghostCanvas, auxCanvas, bufferCanvas].forEach((node) => {
    node.width = width;
    node.height = height;
  });
  return {
    canvas,
    ctx,
    frameShared: Boolean(sharedFrameRuntime),
    ghostCanvas,
    ghostCtx,
    auxCanvas,
    auxCtx,
    bufferCanvas,
    bufferCtx,
  };
}

function togglePanel(head) {
  const group = head.closest("[data-panel-group]");
  if (!group) {
    return;
  }

  group.classList.toggle("collapsed");
  const expanded = !group.classList.contains("collapsed");
  const toggle = head.querySelector(".hud-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(expanded));
  }
}

function cloneParams(params = {}) {
  return { ...params };
}

function randomChoice(items) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function shuffleItems(items) {
  const copy = Array.isArray(items) ? [...items] : [];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function getRandomIntInclusive(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return 0;
  }
  const safeMin = Math.ceil(Math.min(min, max));
  const safeMax = Math.floor(Math.max(min, max));
  return safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1));
}

function getControlDigits(control) {
  return Number.isInteger(control?.digits) ? control.digits : 2;
}

function snapToStep(value, min, step) {
  if (!Number.isFinite(step) || step <= 0) {
    return value;
  }
  return min + Math.round((value - min) / step) * step;
}

function clampControlValue(control, value) {
  if (control?.kind === "toggle") {
    return Boolean(value);
  }
  const digits = getControlDigits(control);
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return Number(control.min.toFixed(digits));
  }
  const steppedValue = snapToStep(clamp(numericValue, control.min, control.max), control.min, control.step);
  return Number(clamp(steppedValue, control.min, control.max).toFixed(digits));
}

function sanitizeLayerOpacity(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? clamp(numericValue, 0, 1) : 1;
}

function formatControlValue(control, value) {
  if (control.kind === "toggle") {
    return value ? "On" : "Off";
  }
  return Number(value).toFixed(control.digits ?? 2);
}

function renderControlMarkup(control, value) {
  if (control.kind === "toggle") {
    return `
      <div class="layer-inline-row">
        <label>${control.label}</label>
        <div class="layer-inline-control layer-inline-toggle">
          <input data-inline-toggle="${control.key}" class="toggle-check" type="checkbox" ${value ? "checked" : ""} />
          <output data-inline-output="${control.key}">${formatControlValue(control, value)}</output>
        </div>
      </div>
    `;
  }

  return `
    <div class="layer-inline-row">
      <label>${control.label}</label>
      <div class="layer-inline-control">
        <input
          data-inline-slider="${control.key}"
          data-inline-digits="${control.digits ?? 2}"
          type="range"
          min="${control.min}"
          max="${control.max}"
          step="${control.step}"
          value="${Number(value).toFixed(control.digits ?? 2)}"
        />
        <output data-inline-output="${control.key}">${formatControlValue(control, value)}</output>
      </div>
    </div>
  `;
}

export function createVideoWorkspace({
  title,
  recordingFilename,
  effectDefinitions,
  renderEffectLayer,
  layerNeedsSourceImageData,
}) {
  const effectMap = new Map(effectDefinitions.map((definition) => [definition.type, definition]));
  const shellTitle = document.querySelector(".titlebar h1");
  const fileInput = document.getElementById("video-input");
  const presetInput = document.getElementById("preset-input");
  const sourceVideo = document.getElementById("video-source");
  const canvas = document.getElementById("video-canvas");
  const uploadButton = document.getElementById("upload-button");
  const playButton = document.getElementById("play-button");
  const randomizeButton = document.getElementById("randomize-button");
  const splitButton = document.getElementById("split-button");
  const splitStackButton = document.getElementById("split-stack-button");
  const savePresetButton = document.getElementById("save-preset-button");
  const importPresetButton = document.getElementById("import-preset-button");
  const exportButton = document.getElementById("export-button");
  const headerPlayButton = document.getElementById("header-play-button");
  const headerStopButton = document.getElementById("header-stop-button");
  const headerReverseButton = document.getElementById("header-reverse-button");
  const headerResetButton = document.getElementById("header-reset-button");
  const statusText = document.getElementById("status-text");
  const fileNameText = document.getElementById("file-name");
  const qualitySelect = document.getElementById("quality-select");
  const fpsSelect = document.getElementById("fps-select");
  const volumeSlider = document.getElementById("volume-slider");
  const volumeOutput = document.getElementById("volume-output");
  const volumeButton = document.getElementById("volume-button");
  const qualityMeta = document.getElementById("quality-meta");
  const fpsMeta = document.getElementById("fps-meta");
  const displayModeValue = document.getElementById("display-mode-value");
  const layersList = document.getElementById("layers-list");
  const layersEmpty = document.getElementById("layers-empty");
  const layerSelectionLabel = document.getElementById("layer-selection-label");
  const effectRack = document.getElementById("effects-rack");
  const collapsiblePanelHeads = Array.from(document.querySelectorAll(".panel-head[data-collapsible]"));

  if (!canvas || !sourceVideo || !fileInput || !layersList || !layersEmpty) {
    throw new Error("Motion Video workspace markup is incomplete.");
  }

  document.title = title;
  if (shellTitle) {
    shellTitle.textContent = title;
  }

  const ctx = canvas.getContext("2d", { alpha: false });
  const sourceCanvas = document.createElement("canvas");
  const sourceCtx = sourceCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const compositeCanvas = document.createElement("canvas");
  const compositeCtx = compositeCanvas.getContext("2d", { alpha: false });
  const splitCanvas = document.createElement("canvas");
  const splitCtx = splitCanvas.getContext("2d", { alpha: false });
  const scratchCanvas = document.createElement("canvas");
  const scratchCtx = scratchCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const layerFrameCanvas = document.createElement("canvas");
  const layerFrameCtx = layerFrameCanvas.getContext("2d", { alpha: true });
  [ctx, sourceCtx, compositeCtx, splitCtx, scratchCtx, layerFrameCtx].forEach(setContextSampling);
  const sharedLayerFrameRuntime = {
    canvas: layerFrameCanvas,
    ctx: layerFrameCtx,
  };

  let activeObjectUrl = null;
  let activeRecorder = null;
  let activeRecordStream = null;
  let currentQuality = qualitySelect?.value || "performance";
  let isRecording = false;
  let lastRenderAt = 0;
  let layers = [];
  let nextLayerId = 1;
  let previousSourceImageData = null;
  let renderHandle = 0;
  let reversePlaybackHandle = 0;
  let reversePlaybackStamp = 0;
  let selectedLayerId = null;
  let splitScreenMode = SPLIT_SCREEN_MODES.off;
  let targetFps = Math.max(1, Number(fpsSelect?.value || 30));
  const fpsState = {
    playbackFps: null,
    previewFps: null,
    droppedFps: null,
    playbackSource: "quality",
    lastPlaybackSampleAt: 0,
    lastQualityTotalFrames: null,
    lastQualityDroppedFrames: null,
    previewFramesSinceSample: 0,
    lastPreviewSampleAt: 0,
    frameCallbackHandle: 0,
    frameCallbackCount: 0,
    lastFrameCallbackCount: 0,
  };

  const volumeController = createVideoVolumeController({
    media: sourceVideo,
    slider: volumeSlider,
    output: volumeOutput,
    toggleButton: volumeButton,
  });

  function setStatus(message) {
    if (statusText) {
      statusText.textContent = message;
    }
  }

  function formatFpsValue(value) {
    return Number.isFinite(value) ? value.toFixed(1) : "--";
  }

  function supportsPlaybackQuality() {
    return typeof sourceVideo.getVideoPlaybackQuality === "function";
  }

  function supportsVideoFrameCallbacks() {
    return typeof sourceVideo.requestVideoFrameCallback === "function";
  }

  function getPlaybackQualitySnapshot() {
    if (!supportsPlaybackQuality()) {
      return null;
    }
    const snapshot = sourceVideo.getVideoPlaybackQuality();
    if (!snapshot) {
      return null;
    }
    if (!Number.isFinite(snapshot.totalVideoFrames) || !Number.isFinite(snapshot.droppedVideoFrames)) {
      return null;
    }
    return {
      totalFrames: snapshot.totalVideoFrames,
      droppedFrames: snapshot.droppedVideoFrames,
    };
  }

  function updateFpsReadout() {
    if (!fpsMeta) {
      return;
    }

    if (!sourceVideo.src) {
      fpsMeta.textContent = "Playback FPS: -- • Preview FPS: --";
      return;
    }

    if (reversePlaybackHandle) {
      fpsMeta.textContent = `Playback FPS: reverse/manual • Preview FPS: ${formatFpsValue(fpsState.previewFps)}`;
      return;
    }

    const playbackLabel = sourceVideo.paused
      ? "paused"
      : Number.isFinite(fpsState.playbackFps)
        ? fpsState.playbackFps.toFixed(1)
        : "sampling...";
    const previewLabel = sourceVideo.paused && !needsContinuousRender()
      ? "--"
      : Number.isFinite(fpsState.previewFps)
        ? fpsState.previewFps.toFixed(1)
        : "sampling...";
    const parts = [
      `Playback FPS: ${playbackLabel}`,
      `Preview FPS: ${previewLabel}`,
    ];

    if (Number.isFinite(fpsState.droppedFps) && !sourceVideo.paused) {
      parts.push(`Dropped: ${fpsState.droppedFps.toFixed(1)}/s`);
    }

    if (fpsState.playbackSource === "video-frame-callback") {
      parts.push("Source: frame callback");
    } else if (fpsState.playbackSource === "preview-fallback") {
      parts.push("Source: preview fallback");
    }

    fpsMeta.textContent = parts.join(" • ");
  }

  function clearPlaybackSampling(keepPlaybackValue = false) {
    fpsState.lastPlaybackSampleAt = 0;
    fpsState.lastQualityTotalFrames = null;
    fpsState.lastQualityDroppedFrames = null;
    fpsState.lastFrameCallbackCount = fpsState.frameCallbackCount;
    fpsState.droppedFps = null;
    if (!keepPlaybackValue) {
      fpsState.playbackFps = null;
    }
  }

  function clearPreviewSampling() {
    fpsState.lastPreviewSampleAt = 0;
    fpsState.previewFramesSinceSample = 0;
    fpsState.previewFps = null;
  }

  function resetFpsCounters() {
    clearPlaybackSampling();
    clearPreviewSampling();
    updateFpsReadout();
  }

  function stopVideoFrameObserver() {
    if (!fpsState.frameCallbackHandle) {
      return;
    }
    if (typeof sourceVideo.cancelVideoFrameCallback === "function") {
      sourceVideo.cancelVideoFrameCallback(fpsState.frameCallbackHandle);
    }
    fpsState.frameCallbackHandle = 0;
  }

  function handleVideoFrameCallback() {
    fpsState.frameCallbackCount += 1;
    fpsState.frameCallbackHandle = 0;
    if (!sourceVideo.paused && sourceVideo.src && !supportsPlaybackQuality()) {
      fpsState.frameCallbackHandle = sourceVideo.requestVideoFrameCallback(handleVideoFrameCallback);
    }
  }

  function startVideoFrameObserver() {
    if (supportsPlaybackQuality() || !supportsVideoFrameCallbacks() || fpsState.frameCallbackHandle) {
      return;
    }
    fpsState.frameCallbackHandle = sourceVideo.requestVideoFrameCallback(handleVideoFrameCallback);
  }

  function samplePreviewFps(timestamp) {
    fpsState.previewFramesSinceSample += 1;
    if (!fpsState.lastPreviewSampleAt) {
      fpsState.lastPreviewSampleAt = timestamp;
      fpsState.previewFramesSinceSample = 0;
      return;
    }

    const elapsedMs = timestamp - fpsState.lastPreviewSampleAt;
    if (elapsedMs < FPS_SAMPLE_WINDOW_MS) {
      return;
    }

    const previewFps = fpsState.previewFramesSinceSample / (elapsedMs / 1000);
    fpsState.previewFps = smoothMetric(fpsState.previewFps, previewFps);
    fpsState.previewFramesSinceSample = 0;
    fpsState.lastPreviewSampleAt = timestamp;
  }

  function samplePlaybackFps(timestamp) {
    if (!sourceVideo.src || sourceVideo.paused || reversePlaybackHandle) {
      return;
    }

    const qualitySnapshot = getPlaybackQualitySnapshot();
    if (qualitySnapshot) {
      fpsState.playbackSource = "quality";
      if (!fpsState.lastPlaybackSampleAt) {
        fpsState.lastPlaybackSampleAt = timestamp;
        fpsState.lastQualityTotalFrames = qualitySnapshot.totalFrames;
        fpsState.lastQualityDroppedFrames = qualitySnapshot.droppedFrames;
        return;
      }

      const elapsedMs = timestamp - fpsState.lastPlaybackSampleAt;
      if (elapsedMs < FPS_SAMPLE_WINDOW_MS) {
        return;
      }

      const totalDelta = qualitySnapshot.totalFrames - fpsState.lastQualityTotalFrames;
      const droppedDelta = qualitySnapshot.droppedFrames - fpsState.lastQualityDroppedFrames;
      if (totalDelta >= 0 && droppedDelta >= 0) {
        const seconds = elapsedMs / 1000;
        const playbackFps = Math.max(0, totalDelta - droppedDelta) / seconds;
        const droppedFps = Math.max(0, droppedDelta) / seconds;
        fpsState.playbackFps = smoothMetric(fpsState.playbackFps, playbackFps);
        fpsState.droppedFps = smoothMetric(fpsState.droppedFps, droppedFps);
      } else {
        clearPlaybackSampling();
      }

      fpsState.lastPlaybackSampleAt = timestamp;
      fpsState.lastQualityTotalFrames = qualitySnapshot.totalFrames;
      fpsState.lastQualityDroppedFrames = qualitySnapshot.droppedFrames;
      return;
    }

    if (supportsVideoFrameCallbacks()) {
      fpsState.playbackSource = "video-frame-callback";
      if (!fpsState.lastPlaybackSampleAt) {
        fpsState.lastPlaybackSampleAt = timestamp;
        fpsState.lastFrameCallbackCount = fpsState.frameCallbackCount;
        return;
      }

      const elapsedMs = timestamp - fpsState.lastPlaybackSampleAt;
      if (elapsedMs < FPS_SAMPLE_WINDOW_MS) {
        return;
      }

      const frameDelta = fpsState.frameCallbackCount - fpsState.lastFrameCallbackCount;
      if (frameDelta >= 0) {
        const playbackFps = frameDelta / (elapsedMs / 1000);
        fpsState.playbackFps = smoothMetric(fpsState.playbackFps, playbackFps);
      } else {
        clearPlaybackSampling();
      }

      fpsState.lastPlaybackSampleAt = timestamp;
      fpsState.lastFrameCallbackCount = fpsState.frameCallbackCount;
      fpsState.droppedFps = null;
      return;
    }

    fpsState.playbackSource = "preview-fallback";
    fpsState.playbackFps = fpsState.previewFps;
    fpsState.droppedFps = null;
  }

  function markControlTouched(control, active = true) {
    if (!control) {
      return;
    }
    control.classList.toggle("touched", active);
  }

  function getQualityPreset() {
    return QUALITY_PRESETS[currentQuality] || QUALITY_PRESETS.balanced;
  }

  function updateQualityMeta() {
    if (!qualityMeta) {
      return;
    }
    const preset = getQualityPreset();
    qualityMeta.textContent = `${preset.label} quality renders at ${Math.round(preset.scale * 100)}% resolution and caps preview at ${targetFps} FPS.`;
  }

  function getLayerById(layerId) {
    return layers.find((layer) => layer.id === layerId) || null;
  }

  function getSelectedLayer() {
    return getLayerById(selectedLayerId);
  }

  function getCanvasSize() {
    return {
      width: canvas.width || 1280,
      height: canvas.height || 720,
    };
  }

  function hasSourceFrame() {
    return Boolean(sourceVideo.src && sourceVideo.videoWidth && sourceVideo.videoHeight);
  }

  function needsContinuousRender() {
    return Boolean((hasSourceFrame() && !sourceVideo.paused) || reversePlaybackHandle || isRecording);
  }

  function buildLayerName(type) {
    if (type === "video") {
      return "Base Video";
    }
    const definition = effectMap.get(type);
    const label = definition?.label || "Layer";
    const count = layers.filter((layer) => layer.type === type).length + 1;
    return `${label} ${count}`;
  }

  function buildLayerTypeLabel(type) {
    if (type === "video") {
      return "Video Source";
    }
    return effectMap.get(type)?.label || type;
  }

  function sanitizeBlendMode(blend) {
    return BLEND_MODE_OPTIONS.some((option) => option.value === blend) ? blend : "normal";
  }

  function buildPresetFilename() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `motionvideo-preset-${stamp}.json`;
  }

  function renderEffectRack() {
    if (!effectRack) {
      return;
    }

    const renderButton = (definition) => `
      <button
        class="button preset-button"
        data-add-layer="${definition.type}"
        type="button"
        style="--layer-accent: ${definition.accent || "#9d73ff"};"
      >${definition.buttonLabel || definition.label}</button>
    `;
    const hasRackGroups = effectDefinitions.some((definition) => definition.rackGroup);

    if (!hasRackGroups) {
      effectRack.innerHTML = effectDefinitions.map((definition) => `
        ${definition.rackDividerLabel ? `<div class="effect-rack-divider" role="presentation">${definition.rackDividerLabel}</div>` : ""}
        ${renderButton(definition)}
      `).join("");
    } else {
      const groupedDefinitions = new Map();
      effectDefinitions.forEach((definition) => {
        const key = definition.rackGroup || "default";
        if (!groupedDefinitions.has(key)) {
          groupedDefinitions.set(key, {
            label: definition.rackGroupLabel || "",
            order: definition.rackGroupOrder ?? Number.MAX_SAFE_INTEGER,
            definitions: [],
          });
        }
        groupedDefinitions.get(key).definitions.push(definition);
      });

      effectRack.innerHTML = Array.from(groupedDefinitions.values())
        .sort((left, right) => left.order - right.order)
        .map((group) => `
          ${group.label ? `<div class="effect-rack-divider" role="presentation">${group.label}</div>` : ""}
          ${group.definitions.map(renderButton).join("")}
        `)
        .join("");
    }

    effectRack.querySelectorAll("[data-add-layer]").forEach((button) => {
      button.addEventListener("click", () => {
        addLayer(button.dataset.addLayer);
      });
    });
  }

  function createLayer(type) {
    const { width, height } = getCanvasSize();
    if (type === "video") {
      return {
        id: nextLayerId += 1,
        type: "video",
        name: "Base Video",
        visible: true,
        blend: "normal",
        opacity: 1,
        controlsOpen: false,
        params: {},
        runtime: createLayerRuntime(width, height, sharedLayerFrameRuntime),
      };
    }

    const definition = effectMap.get(type);
    if (!definition) {
      throw new Error(`Unknown motion effect: ${type}`);
    }

    return {
      id: nextLayerId += 1,
      type,
      name: buildLayerName(type),
      visible: true,
      blend: definition.defaultBlend || "screen",
      opacity: 1,
      controlsOpen: true,
      params: cloneParams(definition.defaultParams),
      runtime: createLayerRuntime(width, height, sharedLayerFrameRuntime),
    };
  }

  function ensureBaseLayer() {
    const existing = layers.find((layer) => layer.type === "video");
    if (existing) {
      return existing;
    }

    const baseLayer = createLayer("video");
    layers = [baseLayer];
    selectedLayerId = baseLayer.id;
    return baseLayer;
  }

  function disposeLayerRuntime(layer) {
    if (!layer?.runtime) {
      return;
    }
    try {
      layer.runtime.dispose?.();
    } catch (error) {
      console.error("Failed to dispose layer runtime.", error);
    }
  }

  function resizeRuntimes(width, height) {
    layers.forEach((layer) => {
      if (!layer.runtime) {
        layer.runtime = createLayerRuntime(width, height, sharedLayerFrameRuntime);
        return;
      }
      [layer.runtime.ghostCanvas, layer.runtime.auxCanvas, layer.runtime.bufferCanvas].forEach((node) => {
        node.width = width;
        node.height = height;
      });
    });
  }

  function resetFrameAnalysisState() {
    layers.forEach((layer) => {
      if (layer.runtime?.ghostCtx) {
        layer.runtime.ghostCtx.clearRect(0, 0, layer.runtime.ghostCanvas.width, layer.runtime.ghostCanvas.height);
      }
      if (layer.runtime?.auxCtx) {
        layer.runtime.auxCtx.clearRect(0, 0, layer.runtime.auxCanvas.width, layer.runtime.auxCanvas.height);
      }
      if (layer.runtime?.bufferCtx) {
        layer.runtime.bufferCtx.clearRect(0, 0, layer.runtime.bufferCanvas.width, layer.runtime.bufferCanvas.height);
      }
    });
    previousSourceImageData = null;
  }

  function resizeBuffers(videoWidth = 1280, videoHeight = 720) {
    const preset = getQualityPreset();
    const scale = Math.min(Math.min(MAX_EXPORT_WIDTH / videoWidth, 1) * preset.scale, 1);
    const width = Math.max(MIN_RENDER_WIDTH, Math.round(videoWidth * scale));
    const height = Math.max(MIN_RENDER_HEIGHT, Math.round(videoHeight * scale));
    [canvas, sourceCanvas, compositeCanvas, splitCanvas, scratchCanvas, layerFrameCanvas].forEach((node) => {
      node.width = width;
      node.height = height;
    });
    [ctx, sourceCtx, compositeCtx, splitCtx, scratchCtx, layerFrameCtx].forEach(setContextSampling);
    resizeRuntimes(width, height);
  }

  function syncLayerSelection() {
    const layer = getSelectedLayer();
    if (layerSelectionLabel) {
      layerSelectionLabel.textContent = layer && layer.type !== "video" ? layer.name : "Effects";
    }
  }

  function buildInlineControls(layer) {
    const definition = effectMap.get(layer.type);
    if (!definition?.controls?.length) {
      return "";
    }
    return definition.controls.map((control) => renderControlMarkup(control, layer.params[control.key])).join("");
  }

  function syncInlineControlViews(layer, key, value, control, activeInput = null) {
    const layerSelector = `[data-control-layer="${layer.id}"]`;
    const digits = control?.digits ?? 2;
    const formattedValue = typeof value === "number" ? value.toFixed(digits) : value;

    document.querySelectorAll(`${layerSelector} [data-inline-output="${key}"]`).forEach((output) => {
      setOutput(output, control?.kind === "toggle" ? (value ? "On" : "Off") : value, digits);
    });

    if (control?.kind === "toggle") {
      document.querySelectorAll(`${layerSelector} [data-inline-toggle="${key}"]`).forEach((toggle) => {
        if (toggle !== activeInput) {
          toggle.checked = Boolean(value);
        }
      });
      return;
    }

    document.querySelectorAll(`${layerSelector} [data-inline-slider="${key}"]`).forEach((slider) => {
      if (slider !== activeInput) {
        slider.value = formattedValue;
      }
    });
  }

  function bindInlineControls(container, layer) {
    if (!container || !layer) {
      return;
    }

    const definition = effectMap.get(layer.type);
    if (!definition?.controls?.length) {
      return;
    }

    container.querySelectorAll("[data-inline-slider]").forEach((slider) => {
      slider.addEventListener("click", (event) => event.stopPropagation());
      slider.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        markControlTouched(slider);
      });
      slider.addEventListener("input", () => {
        const key = slider.dataset.inlineSlider;
        const control = definition.controls.find((entry) => entry.key === key);
        layer.params[key] = Number(slider.value);
        syncInlineControlViews(layer, key, layer.params[key], control, slider);
        requestPreviewRefresh();
      });
    });

    container.querySelectorAll("[data-inline-toggle]").forEach((toggle) => {
      toggle.addEventListener("click", (event) => event.stopPropagation());
      toggle.addEventListener("change", () => {
        const key = toggle.dataset.inlineToggle;
        const control = definition.controls.find((entry) => entry.key === key);
        layer.params[key] = toggle.checked;
        syncInlineControlViews(layer, key, toggle.checked, control, toggle);
        requestPreviewRefresh();
      });
    });
  }

  function requestPreviewRefresh() {
    if (!hasSourceFrame()) {
      return;
    }
    lastRenderAt = 0;
    if (!renderHandle) {
      renderHandle = requestAnimationFrame(renderFrame);
    }
  }

  function renderLayerList() {
    layersList.innerHTML = "";
    layersEmpty.hidden = layers.length > 0;

    [...layers].reverse().forEach((layer) => {
      const actualIndex = layers.findIndex((entry) => entry.id === layer.id);
      const inlineControls = buildInlineControls(layer);
      const definition = effectMap.get(layer.type);
      const row = document.createElement("div");
      row.className = `layer-row-card${layer.id === selectedLayerId ? " selected" : ""}`;
      row.dataset.layerId = String(layer.id);
      row.dataset.layerType = layer.type;
      if (definition?.accent) {
        row.style.setProperty("--layer-accent", definition.accent);
      }
      row.innerHTML = `
        <div class="layer-topline">
          <div>
            <div class="layer-name">${layer.name}</div>
            <div class="layer-type">${buildLayerTypeLabel(layer.type)}</div>
          </div>
          <div class="layer-actions">
            <button class="mini-button" data-action="toggle-controls" type="button">${layer.controlsOpen ? "▾" : "▸"}</button>
            <button class="mini-button ${layer.visible ? "active" : ""}" data-action="toggle-visibility" type="button">${layer.visible ? "Eye" : "Off"}</button>
            <button class="mini-button" data-action="move-up" type="button">↑</button>
            <button class="mini-button" data-action="move-down" type="button">↓</button>
            <button class="mini-button" data-action="duplicate" type="button">Dup</button>
            <button class="mini-button" data-action="delete" type="button">Del</button>
          </div>
        </div>
        <div class="layer-grid">
          <div class="layer-field">
            <label>Blend</label>
            <select data-action="blend">
              ${BLEND_MODE_OPTIONS.map((option) => `<option value="${option.value}" ${option.value === layer.blend ? "selected" : ""}>${option.label}</option>`).join("")}
            </select>
          </div>
          <div class="layer-field">
            <label>Opacity</label>
            <div class="layer-opacity">
              <input data-action="opacity" type="range" min="0" max="1" step="0.01" value="${layer.opacity.toFixed(2)}" />
              <output data-action-output="opacity">${Math.round(layer.opacity * 100)}%</output>
            </div>
          </div>
        </div>
        ${layer.controlsOpen && inlineControls ? `<div class="layer-inline-panel" data-control-layer="${layer.id}">${inlineControls}</div>` : ""}
      `;

      row.addEventListener("click", () => {
        selectedLayerId = layer.id;
        renderLayerList();
        syncLayerSelection();
      });

      const blendSelect = row.querySelector('select[data-action="blend"]');
      const opacityInput = row.querySelector('input[data-action="opacity"]');
      const opacityOutput = row.querySelector('[data-action-output="opacity"]');
      blendSelect?.addEventListener("click", (event) => event.stopPropagation());
      blendSelect?.addEventListener("change", (event) => {
        layer.blend = event.target.value;
        requestPreviewRefresh();
      });
      opacityInput?.addEventListener("click", (event) => event.stopPropagation());
      opacityInput?.addEventListener("input", (event) => {
        layer.opacity = Number(event.target.value);
        opacityOutput.textContent = `${Math.round(layer.opacity * 100)}%`;
        requestPreviewRefresh();
      });

      row.querySelectorAll("[data-action]").forEach((button) => {
        if (button === blendSelect || button === opacityInput) {
          return;
        }

        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const { action } = button.dataset;
          if (action === "toggle-visibility") {
            layer.visible = !layer.visible;
            renderLayerList();
            requestPreviewRefresh();
            return;
          }
          if (action === "toggle-controls") {
            layer.controlsOpen = !layer.controlsOpen;
            renderLayerList();
            return;
          }
          if (action === "move-up") {
            moveLayer(layer.id, 1);
            return;
          }
          if (action === "move-down") {
            moveLayer(layer.id, -1);
            return;
          }
          if (action === "duplicate") {
            duplicateLayer(layer.id);
            return;
          }
          if (action === "delete") {
            deleteLayer(layer.id);
          }
        });
      });

      bindInlineControls(row, layer);

      row.querySelector('[data-action="duplicate"]').disabled = layer.type === "video";
      row.querySelector('[data-action="delete"]').disabled = layer.type === "video";
      row.querySelector('[data-action="toggle-controls"]').disabled = layer.type === "video" || !inlineControls;
      row.querySelector('[data-action="move-up"]').disabled = layer.type === "video" || actualIndex === layers.length - 1;
      row.querySelector('[data-action="move-down"]').disabled = layer.type === "video" || actualIndex <= 1;

      layersList.append(row);
    });

  }

  function addLayer(type) {
    if (!effectMap.has(type)) {
      setStatus("Unknown effect type.");
      return;
    }
    if (!sourceVideo.src) {
      setStatus("Upload a video first so the base layer exists.");
      return;
    }

    ensureBaseLayer();
    const layer = createLayer(type);
    layers.push(layer);
    selectedLayerId = layer.id;
    renderLayerList();
    syncLayerSelection();
    requestPreviewRefresh();
    setStatus(`${buildLayerTypeLabel(type)} layer added.`);
  }

  function duplicateLayer(layerId) {
    const original = getLayerById(layerId);
    if (!original || original.type === "video") {
      return;
    }

    const { width, height } = getCanvasSize();
    const duplicate = {
      ...original,
      id: nextLayerId += 1,
      name: `${buildLayerTypeLabel(original.type)} Copy`,
      params: cloneParams(original.params),
      runtime: createLayerRuntime(width, height, sharedLayerFrameRuntime),
    };
    const index = layers.findIndex((layer) => layer.id === layerId);
    layers.splice(index + 1, 0, duplicate);
    selectedLayerId = duplicate.id;
    renderLayerList();
    syncLayerSelection();
    requestPreviewRefresh();
  }

  function deleteLayer(layerId) {
    const layer = getLayerById(layerId);
    if (!layer || layer.type === "video") {
      return;
    }

    disposeLayerRuntime(layer);
    layers = layers.filter((entry) => entry.id !== layerId);
    if (selectedLayerId === layerId) {
      selectedLayerId = layers[layers.length - 1]?.id ?? null;
    }
    renderLayerList();
    syncLayerSelection();
    requestPreviewRefresh();
  }

  function moveLayer(layerId, direction) {
    const index = layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) {
      return;
    }

    const moving = layers[index];
    const targetIndex = index + direction;
    if (moving.type === "video" || targetIndex < 1 || targetIndex >= layers.length) {
      return;
    }
    if (layers[targetIndex].type === "video") {
      return;
    }

    layers.splice(index, 1);
    layers.splice(targetIndex, 0, moving);
    renderLayerList();
    requestPreviewRefresh();
  }

  function resetLayers() {
    layers.forEach(disposeLayerRuntime);
    layers = [];
    selectedLayerId = null;
  }

  function resetEffects() {
    const baseLayer = layers.find((layer) => layer.type === "video") || null;
    layers.forEach((layer) => {
      if (layer !== baseLayer) {
        disposeLayerRuntime(layer);
      }
    });
    layers = [baseLayer].filter(Boolean);
    selectedLayerId = baseLayer?.id ?? null;
    renderLayerList();
    syncLayerSelection();
    requestPreviewRefresh();
  }

  function replaceEffectLayers(effectLayers) {
    const baseLayer = ensureBaseLayer();
    layers.forEach((layer) => {
      if (layer !== baseLayer) {
        disposeLayerRuntime(layer);
      }
    });
    layers = [baseLayer, ...effectLayers];
    selectedLayerId = effectLayers.at(-1)?.id ?? baseLayer.id;
    renderLayerList();
    syncLayerSelection();
    resetFrameAnalysisState();
    requestPreviewRefresh();
  }

  function randomizeLayerParams(layer, definition) {
    if (!definition?.controls?.length) {
      return;
    }

    definition.controls.forEach((control) => {
      if (control.kind === "toggle") {
        layer.params[control.key] = Math.random() >= 0.5;
        return;
      }
      const rawValue = control.min + Math.random() * (control.max - control.min);
      layer.params[control.key] = clampControlValue(control, rawValue);
    });
  }

  function pickRandomEffectsByGroup() {
    const definitionsByGroup = effectDefinitions.reduce((groups, definition) => {
      const key = definition.rackGroup || "tracking";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(definition);
      return groups;
    }, new Map());
    const chosenDefinitions = [];
    const selectedCounts = {};
    const shortGroups = [];

    Object.entries(RANDOM_EFFECT_GROUP_RULES).forEach(([groupKey, rule]) => {
      const availableDefinitions = shuffleItems(definitionsByGroup.get(groupKey) || []);
      const availableCount = availableDefinitions.length;
      const maxCount = Math.min(rule.max, availableCount);
      const minCount = Math.min(rule.min, maxCount);
      const selectedCount = maxCount > minCount
        ? getRandomIntInclusive(minCount, maxCount)
        : maxCount;

      if (rule.min > 0 && availableCount < rule.min) {
        shortGroups.push(rule.label);
      }

      selectedCounts[groupKey] = selectedCount;
      chosenDefinitions.push(...availableDefinitions.slice(0, selectedCount));
    });

    return {
      chosenDefinitions: shuffleItems(chosenDefinitions),
      selectedCounts,
      shortGroups,
    };
  }

  function serializePreset() {
    return {
      app: PRESET_APP_ID,
      version: PRESET_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      layers: layers
        .filter((layer) => layer.type !== "video")
        .map((layer) => ({
          type: layer.type,
          name: layer.name,
          visible: layer.visible,
          blend: layer.blend,
          opacity: Number(layer.opacity.toFixed(2)),
          controlsOpen: layer.controlsOpen,
          params: cloneParams(layer.params),
        })),
    };
  }

  function savePreset() {
    const preset = serializePreset();
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildPresetFilename();
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Preset saved with ${preset.layers.length} effect layer${preset.layers.length === 1 ? "" : "s"}.`);
  }

  function applyPreset(preset) {
    if (!sourceVideo.src) {
      setStatus("Upload a video first, then import a preset.");
      return;
    }
    if (!preset || typeof preset !== "object") {
      throw new Error("Preset JSON is invalid.");
    }

    const layerEntries = Array.isArray(preset.layers) ? preset.layers : null;
    if (!layerEntries) {
      throw new Error("Preset JSON must include a layers array.");
    }

    const importedLayers = [];
    layerEntries.forEach((entry) => {
      if (!entry || typeof entry !== "object" || !effectMap.has(entry.type)) {
        return;
      }

      const definition = effectMap.get(entry.type);
      const layer = createLayer(entry.type);
      if (typeof entry.name === "string" && entry.name.trim()) {
        layer.name = entry.name.trim();
      }
      layer.visible = entry.visible !== false;
      layer.blend = typeof entry.blend === "string" ? sanitizeBlendMode(entry.blend) : layer.blend;
      layer.opacity = sanitizeLayerOpacity(entry.opacity);
      layer.controlsOpen = entry.controlsOpen !== false;

      if (entry.params && typeof entry.params === "object") {
        definition.controls.forEach((control) => {
          if (!Object.prototype.hasOwnProperty.call(entry.params, control.key)) {
            return;
          }
          const value = entry.params[control.key];
          if (control.kind === "toggle") {
            layer.params[control.key] = Boolean(value);
            return;
          }
          const numericValue = Number(value);
          if (!Number.isFinite(numericValue)) {
            return;
          }
          layer.params[control.key] = clampControlValue(control, numericValue);
        });
      }

      importedLayers.push(layer);
    });

    replaceEffectLayers(importedLayers);

    if (!importedLayers.length && layerEntries.length) {
      setStatus("Preset imported, but none of its effect types are available in this rack.");
      return;
    }

    const skippedCount = Math.max(0, layerEntries.length - importedLayers.length);
    let message = `Preset imported with ${importedLayers.length} effect layer${importedLayers.length === 1 ? "" : "s"}.`;
    if (skippedCount > 0) {
      message += ` Skipped ${skippedCount} unsupported layer${skippedCount === 1 ? "" : "s"}.`;
    }
    setStatus(message);
  }

  async function importPresetFile(file) {
    if (!file) {
      return;
    }

    const payload = JSON.parse(await file.text());
    applyPreset(payload);
  }

  function randomizeEffects() {
    if (!sourceVideo.src) {
      setStatus("Upload a video first.");
      return;
    }
    if (!effectDefinitions.length) {
      setStatus("No rack effects are available to randomize.");
      return;
    }

    const {
      chosenDefinitions,
      selectedCounts,
      shortGroups,
    } = pickRandomEffectsByGroup();
    const randomLayers = chosenDefinitions.map((definition) => {
      const layer = createLayer(definition.type);
      layer.name = definition.label;
      layer.blend = randomChoice(RANDOM_BLEND_OPTIONS) || layer.blend;
      layer.opacity = Number((0.35 + Math.random() * 0.65).toFixed(2));
      layer.controlsOpen = false;
      randomizeLayerParams(layer, definition);
      return layer;
    });

    if (randomLayers.length) {
      randomLayers[randomLayers.length - 1].controlsOpen = true;
    }

    replaceEffectLayers(randomLayers);
    let message = `Randomized ${randomLayers.length} effect layer${randomLayers.length === 1 ? "" : "s"}: `
      + `${selectedCounts.color || 0} color, `
      + `${selectedCounts.tracking || 0} tracking, `
      + `${selectedCounts.particles || 0} particle tracker.`;
    if (shortGroups.length) {
      message += ` Limited by available ${shortGroups.join(" and ")} layers.`;
    }
    setStatus(message);
  }

  function renderLayer(layer, sourceImageData, elapsed) {
    if (layer.type === "video") {
      layer.runtime.ctx.clearRect(0, 0, layer.runtime.canvas.width, layer.runtime.canvas.height);
      layer.runtime.ctx.drawImage(sourceCanvas, 0, 0);
      return;
    }

    renderEffectLayer({
      layer,
      sourceImageData,
      elapsed,
      mediaTime: sourceVideo.currentTime || 0,
      sourceFrameCanvas: sourceCanvas,
      previousSourceImageData,
      getQualityPreset,
      requestPreviewRefresh,
    });
  }

  function compositeLayer(layer) {
    if (!layer.visible || layer.opacity <= 0) {
      return;
    }

    compositeCtx.save();
    compositeCtx.globalAlpha = layer.opacity;
    compositeCtx.globalCompositeOperation = BLEND_MODE_MAP[layer.blend] || "source-over";
    if (layer.blend === "subtract") {
      scratchCtx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
      scratchCtx.fillStyle = "#ffffff";
      scratchCtx.fillRect(0, 0, scratchCanvas.width, scratchCanvas.height);
      scratchCtx.globalCompositeOperation = "difference";
      scratchCtx.drawImage(layer.runtime.canvas, 0, 0);
      scratchCtx.globalCompositeOperation = "source-over";
      compositeCtx.drawImage(scratchCanvas, 0, 0);
    } else {
      compositeCtx.drawImage(layer.runtime.canvas, 0, 0);
    }
    compositeCtx.restore();
  }

  function renderCompositeFrame(elapsed) {
    compositeCtx.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    compositeCtx.fillStyle = "#000000";
    compositeCtx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);

    const activeLayers = layers.filter((layer) => layer.visible && layer.opacity > 0);
    const needsAnalysis = activeLayers.some((layer) => layer.type !== "video" && layerNeedsSourceImageData(layer));
    const sourceImageData = needsAnalysis ? sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height) : null;

    activeLayers.forEach((layer) => {
      renderLayer(layer, sourceImageData, elapsed);
      compositeLayer(layer);
    });

    previousSourceImageData = needsAnalysis ? sourceImageData : null;
  }

  function drawOutputFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (splitScreenMode === SPLIT_SCREEN_MODES.side) {
      const halfWidth = canvas.width * 0.5;
      drawSourceCover(compositeCanvas, ctx, 0, 0, halfWidth, canvas.height);
      drawSourceCover(sourceCanvas, ctx, halfWidth, 0, halfWidth, canvas.height);
      return;
    }

    if (splitScreenMode === SPLIT_SCREEN_MODES.stack) {
      const halfHeight = canvas.height * 0.5;
      drawSourceCover(sourceCanvas, ctx, 0, 0, canvas.width, halfHeight);
      drawSourceCover(compositeCanvas, ctx, 0, halfHeight, canvas.width, halfHeight);
      return;
    }

    ctx.drawImage(compositeCanvas, 0, 0);
  }

  function renderFrame(timestamp = 0) {
    if (!hasSourceFrame()) {
      renderHandle = 0;
      return;
    }

    const frameInterval = 1000 / targetFps;
    if (needsContinuousRender() && lastRenderAt && timestamp - lastRenderAt < frameInterval) {
      renderHandle = requestAnimationFrame(renderFrame);
      return;
    }

    lastRenderAt = timestamp;
    drawVideoFit(sourceVideo, sourceCtx);
    renderCompositeFrame(timestamp / 1000);
    drawOutputFrame();
    samplePreviewFps(timestamp);
    samplePlaybackFps(timestamp);
    updateFpsReadout();

    if (needsContinuousRender()) {
      renderHandle = requestAnimationFrame(renderFrame);
      return;
    }

    renderHandle = 0;
    lastRenderAt = 0;
  }

  function ensureLoop() {
    if (hasSourceFrame() && !renderHandle) {
      renderHandle = requestAnimationFrame(renderFrame);
    }
  }

  function stopLoop() {
    cancelAnimationFrame(renderHandle);
    renderHandle = 0;
    lastRenderAt = 0;
  }

  function stopReversePlayback() {
    cancelAnimationFrame(reversePlaybackHandle);
    reversePlaybackHandle = 0;
    reversePlaybackStamp = 0;
    clearPlaybackSampling();
    updateFpsReadout();
  }

  function updateDisplayModeReadout() {
    if (!displayModeValue) {
      return;
    }
    const labelMap = {
      [SPLIT_SCREEN_MODES.off]: "Composite Monitor",
      [SPLIT_SCREEN_MODES.side]: "Side Split: FX | Raw",
      [SPLIT_SCREEN_MODES.stack]: "Stacked Split: Raw / FX",
    };
    displayModeValue.textContent = labelMap[splitScreenMode] || labelMap[SPLIT_SCREEN_MODES.off];
  }

  function updateSplitButtons() {
    splitButton?.classList.toggle("active", splitScreenMode === SPLIT_SCREEN_MODES.side);
    splitStackButton?.classList.toggle("active", splitScreenMode === SPLIT_SCREEN_MODES.stack);
    updateDisplayModeReadout();
  }

  function setSplitScreenMode(mode) {
    splitScreenMode = splitScreenMode === mode ? SPLIT_SCREEN_MODES.off : mode;
    updateSplitButtons();
    requestPreviewRefresh();
  }

  function updateExportButton() {
    if (!exportButton) {
      return;
    }
    exportButton.textContent = isRecording ? "Stop and Export" : "Record and Render";
    exportButton.classList.toggle("active", isRecording);
  }

  function revokeActiveUrl() {
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
  }

  function applyPerformanceSettings() {
    currentQuality = qualitySelect?.value || "balanced";
    targetFps = Math.max(1, Number(fpsSelect?.value || 30));
    updateQualityMeta();
    lastRenderAt = 0;
    resetFrameAnalysisState();
    if (sourceVideo.videoWidth && sourceVideo.videoHeight) {
      resizeBuffers(sourceVideo.videoWidth, sourceVideo.videoHeight);
      requestPreviewRefresh();
    }
  }

  async function loadVideo(file) {
    if (!file || !file.type.startsWith("video/")) {
      setStatus("Unsupported file type. Use MP4, WebM, or MOV.");
      return;
    }

    stopReversePlayback();
    revokeActiveUrl();
    stopVideoFrameObserver();
    resetFpsCounters();
    volumeController.setAvailable(false);
    activeObjectUrl = URL.createObjectURL(file);
    sourceVideo.src = activeObjectUrl;
    sourceVideo.load();

    await new Promise((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Failed to load video."));
      };
      const cleanup = () => {
        sourceVideo.removeEventListener("loadedmetadata", onLoaded);
        sourceVideo.removeEventListener("error", onError);
      };
      sourceVideo.addEventListener("loadedmetadata", onLoaded);
      sourceVideo.addEventListener("error", onError);
    });

    resizeBuffers(sourceVideo.videoWidth, sourceVideo.videoHeight);
    resetLayers();
    ensureBaseLayer();
    resetFrameAnalysisState();
    renderLayerList();
    syncLayerSelection();
    if (fileNameText) {
      fileNameText.textContent = `${file.name} • ${sourceVideo.videoWidth}x${sourceVideo.videoHeight} • ${sourceVideo.duration.toFixed(2)}s`;
    }
    setStatus("Video loaded. Base layer created.");
    updateFpsReadout();
    requestPreviewRefresh();

    let autoplayBlocked = false;
    try {
      await sourceVideo.play();
    } catch {
      autoplayBlocked = true;
    }

    volumeController.setAvailable(true);
    if (autoplayBlocked) {
      setStatus("Video loaded. Press Play / Pause if autoplay is blocked.");
    }
  }

  async function togglePlayback() {
    if (!sourceVideo.src) {
      setStatus("Upload a video first.");
      return;
    }

    if (sourceVideo.paused) {
      stopReversePlayback();
      clearPlaybackSampling();
      clearPreviewSampling();
      startVideoFrameObserver();
      try {
        await sourceVideo.play();
        setStatus("Playback running.");
        updateFpsReadout();
      } catch {
        setStatus("Playback could not start.");
      }
      return;
    }

    sourceVideo.pause();
    stopVideoFrameObserver();
    stopReversePlayback();
    clearPlaybackSampling(true);
    clearPreviewSampling();
    requestPreviewRefresh();
    setStatus("Playback paused.");
    updateFpsReadout();
  }

  function stopPlayback() {
    if (!sourceVideo.src) {
      setStatus("Upload a video first.");
      return;
    }
    sourceVideo.pause();
    stopVideoFrameObserver();
    stopReversePlayback();
    sourceVideo.currentTime = 0;
    resetFpsCounters();
    requestPreviewRefresh();
    setStatus("Playback stopped.");
  }

  function startReversePlayback() {
    if (!sourceVideo.src) {
      setStatus("Upload a video first.");
      return;
    }

    sourceVideo.pause();
    stopVideoFrameObserver();
    stopReversePlayback();
    clearPlaybackSampling();
    clearPreviewSampling();
    reversePlaybackStamp = 0;
    setStatus("Reverse playback running.");
    updateFpsReadout();
    ensureLoop();

    const step = (timestamp) => {
      if (!sourceVideo.src) {
        stopReversePlayback();
        return;
      }
      if (!reversePlaybackStamp) {
        reversePlaybackStamp = timestamp;
      }
      const deltaSeconds = (timestamp - reversePlaybackStamp) / 1000;
      reversePlaybackStamp = timestamp;
      const nextTime = sourceVideo.currentTime - deltaSeconds;
      sourceVideo.currentTime = nextTime <= 0 ? (sourceVideo.duration || 0) : nextTime;
      reversePlaybackHandle = requestAnimationFrame(step);
    };

    reversePlaybackHandle = requestAnimationFrame(step);
  }

  function cleanupRecordingState() {
    activeRecorder = null;
    if (activeRecordStream) {
      activeRecordStream.getTracks().forEach((track) => track.stop());
      activeRecordStream = null;
    }
    isRecording = false;
    updateExportButton();
  }

  function stopExportRecording() {
    if (!activeRecorder || activeRecorder.state === "inactive") {
      return;
    }
    setStatus("Stopping recording and exporting...");
    activeRecorder.stop();
  }

  async function exportLoop() {
    if (isRecording) {
      stopExportRecording();
      return;
    }

    if (!sourceVideo.src) {
      setStatus("Upload a video first.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setStatus("MediaRecorder is unavailable in this browser.");
      return;
    }

    ensureLoop();
    const stream = canvas.captureStream(targetFps);
    if (!stream) {
      setStatus("Canvas capture is unavailable in this browser.");
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const chunks = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });

    activeRecorder = recorder;
    activeRecordStream = stream;
    isRecording = true;
    updateExportButton();
    setStatus("Recording started. Press Record and Render again to stop and export.");
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      cleanupRecordingState();
      setStatus("Recording failed.");
    };
    recorder.onstop = () => {
      if (!chunks.length) {
        cleanupRecordingState();
        setStatus("Recording stopped with no video data.");
        return;
      }

      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = recordingFilename;
      anchor.click();
      URL.revokeObjectURL(url);
      cleanupRecordingState();
      setStatus(`Export complete. Downloaded \`${recordingFilename}\`.`);
    };

    if (sourceVideo.paused && !reversePlaybackHandle) {
      try {
        await sourceVideo.play();
      } catch {
        cleanupRecordingState();
        setStatus("Playback is blocked. Press Play / Pause once and try export again.");
        return;
      }
    }

    recorder.start();
  }

  sourceVideo.addEventListener("play", () => {
    startVideoFrameObserver();
    clearPlaybackSampling();
    clearPreviewSampling();
    updateFpsReadout();
    ensureLoop();
  });
  sourceVideo.addEventListener("pause", () => {
    stopVideoFrameObserver();
    clearPlaybackSampling(true);
    clearPreviewSampling();
    updateFpsReadout();
    requestPreviewRefresh();
  });
  sourceVideo.addEventListener("seeked", () => {
    clearPlaybackSampling();
    updateFpsReadout();
    requestPreviewRefresh();
  });
  sourceVideo.addEventListener("loadeddata", () => {
    clearPlaybackSampling();
    updateFpsReadout();
    requestPreviewRefresh();
  });

  uploadButton?.addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });
  fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    loadVideo(file).catch((error) => {
      setStatus(error.message);
    });
  });
  presetInput?.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    importPresetFile(file).catch((error) => {
      setStatus(error.message || "Preset import failed.");
    });
    event.target.value = "";
  });
  playButton?.addEventListener("click", () => {
    togglePlayback();
  });
  randomizeButton?.addEventListener("click", () => {
    randomizeEffects();
  });
  headerPlayButton?.addEventListener("click", () => {
    togglePlayback();
  });
  headerStopButton?.addEventListener("click", () => {
    stopPlayback();
  });
  headerReverseButton?.addEventListener("click", () => {
    startReversePlayback();
  });
  headerResetButton?.addEventListener("click", () => {
    if (!sourceVideo.src) {
      setStatus("Upload a video first.");
      return;
    }
    stopReversePlayback();
    resetEffects();
    resetFrameAnalysisState();
    requestPreviewRefresh();
    setStatus("Video effects reset.");
  });
  exportButton?.addEventListener("click", () => {
    exportLoop();
  });
  savePresetButton?.addEventListener("click", () => {
    savePreset();
  });
  importPresetButton?.addEventListener("click", () => {
    if (presetInput) {
      presetInput.value = "";
    }
    presetInput?.click();
  });
  splitButton?.addEventListener("click", () => {
    setSplitScreenMode(SPLIT_SCREEN_MODES.side);
  });
  splitStackButton?.addEventListener("click", () => {
    setSplitScreenMode(SPLIT_SCREEN_MODES.stack);
  });
  qualitySelect?.addEventListener("change", () => {
    applyPerformanceSettings();
  });
  fpsSelect?.addEventListener("change", () => {
    applyPerformanceSettings();
  });

  collapsiblePanelHeads.forEach((head) => {
    head.addEventListener("click", () => {
      togglePanel(head);
    });
    const toggle = head.querySelector(".hud-toggle");
    toggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePanel(head);
    });
  });

  window.addEventListener("beforeunload", () => {
    stopVideoFrameObserver();
    cleanupRecordingState();
    revokeActiveUrl();
    volumeController.setAvailable(false);
    stopReversePlayback();
    stopLoop();
  });

  updateQualityMeta();
  updateSplitButtons();
  updateExportButton();
  renderEffectRack();
  renderLayerList();
  syncLayerSelection();
  updateFpsReadout();
  setStatus("Ready. Upload a video for motion playback and export.");

  return {
    addLayer,
    getLayers: () => layers,
    resetEffects,
  };
}
