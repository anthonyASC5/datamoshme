import { createLayerEditor } from "./crtvideo-layer-editor.js";
import { createVideoVolumeController } from "./video-volume.js";

const LOOP_DURATION = 7;
const MAX_EXPORT_WIDTH = 1280;
const MIN_RENDER_WIDTH = 64;
const MIN_RENDER_HEIGHT = 36;
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
const FILTER_JS_SCRIPT_URLS = Object.freeze([
  "https://cdn.jsdelivr.net/gh/foo123/FILTER.js@1.13.0/build/filter.min.js",
  "https://cdn.jsdelivr.net/gh/foo123/FILTER.js/build/filter.min.js",
  "https://rawcdn.githack.com/foo123/FILTER.js/master/build/filter.min.js",
]);
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
const EDITOR_WEBGL_EFFECT_KEYS = new Set([
  "solarize",
  "redChannel",
  "hueGreyscale",
]);
const fileInput = document.getElementById("video-input");
const sourceVideo = document.getElementById("video-source");
const canvas = document.getElementById("video-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const uploadButton = document.getElementById("upload-button");
const playButton = document.getElementById("play-button");
const splitButton = document.getElementById("split-button");
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
const layersList = document.getElementById("layers-list");
const layersEmpty = document.getElementById("layers-empty");
const layerSelectionLabel = document.getElementById("layer-selection-label");
const editorSelectionLabel = document.getElementById("editor-selection-label");

const brightnessSlider = document.getElementById("brightness-slider");
const contrastSlider = document.getElementById("contrast-slider");
const highlightsSlider = document.getElementById("highlights-slider");
const shadowsSlider = document.getElementById("shadows-slider");
const sharpnessSlider = document.getElementById("sharpness-slider");
const editorEdgeGlowSlider = document.getElementById("editor-edge-glow-slider");
const crtGlowSlider = document.getElementById("crt-glow-slider");

const brightnessOutput = document.getElementById("brightness-output");
const contrastOutput = document.getElementById("contrast-output");
const highlightsOutput = document.getElementById("highlights-output");
const shadowsOutput = document.getElementById("shadows-output");
const sharpnessOutput = document.getElementById("sharpness-output");
const editorEdgeGlowOutput = document.getElementById("editor-edge-glow-output");
const crtGlowOutput = document.getElementById("crt-glow-output");

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
let splitScreenEnabled = false;
let previousSourceImageData = null;
let layerEditor = null;
let reversePlaybackHandle = 0;
let reversePlaybackStamp = 0;
let currentQuality = qualitySelect?.value || "balanced";
let targetFps = Number(fpsSelect?.value || 30);
let lastRenderAt = 0;
let filterJsLoadPromise = null;
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

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
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
  }
}

function resetFrameAnalysisState() {
  getLayers().forEach((layer) => {
    const detectState = layer.runtime?.detectState;
    if (detectState) {
      detectState.history.length = 0;
      detectState.activeAverage = 0;
    }
  });
  previousSourceImageData = null;
}

function editorPassIsNeutral(params) {
  if (!params) {
    return true;
  }
  return (
    Math.abs(params.brightness) < 0.001 &&
    Math.abs(params.contrast - 1) < 0.001 &&
    Math.abs(params.highlights) < 0.001 &&
    Math.abs(params.shadows) < 0.001 &&
    Math.abs(params.sharpness) < 0.001 &&
    Math.abs(params.edgeGlow) < 0.001 &&
    Math.abs(params.crtGlow) < 0.001 &&
    Math.abs(params.solarize ?? EDITOR_EXTRA_DEFAULTS.solarize) < 0.001 &&
    Math.abs(params.redChannel ?? EDITOR_EXTRA_DEFAULTS.redChannel) < 0.001 &&
    Math.abs(params.hueGreyscale ?? EDITOR_EXTRA_DEFAULTS.hueGreyscale) < 0.001 &&
    Math.abs(params.hueConnectedComponents ?? EDITOR_EXTRA_DEFAULTS.hueConnectedComponents) < 0.001 &&
    Math.abs(params.hueConnectedContours ?? EDITOR_EXTRA_DEFAULTS.hueConnectedContours) < 0.001
  );
}

