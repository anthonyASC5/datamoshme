import { createLayerEditor } from "./crtvideo-layer-editor.js";
import { createVideoVolumeController } from "./video-volume.js";
import { layerNeedsSourceImageData, renderEffectLayer } from "./effects.js";

// these presets scale the working buffers before effects are composited.
const MAX_EXPORT_WIDTH = 1280;
const MIN_RENDER_WIDTH = 64;
const MIN_RENDER_HEIGHT = 36;
const SPLIT_SCREEN_MODES = Object.freeze({
  off: "off",
  side: "side",
  stack: "stack",
});
const QUALITY_PRESETS = {
  micro: {
    label: "Micro",
    scale: 0.1,
    clusterStepScale: 3.4,
    clusterLimitScale: 0.18,
    edgeBlockScale: 3.2,
    detectBlock: 10,
  },
  low: {
    label: "Low",
    scale: 0.3,
    clusterStepScale: 2.05,
    clusterLimitScale: 0.34,
    edgeBlockScale: 2.15,
    detectBlock: 7,
  },
  performance: {
    label: "Performance",
    scale: 0.55,
    clusterStepScale: 1.45,
    clusterLimitScale: 0.55,
    edgeBlockScale: 1.55,
    detectBlock: 6,
  },
  balanced: {
    label: "Balanced",
    scale: 0.72,
    clusterStepScale: 1.18,
    clusterLimitScale: 0.8,
    edgeBlockScale: 1.2,
    detectBlock: 4,
  },
  quality: {
    label: "Quality",
    scale: 1,
    clusterStepScale: 1,
    clusterLimitScale: 1,
    edgeBlockScale: 1,
    detectBlock: 3,
  },
};
const BLEND_MODE_MAP = {
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
};
const EDITOR_BASE_PARAM_DEFAULTS = Object.freeze({
  brightness: 0,
  contrast: 1,
  highlights: 0,
  shadows: 0,
  sharpness: 0,
  flicker: 0,
  glow: 0,
  blur: 0,
  slowShutter: 0,
  edgeGlow: 0,
  crtGlow: 0,
});
// these extra controls feed the editor pass and small webgl shader.
const EDITOR_EXTRA_EFFECT_CONFIG = Object.freeze([
  { key: "solarize", label: "Solarize", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: "redChannel", label: "Red Channel", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: "hueGreyscale", label: "Hue Gray", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: "hueConnectedComponents", label: "Hue CCA", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { key: "hueConnectedContours", label: "CCA Contours", min: 0, max: 1, step: 0.01, defaultValue: 0 },
]);
const EDITOR_EXTRA_DEFAULTS = Object.freeze(
  Object.fromEntries(EDITOR_EXTRA_EFFECT_CONFIG.map((entry) => [entry.key, entry.defaultValue])),
);
const fileInput = document.getElementById("video-input");
const sourceVideo = document.getElementById("video-source");
const canvas = document.getElementById("video-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const uploadButton = document.getElementById("upload-button");
const playButton = document.getElementById("play-button");
const splitButton = document.getElementById("split-button");
const splitStackButton = document.getElementById("split-stack-button");
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
const displayModeValue = document.getElementById("display-mode-value");
const layersList = document.getElementById("layers-list");
const layersEmpty = document.getElementById("layers-empty");
const layerSelectionLabel = document.getElementById("layer-selection-label");
const editorSelectionLabel = document.getElementById("editor-selection-label");

const brightnessSlider = document.getElementById("brightness-slider");
const contrastSlider = document.getElementById("contrast-slider");
const highlightsSlider = document.getElementById("highlights-slider");
const shadowsSlider = document.getElementById("shadows-slider");
const sharpnessSlider = document.getElementById("sharpness-slider");
const flickerSlider = document.getElementById("flicker-slider");
const glowSlider = document.getElementById("glow-slider");
const blurSlider = document.getElementById("blur-slider");
const slowShutterSlider = document.getElementById("slow-shutter-slider");
const editorEdgeGlowSlider = document.getElementById("editor-edge-glow-slider");
const crtGlowSlider = document.getElementById("crt-glow-slider");

const brightnessOutput = document.getElementById("brightness-output");
const contrastOutput = document.getElementById("contrast-output");
const highlightsOutput = document.getElementById("highlights-output");
const shadowsOutput = document.getElementById("shadows-output");
const sharpnessOutput = document.getElementById("sharpness-output");
const flickerOutput = document.getElementById("flicker-output");
const glowOutput = document.getElementById("glow-output");
const blurOutput = document.getElementById("blur-output");
const slowShutterOutput = document.getElementById("slow-shutter-output");
const editorEdgeGlowOutput = document.getElementById("editor-edge-glow-output");
const crtGlowOutput = document.getElementById("crt-glow-output");
const EDITOR_CONTROL_BINDINGS = [
  { slider: brightnessSlider, key: "brightness", output: brightnessOutput },
  { slider: contrastSlider, key: "contrast", output: contrastOutput },
  { slider: highlightsSlider, key: "highlights", output: highlightsOutput },
  { slider: shadowsSlider, key: "shadows", output: shadowsOutput },
  { slider: sharpnessSlider, key: "sharpness", output: sharpnessOutput },
  { slider: flickerSlider, key: "flicker", output: flickerOutput },
  { slider: glowSlider, key: "glow", output: glowOutput },
  { slider: blurSlider, key: "blur", output: blurOutput },
  { slider: slowShutterSlider, key: "slowShutter", output: slowShutterOutput },
  { slider: editorEdgeGlowSlider, key: "edgeGlow", output: editorEdgeGlowOutput },
  { slider: crtGlowSlider, key: "crtGlow", output: crtGlowOutput },
];

const editorPanel = document.getElementById("editor-panel");
const editorControls = document.getElementById("editor-controls");
document.querySelectorAll('[data-add-layer="datamosh"], [data-add-layer="motionTracker"]').forEach((button) => {
  button.remove();
});
const addLayerButtons = Array.from(document.querySelectorAll("[data-add-layer]"));
const collapsiblePanelHeads = Array.from(document.querySelectorAll(".panel-head[data-collapsible]"));

const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
const compositeCanvas = document.createElement("canvas");
const compositeCtx = compositeCanvas.getContext("2d", { alpha: false });
const splitCanvas = document.createElement("canvas");
const splitCtx = splitCanvas.getContext("2d", { alpha: false });
const scratchCanvas = document.createElement("canvas");
const scratchCtx = scratchCanvas.getContext("2d", { alpha: false, willReadFrequently: true });

let activeObjectUrl = null;
let isRecording = false;
let renderHandle = 0;
let splitScreenMode = SPLIT_SCREEN_MODES.off;
let previousSourceImageData = null;
let layerEditor = null;
let reversePlaybackHandle = 0;
let reversePlaybackStamp = 0;
let currentQuality = qualitySelect?.value || "balanced";
let targetFps = Number(fpsSelect?.value || 30);
let lastRenderAt = 0;
let activeRecorder = null;
let activeRecordStream = null;
const extraEditorControls = new Map();
const volumeController = createVideoVolumeController({
  media: sourceVideo,
  slider: volumeSlider,
  output: volumeOutput,
  toggleButton: volumeButton,
});

function setStatus(message) {
  statusText.textContent = message;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(start, end, amount) {
  return start + (end - start) * amount;
}

function wrapUnit(value) {
  return ((value % 1) + 1) % 1;
}

function setOutput(output, value, digits = 2) {
  if (!output) {
    return;
  }
  const nextValue = typeof value === "number" ? value.toFixed(digits) : value;
  output.value = nextValue;
  output.textContent = nextValue;
}

function getQualityPreset() {
  return QUALITY_PRESETS[currentQuality] || QUALITY_PRESETS.balanced;
}

function setContextSampling(targetCtx) {
  if (!targetCtx) {
    return;
  }
  targetCtx.imageSmoothingEnabled = false;
}

function updateQualityMeta() {
  if (!qualityMeta) {
    return;
  }
  const preset = getQualityPreset();
  qualityMeta.textContent = `${preset.label} quality renders at ${Math.round(preset.scale * 100)}% resolution and caps preview at ${targetFps} FPS.`;
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

function resetFrameAnalysisState() {
  getLayers().forEach((layer) => {
    const detectState = layer.runtime?.detectState;
    if (detectState) {
      detectState.history.length = 0;
      detectState.activeAverage = 0;
    }
    if (layer.runtime?.ghostCtx) {
      layer.runtime.ghostCtx.clearRect(0, 0, layer.runtime.ghostCanvas.width, layer.runtime.ghostCanvas.height);
    }
    if (layer.runtime?.auxCtx) {
      layer.runtime.auxCtx.clearRect(0, 0, layer.runtime.auxCanvas.width, layer.runtime.auxCanvas.height);
    }
    if (layer.runtime?.bufferCtx) {
      layer.runtime.bufferCtx.clearRect(0, 0, layer.runtime.bufferCanvas.width, layer.runtime.bufferCanvas.height);
    }
    if (layer.runtime) {
      layer.runtime.presetGhostData = null;
    }
  });
  previousSourceImageData = null;
}

function editorPassIsNeutral(params) {
  if (!params) {
    return true;
  }
  return (
    Math.abs(getEditorBaseValue(params, "brightness")) < 0.001 &&
    Math.abs(getEditorBaseValue(params, "contrast") - 1) < 0.001 &&
    Math.abs(getEditorBaseValue(params, "highlights")) < 0.001 &&
    Math.abs(getEditorBaseValue(params, "shadows")) < 0.001 &&
    Math.abs(getEditorBaseValue(params, "sharpness")) < 0.001 &&
    Math.abs(getEditorBaseValue(params, "flicker")) < 0.001 &&
    Math.abs(getEditorBaseValue(params, "glow")) < 0.001 &&
    Math.abs(getEditorBaseValue(params, "blur")) < 0.001 &&
    Math.abs(getEditorBaseValue(params, "slowShutter")) < 0.001 &&
    Math.abs(getEditorBaseValue(params, "edgeGlow")) < 0.001 &&
    Math.abs(getEditorBaseValue(params, "crtGlow")) < 0.001 &&
    Math.abs(params.solarize ?? EDITOR_EXTRA_DEFAULTS.solarize) < 0.001 &&
    Math.abs(params.redChannel ?? EDITOR_EXTRA_DEFAULTS.redChannel) < 0.001 &&
    Math.abs(params.hueGreyscale ?? EDITOR_EXTRA_DEFAULTS.hueGreyscale) < 0.001 &&
    Math.abs(params.hueConnectedComponents ?? EDITOR_EXTRA_DEFAULTS.hueConnectedComponents) < 0.001 &&
    Math.abs(params.hueConnectedContours ?? EDITOR_EXTRA_DEFAULTS.hueConnectedContours) < 0.001
  );
}

function markControlTouched(control, active = true) {
  if (!control) {
    return;
  }
  control.classList.toggle("touched", active);
}

function stopReversePlayback() {
  cancelAnimationFrame(reversePlaybackHandle);
  reversePlaybackHandle = 0;
  reversePlaybackStamp = 0;
}

function getLayers() {
  return layerEditor ? layerEditor.getLayers() : [];
}

// this guards paused refreshes and disabled buttons from rendering empty frames.
function hasSourceFrame() {
  return Boolean(sourceVideo.src && sourceVideo.videoWidth && sourceVideo.videoHeight);
}

function needsContinuousRender() {
  return Boolean((hasSourceFrame() && !sourceVideo.paused) || reversePlaybackHandle || isRecording);
}

function createLayerRuntime(width = canvas.width || 1280, height = canvas.height || 720) {
  const layerCanvas = document.createElement("canvas");
  const layerCtx = layerCanvas.getContext("2d", { alpha: true });
  const ghostCanvas = document.createElement("canvas");
  const ghostCtx = ghostCanvas.getContext("2d", { alpha: true });
  const auxCanvas = document.createElement("canvas");
  const auxCtx = auxCanvas.getContext("2d", { alpha: true });
  const bufferCanvas = document.createElement("canvas");
  const bufferCtx = bufferCanvas.getContext("2d", { alpha: true });
  [layerCtx, ghostCtx, auxCtx, bufferCtx].forEach(setContextSampling);
  layerCanvas.width = ghostCanvas.width = auxCanvas.width = bufferCanvas.width = width;
  layerCanvas.height = ghostCanvas.height = auxCanvas.height = bufferCanvas.height = height;
  return {
    canvas: layerCanvas,
    ctx: layerCtx,
    ghostCanvas,
    ghostCtx,
    auxCanvas,
    auxCtx,
    bufferCanvas,
    bufferCtx,
    presetGhostData: null,
    detectState: {
      history: [],
      activeAverage: 0,
    },
  };
}

// this fits the live source into the working buffer with letterboxing.
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
  const dx = (targetWidth - dw) / 2;
  const dy = (targetHeight - dh) / 2;

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

function hueToRgb(hue) {
  const h = (hue % 1 + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;

  switch (i % 6) {
    case 0:
      return { r: 1, g: f, b: 0 };
    case 1:
      return { r: q, g: 1, b: 0 };
    case 2:
      return { r: 0, g: 1, b: f };
    case 3:
      return { r: 0, g: q, b: 1 };
    case 4:
      return { r: f, g: 0, b: 1 };
    default:
      return { r: 1, g: 0, b: q };
  }
}

function hslToRgb(hue, saturation, lightness) {
  const h = wrapUnit(hue);
  const s = clamp(saturation, 0, 1);
  const l = clamp(lightness, 0, 1);

  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToChannel = (t) => {
    const wrapped = wrapUnit(t);
    if (wrapped < 1 / 6) {
      return p + (q - p) * 6 * wrapped;
    }
    if (wrapped < 1 / 2) {
      return q;
    }
    if (wrapped < 2 / 3) {
      return p + (q - p) * (2 / 3 - wrapped) * 6;
    }
    return p;
  };

  return {
    r: Math.round(hueToChannel(h + 1 / 3) * 255),
    g: Math.round(hueToChannel(h) * 255),
    b: Math.round(hueToChannel(h - 1 / 3) * 255),
  };
}

function rgbToHsvNormalized(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta > 0.000001) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
    hue /= 6;
  }

  return {
    h: wrapUnit(hue),
    s: max <= 0.000001 ? 0 : delta / max,
    v: max,
  };
}

// these helpers keep saved editor params compatible with the current control set.
function ensureEditorParams(layer) {
  if (!layer || layer.type !== "editor") {
    return layer;
  }

  if (!layer.params) {
    layer.params = {};
  }

  Object.entries(EDITOR_BASE_PARAM_DEFAULTS).forEach(([key, defaultValue]) => {
    if (typeof layer.params[key] !== "number" || Number.isNaN(layer.params[key])) {
      layer.params[key] = defaultValue;
    }
  });

  EDITOR_EXTRA_EFFECT_CONFIG.forEach(({ key, defaultValue }) => {
    if (typeof layer.params[key] !== "number" || Number.isNaN(layer.params[key])) {
      layer.params[key] = defaultValue;
    }
  });

  return layer;
}

function getEditorBaseValue(params, key) {
  return typeof params?.[key] === "number" && !Number.isNaN(params[key]) ? params[key] : EDITOR_BASE_PARAM_DEFAULTS[key];
}

function getEditorExtraValue(params, key) {
  return typeof params?.[key] === "number" && !Number.isNaN(params[key]) ? params[key] : EDITOR_EXTRA_DEFAULTS[key] || 0;
}

function createEditorExtraSliderRow(config) {
  const row = document.createElement("div");
  row.className = "slider-row";

  const label = document.createElement("label");
  label.setAttribute("for", `editor-extra-${config.key}`);
  label.textContent = config.label;

  const input = document.createElement("input");
  input.id = `editor-extra-${config.key}`;
  input.type = "range";
  input.min = String(config.min);
  input.max = String(config.max);
  input.step = String(config.step);
  input.value = String(config.defaultValue);
  input.dataset.editorExtraKey = config.key;

  const output = document.createElement("output");
  output.textContent = Number(config.defaultValue).toFixed(2);

  row.append(label, input, output);
  extraEditorControls.set(config.key, { row, input, output });
  return row;
}

// this appends the extra editor controls after the base adjustment sliders.
function injectEditorExtraControls() {
  if (!editorControls || extraEditorControls.size) {
    return;
  }

  const divider = document.createElement("div");
  divider.className = "slider-divider";
  divider.textContent = "WebGL / Filter FX";
  editorControls.append(divider);

  EDITOR_EXTRA_EFFECT_CONFIG.forEach((config) => {
    editorControls.append(createEditorExtraSliderRow(config));
  });
}

function syncEditorExtraControls() {
  const editorLayer = ensureEditorParams(layerEditor?.getEditorLayer?.());
  EDITOR_EXTRA_EFFECT_CONFIG.forEach((config) => {
    const control = extraEditorControls.get(config.key);
    if (!control) {
      return;
    }
    const value = editorLayer ? getEditorExtraValue(editorLayer.params, config.key) : config.defaultValue;
    control.input.value = String(value);
    setOutput(control.output, value);
  });
}

function bindEditorExtraControls() {
  extraEditorControls.forEach((control, key) => {
    control.input.addEventListener("input", () => {
      markControlTouched(control.input);
      const editorLayer = ensureEditorParams(layerEditor?.getEditorLayer?.());
      if (!editorLayer) {
        return;
      }
      editorLayer.params[key] = Number(control.input.value);
      setOutput(control.output, editorLayer.params[key]);
      requestPreviewRefresh();
    });

    control.input.addEventListener("pointerdown", () => {
      markControlTouched(control.input);
    });
  });
}

function initializeEditorExtraControls() {
  injectEditorExtraControls();
  bindEditorExtraControls();
  syncEditorExtraControls();
}

// this extends the shared layer editor with crt-specific adjustment sliders.
function extendLayerEditorForExtraEffects(editor) {
  const originalEnsureEditorLayer = editor.ensureEditorLayer.bind(editor);
  const originalGetEditorLayer = editor.getEditorLayer.bind(editor);
  const originalSyncControlsFromSelection = editor.syncControlsFromSelection.bind(editor);
  const originalResetEffects = editor.resetEffects.bind(editor);

  editor.ensureEditorLayer = () => ensureEditorParams(originalEnsureEditorLayer());
  editor.getEditorLayer = () => ensureEditorParams(originalGetEditorLayer());
  editor.syncControlsFromSelection = () => {
    const result = originalSyncControlsFromSelection();
    syncEditorExtraControls();
    return result;
  };
  editor.resetEffects = () => {
    const result = originalResetEffects();
    ensureEditorParams(originalGetEditorLayer());
    syncEditorExtraControls();
    return result;
  };

  return editor;
}

// this webgl helper runs the small shader path for the editor extras.
function createEditorShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }
  console.error("CRT editor shader compile failed:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createEditorProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = createEditorShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createEditorShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    return null;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return program;
  }

  console.error("CRT editor program link failed:", gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

function editorWebGLEffectsActive(params) {
  return (
    getEditorExtraValue(params, "solarize") > 0.001 ||
    getEditorExtraValue(params, "redChannel") > 0.001 ||
    getEditorExtraValue(params, "hueGreyscale") > 0.001
  );
}

// this lazily creates the editor webgl state the first time it is needed.
function ensureEditorWebGLState(runtime, width, height) {
  if (runtime.editorWebglState?.available) {
    const existing = runtime.editorWebglState;
    if (existing.canvas.width !== width || existing.canvas.height !== height) {
      existing.canvas.width = width;
      existing.canvas.height = height;
      existing.gl.viewport(0, 0, width, height);
    }
    return existing;
  }

  if (runtime.editorWebglState && runtime.editorWebglState.available === false) {
    return runtime.editorWebglState;
  }

  const webglCanvas = document.createElement("canvas");
  webglCanvas.width = width;
  webglCanvas.height = height;
  const gl = webglCanvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  }) || webglCanvas.getContext("experimental-webgl");

  if (!gl) {
    runtime.editorWebglState = { available: false };
    return runtime.editorWebglState;
  }

  const vertexSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;

    void main() {
      v_uv = (a_position + 1.0) * 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision mediump float;

    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_solarize;
    uniform float u_redChannel;
    uniform float u_hueGray;

    vec3 rgb2hsv(vec3 color) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(color.bg, K.wz), vec4(color.gb, K.xy), step(color.b, color.g));
      vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));
      float d = q.x - min(q.w, q.y);
      float e = 0.00001;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    void main() {
      vec3 color = texture2D(u_texture, v_uv).rgb;

      if (u_redChannel > 0.001) {
        color = mix(color, vec3(color.r, 0.0, 0.0), u_redChannel);
      }

      if (u_hueGray > 0.001) {
        vec3 hsv = rgb2hsv(color);
        color = mix(color, vec3(hsv.x), u_hueGray);
      }

      if (u_solarize > 0.001) {
        float threshold = mix(0.84, 0.34, u_solarize);
        vec3 solarized = mix(color, 1.0 - color, step(vec3(threshold), color));
        color = mix(color, solarized, u_solarize);
      }

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

  const program = createEditorProgram(gl, vertexSource, fragmentSource);
  if (!program) {
    runtime.editorWebglState = { available: false };
    return runtime.editorWebglState;
  }

  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    1, 1,
  ]), gl.STATIC_DRAW);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  runtime.editorWebglState = {
    available: true,
    canvas: webglCanvas,
    gl,
    program,
    quadBuffer,
    texture,
    attribs: {
      position: gl.getAttribLocation(program, "a_position"),
    },
    uniforms: {
      texture: gl.getUniformLocation(program, "u_texture"),
      solarize: gl.getUniformLocation(program, "u_solarize"),
      redChannel: gl.getUniformLocation(program, "u_redChannel"),
      hueGray: gl.getUniformLocation(program, "u_hueGray"),
    },
  };

  return runtime.editorWebglState;
}