function layerNeedsSourceImageData(layer) {
  if (!layer?.visible || layer.opacity <= 0) {
    return false;
  }
  if (layer.type === "crt") {
    return (layer.params.edgeGlow || 0) > 0;
  }
  return ["cluster", "clusterOnly", "clusterTrack", "monitor", "black", "blu", "infrared", "detect"].includes(layer.type);
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

function createLayerRuntime(width = canvas.width || 1280, height = canvas.height || 720) {
  const layerCanvas = document.createElement("canvas");
  const layerCtx = layerCanvas.getContext("2d", { alpha: true });
  const ghostCanvas = document.createElement("canvas");
  const ghostCtx = ghostCanvas.getContext("2d", { alpha: true });
  const auxCanvas = document.createElement("canvas");
  const auxCtx = auxCanvas.getContext("2d", { alpha: true });
  [layerCtx, ghostCtx, auxCtx].forEach(setContextSampling);
  layerCanvas.width = ghostCanvas.width = auxCanvas.width = width;
  layerCanvas.height = ghostCanvas.height = auxCanvas.height = height;
  return {
    canvas: layerCanvas,
    ctx: layerCtx,
    ghostCanvas,
    ghostCtx,
    auxCanvas,
    auxCtx,
    detectState: {
      history: [],
      activeAverage: 0,
    },
  };
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

function ensureEditorExtraParams(layer) {
  if (!layer || layer.type !== "editor") {
    return layer;
  }

  if (!layer.params) {
    layer.params = {};
  }

  EDITOR_EXTRA_EFFECT_CONFIG.forEach(({ key, defaultValue }) => {
    if (typeof layer.params[key] !== "number" || Number.isNaN(layer.params[key])) {
      layer.params[key] = defaultValue;
    }
  });

  return layer;
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

function injectEditorExtraControls() {
  if (!editorControls || extraEditorControls.size) {
    return;
  }

  const divider = document.createElement("div");
  divider.textContent = "WebGL / Filter FX";
  divider.style.marginTop = "4px";
  divider.style.paddingTop = "6px";
  divider.style.borderTop = "1px solid rgba(0,0,0,0.28)";
  divider.style.fontWeight = "700";
  divider.style.color = "var(--ink-soft, #2f2f2f)";
  divider.style.letterSpacing = "0.02em";
  editorControls.append(divider);

  EDITOR_EXTRA_EFFECT_CONFIG.forEach((config) => {
    editorControls.append(createEditorExtraSliderRow(config));
  });
}

function syncEditorExtraControls() {
  const editorLayer = ensureEditorExtraParams(layerEditor?.getEditorLayer?.());
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
      const editorLayer = ensureEditorExtraParams(layerEditor?.getEditorLayer?.());
      if (!editorLayer) {
        return;
      }
      editorLayer.params[key] = Number(control.input.value);
      setOutput(control.output, editorLayer.params[key]);
      if (EDITOR_WEBGL_EFFECT_KEYS.has(key) && editorLayer.params[key] > 0.001) {
        ensureFilterJsLibrary();
      }
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

function extendLayerEditorForExtraEffects(editor) {
  const originalEnsureEditorLayer = editor.ensureEditorLayer.bind(editor);
  const originalGetEditorLayer = editor.getEditorLayer.bind(editor);
  const originalSyncControlsFromSelection = editor.syncControlsFromSelection.bind(editor);
  const originalResetEffects = editor.resetEffects.bind(editor);

  editor.ensureEditorLayer = () => ensureEditorExtraParams(originalEnsureEditorLayer());
  editor.getEditorLayer = () => ensureEditorExtraParams(originalGetEditorLayer());
  editor.syncControlsFromSelection = () => {
    const result = originalSyncControlsFromSelection();
    syncEditorExtraControls();
    return result;
  };
  editor.resetEffects = () => {
    const result = originalResetEffects();
    ensureEditorExtraParams(originalGetEditorLayer());
    syncEditorExtraControls();
    return result;
  };

  return editor;
}

function ensureFilterJsLibrary() {
  if (window.FILTER) {
    return Promise.resolve(window.FILTER);
  }

  if (filterJsLoadPromise) {
    return filterJsLoadPromise;
  }

  filterJsLoadPromise = new Promise((resolve) => {
    let currentIndex = 0;
    const loadNext = () => {
      if (window.FILTER) {
        resolve(window.FILTER);
        return;
      }

      const src = FILTER_JS_SCRIPT_URLS[currentIndex];
      currentIndex += 1;
      if (!src) {
        resolve(null);
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => {
        if (window.FILTER) {
          resolve(window.FILTER);
          return;
        }
        script.remove();
        loadNext();
      };
      script.onerror = () => {
        script.remove();
        loadNext();
      };
      document.head.append(script);
    };

    loadNext();
  });

  return filterJsLoadPromise;
}

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

  ensureFilterJsLibrary();
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

function buildPresetImage(imageData, elapsed, layer) {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data.length);
  const ghost = layer.runtime.ghostCtx.getImageData(0, 0, width, height).data;
  const params = layer.params;
  const grainCell = 1 + Math.floor(((Math.sin(elapsed * 7) + 1) * 0.5) * (2 + params.grit * 3));
  const textureCell = Math.max(1, Math.round(1 + params.grit * 1.5));
  const bluTint = hueToRgb(params.hue);

  const lumaAt = (x, y) => {
    const px = clamp(x, 0, width - 1);
    const py = clamp(y, 0, height - 1);
    const index = (py * width + px) * 4;
    return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const srcR = data[index];
      const srcG = data[index + 1];
      const srcB = data[index + 2];
      const luminance = lumaAt(x, y);
      const inverted = 255 - luminance;
      const edge = Math.abs(lumaAt(x + 1, y) - lumaAt(x - 1, y)) + Math.abs(lumaAt(x, y + 1) - lumaAt(x, y - 1));
      const ghostGlow = ghost[index] * (layer.type === "blu" ? 0.22 : 0.28);
      const textureSeed = (((Math.floor(x / textureCell) + 1) * 83492791) ^ ((Math.floor(y / textureCell) + 1) * 2971215073) ^ Math.floor(elapsed * 48)) >>> 0;
      const sharpTexture = textureSeed % 100 < 50 ? 14 + params.grit * 20 : -(10 + params.grit * 12);

      if (layer.type === "black") {
        const sharpened = clamp((inverted * (1.15 + params.invertBlack * 1.05) + edge * 2.1) - params.reduceBlack * 124, 0, 255);
        const threshold = 138 - params.reduceWhite * 74;
        const halftone = ((x * 13 + y * 7 + Math.floor(elapsed * 20)) & 7) / 7;
        const blackValue = sharpened + halftone * (18 + params.grit * 18) > threshold ? 255 : 0;
        const crisp = clamp(blackValue + (ghostGlow > 64 ? 32 : 0), 0, 255);
        out[index] = crisp;
        out[index + 1] = crisp;
        out[index + 2] = crisp;
        out[index + 3] = 255;
        continue;
      }

      let base = clamp((inverted * (0.7 + params.invertBlack * 0.9) - 96 * params.reduceBlack) * (2.2 + (1 - params.reduceWhite) * 0.9) + edge * 1.35, 0, 255);
      base = clamp(base - params.reduceWhite * 88 + ghostGlow, 0, 255);

      const grainSeed = (((Math.floor(x / grainCell) + 1) * 73856093) ^ ((Math.floor(y / grainCell) + 1) * 19349663) ^ Math.floor(elapsed * 60)) >>> 0;
      const grain = grainSeed % 100 < 54 ? 18 + params.grit * 46 : -(10 + params.grit * 18);
      base = clamp(base + grain + sharpTexture, 0, 255);

      if (layer.type === "blu") {
        const scanMask = y % 3 === 0 ? 0.82 : 1.0;
        const interference = Math.sin((y + elapsed * 120) * 0.06) * 10 * params.grit;
        const blueLevel = clamp(base * 0.2 + 38 + interference, 0, 255);
        const whiteLevel = clamp(base * 0.92, 0, 255);
        const tintStrength = 0.58 + params.color * 0.42;
        let r = clamp(whiteLevel * params.color * 0.08 + blueLevel * bluTint.r * 0.22, 0, 255);
        let g = clamp(blueLevel * bluTint.g * tintStrength + whiteLevel * params.color * 0.22, 0, 255);
        let b = clamp(blueLevel * (0.74 + bluTint.b * 0.42) + whiteLevel * (0.2 + params.color * 0.48), 0, 255);
        r *= scanMask;
        g *= scanMask;
        b *= scanMask;
        out[index] = r;
        out[index + 1] = g;
        out[index + 2] = b;
        out[index + 3] = 255;
      } else {
        out[index] = clamp(base * (1 - params.color) + srcR * params.color, 0, 255);
        out[index + 1] = clamp(base * (1 - params.color) + srcG * params.color, 0, 255);
        out[index + 2] = clamp(base * (1 - params.color) + srcB * params.color, 0, 255);
        out[index + 3] = 255;
      }
    }
  }

  return new ImageData(out, width, height);
}

function buildInfraredImage(imageData, elapsed, layer) {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data.length);
  const colorOffset = wrapUnit(layer.params.colorOffset || 0);
  const sweep = elapsed * 0.8;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index] / 255;
      const green = data[index + 1] / 255;
      const blue = data[index + 2] / 255;
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      const hue = wrapUnit(red + colorOffset + Math.sin(y * 0.03 + sweep) * 0.012);
      const lightness = clamp(0.1 + luminance * 0.44 + red * 0.24, 0.08, 0.78);
      const saturation = clamp(0.82 + red * 0.18, 0, 1);
      const mapped = hslToRgb(hue, saturation, lightness);
      const glowBoost = 1 + red * 0.18 + Math.sin((x + y) * 0.015 + sweep * 4) * 0.04;

      out[index] = clamp(Math.round(mapped.r * glowBoost), 0, 255);
      out[index + 1] = clamp(Math.round(mapped.g * glowBoost), 0, 255);
      out[index + 2] = clamp(Math.round(mapped.b * glowBoost), 0, 255);
      out[index + 3] = 255;
    }
  }

  return new ImageData(out, width, height);
}

function renderClusterLayer(layer, sourceImageData, elapsed) {
  const { width, height, data } = sourceImageData;
  const previousData = previousSourceImageData ? previousSourceImageData.data : null;
  const params = layer.params;
  const targetCtx = layer.runtime.ctx;
  const ghostCtx = layer.runtime.ghostCtx;
  const intenseTrack = layer.type === "clusterTrack";
  const clusterOnly = layer.type === "clusterOnly" || intenseTrack;
  const preset = getQualityPreset();
  const step = Math.max(2, Math.round((5 - Math.min(params.grit, 1.35) * 0.75 - params.clusterQuantity * 1.6) * preset.clusterStepScale));
  const clusterSpan = Math.max(8, Math.round(10 + params.clusterSize * 24 + (1 - params.clusterQuantity) * 14));
  const clusters = new Map();

  targetCtx.clearRect(0, 0, width, height);
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";

  const lumaAt = (buffer, x, y) => {
    const px = clamp(x, 0, width - 1);
    const py = clamp(y, 0, height - 1);
    const index = (py * width + px) * 4;
    return buffer[index] * 0.299 + buffer[index + 1] * 0.587 + buffer[index + 2] * 0.114;
  };

  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const edgeX = lumaAt(data, x + 1, y) - lumaAt(data, x - 1, y);
      const edgeY = lumaAt(data, x, y + 1) - lumaAt(data, x, y - 1);
      const luma = lumaAt(data, x, y);
      const edge = Math.abs(edgeX) + Math.abs(edgeY);
      const motion = previousData ? Math.abs(lumaAt(data, x, y) - lumaAt(previousData, x, y)) : 0;
      const lightMask = clamp((luma - 150) / 105, 0, 1);
      const density = edge * (0.58 + lightMask * 1.15) + motion * (clusterOnly ? 1.6 : 1.05) + lightMask * 84 - params.reduceBlack * 18;
      if (density < (clusterOnly ? 20 : 30) || lightMask < (clusterOnly ? 0.02 : 0.08)) {
        continue;
      }

      const normalized = clamp((density - (clusterOnly ? 20 : 30)) / (clusterOnly ? 120 : 104), 0, 1);
      const key = `${Math.floor(x / clusterSpan)}:${Math.floor(y / clusterSpan)}`;
      const cluster = clusters.get(key) || {
        sumX: 0,
        sumY: 0,
        weightSum: 0,
        edgeSum: 0,
        motionSum: 0,
        count: 0,
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
        peak: 0,
        lightSum: 0,
      };
      cluster.sumX += x * normalized;
      cluster.sumY += y * normalized;
      cluster.weightSum += normalized;
      cluster.edgeSum += edge * normalized;
      cluster.motionSum += motion * (0.2 + normalized);
      cluster.count += 1;
      cluster.minX = Math.min(cluster.minX, x);
      cluster.minY = Math.min(cluster.minY, y);
      cluster.maxX = Math.max(cluster.maxX, x);
      cluster.maxY = Math.max(cluster.maxY, y);
      cluster.peak = Math.max(cluster.peak, density);
      cluster.lightSum += lightMask;
      clusters.set(key, cluster);
    }
  }

  const candidates = Array.from(clusters.values())
    .map((cluster) => {
      const weight = Math.max(cluster.count, 1);
      const centerWeight = Math.max(cluster.weightSum, 0.001);
      const light = clamp(cluster.lightSum / weight, 0, 1);
      const energy = clamp((cluster.edgeSum / weight + cluster.motionSum / weight) / 140, 0, 1);
      const boxWidth = Math.max(4, cluster.maxX - cluster.minX + clusterSpan * (0.12 + params.clusterShape * 0.26));
      const boxHeight = Math.max(4, cluster.maxY - cluster.minY + clusterSpan * (0.12 + params.clusterShape * 0.26));
      const centerX = cluster.sumX / centerWeight;
      const centerY = cluster.sumY / centerWeight;
      const score = (energy * 0.8 + light * 0.9) * (0.8 + Math.min(cluster.count, 14) * 0.08) * (0.6 + cluster.peak / 120);
      return {
        x: centerX,
        y: centerY,
        width: Math.min(width * 0.08, boxWidth),
        height: Math.min(height * 0.08, boxHeight),
        energy,
        light,
        score,
        count: cluster.count,
      };
    })
    .filter((cluster) => cluster.count >= (clusterOnly ? 1 : 2) && cluster.energy >= (clusterOnly ? 0.06 : 0.12))
    .sort((a, b) => b.score - a.score);

  const selected = [];
  const maxClusters = Math.max(12, Math.round((16 + params.clusterQuantity * (intenseTrack ? 180 : clusterOnly ? 92 : 54)) * preset.clusterLimitScale));
  candidates.forEach((candidate) => {
    if (selected.length >= maxClusters) {
      return;
    }
    const overlaps = selected.some((existing) => {
      const dx = Math.abs(existing.x - candidate.x);
      const dy = Math.abs(existing.y - candidate.y);
      return dx < (existing.width + candidate.width) * 0.32 && dy < (existing.height + candidate.height) * 0.32;
    });
    if (!overlaps) {
      selected.push(candidate);
    }
  });

  if (params.showLines && selected.length > 1) {
    targetCtx.save();
    targetCtx.strokeStyle = intenseTrack ? "rgba(198,255,236,0.28)" : "rgba(211,255,229,0.2)";
    targetCtx.lineWidth = intenseTrack ? 1.2 : 0.8;
    for (let index = 1; index < selected.length; index += 1) {
      const previous = selected[index - 1];
      const current = selected[index];
      targetCtx.beginPath();
      targetCtx.moveTo(previous.x, previous.y);
      targetCtx.lineTo(current.x, current.y);
      targetCtx.stroke();
    }
    targetCtx.restore();
  }

  const drawTrackedBox = (cluster, index) => {
    const halfWidth = cluster.width * 0.5;
    const halfHeight = cluster.height * 0.5;
    const x = cluster.x - halfWidth;
    const y = cluster.y - halfHeight;
    const corner = Math.max(2, Math.min(cluster.width, cluster.height) * 0.22);
    const lineWidth = intenseTrack ? 0.9 + cluster.light * 0.7 : clusterOnly ? 1.2 + cluster.energy * 0.8 : 0.8 + cluster.energy * 0.7;
    const alpha = intenseTrack ? 0.58 + cluster.light * 0.28 : clusterOnly ? 0.72 + cluster.energy * 0.14 : 0.38 + cluster.energy * 0.22;
    const glow = intenseTrack ? 0.26 + cluster.light * 0.14 : clusterOnly ? 0.22 + cluster.energy * 0.1 : 0.12 + cluster.energy * 0.08;
    const stroke = intenseTrack ? "198, 255, 236" : clusterOnly ? "255, 238, 224" : "211, 255, 229";

    targetCtx.save();
    targetCtx.strokeStyle = `rgba(${stroke}, ${alpha})`;
    targetCtx.lineWidth = lineWidth;
    targetCtx.shadowColor = `rgba(${stroke}, ${glow})`;
    targetCtx.shadowBlur = clusterOnly ? 14 : 8;
    targetCtx.strokeRect(x, y, cluster.width, cluster.height);

    targetCtx.beginPath();
    targetCtx.moveTo(x, y + corner);
    targetCtx.lineTo(x, y);
    targetCtx.lineTo(x + corner, y);
    targetCtx.moveTo(x + cluster.width - corner, y);
    targetCtx.lineTo(x + cluster.width, y);
    targetCtx.lineTo(x + cluster.width, y + corner);
    targetCtx.moveTo(x + cluster.width, y + cluster.height - corner);
    targetCtx.lineTo(x + cluster.width, y + cluster.height);
    targetCtx.lineTo(x + cluster.width - corner, y + cluster.height);
    targetCtx.moveTo(x + corner, y + cluster.height);
    targetCtx.lineTo(x, y + cluster.height);
    targetCtx.lineTo(x, y + cluster.height - corner);
    targetCtx.stroke();

    if (clusterOnly) {
      targetCtx.fillStyle = `rgba(${stroke}, ${intenseTrack ? 0.12 : 0.06})`;
      targetCtx.fillRect(x, y, cluster.width, cluster.height);
    }

    if (params.showCoordinates) {
      targetCtx.fillStyle = `rgba(${stroke}, 0.88)`;
      targetCtx.font = '9px "IBM Plex Mono", monospace';
      targetCtx.textAlign = "left";
      targetCtx.fillText(`${Math.round(cluster.x)},${Math.round(cluster.y)}`, x + 2, y - 3 - (index % 2) * 10);
    }
    targetCtx.restore();
  };

  selected.forEach(drawTrackedBox);

  targetCtx.save();
  targetCtx.globalCompositeOperation = "screen";
  targetCtx.globalAlpha = intenseTrack ? 0.28 : clusterOnly ? 0.26 : 0.14;
  targetCtx.filter = `blur(${intenseTrack ? 0.9 : clusterOnly ? 1.2 : 0.8}px)`;
  ghostCtx.clearRect(0, 0, width, height);
  ghostCtx.drawImage(targetCtx.canvas, 0, 0);
  targetCtx.drawImage(layer.runtime.ghostCanvas, 0, 0);
  targetCtx.restore();
}