function applyEditorWebGLPass(targetCtx, params, runtime) {
  const width = targetCtx.canvas.width;
  const height = targetCtx.canvas.height;
  const state = ensureEditorWebGLState(runtime, width, height);
  if (!state?.available) {
    return false;
  }

  const { gl, program, quadBuffer, texture, attribs, uniforms } = state;
  gl.viewport(0, 0, width, height);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(attribs.position);
  gl.vertexAttribPointer(attribs.position, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, targetCtx.canvas);

  gl.uniform1i(uniforms.texture, 0);
  gl.uniform1f(uniforms.solarize, clamp(getEditorExtraValue(params, "solarize"), 0, 1));
  gl.uniform1f(uniforms.redChannel, clamp(getEditorExtraValue(params, "redChannel"), 0, 1));
  gl.uniform1f(uniforms.hueGray, clamp(getEditorExtraValue(params, "hueGreyscale"), 0, 1));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  targetCtx.clearRect(0, 0, width, height);
  targetCtx.drawImage(state.canvas, 0, 0);
  return true;
}

// this cpu path mirrors the shader effects when webgl is unavailable.
function applyEditorAdvancedCpuFallback(targetCtx, params) {
  const width = targetCtx.canvas.width;
  const height = targetCtx.canvas.height;
  const solarize = clamp(getEditorExtraValue(params, "solarize"), 0, 1);
  const redChannel = clamp(getEditorExtraValue(params, "redChannel"), 0, 1);
  const hueGray = clamp(getEditorExtraValue(params, "hueGreyscale"), 0, 1);

  if (solarize <= 0.001 && redChannel <= 0.001 && hueGray <= 0.001) {
    return;
  }

  const imageData = targetCtx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      let red = data[index] / 255;
      let green = data[index + 1] / 255;
      let blue = data[index + 2] / 255;

      if (redChannel > 0.001) {
        red = mix(red, red, redChannel);
        green = mix(green, 0, redChannel);
        blue = mix(blue, 0, redChannel);
      }

      if (hueGray > 0.001) {
        const hsv = rgbToHsvNormalized(red, green, blue);
        red = mix(red, hsv.h, hueGray);
        green = mix(green, hsv.h, hueGray);
        blue = mix(blue, hsv.h, hueGray);
      }

      if (solarize > 0.001) {
        const threshold = mix(0.84, 0.34, solarize);
        red = mix(red, red >= threshold ? 1 - red : red, solarize);
        green = mix(green, green >= threshold ? 1 - green : green, solarize);
        blue = mix(blue, blue >= threshold ? 1 - blue : blue, solarize);
      }

      data[index] = clamp(Math.round(red * 255), 0, 255);
      data[index + 1] = clamp(Math.round(green * 255), 0, 255);
      data[index + 2] = clamp(Math.round(blue * 255), 0, 255);
    }
  }

  targetCtx.putImageData(imageData, 0, 0);
}