function renderMonitorLayer(layer, sourceImageData, elapsed) {
  const { width, height, data } = sourceImageData;
  const targetCtx = layer.runtime.ctx;
  const glowCtx = layer.runtime.ghostCtx;
  const output = new Uint8ClampedArray(data.length);
  const phase = elapsed * 1.8;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const luma = (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114) / 255;
      const curve = Math.pow(luma, 0.86);
      const dotMask = 0.78 + Math.sin((x + phase * 8) * 0.85) * 0.08 + Math.cos((y - phase * 4) * 0.32) * 0.06;
      const triad = x % 3 === 0 ? 1.08 : x % 3 === 1 ? 0.94 : 0.82;
      const scanMask = y % 4 === 0 ? 0.72 : y % 2 === 0 ? 0.9 : 1;
      const vignetteX = 1 - Math.pow((x / Math.max(1, width - 1)) * 2 - 1, 2) * 0.18;
      const vignetteY = 1 - Math.pow((y / Math.max(1, height - 1)) * 2 - 1, 2) * 0.24;
      const noise = (Math.sin((x + 3) * 12.9898 + (y + 7) * 78.233 + elapsed * 24) * 43758.5453) % 1;
      const glow = clamp(curve * 1.16 * dotMask * triad * scanMask * vignetteX * vignetteY + noise * 0.025, 0, 1);
      const green = Math.round(glow * 255);
      output[index] = Math.round(green * 0.18);
      output[index + 1] = Math.round(clamp(green * 1.05 + 18, 0, 255));
      output[index + 2] = Math.round(green * 0.24);
      output[index + 3] = 255;
    }
  }

  targetCtx.clearRect(0, 0, width, height);
  targetCtx.putImageData(new ImageData(output, width, height), 0, 0);

  glowCtx.clearRect(0, 0, width, height);
  glowCtx.drawImage(targetCtx.canvas, 0, 0);

  targetCtx.save();
  targetCtx.globalCompositeOperation = "screen";
  targetCtx.globalAlpha = 0.62;
  targetCtx.filter = "blur(4px)";
  targetCtx.drawImage(layer.runtime.ghostCanvas, 0, 0);
  targetCtx.filter = "none";
  targetCtx.globalAlpha = 0.18;
  targetCtx.fillStyle = "rgba(72, 255, 124, 0.9)";
  targetCtx.fillRect(0, 0, width, height);
  targetCtx.restore();

  targetCtx.save();
  targetCtx.globalAlpha = 0.22;
  for (let y = 0; y < height; y += 3) {
    targetCtx.fillStyle = y % 6 === 0 ? "rgba(0, 0, 0, 0.38)" : "rgba(98, 255, 148, 0.04)";
    targetCtx.fillRect(0, y, width, 1);
  }
  targetCtx.restore();
}