// this pass groups nearby hue blocks into simple fills and outlines.
function applyHueConnectedComponentsPass(targetCtx, params, runtime) {
  const fillAmount = clamp(getEditorExtraValue(params, "hueConnectedComponents"), 0, 1);
  const contourAmount = clamp(getEditorExtraValue(params, "hueConnectedContours"), 0, 1);
  if ((fillAmount <= 0.001 && contourAmount <= 0.001) || !runtime?.auxCtx) {
    return;
  }

  const width = targetCtx.canvas.width;
  const height = targetCtx.canvas.height;
  const preset = getQualityPreset();
  const effectStrength = Math.max(fillAmount, contourAmount);
  const blockSize = Math.max(2, Math.round((2.6 - effectStrength * 1.35) * preset.clusterStepScale));
  const columns = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  const total = columns * rows;
  const hueBins = Math.max(4, Math.round(4 + effectStrength * 10));
  const minimumCells = Math.max(3, Math.round((1.15 - effectStrength) * 8));
  const binGrid = new Int16Array(total);
  const saturationGrid = new Float32Array(total);
  const valueGrid = new Float32Array(total);
  const labelGrid = new Int32Array(total);
  const queue = new Int32Array(total);
  const imageData = targetCtx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  binGrid.fill(-1);
  labelGrid.fill(-1);

  const sampleColorAt = (gridX, gridY) => {
    const x = Math.min(width - 1, gridX * blockSize + Math.floor(blockSize * 0.5));
    const y = Math.min(height - 1, gridY * blockSize + Math.floor(blockSize * 0.5));
    const index = (y * width + x) * 4;
    return {
      red: pixels[index] / 255,
      green: pixels[index + 1] / 255,
      blue: pixels[index + 2] / 255,
    };
  };

  for (let gridY = 0; gridY < rows; gridY += 1) {
    for (let gridX = 0; gridX < columns; gridX += 1) {
      const gridIndex = gridY * columns + gridX;
      const sample = sampleColorAt(gridX, gridY);
      const hsv = rgbToHsvNormalized(sample.red, sample.green, sample.blue);
      if (hsv.s < mix(0.2, 0.08, effectStrength) || hsv.v < mix(0.18, 0.1, effectStrength)) {
        continue;
      }
      binGrid[gridIndex] = Math.min(hueBins - 1, Math.floor(hsv.h * hueBins));
      saturationGrid[gridIndex] = hsv.s;
      valueGrid[gridIndex] = hsv.v;
    }
  }

  const acceptedComponents = [];
  let componentId = 0;

  for (let start = 0; start < total; start += 1) {
    if (labelGrid[start] !== -1 || binGrid[start] < 0) {
      continue;
    }

    const startBin = binGrid[start];
    let queueHead = 0;
    let queueTail = 0;
    const cells = [];
    let saturationSum = 0;
    let valueSum = 0;

    queue[queueTail++] = start;
    labelGrid[start] = -2;

    while (queueHead < queueTail) {
      const current = queue[queueHead++];
      const currentX = current % columns;
      const currentY = Math.floor(current / columns);
      cells.push(current);
      saturationSum += saturationGrid[current];
      valueSum += valueGrid[current];

      const neighbors = [
        [currentX - 1, currentY],
        [currentX + 1, currentY],
        [currentX, currentY - 1],
        [currentX, currentY + 1],
      ];

      neighbors.forEach(([nextX, nextY]) => {
        if (nextX < 0 || nextX >= columns || nextY < 0 || nextY >= rows) {
          return;
        }
        const nextIndex = nextY * columns + nextX;
        if (labelGrid[nextIndex] !== -1 || binGrid[nextIndex] !== startBin) {
          return;
        }
        labelGrid[nextIndex] = -2;
        queue[queueTail++] = nextIndex;
      });
    }

    if (cells.length < minimumCells) {
      cells.forEach((cellIndex) => {
        labelGrid[cellIndex] = -3;
      });
      continue;
    }

    const averageSaturation = saturationSum / cells.length;
    const averageValue = valueSum / cells.length;
    const hue = (startBin + 0.5) / hueBins;
    const tint = hslToRgb(hue, clamp(0.45 + averageSaturation * 0.5, 0, 1), clamp(0.28 + averageValue * 0.4, 0.25, 0.74));
    cells.forEach((cellIndex) => {
      labelGrid[cellIndex] = componentId;
    });
    acceptedComponents.push({
      id: componentId,
      cells,
      tint,
    });
    componentId += 1;
  }

  runtime.auxCtx.clearRect(0, 0, width, height);

  if (fillAmount > 0.001) {
    acceptedComponents.forEach((component) => {
      runtime.auxCtx.fillStyle = `rgba(${component.tint.r}, ${component.tint.g}, ${component.tint.b}, ${0.2 + fillAmount * 0.42})`;
      component.cells.forEach((cellIndex) => {
        const gridX = cellIndex % columns;
        const gridY = Math.floor(cellIndex / columns);
        runtime.auxCtx.fillRect(gridX * blockSize, gridY * blockSize, blockSize, blockSize);
      });
    });

    targetCtx.save();
    targetCtx.globalCompositeOperation = "screen";
    targetCtx.globalAlpha = 0.38 + fillAmount * 0.42;
    targetCtx.drawImage(runtime.auxCanvas, 0, 0);
    targetCtx.restore();
  }

  if (contourAmount > 0.001) {
    const edgeSize = Math.max(1, Math.round(blockSize * (0.22 + contourAmount * 0.33)));
    targetCtx.save();
    targetCtx.globalAlpha = 0.46 + contourAmount * 0.42;
    acceptedComponents.forEach((component) => {
      targetCtx.fillStyle = `rgba(${component.tint.r}, ${component.tint.g}, ${component.tint.b}, ${0.76 + contourAmount * 0.2})`;
      component.cells.forEach((cellIndex) => {
        const gridX = cellIndex % columns;
        const gridY = Math.floor(cellIndex / columns);
        const px = gridX * blockSize;
        const py = gridY * blockSize;
        const top = gridY === 0 ? -1 : labelGrid[(gridY - 1) * columns + gridX];
        const bottom = gridY === rows - 1 ? -1 : labelGrid[(gridY + 1) * columns + gridX];
        const left = gridX === 0 ? -1 : labelGrid[gridY * columns + gridX - 1];
        const right = gridX === columns - 1 ? -1 : labelGrid[gridY * columns + gridX + 1];

        if (top !== component.id) {
          targetCtx.fillRect(px, py, blockSize, edgeSize);
        }
        if (bottom !== component.id) {
          targetCtx.fillRect(px, py + blockSize - edgeSize, blockSize, edgeSize);
        }
        if (left !== component.id) {
          targetCtx.fillRect(px, py, edgeSize, blockSize);
        }
        if (right !== component.id) {
          targetCtx.fillRect(px + blockSize - edgeSize, py, edgeSize, blockSize);
        }
      });
    });
    targetCtx.restore();
  }
}