function renderCrtLayer(layer, sourceImageData) {
  const targetCtx = layer.runtime.ctx;
  const { width, height } = targetCtx.canvas;
  targetCtx.clearRect(0, 0, width, height);
  const preset = getQualityPreset();

  const rgbShift = layer.params.rgb * width;
  const glow = layer.params.glow;
  const scanStrength = layer.params.scan;
  const edgeGlow = layer.params.edgeGlow || 0;

  if (glow > 0) {
    targetCtx.save();
    targetCtx.globalCompositeOperation = "screen";
    targetCtx.globalAlpha = Math.min(0.36, glow * 0.18);
    targetCtx.filter = `blur(${Math.max(0.1, glow * 3)}px)`;
    targetCtx.drawImage(sourceCanvas, 0, 0);
    targetCtx.fillStyle = `rgba(116, 71, 255, ${Math.min(0.18, glow * 0.08)})`;
    targetCtx.fillRect(0, 0, width, height);
    targetCtx.restore();
  }

  if (rgbShift > 0.1) {
    targetCtx.save();
    targetCtx.globalCompositeOperation = "lighter";
    targetCtx.globalAlpha = 0.16;
    targetCtx.drawImage(sourceCanvas, -rgbShift, 0);
    targetCtx.globalCompositeOperation = "multiply";
    targetCtx.fillStyle = "rgba(116, 71, 255, 0.62)";
    targetCtx.fillRect(0, 0, width, height);
    targetCtx.globalCompositeOperation = "screen";
    targetCtx.globalAlpha = 0.14;
    targetCtx.drawImage(sourceCanvas, rgbShift, 0);
    targetCtx.restore();
  }

  if (scanStrength > 0) {
    targetCtx.save();
    targetCtx.globalAlpha = scanStrength * 0.85;
    for (let y = 0; y < height; y += 4) {
      targetCtx.fillStyle = `rgba(0,0,0,${0.14 + ((y / 4 + Math.floor(performance.now() / 50)) % 2) * 0.08})`;
      targetCtx.fillRect(0, y, width, 1);
    }
    targetCtx.restore();
  }

  if (edgeGlow > 0) {
    const blockSize = Math.max(3, Math.round((3 + edgeGlow * 11) * preset.edgeBlockScale));
    const edgeImage = sourceImageData || sourceCtx.getImageData(0, 0, width, height);
    const edgeOutput = new Uint8ClampedArray(edgeImage.data.length);

    const lumaAt = (x, y) => {
      const px = clamp(x, 0, width - 1);
      const py = clamp(y, 0, height - 1);
      const index = (py * width + px) * 4;
      return (
        edgeImage.data[index] * 0.299 +
        edgeImage.data[index + 1] * 0.587 +
        edgeImage.data[index + 2] * 0.114
      );
    };

    for (let by = 0; by < height; by += blockSize) {
      for (let bx = 0; bx < width; bx += blockSize) {
        const sampleX = Math.min(width - 2, bx + Math.floor(blockSize * 0.5));
        const sampleY = Math.min(height - 2, by + Math.floor(blockSize * 0.5));
        const edgeX = Math.abs(lumaAt(sampleX + 1, sampleY) - lumaAt(sampleX - 1, sampleY));
        const edgeY = Math.abs(lumaAt(sampleX, sampleY + 1) - lumaAt(sampleX, sampleY - 1));
        const edgeStrength = clamp((edgeX + edgeY) / 180, 0, 1);
        if (edgeStrength <= 0.08) {
          continue;
        }

        const glowAlpha = Math.round(clamp(edgeStrength * (0.5 + edgeGlow * 1.4), 0, 1) * 255);
        const maxY = Math.min(height, by + blockSize);
        const maxX = Math.min(width, bx + blockSize);
        for (let y = by; y < maxY; y += 1) {
          for (let x = bx; x < maxX; x += 1) {
            const index = (y * width + x) * 4;
            edgeOutput[index] = 116;
            edgeOutput[index + 1] = 71;
            edgeOutput[index + 2] = 255;
            edgeOutput[index + 3] = glowAlpha;
          }
        }
      }
    }

    layer.runtime.auxCtx.clearRect(0, 0, width, height);
    layer.runtime.auxCtx.putImageData(new ImageData(edgeOutput, width, height), 0, 0);
    targetCtx.save();
    targetCtx.globalCompositeOperation = "screen";
    targetCtx.globalAlpha = 0.35 + edgeGlow * 0.5;
    targetCtx.filter = `blur(${Math.max(0.2, edgeGlow * 4)}px)`;
    targetCtx.drawImage(layer.runtime.auxCanvas, 0, 0);
    targetCtx.filter = "none";
    targetCtx.globalAlpha = 0.6 + edgeGlow * 0.3;
    targetCtx.drawImage(layer.runtime.auxCanvas, 0, 0);
    targetCtx.restore();
  }
}