// this resize keeps every working canvas aligned to the selected render quality.
function resizeBuffers(videoWidth = 1280, videoHeight = 720) {
  const preset = getQualityPreset();
  const scale = Math.min(Math.min(MAX_EXPORT_WIDTH / videoWidth, 1) * preset.scale, 1);
  const width = Math.max(MIN_RENDER_WIDTH, Math.round(videoWidth * scale));
  const height = Math.max(MIN_RENDER_HEIGHT, Math.round(videoHeight * scale));
  [canvas, sourceCanvas, compositeCanvas, splitCanvas, scratchCanvas].forEach((node) => {
    node.width = width;
    node.height = height;
  });
  [ctx, sourceCtx, compositeCtx, splitCtx, scratchCtx].forEach(setContextSampling);
  if (layerEditor) {
    layerEditor.resizeRuntimes(width, height);
  }
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

function getEditorFlickerGain(elapsed, amount) {
  if (amount <= 0.001) {
    return 1;
  }
  const wave =
    Math.sin(elapsed * 23.7) * 0.55 +
    Math.sin(elapsed * 12.4 + 1.7) * 0.3 +
    Math.sin(elapsed * 57.3 + 0.2) * 0.15;
  const pulse = Math.pow(Math.max(0, Math.sin(elapsed * 18.5 + 0.9)), 14);
  return clamp(1 + wave * amount * 0.12 - pulse * amount * 0.22, 0.58, 1.16);
}

// this editor pass runs the main per-frame adjustments before compositing.
function applyEditorPass(targetCtx, params, runtime, elapsed = 0) {
  const width = targetCtx.canvas.width;
  const height = targetCtx.canvas.height;
  const imageData = targetCtx.getImageData(0, 0, width, height);
  const source = imageData.data;
  const output = new Uint8ClampedArray(source.length);
  const brightness = getEditorBaseValue(params, "brightness");
  const contrast = getEditorBaseValue(params, "contrast");
  const highlights = getEditorBaseValue(params, "highlights");
  const shadows = getEditorBaseValue(params, "shadows");
  const sharpness = getEditorBaseValue(params, "sharpness");
  const flicker = getEditorBaseValue(params, "flicker");
  const glowAmount = getEditorBaseValue(params, "glow");
  const blurAmount = getEditorBaseValue(params, "blur");
  const slowShutter = getEditorBaseValue(params, "slowShutter");
  const edgeGlow = getEditorBaseValue(params, "edgeGlow");
  const crtGlow = getEditorBaseValue(params, "crtGlow");
  const brightnessOffset = brightness * 255;
  const flickerGain = getEditorFlickerGain(elapsed, flicker);
  let preserveGhostTrail = false;

  const sample = (x, y, channel) => {
    const px = clamp(x, 0, width - 1);
    const py = clamp(y, 0, height - 1);
    return source[(py * width + px) * 4 + channel];
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const luma = source[index] * 0.299 + source[index + 1] * 0.587 + source[index + 2] * 0.114;
      const lightMask = Math.pow(luma / 255, 1.35);
      const shadowMask = Math.pow(1 - luma / 255, 1.25);

      for (let channel = 0; channel < 3; channel += 1) {
        const center = source[index + channel];
        const blur = (sample(x - 1, y, channel) + sample(x + 1, y, channel) + sample(x, y - 1, channel) + sample(x, y + 1, channel)) / 4;
        let value = center + (center - blur) * sharpness * 1.35;
        value = (value - 128) * contrast + 128;
        value += brightnessOffset;
        value += highlights * lightMask * 42;
        value += shadows * shadowMask * 38;
        value *= flickerGain;
        output[index + channel] = clamp(Math.round(value), 0, 255);
      }

      output[index + 3] = 255;
    }
  }

  targetCtx.putImageData(new ImageData(output, width, height), 0, 0);

  if (editorWebGLEffectsActive(params)) {
    const appliedThroughWebGL = applyEditorWebGLPass(targetCtx, params, runtime);
    if (!appliedThroughWebGL) {
      applyEditorAdvancedCpuFallback(targetCtx, params);
    }
  }

  applyHueConnectedComponentsPass(targetCtx, params, runtime);

  if (blurAmount > 0 && runtime?.auxCtx) {
    runtime.auxCtx.clearRect(0, 0, width, height);
    runtime.auxCtx.drawImage(targetCtx.canvas, 0, 0);
    targetCtx.save();
    targetCtx.globalAlpha = Math.min(0.72, 0.14 + blurAmount * 0.38);
    targetCtx.filter = `blur(${Math.max(0.2, blurAmount * 5)}px)`;
    targetCtx.drawImage(runtime.auxCanvas, 0, 0);
    targetCtx.restore();
  }

  if (glowAmount > 0 && runtime?.auxCtx) {
    runtime.auxCtx.clearRect(0, 0, width, height);
    runtime.auxCtx.drawImage(targetCtx.canvas, 0, 0);
    targetCtx.save();
    targetCtx.globalCompositeOperation = "screen";
    targetCtx.globalAlpha = Math.min(0.72, glowAmount * 0.24);
    targetCtx.filter = `blur(${Math.max(0.3, glowAmount * 6.5)}px)`;
    targetCtx.drawImage(runtime.auxCanvas, 0, 0);
    targetCtx.filter = "none";
    targetCtx.globalAlpha = Math.min(0.16, glowAmount * 0.07);
    targetCtx.fillStyle = "rgba(216, 255, 230, 0.95)";
    targetCtx.fillRect(0, 0, width, height);
    targetCtx.restore();
  }

  if (slowShutter > 0 && runtime?.ghostCtx && runtime?.auxCtx && runtime?.bufferCtx) {
    runtime.bufferCtx.clearRect(0, 0, width, height);
    runtime.bufferCtx.drawImage(runtime.ghostCanvas, 0, 0);
    runtime.auxCtx.clearRect(0, 0, width, height);
    runtime.auxCtx.drawImage(targetCtx.canvas, 0, 0);

    targetCtx.save();
    targetCtx.globalCompositeOperation = "screen";
    targetCtx.globalAlpha = Math.min(0.58, 0.08 + slowShutter * 0.34);
    targetCtx.filter = `blur(${Math.max(0.2, slowShutter * 4.5)}px)`;
    targetCtx.drawImage(runtime.bufferCanvas, 0, 0);
    targetCtx.filter = "none";
    targetCtx.globalCompositeOperation = "source-over";
    targetCtx.globalAlpha = Math.min(0.8, slowShutter * 0.62);
    targetCtx.drawImage(runtime.bufferCanvas, 0, 0);
    targetCtx.restore();

    runtime.ghostCtx.clearRect(0, 0, width, height);
    runtime.ghostCtx.save();
    runtime.ghostCtx.globalAlpha = 0.18 + slowShutter * 0.7;
    runtime.ghostCtx.filter = `blur(${Math.max(0.1, slowShutter * 2.2)}px)`;
    runtime.ghostCtx.drawImage(runtime.bufferCanvas, 0, 0);
    runtime.ghostCtx.filter = "none";
    runtime.ghostCtx.globalAlpha = Math.min(0.82, 0.32 + slowShutter * 0.32);
    runtime.ghostCtx.drawImage(runtime.auxCanvas, 0, 0);
    runtime.ghostCtx.restore();
    preserveGhostTrail = true;
  }

  if (edgeGlow > 0 && runtime?.auxCtx) {
    const preset = getQualityPreset();
    const passImage = targetCtx.getImageData(0, 0, width, height);
    const edgeOutput = new Uint8ClampedArray(passImage.data.length);
    const sample = (x, y) => {
      const px = clamp(x, 0, width - 1);
      const py = clamp(y, 0, height - 1);
      const index = (py * width + px) * 4;
      return passImage.data[index] * 0.299 + passImage.data[index + 1] * 0.587 + passImage.data[index + 2] * 0.114;
    };

    const blockSize = Math.max(2, Math.round((2 + edgeGlow * 7) * preset.edgeBlockScale));
    for (let by = 0; by < height; by += blockSize) {
      for (let bx = 0; bx < width; bx += blockSize) {
        const sampleX = Math.min(width - 2, bx + Math.floor(blockSize * 0.5));
        const sampleY = Math.min(height - 2, by + Math.floor(blockSize * 0.5));
        const edgeX = Math.abs(sample(sampleX + 1, sampleY) - sample(sampleX - 1, sampleY));
        const edgeY = Math.abs(sample(sampleX, sampleY + 1) - sample(sampleX, sampleY - 1));
        const edgeStrength = clamp((edgeX + edgeY) / 160, 0, 1);
        if (edgeStrength < 0.08) {
          continue;
        }

        const alpha = Math.round(clamp(edgeStrength * (0.42 + edgeGlow), 0, 1) * 255);
        const maxY = Math.min(height, by + blockSize);
        const maxX = Math.min(width, bx + blockSize);
        for (let y = by; y < maxY; y += 1) {
          for (let x = bx; x < maxX; x += 1) {
            const index = (y * width + x) * 4;
            edgeOutput[index] = 142;
            edgeOutput[index + 1] = 255;
            edgeOutput[index + 2] = 154;
            edgeOutput[index + 3] = alpha;
          }
        }
      }
    }

    runtime.auxCtx.clearRect(0, 0, width, height);
    runtime.auxCtx.putImageData(new ImageData(edgeOutput, width, height), 0, 0);
    targetCtx.save();
    targetCtx.globalCompositeOperation = "screen";
    targetCtx.globalAlpha = 0.34 + edgeGlow * 0.26;
    targetCtx.filter = `blur(${Math.max(0.2, edgeGlow * 5)}px)`;
    targetCtx.drawImage(runtime.auxCanvas, 0, 0);
    targetCtx.filter = "none";
    targetCtx.globalAlpha = 0.52 + edgeGlow * 0.2;
    targetCtx.drawImage(runtime.auxCanvas, 0, 0);
    targetCtx.restore();
  }

  if (crtGlow > 0 && runtime?.auxCtx) {
    runtime.auxCtx.clearRect(0, 0, width, height);
    runtime.auxCtx.drawImage(targetCtx.canvas, 0, 0);
    targetCtx.save();
    targetCtx.globalCompositeOperation = "screen";
    targetCtx.globalAlpha = Math.min(0.8, crtGlow * 0.34);
    targetCtx.filter = `blur(${Math.max(0.3, crtGlow * 6)}px)`;
    targetCtx.drawImage(runtime.auxCanvas, 0, 0);
    targetCtx.filter = "none";
    targetCtx.globalAlpha = 0.08 + crtGlow * 0.1;
    targetCtx.fillStyle = "rgba(84, 255, 132, 0.9)";
    targetCtx.fillRect(0, 0, width, height);
    targetCtx.restore();

    targetCtx.save();
    targetCtx.globalAlpha = Math.min(0.55, crtGlow * 0.32);
    for (let y = 0; y < height; y += 3) {
      targetCtx.fillStyle = y % 6 === 0 ? "rgba(0,0,0,0.2)" : "rgba(106,255,156,0.035)";
      targetCtx.fillRect(0, y, width, 1);
    }
    targetCtx.restore();
  }

  if (runtime?.ghostCtx && !preserveGhostTrail) {
    runtime.ghostCtx.clearRect(0, 0, width, height);
    runtime.ghostCtx.drawImage(targetCtx.canvas, 0, 0);
    runtime.ghostCtx.globalAlpha = 1;
  }
}