function renderPresetLayer(layer, sourceImageData, elapsed) {
  const processed = buildPresetImage(sourceImageData, elapsed, layer);
  layer.runtime.ctx.clearRect(0, 0, processed.width, processed.height);
  layer.runtime.ctx.putImageData(processed, 0, 0);

  if (layer.type === "blu") {
    layer.runtime.ctx.save();
    layer.runtime.ctx.globalAlpha = 0.22 + layer.params.grit * 0.18;
    for (let y = 0; y < layer.runtime.canvas.height; y += 3) {
      layer.runtime.ctx.fillStyle = y % 6 === 0 ? "rgba(0,18,42,0.35)" : "rgba(255,255,255,0.04)";
      layer.runtime.ctx.fillRect(0, y, layer.runtime.canvas.width, 1);
    }
    layer.runtime.ctx.restore();
  }

  layer.runtime.ghostCtx.clearRect(0, 0, layer.runtime.canvas.width, layer.runtime.canvas.height);
  layer.runtime.ghostCtx.drawImage(layer.runtime.canvas, 0, 0);
}

function renderInfraredLayer(layer, sourceImageData, elapsed) {
  const processed = buildInfraredImage(sourceImageData, elapsed, layer);
  const targetCtx = layer.runtime.ctx;
  const ghostCtx = layer.runtime.ghostCtx;

  targetCtx.clearRect(0, 0, processed.width, processed.height);
  targetCtx.putImageData(processed, 0, 0);

  ghostCtx.clearRect(0, 0, layer.runtime.canvas.width, layer.runtime.canvas.height);
  ghostCtx.drawImage(layer.runtime.canvas, 0, 0);

  targetCtx.save();
  targetCtx.globalCompositeOperation = "screen";
  targetCtx.globalAlpha = 0.22;
  targetCtx.filter = "blur(5px)";
  targetCtx.drawImage(layer.runtime.ghostCanvas, 0, 0);
  targetCtx.filter = "none";
  targetCtx.globalAlpha = 0.12;
  for (let y = 0; y < layer.runtime.canvas.height; y += 3) {
    targetCtx.fillStyle = y % 6 === 0 ? "rgba(16, 8, 10, 0.26)" : "rgba(255, 255, 255, 0.03)";
    targetCtx.fillRect(0, y, layer.runtime.canvas.width, 1);
  }
  targetCtx.restore();
}

function renderDetectLayer(layer, sourceImageData) {
  const { width, height, data } = sourceImageData;
  const previousData = previousSourceImageData?.data;
  const targetCtx = layer.runtime.ctx;
  const ghostCtx = layer.runtime.ghostCtx;
  const auxCtx = layer.runtime.auxCtx;
  const detectState = layer.runtime.detectState;
  const preset = getQualityPreset();
  const blockSize = Math.max(2, Math.round(preset.detectBlock));
  const threshold = clamp(layer.params.threshold || 0.18, 0, 0.96);
  const decay = clamp(layer.params.decay || 0.52, 0, 0.95);
  const trigger = clamp(layer.params.trigger || 0.18, 0, 1);
  const output = new Uint8ClampedArray(data.length);
  let totalActivity = 0;
  let blockCount = 0;

  targetCtx.clearRect(0, 0, width, height);
  auxCtx.clearRect(0, 0, width, height);

  if (!previousData) {
    detectState.history.length = 0;
    detectState.activeAverage = 0;
    ghostCtx.clearRect(0, 0, width, height);
    return;
  }

  const lumaAt = (buffer, x, y) => {
    const px = clamp(x, 0, width - 1);
    const py = clamp(y, 0, height - 1);
    const index = (py * width + px) * 4;
    return buffer[index] * 0.299 + buffer[index + 1] * 0.587 + buffer[index + 2] * 0.114;
  };

  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      const sampleA = [bx + blockSize * 0.25, by + blockSize * 0.25];
      const sampleB = [bx + blockSize * 0.75, by + blockSize * 0.75];
      const currentLuma = (lumaAt(data, sampleA[0], sampleA[1]) + lumaAt(data, sampleB[0], sampleA[1]) + lumaAt(data, sampleA[0], sampleB[1]) + lumaAt(data, sampleB[0], sampleB[1])) * 0.25;
      const previousLuma = (lumaAt(previousData, sampleA[0], sampleA[1]) + lumaAt(previousData, sampleB[0], sampleA[1]) + lumaAt(previousData, sampleA[0], sampleB[1]) + lumaAt(previousData, sampleB[0], sampleB[1])) * 0.25;
      const activity = clamp((Math.abs(currentLuma - previousLuma) / 255 - threshold) / Math.max(0.001, 1 - threshold), 0, 1);

      blockCount += 1;
      totalActivity += activity;
      if (activity <= 0.001) {
        continue;
      }

      const sampleIndex = (Math.min(height - 1, Math.round(by + blockSize * 0.5)) * width + Math.min(width - 1, Math.round(bx + blockSize * 0.5))) * 4;
      const sourceRed = data[sampleIndex] / 255;
      const tone = hslToRgb(0.01 + activity * 0.09, 0.94, clamp(0.18 + activity * 0.46 + sourceRed * 0.1, 0, 0.92));
      const alpha = Math.round(clamp(activity * (0.8 + sourceRed * 0.4), 0, 1) * 255);
      const maxY = Math.min(height, by + blockSize);
      const maxX = Math.min(width, bx + blockSize);

      for (let y = by; y < maxY; y += 1) {
        for (let x = bx; x < maxX; x += 1) {
          const index = (y * width + x) * 4;
          output[index] = tone.r;
          output[index + 1] = tone.g;
          output[index + 2] = tone.b;
          output[index + 3] = alpha;
        }
      }
    }
  }

  detectState.history.push(blockCount ? totalActivity / blockCount : 0);
  if (detectState.history.length > 30) {
    detectState.history.shift();
  }
  detectState.activeAverage = detectState.history.reduce((sum, value) => sum + value, 0) / Math.max(1, detectState.history.length);

  auxCtx.putImageData(new ImageData(output, width, height), 0, 0);

  if (decay > 0) {
    targetCtx.save();
    targetCtx.globalAlpha = 0.32 + decay * 0.44;
    targetCtx.filter = `blur(${Math.max(0.2, decay * 2.6)}px)`;
    targetCtx.drawImage(layer.runtime.ghostCanvas, 0, 0);
    targetCtx.filter = "none";
    targetCtx.restore();
  }

  targetCtx.save();
  targetCtx.globalCompositeOperation = "screen";
  targetCtx.globalAlpha = 0.96;
  targetCtx.drawImage(layer.runtime.auxCanvas, 0, 0);
  targetCtx.globalAlpha = 0.3;
  targetCtx.filter = `blur(${Math.max(0.2, 1 + decay * 3)}px)`;
  targetCtx.drawImage(layer.runtime.auxCanvas, 0, 0);
  targetCtx.filter = "none";
  targetCtx.restore();

  if (detectState.activeAverage > trigger) {
    const alertSize = Math.max(28, Math.round(Math.min(width, height) * 0.085));
    targetCtx.save();
    targetCtx.fillStyle = "rgba(255, 38, 12, 0.92)";
    targetCtx.fillRect(0, 0, alertSize, alertSize);
    targetCtx.strokeStyle = "rgba(255, 242, 230, 0.65)";
    targetCtx.lineWidth = 1;
    targetCtx.strokeRect(0.5, 0.5, alertSize - 1, alertSize - 1);
    targetCtx.restore();
  }

  ghostCtx.clearRect(0, 0, width, height);
  ghostCtx.drawImage(targetCtx.canvas, 0, 0);
}