// this dispatches each effect layer to its renderer.
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
    sourceCanvas,
    sourceCtx,
    previousSourceImageData,
    getQualityPreset,
  });
}

// this blends each rendered layer into the composite output buffer.
function compositeLayer(layer, elapsed) {
  if (!layer.visible) {
    return;
  }

  if (layer.type === "editor") {
    if (layer.opacity <= 0 || editorPassIsNeutral(layer.params)) {
      return;
    }
    splitCtx.clearRect(0, 0, splitCanvas.width, splitCanvas.height);
    splitCtx.drawImage(compositeCanvas, 0, 0);
    scratchCtx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    scratchCtx.drawImage(splitCanvas, 0, 0);
    applyEditorPass(scratchCtx, layer.params, layer.runtime, elapsed);
    compositeCtx.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    compositeCtx.globalAlpha = 1 - layer.opacity;
    compositeCtx.drawImage(splitCanvas, 0, 0);
    compositeCtx.globalAlpha = layer.opacity;
    compositeCtx.drawImage(scratchCanvas, 0, 0);
    compositeCtx.globalAlpha = 1;
    return;
  }

  if (layer.opacity <= 0) {
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

// this builds the composite frame from the visible layer stack.
function renderCompositeFrame(elapsed) {
  compositeCtx.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
  compositeCtx.fillStyle = "#000000";
  compositeCtx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);

  const activeLayers = getLayers().filter((layer) => layer.visible && layer.opacity > 0);
  const needsAnalysis = activeLayers.some(layerNeedsSourceImageData);
  const sourceImageData = needsAnalysis ? sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height) : null;

  activeLayers.forEach((layer) => {
    renderLayer(layer, sourceImageData, elapsed);
    compositeLayer(layer, elapsed);
  });

  previousSourceImageData = needsAnalysis ? sourceImageData : null;
}

function drawOutputFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (splitScreenMode === SPLIT_SCREEN_MODES.side) {
    const halfWidth = canvas.width / 2;
    drawSourceCover(compositeCanvas, ctx, 0, 0, halfWidth, canvas.height);
    drawSourceCover(sourceCanvas, ctx, halfWidth, 0, halfWidth, canvas.height);
    return;
  }

  if (splitScreenMode === SPLIT_SCREEN_MODES.stack) {
    const halfHeight = canvas.height / 2;
    drawSourceCover(sourceCanvas, ctx, 0, 0, canvas.width, halfHeight);
    drawSourceCover(compositeCanvas, ctx, 0, halfHeight, canvas.width, halfHeight);
  } else {
    ctx.drawImage(compositeCanvas, 0, 0);
  }
}

// this render step runs once for paused previews and loops while playback is active.
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

function requestPreviewRefresh() {
  if (!hasSourceFrame()) {
    return;
  }
  lastRenderAt = 0;
  if (!renderHandle) {
    renderHandle = requestAnimationFrame(renderFrame);
  }
}

function stopLoop() {
  cancelAnimationFrame(renderHandle);
  renderHandle = 0;
  lastRenderAt = 0;
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

// this loads a new source clip and rebuilds the crt stack around it.
async function loadVideo(file) {
  if (!file || !file.type.startsWith("video/")) {
    setStatus("Unsupported file type. Use MP4, WebM, or MOV.");
    return;
  }

  stopReversePlayback();
  revokeActiveUrl();
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
  layerEditor.reset();
  layerEditor.ensureBaseLayer();
  layerEditor.ensureEditorLayer();
  resetFrameAnalysisState();
  layerEditor.renderLayerList();
  layerEditor.syncControlsFromSelection();
  fileNameText.textContent = `${file.name} • ${sourceVideo.videoWidth}x${sourceVideo.videoHeight} • ${sourceVideo.duration.toFixed(2)}s`;
  setStatus("Video loaded. Base layer created.");
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

// these transport helpers mirror the front-panel playback buttons.
async function togglePlayback() {
  if (!sourceVideo.src) {
    setStatus("Upload a video first.");
    return;
  }

  if (sourceVideo.paused) {
    stopReversePlayback();
    try {
      await sourceVideo.play();
      setStatus("Playback running.");
    } catch {
      setStatus("Playback could not start.");
    }
    return;
  }

  sourceVideo.pause();
  stopReversePlayback();
  requestPreviewRefresh();
  setStatus("Playback paused.");
}

function stopPlayback() {
  if (!sourceVideo.src) {
    setStatus("Upload a video first.");
    return;
  }
  sourceVideo.pause();
  stopReversePlayback();
  sourceVideo.currentTime = 0;
  requestPreviewRefresh();
  setStatus("Playback stopped.");
}

function startReversePlayback() {
  if (!sourceVideo.src) {
    setStatus("Upload a video first.");
    return;
  }

  sourceVideo.pause();
  stopReversePlayback();
  reversePlaybackStamp = 0;
  setStatus("Reverse playback running.");
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

function resetVideoEffects() {
  if (!sourceVideo.src) {
    setStatus("Upload a video first.");
    return;
  }
  stopReversePlayback();
  layerEditor.resetEffects();
  resetFrameAnalysisState();
  requestPreviewRefresh();
  setStatus("Video effects reset.");
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

// this records the current composite output until the user stops it.
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
    anchor.download = "crtvideo-recording.webm";
    anchor.click();
    URL.revokeObjectURL(url);
    cleanupRecordingState();
    setStatus("Export complete. Downloaded `crtvideo-recording.webm`.");
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

// these media events keep the preview responsive without rerendering while idle.
sourceVideo.addEventListener("play", () => {
  ensureLoop();
});

sourceVideo.addEventListener("pause", () => {
  requestPreviewRefresh();
});

sourceVideo.addEventListener("seeked", () => {
  requestPreviewRefresh();
});

sourceVideo.addEventListener("loadeddata", () => {
  requestPreviewRefresh();
});

uploadButton.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  loadVideo(file).catch((error) => {
    setStatus(error.message);
  });
});

playButton.addEventListener("click", () => {
  togglePlayback();
});

headerPlayButton.addEventListener("click", () => {
  togglePlayback();
});

headerStopButton.addEventListener("click", () => {
  stopPlayback();
});

headerReverseButton.addEventListener("click", () => {
  startReversePlayback();
});

headerResetButton.addEventListener("click", () => {
  resetVideoEffects();
});

exportButton.addEventListener("click", () => {
  exportLoop();
});

splitButton.addEventListener("click", () => {
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
  if (toggle) {
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePanel(head);
    });
  }
});

addLayerButtons.forEach((button) => {
  button.addEventListener("click", () => {
    layerEditor.addLayer(button.dataset.addLayer);
  });
});

EDITOR_CONTROL_BINDINGS.forEach(({ slider, key, output }) => {
  slider.addEventListener("input", () => {
    markControlTouched(slider);
    const layer = layerEditor.getEditorLayer();
    if (!layer) {
      return;
    }
    layer.params[key] = Number(slider.value);
    setOutput(output, layer.params[key]);
    layerEditor.syncControlsFromSelection();
    requestPreviewRefresh();
  });
});

EDITOR_CONTROL_BINDINGS.forEach(({ slider }) => {
  slider.addEventListener("pointerdown", () => {
    markControlTouched(slider);
  });
});

// this reuses the shared layer editor and volume helper for the crt page.
layerEditor = createLayerEditor({
  dom: {
    layersList,
    layersEmpty,
    layerSelectionLabel,
    editorSelectionLabel,
    editorPanel,
    editorControls,
    brightnessSlider,
    contrastSlider,
    highlightsSlider,
    shadowsSlider,
    sharpnessSlider,
    flickerSlider,
    glowSlider,
    blurSlider,
    slowShutterSlider,
    editorEdgeGlowSlider,
    crtGlowSlider,
    brightnessOutput,
    contrastOutput,
    highlightsOutput,
    shadowsOutput,
    sharpnessOutput,
    flickerOutput,
    glowOutput,
    blurOutput,
    slowShutterOutput,
    editorEdgeGlowOutput,
    crtGlowOutput,
  },
  createLayerRuntime,
  getCanvasSize: () => ({ width: canvas.width || 1280, height: canvas.height || 720 }),
  hasSource: () => Boolean(sourceVideo.src),
  requestRender: requestPreviewRefresh,
  setStatus,
  setOutput,
  markControlTouched,
  trackLayerAdd: () => {},
  disposeLayerRuntime: () => {},
});
extendLayerEditorForExtraEffects(layerEditor);
initializeEditorExtraControls();

window.addEventListener("beforeunload", () => {
  if (activeRecordStream) {
    activeRecordStream.getTracks().forEach((track) => track.stop());
  }
  activeRecorder = null;
  activeRecordStream = null;
  volumeController.setAvailable(false);
  stopReversePlayback();
  stopLoop();
  revokeActiveUrl();
});

layerEditor.renderLayerList();
layerEditor.syncControlsFromSelection();
updateSplitButtons();
updateExportButton();
updateQualityMeta();