function applyEditorPass(targetCtx, params, runtime) {
  const width = targetCtx.canvas.width;
  const height = targetCtx.canvas.height;
  const imageData = targetCtx.getImageData(0, 0, width, height);
  const source = imageData.data;
  const output = new Uint8ClampedArray(source.length);
  const brightnessOffset = params.brightness * 255;

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
        let value = center + (center - blur) * params.sharpness * 1.35;
        value = (value - 128) * params.contrast + 128;
        value += brightnessOffset;
        value += params.highlights * lightMask * 42;
        value += params.shadows * shadowMask * 38;
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

  if (params.edgeGlow > 0 && runtime?.auxCtx) {
    const preset = getQualityPreset();
    const passImage = targetCtx.getImageData(0, 0, width, height);
    const edgeOutput = new Uint8ClampedArray(passImage.data.length);
    const sample = (x, y) => {
      const px = clamp(x, 0, width - 1);
      const py = clamp(y, 0, height - 1);
      const index = (py * width + px) * 4;
      return passImage.data[index] * 0.299 + passImage.data[index + 1] * 0.587 + passImage.data[index + 2] * 0.114;
    };

    const blockSize = Math.max(2, Math.round((2 + params.edgeGlow * 7) * preset.edgeBlockScale));
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

        const alpha = Math.round(clamp(edgeStrength * (0.42 + params.edgeGlow), 0, 1) * 255);
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
    targetCtx.globalAlpha = 0.34 + params.edgeGlow * 0.26;
    targetCtx.filter = `blur(${Math.max(0.2, params.edgeGlow * 5)}px)`;
    targetCtx.drawImage(runtime.auxCanvas, 0, 0);
    targetCtx.filter = "none";
    targetCtx.globalAlpha = 0.52 + params.edgeGlow * 0.2;
    targetCtx.drawImage(runtime.auxCanvas, 0, 0);
    targetCtx.restore();
  }

  if (params.crtGlow > 0 && runtime?.auxCtx) {
    runtime.auxCtx.clearRect(0, 0, width, height);
    runtime.auxCtx.drawImage(targetCtx.canvas, 0, 0);
    targetCtx.save();
    targetCtx.globalCompositeOperation = "screen";
    targetCtx.globalAlpha = Math.min(0.8, params.crtGlow * 0.34);
    targetCtx.filter = `blur(${Math.max(0.3, params.crtGlow * 6)}px)`;
    targetCtx.drawImage(runtime.auxCanvas, 0, 0);
    targetCtx.filter = "none";
    targetCtx.globalAlpha = 0.08 + params.crtGlow * 0.1;
    targetCtx.fillStyle = "rgba(84, 255, 132, 0.9)";
    targetCtx.fillRect(0, 0, width, height);
    targetCtx.restore();

    targetCtx.save();
    targetCtx.globalAlpha = Math.min(0.55, params.crtGlow * 0.32);
    for (let y = 0; y < height; y += 3) {
      targetCtx.fillStyle = y % 6 === 0 ? "rgba(0,0,0,0.2)" : "rgba(106,255,156,0.035)";
      targetCtx.fillRect(0, y, width, 1);
    }
    targetCtx.restore();
  }

  if (runtime?.ghostCtx) {
    runtime.ghostCtx.clearRect(0, 0, width, height);
    runtime.ghostCtx.drawImage(targetCtx.canvas, 0, 0);
    runtime.ghostCtx.globalAlpha = 1;
  }
}

function renderLayer(layer, sourceImageData, elapsed) {
  if (layer.type === "video") {
    layer.runtime.ctx.clearRect(0, 0, layer.runtime.canvas.width, layer.runtime.canvas.height);
    layer.runtime.ctx.drawImage(sourceCanvas, 0, 0);
    return;
  }

  if (layer.type === "crt") {
    renderCrtLayer(layer, sourceImageData);
    return;
  }

  if (layer.type === "cluster") {
    if (!sourceImageData) {
      return;
    }
    renderClusterLayer(layer, sourceImageData, elapsed);
    return;
  }

  if (layer.type === "clusterOnly" || layer.type === "clusterTrack") {
    if (!sourceImageData) {
      return;
    }
    renderClusterLayer(layer, sourceImageData, elapsed);
    return;
  }

  if (layer.type === "monitor") {
    if (!sourceImageData) {
      return;
    }
    renderMonitorLayer(layer, sourceImageData, elapsed);
    return;
  }

  if (layer.type === "infrared") {
    if (!sourceImageData) {
      return;
    }
    renderInfraredLayer(layer, sourceImageData, elapsed);
    return;
  }

  if (layer.type === "detect") {
    if (!sourceImageData) {
      return;
    }
    renderDetectLayer(layer, sourceImageData);
    return;
  }

  if (layer.type === "black" || layer.type === "blu") {
    if (!sourceImageData) {
      return;
    }
    renderPresetLayer(layer, sourceImageData, elapsed);
  }
}

function compositeLayer(layer) {
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
    applyEditorPass(scratchCtx, layer.params, layer.runtime);
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

function renderCompositeFrame(elapsed) {
  compositeCtx.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
  compositeCtx.fillStyle = "#000000";
  compositeCtx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);

  const activeLayers = getLayers().filter((layer) => layer.visible && layer.opacity > 0);
  const needsAnalysis = activeLayers.some(layerNeedsSourceImageData);
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

  if (splitScreenEnabled) {
    const halfWidth = canvas.width / 2;
    drawSourceCover(compositeCanvas, ctx, 0, 0, halfWidth, canvas.height);
    drawSourceCover(sourceCanvas, ctx, halfWidth, 0, halfWidth, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(Math.round(halfWidth) - 1, 0, 2, canvas.height);
  } else {
    ctx.drawImage(compositeCanvas, 0, 0);
  }
}

function renderFrame(timestamp = 0) {
  if (!sourceVideo.videoWidth || !sourceVideo.videoHeight) {
    renderHandle = 0;
    return;
  }

  const frameInterval = 1000 / targetFps;
  if (lastRenderAt && timestamp - lastRenderAt < frameInterval) {
    renderHandle = requestAnimationFrame(renderFrame);
    return;
  }
  lastRenderAt = timestamp;

  drawVideoFit(sourceVideo, sourceCtx);
  renderCompositeFrame(timestamp / 1000);
  drawOutputFrame();
  renderHandle = requestAnimationFrame(renderFrame);
}

function ensureLoop() {
  if (!renderHandle) {
    renderHandle = requestAnimationFrame(renderFrame);
  }
}

function stopLoop() {
  cancelAnimationFrame(renderHandle);
  renderHandle = 0;
  lastRenderAt = 0;
}

function updateSplitButton() {
  splitButton.classList.toggle("active", splitScreenEnabled);
}

function revokeActiveUrl() {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

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
  ensureLoop();

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
  setStatus("Video effects reset.");
}

async function exportLoop() {
  if (isRecording) {
    return;
  }

  if (!sourceVideo.src) {
    setStatus("Upload a video first.");
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

  isRecording = true;
  exportButton.disabled = true;
  setStatus("Recording 7 second composite loop...");
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  recorder.onerror = () => {
    isRecording = false;
    exportButton.disabled = false;
    stream.getTracks().forEach((track) => track.stop());
    setStatus("Recording failed.");
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "crtvideo-loop.webm";
    anchor.click();
    URL.revokeObjectURL(url);
    stream.getTracks().forEach((track) => track.stop());
    isRecording = false;
    exportButton.disabled = false;
    setStatus("Export complete. Downloaded `crtvideo-loop.webm`.");
  };

  sourceVideo.currentTime = 0;
  try {
    await sourceVideo.play();
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    isRecording = false;
    exportButton.disabled = false;
    setStatus("Playback is blocked. Press Play / Pause once and try export again.");
    return;
  }

  recorder.start();
  window.setTimeout(() => {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }, LOOP_DURATION * 1000);
}

uploadButton.addEventListener("click", () => {
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
  splitScreenEnabled = !splitScreenEnabled;
  updateSplitButton();
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

[
  [brightnessSlider, "brightness"],
  [contrastSlider, "contrast"],
  [highlightsSlider, "highlights"],
  [shadowsSlider, "shadows"],
  [sharpnessSlider, "sharpness"],
  [editorEdgeGlowSlider, "edgeGlow"],
  [crtGlowSlider, "crtGlow"],
].forEach(([slider, key]) => {
  slider.addEventListener("input", () => {
    markControlTouched(slider);
    const layer = layerEditor.getEditorLayer();
    if (!layer) {
      return;
    }
    layer.params[key] = Number(slider.value);
    const outputMap = {
      brightness: brightnessOutput,
      contrast: contrastOutput,
      highlights: highlightsOutput,
      shadows: shadowsOutput,
      sharpness: sharpnessOutput,
      edgeGlow: editorEdgeGlowOutput,
      crtGlow: crtGlowOutput,
    };
    setOutput(outputMap[key], layer.params[key]);
    layerEditor.syncControlsFromSelection();
  });
});

[
  brightnessSlider,
  contrastSlider,
  highlightsSlider,
  shadowsSlider,
  sharpnessSlider,
  editorEdgeGlowSlider,
  crtGlowSlider,
].forEach((slider) => {
  slider.addEventListener("pointerdown", () => {
    markControlTouched(slider);
  });
});

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
    editorEdgeGlowSlider,
    crtGlowSlider,
    brightnessOutput,
    contrastOutput,
    highlightsOutput,
    shadowsOutput,
    sharpnessOutput,
    editorEdgeGlowOutput,
    crtGlowOutput,
  },
  createLayerRuntime,
  getCanvasSize: () => ({ width: canvas.width || 1280, height: canvas.height || 720 }),
  hasSource: () => Boolean(sourceVideo.src),
  setStatus,
  setOutput,
  markControlTouched,
  trackLayerAdd: () => {},
  disposeLayerRuntime: () => {},
});
extendLayerEditorForExtraEffects(layerEditor);
initializeEditorExtraControls();

window.addEventListener("beforeunload", () => {
  volumeController.setAvailable(false);
  stopReversePlayback();
  stopLoop();
  revokeActiveUrl();
});

layerEditor.renderLayerList();
layerEditor.syncControlsFromSelection();
updateSplitButton();
updateQualityMeta();
