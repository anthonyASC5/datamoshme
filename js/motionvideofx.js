// Core math and color helpers are shared by every effect pass in this file. They keep the later
// renderers focused on look-dev logic instead of repeating low-level clamp, mix, and conversion code.
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

function wrapUnit(value) {
  return ((value % 1) + 1) % 1;
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
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
  const hueToChannel = (offset) => {
    const t = wrapUnit(h + offset);
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  };

  return {
    r: Math.round(hueToChannel(1 / 3) * 255),
    g: Math.round(hueToChannel(0) * 255),
    b: Math.round(hueToChannel(-1 / 3) * 255),
  };
}

function rgbToHsv(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta > 0) {
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
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function rgbToYCrCb(r, g, b) {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cr: (r - (0.299 * r + 0.587 * g + 0.114 * b)) * 0.713 + 128,
    cb: (b - (0.299 * r + 0.587 * g + 0.114 * b)) * 0.564 + 128,
  };
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((digit) => digit + digit).join("")
    : normalized;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgba(color, alpha) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;
}

function mixRgb(colorA, colorB, amount) {
  return {
    r: Math.round(lerp(colorA.r, colorB.r, amount)),
    g: Math.round(lerp(colorA.g, colorB.g, amount)),
    b: Math.round(lerp(colorA.b, colorB.b, amount)),
  };
}

function quantizeChannel(value, levels) {
  if (levels <= 1) {
    return value;
  }
  const scaled = Math.round((clamp(value, 0, 255) / 255) * (levels - 1));
  return Math.round((scaled / (levels - 1)) * 255);
}

function getPixelOffset(width, height, x, y) {
  const sampleX = clamp(Math.round(x), 0, width - 1);
  const sampleY = clamp(Math.round(y), 0, height - 1);
  return (sampleY * width + sampleX) * 4;
}

function hueDistance(a, b) {
  const delta = Math.abs(wrapUnit(a) - wrapUnit(b));
  return Math.min(delta, 1 - delta);
}

function createSlider(key, label, min, max, step, digits = 2) {
  return { key, label, min, max, step, digits };
}

function createToggle(key, label) {
  return { kind: "toggle", key, label };
}

const EFFECT_COLORS = Object.freeze({
  clusterTrack: "#7ff4d8",
  temporalAverage: "#4bc8ff",
  motionThreshold: "#ff5a8e",
  datamoshSmear: "#ff7a64",
  feedbackTrails: "#ffc86d",
  edgeGlow: "#61c8ff",
  filmGrain: "#d8d0be",
  voronoiShading: "#b38cff",
  punchBlackWhite: "#f2f2f2",
  sparseOpticalFlow: "#49ffd3",
  harrisCorners: "#ff72d4",
  orbTracking: "#7ee8ff",
  fastKeypoints: "#ff9e52",
  multiBlob: "#45dcff",
  boundingBoxes: "#ff6f6f",
  skinTone: "#f2c89a",
  greenScreenMotion: "#5dff84",
  colorCentroid: "#ff9fd7",
});

const DEFAULT_BLEND = "screen";
const DEFAULT_TRAIL = 0.28;

// Rack definitions power both the "Add Layer" buttons and the selected-effect slider panel.
// Each entry declares the layer type, its default params, and the inline controls exposed in the UI.
const EFFECT_DEFINITIONS = [
  {
    type: "clusterTrack",
    label: "Cluster Track",
    buttonLabel: "Cluster Track",
    accent: EFFECT_COLORS.clusterTrack,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { threshold: 0.22, detail: 0.58, trail: 0.36, showLabels: true },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
      createToggle("showLabels", "Labels"),
    ],
  },
  {
    type: "temporalAverage",
    label: "Temporal Avg BG",
    buttonLabel: "Temporal Avg BG",
    accent: EFFECT_COLORS.temporalAverage,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { threshold: 0.16, bufferFrames: 18, trail: 0.32 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("bufferFrames", "Buffer", 6, 36, 1, 0),
      createSlider("trail", "Trail", 0, 1, 0.01),
    ],
  },
  {
    type: "motionThreshold",
    label: "Motion Threshold",
    buttonLabel: "Motion Threshold",
    accent: EFFECT_COLORS.motionThreshold,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { threshold: 0.18, detail: 0.52, trail: 0.2 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
    ],
  },
  {
    type: "multiBlob",
    label: "Blob Tracker",
    buttonLabel: "Blob Tracker",
    accent: EFFECT_COLORS.multiBlob,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { threshold: 0.16, detail: 0.54, trail: 0.4 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
    ],
  },
  {
    type: "boundingBoxes",
    label: "Bounding Boxes",
    buttonLabel: "Bounding Boxes",
    accent: EFFECT_COLORS.boundingBoxes,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { threshold: 0.16, detail: 0.56, trail: 0.18 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
    ],
  },
  {
    type: "skinTone",
    label: "Skin Mask",
    buttonLabel: "Skin Mask",
    accent: EFFECT_COLORS.skinTone,
    defaultBlend: "normal",
    defaultParams: {},
    controls: [],
  },
  {
    type: "greenScreenMotion",
    label: "Green Screen",
    buttonLabel: "Green Screen",
    accent: EFFECT_COLORS.greenScreenMotion,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { threshold: 0.14, hueWidth: 0.1, trail: 0.2 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("hueWidth", "Green Width", 0.04, 0.22, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
    ],
  },
  {
    type: "colorCentroid",
    label: "Color Centroid",
    buttonLabel: "Color Centroid",
    accent: EFFECT_COLORS.colorCentroid,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { hue: 0.0, hueWidth: 0.08, trail: 0.5 },
    controls: [
      createSlider("hue", "Hue", 0, 1, 0.01),
      createSlider("hueWidth", "Hue Width", 0.02, 0.25, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
    ],
  },
  {
    type: "datamoshSmear",
    label: "Datamosh Smear",
    buttonLabel: "Datamosh Smear",
    accent: EFFECT_COLORS.datamoshSmear,
    rackDividerLabel: "NEW EFFECTS TESTING",
    defaultBlend: "normal",
    defaultParams: { threshold: 0.14, smear: 0.78, refresh: 0.12, detail: 0.5, signalLoss: 0, emissionRate: 1, lifetime: 0.42 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("smear", "Smear", 0, 1, 0.01),
      createSlider("refresh", "Refresh", 0.02, 0.9, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("signalLoss", "Signal Loss", 0, 1, 0.01),
      createSlider("emissionRate", "Particle Emit", 0.1, 3, 0.01),
      createSlider("lifetime", "Particle Life", 0.05, 1, 0.01),
    ],
  },
  {
    type: "feedbackTrails",
    label: "Feedback Trails",
    buttonLabel: "Feedback Trails",
    accent: EFFECT_COLORS.feedbackTrails,
    defaultBlend: "screen",
    defaultParams: { feedback: 0.86, zoom: 0.22, sourceMix: 0.72, drift: 0.24 },
    controls: [
      createSlider("feedback", "Feedback", 0.1, 0.98, 0.01),
      createSlider("zoom", "Zoom", 0, 1, 0.01),
      createSlider("sourceMix", "Source Mix", 0.02, 1, 0.01),
      createSlider("drift", "Drift", 0, 1, 0.01),
    ],
  },
  {
    type: "edgeGlow",
    label: "Edge Glow",
    buttonLabel: "Edge Glow",
    accent: EFFECT_COLORS.edgeGlow,
    defaultBlend: "screen",
    defaultParams: { threshold: 0.12, darkness: 0.4, glow: 0.82 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("darkness", "Darkness", 0, 1, 0.01),
      createSlider("glow", "Glow", 0, 1, 0.01),
    ],
  },
  {
    type: "filmGrain",
    label: "Film Grain",
    buttonLabel: "Film Grain",
    accent: EFFECT_COLORS.filmGrain,
    defaultBlend: "normal",
    defaultParams: { amount: 0.42, contrast: 0.3, grainSize: 1.4, speed: 0.62 },
    controls: [
      createSlider("amount", "Amount", 0, 1, 0.01),
      createSlider("contrast", "Contrast", 0, 1, 0.01),
      createSlider("grainSize", "Grain Size", 1, 6, 0.1, 1),
      createSlider("speed", "Speed", 0.05, 1, 0.01),
    ],
  },
  {
    type: "voronoiShading",
    label: "Voronoi Shade",
    buttonLabel: "Voronoi Shade",
    accent: EFFECT_COLORS.voronoiShading,
    defaultBlend: "normal",
    defaultParams: { pointCount: 32, cellSize: 8, posterize: 0.58 },
    controls: [
      createSlider("pointCount", "Points", 8, 48, 1, 0),
      createSlider("cellSize", "Cell Size", 4, 20, 1, 0),
      createSlider("posterize", "Posterize", 0, 1, 0.01),
    ],
  },
  {
    type: "punchBlackWhite",
    label: "Punch B&W",
    buttonLabel: "Punch B&W",
    accent: EFFECT_COLORS.punchBlackWhite,
    defaultBlend: "normal",
    defaultParams: { contrast: 0.84, screen: 0.38, crush: 0.44, roughness: 0.26 },
    controls: [
      createSlider("contrast", "Contrast", 0, 1, 0.01),
      createSlider("screen", "Screen", 0, 1, 0.01),
      createSlider("crush", "Crush", 0, 1, 0.01),
      createSlider("roughness", "Roughness", 0, 1, 0.01),
    ],
  },
  // Rack: particle tracker layers.
  {
    type: "sparseOpticalFlow",
    label: "Sparse Flow",
    buttonLabel: "Sparse Flow",
    accent: EFFECT_COLORS.sparseOpticalFlow,
    rackDividerLabel: "Particle Trackers",
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { featureCount: 44, search: 0.55, detail: 0.56, emissionRate: 1, lifetime: 0.4 },
    controls: [
      createSlider("featureCount", "Features", 8, 88, 1, 0),
      createSlider("search", "Search", 0.1, 1, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("emissionRate", "Particle Emit", 0.1, 3, 0.01),
      createSlider("lifetime", "Particle Life", 0.05, 1, 0.01),
    ],
  },
  {
    type: "harrisCorners",
    label: "Harris Corners",
    buttonLabel: "Harris Corners",
    accent: EFFECT_COLORS.harrisCorners,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { featureCount: 54, threshold: 0.18, detail: 0.58, emissionRate: 1, lifetime: 0.4 },
    controls: [
      createSlider("featureCount", "Features", 8, 96, 1, 0),
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("emissionRate", "Particle Emit", 0.1, 3, 0.01),
      createSlider("lifetime", "Particle Life", 0.05, 1, 0.01),
    ],
  },
  {
    type: "orbTracking",
    label: "ORB Tracking",
    buttonLabel: "ORB Tracking",
    accent: EFFECT_COLORS.orbTracking,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { featureCount: 48, threshold: 0.18, detail: 0.54, emissionRate: 1, lifetime: 0.38 },
    controls: [
      createSlider("featureCount", "Features", 8, 84, 1, 0),
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("emissionRate", "Particle Emit", 0.1, 3, 0.01),
      createSlider("lifetime", "Particle Life", 0.05, 1, 0.01),
    ],
  },
  {
    type: "fastKeypoints",
    label: "FAST Keypoints",
    buttonLabel: "FAST Keypoints",
    accent: EFFECT_COLORS.fastKeypoints,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { featureCount: 68, threshold: 0.18, detail: 0.6, emissionRate: 1, lifetime: 0.36 },
    controls: [
      createSlider("featureCount", "Features", 8, 112, 1, 0),
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("emissionRate", "Particle Emit", 0.1, 3, 0.01),
      createSlider("lifetime", "Particle Life", 0.05, 1, 0.01),
    ],
  },
];

const EFFECT_MAP = new Map(EFFECT_DEFINITIONS.map((definition) => [definition.type, definition]));

const MOTION_EFFECT_TYPES = new Set(EFFECT_DEFINITIONS.map((definition) => definition.type));

const FAST_RING = Object.freeze([
  [0, -3], [1, -3], [2, -2], [3, -1],
  [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1],
  [-3, 0], [-3, -1], [-2, -2], [-1, -3],
]);

const BRIEF_PAIRS = Object.freeze([
  [-3, -1, 2, 1], [-2, -3, 1, 2], [0, -4, 0, 4], [-4, 0, 4, 0],
  [-3, 2, 2, -3], [3, 2, -2, -3], [-1, -1, 1, 1], [2, 0, -2, 1],
  [-1, 3, 1, -2], [3, -1, -3, 1], [-2, 1, 2, 2], [1, -2, -1, 2],
  [-4, -1, 3, 0], [-3, 1, 4, -1], [0, -2, 2, 3], [-2, 4, 1, -4],
  [-1, -4, 2, 4], [4, 2, -4, -1], [-3, -3, 3, 3], [-2, 3, 3, -2],
  [-4, 1, 2, -1], [1, 4, -1, -4], [-3, 0, 3, 1], [0, 3, 4, -2],
  [-4, 2, 0, -3], [2, 4, -3, -1], [-1, 2, 4, 0], [3, -3, -2, 2],
  [-4, -2, 4, 2], [-3, 4, 3, -4], [-2, 0, 2, 1], [1, 2, -1, -2],
]);

let sharedAnalysisCache = null;

export const motionVideoEffectDefinitions = EFFECT_DEFINITIONS;

export function layerNeedsMotionSourceImageData(layer) {
  return Boolean(layer?.visible && layer.opacity > 0 && MOTION_EFFECT_TYPES.has(layer.type));
}

function getEffectColor(layer) {
  return hexToRgb(EFFECT_MAP.get(layer.type)?.accent || "#ffffff");
}

// Shared analysis runs once per source frame so all effects can reuse the same luma, motion-diff,
// hue, and mask inputs instead of recomputing them independently for every layer.
function buildSharedAnalysis(sourceImageData, previousSourceImageData) {
  const { width, height, data } = sourceImageData;
  const previousData = previousSourceImageData?.data || null;
  const pixels = width * height;
  const luma = new Float32Array(pixels);
  const previousLuma = previousData ? new Float32Array(pixels) : null;
  const colorDiff = new Uint8Array(pixels);
  let motionTotal = 0;

  for (let index = 0, px = 0; index < pixels; index += 1, px += 4) {
    const currentLuma = data[px] * 0.299 + data[px + 1] * 0.587 + data[px + 2] * 0.114;
    luma[index] = currentLuma;

    if (previousData) {
      const prevLuma = previousData[px] * 0.299 + previousData[px + 1] * 0.587 + previousData[px + 2] * 0.114;
      previousLuma[index] = prevLuma;
      const delta = Math.round((Math.abs(data[px] - previousData[px]) + Math.abs(data[px + 1] - previousData[px + 1]) + Math.abs(data[px + 2] - previousData[px + 2])) / 3);
      colorDiff[index] = delta;
      motionTotal += delta;
    }
  }

  return {
    width,
    height,
    pixels,
    data,
    previousData,
    luma,
    previousLuma,
    colorDiff,
    averageMotion: pixels ? motionTotal / pixels : 0,
    currentFrame: { data, luma, width, height },
    previousFrame: previousData ? { data: previousData, luma: previousLuma, width, height } : null,
    hsv: null,
    ycrcb: null,
    density: null,
    componentCache: new Map(),
  };
}

function getSharedAnalysis(sourceImageData, previousSourceImageData) {
  if (!sourceImageData) {
    return null;
  }

  if (
    sharedAnalysisCache &&
    sharedAnalysisCache.sourceImageData === sourceImageData &&
    sharedAnalysisCache.previousSourceImageData === previousSourceImageData
  ) {
    return sharedAnalysisCache.analysis;
  }

  const analysis = buildSharedAnalysis(sourceImageData, previousSourceImageData);
  sharedAnalysisCache = {
    sourceImageData,
    previousSourceImageData,
    analysis,
  };
  return analysis;
}

function ensureFrameDerivatives(frame) {
  if (!frame || frame.derivatives) {
    return frame?.derivatives || null;
  }

  // The derivative pass creates edge strength and gradients that feed corner detectors,
  // density masks, and glow-like effects later in the pipeline.
  const { width, height, luma } = frame;
  const pixels = width * height;
  const gradX = new Float32Array(pixels);
  const gradY = new Float32Array(pixels);
  const edge = new Uint8Array(pixels);

  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      const gx = (luma[index + 1] - luma[index - 1]) * 0.5;
      const gy = (luma[index + width] - luma[index - width]) * 0.5;
      gradX[index] = gx;
      gradY[index] = gy;
      edge[index] = Math.round(clamp(Math.abs(gx) + Math.abs(gy), 0, 255));
    }
  }

  frame.derivatives = { gradX, gradY, edge };
  return frame.derivatives;
}

function ensureHsv(analysis) {
  if (analysis.hsv) {
    return analysis.hsv;
  }

  const hue = new Float32Array(analysis.pixels);
  const saturation = new Float32Array(analysis.pixels);
  const value = new Float32Array(analysis.pixels);

  for (let index = 0, px = 0; index < analysis.pixels; index += 1, px += 4) {
    const hsv = rgbToHsv(analysis.data[px], analysis.data[px + 1], analysis.data[px + 2]);
    hue[index] = hsv.h;
    saturation[index] = hsv.s;
    value[index] = hsv.v;
  }

  analysis.hsv = { hue, saturation, value };
  return analysis.hsv;
}

function ensureYCrCb(analysis) {
  if (analysis.ycrcb) {
    return analysis.ycrcb;
  }

  const y = new Float32Array(analysis.pixels);
  const cr = new Float32Array(analysis.pixels);
  const cb = new Float32Array(analysis.pixels);

  for (let index = 0, px = 0; index < analysis.pixels; index += 1, px += 4) {
    const converted = rgbToYCrCb(analysis.data[px], analysis.data[px + 1], analysis.data[px + 2]);
    y[index] = converted.y;
    cr[index] = converted.cr;
    cb[index] = converted.cb;
  }

  analysis.ycrcb = { y, cr, cb };
  return analysis.ycrcb;
}

function ensureClusterDensity(analysis) {
  if (analysis.density) {
    return analysis.density;
  }

  const edge = ensureFrameDerivatives(analysis.currentFrame).edge;
  const density = new Float32Array(analysis.pixels);

  for (let index = 0; index < analysis.pixels; index += 1) {
    const lightMask = clamp((analysis.luma[index] - 150) / 105, 0, 1);
    density[index] = clamp(edge[index] * 0.58 + analysis.colorDiff[index] * 1.4 + lightMask * 84, 0, 255);
  }

  analysis.density = density;
  return density;
}

function ensureLayerState(layer, width, height) {
  const runtime = layer.runtime;
  const pixels = width * height;
  if (runtime.motionState?.width === width && runtime.motionState?.height === height) {
    return runtime.motionState;
  }

  // Each effect layer keeps its own analysis history so temporal averages, track trails, and the
  // new persistent particle pools survive frame-to-frame without leaking into other layers.
  runtime.motionState = {
    width,
    height,
    pixels,
    buffers: {},
    temporalFrames: [],
    temporalSum: new Float32Array(pixels),
    tracks: [],
    nextTrackId: 1,
    centroidTrail: [],
    particles: [],
    particleStamp: 0,
  };
  return runtime.motionState;
}

function ensureImageBuffer(state, key, width, height) {
  const existing = state.buffers[key];
  if (existing && existing.width === width && existing.height === height) {
    return existing;
  }

  const data = new Uint8ClampedArray(width * height * 4);
  const imageData = new ImageData(data, width, height);
  const nextBuffer = { width, height, data, imageData };
  state.buffers[key] = nextBuffer;
  return nextBuffer;
}

function getDetailBlockSize(params, preset, multiplier = 1) {
  const detail = clamp(params.detail ?? 0.5, 0, 1);
  const presetScale = preset?.clusterStepScale || 1;
  return Math.max(4, Math.round((20 - detail * 14) * presetScale * multiplier));
}

function beginLayerTrail(layer, trail, composite = "screen") {
  const ctx = layer.runtime.ctx;
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  if (trail <= 0.001) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = 0.1 + trail * 0.28;
  ctx.filter = `blur(${Math.max(0.4, trail * 3.6)}px)`;
  ctx.drawImage(layer.runtime.ghostCanvas, 0, 0);
  ctx.filter = "none";
  ctx.restore();
}

function finishLayerTrail(layer) {
  const ghostCtx = layer.runtime.ghostCtx;
  const { width, height } = layer.runtime.canvas;
  ghostCtx.clearRect(0, 0, width, height);
  ghostCtx.drawImage(layer.runtime.canvas, 0, 0);
}

function renderTintedMask(layer, analysis, mask, {
  bufferKey = "mask",
  trail = DEFAULT_TRAIL,
  blur = 1.5,
  alphaScale = 0.9,
  sourceMix = 0.16,
  composite = "screen",
} = {}) {
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const color = getEffectColor(layer);
  const buffer = ensureImageBuffer(state, bufferKey, analysis.width, analysis.height);

  for (let index = 0, px = 0; index < analysis.pixels; index += 1, px += 4) {
    const intensity = mask[index] / 255;
    if (intensity <= 0.001) {
      buffer.data[px + 3] = 0;
      continue;
    }

    const tint = clamp(intensity, 0, 1);
    buffer.data[px] = Math.round(lerp(color.r, analysis.data[px], sourceMix));
    buffer.data[px + 1] = Math.round(lerp(color.g, analysis.data[px + 1], sourceMix));
    buffer.data[px + 2] = Math.round(lerp(color.b, analysis.data[px + 2], sourceMix));
    buffer.data[px + 3] = Math.round(clamp(tint * alphaScale, 0, 1) * 255);
  }

  layer.runtime.auxCtx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.auxCtx.putImageData(buffer.imageData, 0, 0);

  beginLayerTrail(layer, trail, composite);
  const ctx = layer.runtime.ctx;
  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = 0.98;
  ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
  ctx.globalAlpha = 0.16 + trail * 0.36;
  ctx.filter = `blur(${Math.max(0.6, blur)}px)`;
  ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
  ctx.filter = "none";
  ctx.restore();
  finishLayerTrail(layer);
}

function buildIntensityMask(values, threshold, normalizeMax = 255, includeMask = null, excludeMask = null) {
  const output = new Uint8Array(values.length);
  const thresholdValue = clamp(threshold, 0, normalizeMax);
  const range = Math.max(1, normalizeMax - thresholdValue);

  for (let index = 0; index < values.length; index += 1) {
    if (includeMask && includeMask[index] <= 0) {
      continue;
    }
    if (excludeMask && excludeMask[index] > 0) {
      continue;
    }
    const normalized = clamp((values[index] - thresholdValue) / range, 0, 1);
    output[index] = Math.round(normalized * 255);
  }

  return output;
}

function buildMotionThresholdMask(analysis, params) {
  const thresholdValue = 8 + clamp(params.threshold || 0.18, 0, 1) * 160;
  return buildIntensityMask(analysis.colorDiff, thresholdValue, 255);
}

function buildDensityMask(analysis, params, includeMask = null, excludeMask = null) {
  const density = ensureClusterDensity(analysis);
  const thresholdValue = 18 + clamp(params.threshold || 0.16, 0, 1) * 160;
  return buildIntensityMask(density, thresholdValue, 255, includeMask, excludeMask);
}

function buildHueMask(analysis, {
  hue = 0,
  hueWidth = 0.08,
  minSaturation = 0.28,
  minValue = 0.18,
} = {}) {
  const { hue: hueData, saturation, value } = ensureHsv(analysis);
  const output = new Uint8Array(analysis.pixels);
  const width = clamp(hueWidth, 0.001, 0.5);

  for (let index = 0; index < analysis.pixels; index += 1) {
    if (saturation[index] < minSaturation || value[index] < minValue) {
      continue;
    }
    const distanceToTarget = hueDistance(hueData[index], hue);
    if (distanceToTarget > width) {
      continue;
    }
    output[index] = Math.round((1 - distanceToTarget / width) * 255);
  }

  return output;
}

function buildSkinMask(analysis) {
  const ycrcb = ensureYCrCb(analysis);
  const hsv = ensureHsv(analysis);
  const output = new Uint8Array(analysis.pixels);

  for (let index = 0; index < analysis.pixels; index += 1) {
    const isSkin = ycrcb.cr[index] >= 135 && ycrcb.cr[index] <= 180 && ycrcb.cb[index] >= 85 && ycrcb.cb[index] <= 135;
    const isVisible = hsv.saturation[index] >= 0.12 && hsv.value[index] >= 0.18;
    if (isSkin && isVisible) {
      output[index] = 255;
    }
  }

  return output;
}

function buildGreenMask(analysis, hueWidth = 0.1) {
  return buildHueMask(analysis, {
    hue: 1 / 3,
    hueWidth,
    minSaturation: 0.24,
    minValue: 0.12,
  });
}

function computeCentroid(mask, width, height) {
  let sumX = 0;
  let sumY = 0;
  let weight = 0;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const value = mask[row + x];
      if (!value) {
        continue;
      }
      sumX += x * value;
      sumY += y * value;
      weight += value;
    }
  }

  if (!weight) {
    return null;
  }

  return {
    x: sumX / weight,
    y: sumY / weight,
    weight,
  };
}

function writeMaskedSourceToBuffer(buffer, analysis, mask) {
  for (let index = 0, px = 0; index < analysis.pixels; index += 1, px += 4) {
    const intensity = mask[index] / 255;
    if (intensity > 0) {
      buffer.data[px] = Math.round(analysis.data[px] * intensity);
      buffer.data[px + 1] = Math.round(analysis.data[px + 1] * intensity);
      buffer.data[px + 2] = Math.round(analysis.data[px + 2] * intensity);
    } else {
      buffer.data[px] = 0;
      buffer.data[px + 1] = 0;
      buffer.data[px + 2] = 0;
    }
    buffer.data[px + 3] = 255;
  }
}

function buildActivityGrid(values, width, height, blockSize, normalizer = 255) {
  const gridWidth = Math.ceil(width / blockSize);
  const gridHeight = Math.ceil(height / blockSize);
  const activity = new Float32Array(gridWidth * gridHeight);
  const counts = new Uint16Array(gridWidth * gridHeight);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const gridY = Math.floor(y / blockSize);
    for (let x = 0; x < width; x += 1) {
      const gridX = Math.floor(x / blockSize);
      const gridIndex = gridY * gridWidth + gridX;
      activity[gridIndex] += values[row + x];
      counts[gridIndex] += 1;
    }
  }

  for (let index = 0; index < activity.length; index += 1) {
    activity[index] = counts[index] ? clamp(activity[index] / (counts[index] * normalizer), 0, 1) : 0;
  }

  return { activity, counts, gridWidth, gridHeight };
}

function extractComponentsFromGrid(activity, gridWidth, gridHeight, blockSize, options = {}) {
  // This flood-fills active cells into coherent blobs so tracker effects can work on stable regions
  // instead of noisy per-pixel motion hits.
  const threshold = clamp(options.threshold ?? 0.12, 0, 1);
  const minCells = Math.max(1, Math.round(options.minCells ?? 2));
  const visited = new Uint8Array(activity.length);
  const components = [];

  const neighbors = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  for (let index = 0; index < activity.length; index += 1) {
    if (visited[index] || activity[index] < threshold) {
      continue;
    }

    const queue = [index];
    visited[index] = 1;
    let cursor = 0;
    let sumX = 0;
    let sumY = 0;
    let weight = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let peak = 0;
    const cells = [];

    while (cursor < queue.length) {
      const current = queue[cursor];
      cursor += 1;
      const cellX = current % gridWidth;
      const cellY = Math.floor(current / gridWidth);
      const cellWeight = activity[current];
      const centerX = (cellX + 0.5) * blockSize;
      const centerY = (cellY + 0.5) * blockSize;

      cells.push(current);
      sumX += centerX * cellWeight;
      sumY += centerY * cellWeight;
      weight += cellWeight;
      peak = Math.max(peak, cellWeight);
      minX = Math.min(minX, cellX * blockSize);
      minY = Math.min(minY, cellY * blockSize);
      maxX = Math.max(maxX, (cellX + 1) * blockSize);
      maxY = Math.max(maxY, (cellY + 1) * blockSize);

      neighbors.forEach(([dx, dy]) => {
        const nextX = cellX + dx;
        const nextY = cellY + dy;
        if (nextX < 0 || nextY < 0 || nextX >= gridWidth || nextY >= gridHeight) {
          return;
        }
        const nextIndex = nextY * gridWidth + nextX;
        if (visited[nextIndex] || activity[nextIndex] < threshold) {
          return;
        }
        visited[nextIndex] = 1;
        queue.push(nextIndex);
      });
    }

    if (cells.length < minCells || weight <= 0.001) {
      continue;
    }

    components.push({
      x: sumX / weight,
      y: sumY / weight,
      width: Math.max(blockSize, maxX - minX),
      height: Math.max(blockSize, maxY - minY),
      minX,
      minY,
      maxX,
      maxY,
      weight,
      area: cells.length * blockSize * blockSize,
      peak,
      cells,
      gridWidth,
      blockSize,
    });
  }

  return components.sort((a, b) => (b.area * b.peak) - (a.area * a.peak));
}

function buildComponentsFromValues(analysis, values, blockSize, options = {}) {
  const canCache = values === analysis.density;
  const cacheKey = `${options.cacheKey || "values"}:${blockSize}:${options.threshold ?? 0.12}:${options.minCells ?? 2}`;
  if (canCache && analysis.componentCache.has(cacheKey)) {
    return analysis.componentCache.get(cacheKey);
  }

  const grid = buildActivityGrid(values, analysis.width, analysis.height, blockSize, options.normalizer || 255);
  const components = extractComponentsFromGrid(grid.activity, grid.gridWidth, grid.gridHeight, blockSize, {
    threshold: options.threshold,
    minCells: options.minCells,
  });
  const result = { components, grid };
  if (canCache) {
    analysis.componentCache.set(cacheKey, result);
  }
  return result;
}

function updateTracks(state, detections, options = {}) {
  // Tracker state keeps ids, smoothed positions, and trails stable between frames so the visuals
  // feel anchored to moving subjects instead of flickering as detections jitter around.
  const maxDistance = options.maxDistance || 60;
  const maxMissed = options.maxMissed || 8;
  const smoothing = clamp(options.smoothing ?? 0.45, 0, 1);
  const trailLength = options.trailLength || 18;
  const existing = state.tracks || [];
  const matchedTrackIds = new Set();
  const nextTracks = [];

  detections.forEach((detection) => {
    let bestTrack = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    existing.forEach((track) => {
      if (matchedTrackIds.has(track.id)) {
        return;
      }
      const limit = maxDistance + Math.max(track.width, detection.width) * 0.25;
      const delta = distance(track.x, track.y, detection.x, detection.y);
      if (delta < bestDistance && delta <= limit) {
        bestDistance = delta;
        bestTrack = track;
      }
    });

    if (!bestTrack) {
      bestTrack = {
        id: state.nextTrackId,
        x: detection.x,
        y: detection.y,
        width: detection.width,
        height: detection.height,
        missed: 0,
        trail: [],
      };
      state.nextTrackId += 1;
    } else {
      matchedTrackIds.add(bestTrack.id);
      bestTrack.x = lerp(bestTrack.x, detection.x, 1 - smoothing);
      bestTrack.y = lerp(bestTrack.y, detection.y, 1 - smoothing);
      bestTrack.width = lerp(bestTrack.width, detection.width, 1 - smoothing);
      bestTrack.height = lerp(bestTrack.height, detection.height, 1 - smoothing);
      bestTrack.missed = 0;
    }

    bestTrack.area = detection.area;
    bestTrack.weight = detection.weight;
    bestTrack.peak = detection.peak;
    bestTrack.trail.push({ x: bestTrack.x, y: bestTrack.y });
    if (bestTrack.trail.length > trailLength) {
      bestTrack.trail.shift();
    }
    nextTracks.push(bestTrack);
  });

  existing.forEach((track) => {
    if (matchedTrackIds.has(track.id) || nextTracks.includes(track) || track.missed >= maxMissed) {
      return;
    }
    track.missed += 1;
    nextTracks.push(track);
  });

  state.tracks = nextTracks;
  return nextTracks.filter((track) => track.missed < maxMissed);
}

function drawTrail(ctx, trail, color, width = 1.4, alpha = 0.7) {
  if (!trail || trail.length < 2) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(trail[0].x, trail[0].y);
  for (let index = 1; index < trail.length; index += 1) {
    ctx.lineTo(trail[index].x, trail[index].y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawCrosshair(ctx, x, y, size, color, alpha = 0.9) {
  ctx.save();
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.restore();
}

function patchDifference(sourceA, sourceB, width, height, x, y, dx, dy, radius, bestSoFar = Number.POSITIVE_INFINITY) {
  let error = 0;
  for (let oy = -radius; oy <= radius; oy += 1) {
    const sampleY = y + oy;
    const sampleY2 = y + dy + oy;
    if (sampleY < 0 || sampleY >= height || sampleY2 < 0 || sampleY2 >= height) {
      return Number.POSITIVE_INFINITY;
    }
    for (let ox = -radius; ox <= radius; ox += 1) {
      const sampleX = x + ox;
      const sampleX2 = x + dx + ox;
      if (sampleX < 0 || sampleX >= width || sampleX2 < 0 || sampleX2 >= width) {
        return Number.POSITIVE_INFINITY;
      }
      error += Math.abs(sourceA[sampleY * width + sampleX] - sourceB[sampleY2 * width + sampleX2]);
      if (error >= bestSoFar) {
        return error;
      }
    }
  }
  return error;
}

function findBestPatchMatch(previousFrame, currentFrame, x, y, searchRadius, patchRadius) {
  let bestDx = 0;
  let bestDy = 0;
  let bestError = Number.POSITIVE_INFINITY;

  for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
    for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
      const error = patchDifference(previousFrame.luma, currentFrame.luma, previousFrame.width, previousFrame.height, x, y, dx, dy, patchRadius, bestError);
      if (error < bestError) {
        bestError = error;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  if (!Number.isFinite(bestError)) {
    return null;
  }

  return {
    x: x + bestDx,
    y: y + bestDy,
    dx: bestDx,
    dy: bestDy,
    magnitude: Math.hypot(bestDx, bestDy),
    error: bestError,
  };
}

function scoreFastKeypoint(luma, width, height, x, y, threshold) {
  if (x < 4 || y < 4 || x >= width - 4 || y >= height - 4) {
    return 0;
  }

  const center = luma[y * width + x];
  const values = FAST_RING.map(([dx, dy]) => luma[(y + dy) * width + (x + dx)] - center);
  let bestBright = 0;
  let bestDark = 0;
  let currentBright = 0;
  let currentDark = 0;
  let brightScore = 0;
  let darkScore = 0;

  for (let index = 0; index < values.length * 2; index += 1) {
    const value = values[index % values.length];
    if (value > threshold) {
      currentBright += 1;
      brightScore += value;
    } else {
      currentBright = 0;
      brightScore = 0;
    }

    if (-value > threshold) {
      currentDark += 1;
      darkScore += -value;
    } else {
      currentDark = 0;
      darkScore = 0;
    }

    bestBright = Math.max(bestBright, currentBright >= 9 ? brightScore : 0);
    bestDark = Math.max(bestDark, currentDark >= 9 ? darkScore : 0);
  }

  return Math.max(bestBright, bestDark);
}

function selectTopFeatures(candidates, count, minDistance = 8) {
  const selected = [];
  candidates.sort((a, b) => b.score - a.score);

  candidates.forEach((candidate) => {
    if (selected.length >= count) {
      return;
    }
    const overlaps = selected.some((existing) => distance(existing.x, existing.y, candidate.x, candidate.y) < minDistance);
    if (!overlaps) {
      selected.push(candidate);
    }
  });

  return selected;
}

function detectFastKeypoints(frame, analysis, options = {}) {
  if (!frame) {
    return [];
  }

  // FAST is the quick feature finder used for sparse-flow style particles and several fallback passes.
  const detail = clamp(options.detail ?? 0.5, 0, 1);
  const sampleStep = Math.max(1, Math.round(4 - detail * 2.6));
  const threshold = 12 + (options.threshold ?? 0.16) * 48;
  const candidates = [];

  for (let y = 4; y < frame.height - 4; y += sampleStep) {
    for (let x = 4; x < frame.width - 4; x += sampleStep) {
      const index = y * frame.width + x;
      if (analysis && frame === analysis.currentFrame && analysis.colorDiff[index] < 8) {
        continue;
      }
      const score = scoreFastKeypoint(frame.luma, frame.width, frame.height, x, y, threshold);
      if (score > threshold * 12) {
        candidates.push({ x, y, score });
      }
    }
  }

  return selectTopFeatures(candidates, options.count || 32, Math.max(5, Math.round(10 - detail * 4)));
}

function detectHarrisFeatures(frame, analysis, options = {}) {
  if (!frame) {
    return [];
  }

  // Harris corners bias toward structured geometry, which gives the Harris tracker a more rigid,
  // architectural feel than the looser FAST-based particle layers.
  const detail = clamp(options.detail ?? 0.5, 0, 1);
  const sampleStep = Math.max(1, Math.round(4 - detail * 2.3));
  const { gradX, gradY } = ensureFrameDerivatives(frame);
  const candidates = [];
  const motionGate = frame === analysis.currentFrame;

  for (let y = 2; y < frame.height - 2; y += sampleStep) {
    for (let x = 2; x < frame.width - 2; x += sampleStep) {
      const index = y * frame.width + x;
      if (motionGate && ensureClusterDensity(analysis)[index] < 24) {
        continue;
      }

      let sumXX = 0;
      let sumYY = 0;
      let sumXY = 0;

      for (let oy = -1; oy <= 1; oy += 1) {
        const row = (y + oy) * frame.width;
        for (let ox = -1; ox <= 1; ox += 1) {
          const sampleIndex = row + x + ox;
          const gx = gradX[sampleIndex];
          const gy = gradY[sampleIndex];
          sumXX += gx * gx;
          sumYY += gy * gy;
          sumXY += gx * gy;
        }
      }

      const trace = sumXX + sumYY;
      const det = sumXX * sumYY - sumXY * sumXY;
      if (trace <= 50) {
        continue;
      }

      const score = det - 0.04 * trace * trace;
      if (score > 0) {
        candidates.push({ x, y, score });
      }
    }
  }

  return selectTopFeatures(candidates, options.count || 32, Math.max(5, Math.round(11 - detail * 4)));
}

function computeBriefDescriptor(frame, x, y) {
  let descriptor = 0;
  for (let index = 0; index < BRIEF_PAIRS.length; index += 1) {
    const [ax, ay, bx, by] = BRIEF_PAIRS[index];
    const sampleAX = clamp(Math.round(x + ax), 0, frame.width - 1);
    const sampleAY = clamp(Math.round(y + ay), 0, frame.height - 1);
    const sampleBX = clamp(Math.round(x + bx), 0, frame.width - 1);
    const sampleBY = clamp(Math.round(y + by), 0, frame.height - 1);
    const valueA = frame.luma[sampleAY * frame.width + sampleAX];
    const valueB = frame.luma[sampleBY * frame.width + sampleBX];
    if (valueA < valueB) {
      descriptor |= (1 << index);
    }
  }
  return descriptor >>> 0;
}

function hammingDistance32(a, b) {
  let value = (a ^ b) >>> 0;
  let count = 0;
  while (value) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

function matchDescriptors(previousPoints, currentPoints, previousFrame, currentFrame, options = {}) {
  // ORB-style matching compares compact descriptors between frames so particles can follow
  // recognizable features instead of relying only on patch correlation.
  const maxDistance = options.maxDistance || 14;
  const matches = [];
  const usedCurrent = new Set();
  const previousDescriptors = previousPoints.map((point) => ({ ...point, descriptor: computeBriefDescriptor(previousFrame, point.x, point.y) }));
  const currentDescriptors = currentPoints.map((point) => ({ ...point, descriptor: computeBriefDescriptor(currentFrame, point.x, point.y) }));

  previousDescriptors.forEach((previousPoint) => {
    let bestMatch = null;
    let bestScore = Number.POSITIVE_INFINITY;

    currentDescriptors.forEach((currentPoint, currentIndex) => {
      if (usedCurrent.has(currentIndex) || distance(previousPoint.x, previousPoint.y, currentPoint.x, currentPoint.y) > maxDistance * 3.2) {
        return;
      }
      const score = hammingDistance32(previousPoint.descriptor, currentPoint.descriptor);
      if (score < bestScore) {
        bestScore = score;
        bestMatch = { point: currentPoint, currentIndex, score };
      }
    });

    if (bestMatch && bestMatch.score <= maxDistance) {
      usedCurrent.add(bestMatch.currentIndex);
      matches.push({
        fromX: previousPoint.x,
        fromY: previousPoint.y,
        toX: bestMatch.point.x,
        toY: bestMatch.point.y,
        score: bestMatch.score,
      });
    }
  });

  return matches.sort((a, b) => a.score - b.score);
}

function trackPointsByPatch(analysis, points, options = {}) {
  if (!analysis.previousFrame) {
    return [];
  }

  const searchRadius = Math.max(1, Math.round(1 + (options.search || 0.5) * 6));
  const patchRadius = Math.max(2, Math.round(2 + (options.detail || 0.5) * 2));
  const matches = [];

  points.forEach((point) => {
    const match = findBestPatchMatch(analysis.previousFrame, analysis.currentFrame, Math.round(point.x), Math.round(point.y), searchRadius, patchRadius);
    if (!match) {
      return;
    }
    if (match.magnitude < 0.4 && analysis.colorDiff[Math.round(point.y) * analysis.width + Math.round(point.x)] < 10) {
      return;
    }
    matches.push({
      fromX: point.x,
      fromY: point.y,
      toX: match.x,
      toY: match.y,
      dx: match.dx,
      dy: match.dy,
      magnitude: match.magnitude,
      error: match.error,
      score: point.score,
    });
  });

  return matches;
}

function updateTemporalAverageMask(state, analysis, bufferFrames, threshold) {
  // The temporal average background model highlights new motion by comparing the current frame
  // against a rolling luma history instead of just the immediately previous frame.
  const currentFrame = Uint8Array.from(analysis.luma, (value) => Math.round(value));
  const historyCount = state.temporalFrames.length;
  const output = new Uint8Array(analysis.pixels);

  if (historyCount > 0) {
    const thresholdValue = 8 + threshold * 150;
    for (let index = 0; index < analysis.pixels; index += 1) {
      const average = state.temporalSum[index] / historyCount;
      const delta = Math.abs(analysis.luma[index] - average);
      output[index] = Math.round(clamp((delta - thresholdValue) / Math.max(1, 255 - thresholdValue), 0, 1) * 255);
    }
  }

  state.temporalFrames.push(currentFrame);
  for (let index = 0; index < analysis.pixels; index += 1) {
    state.temporalSum[index] += currentFrame[index];
  }

  const maxFrames = Math.max(2, Math.round(bufferFrames));
  while (state.temporalFrames.length > maxFrames) {
    const removed = state.temporalFrames.shift();
    for (let index = 0; index < analysis.pixels; index += 1) {
      state.temporalSum[index] -= removed[index];
    }
  }

  return output;
}

function buildTrackerDetections(analysis, mask, params, preset, options = {}) {
  const blockSize = getDetailBlockSize(params, preset, options.multiplier || 1);
  const componentThreshold = options.threshold ?? (0.08 + clamp(params.threshold || 0.16, 0, 1) * 0.36);
  const { components } = buildComponentsFromValues(analysis, mask, blockSize, {
    cacheKey: options.cacheKey || "mask-components",
    threshold: componentThreshold,
    minCells: options.minCells || 2,
  });

  return components.map((component) => ({
    ...component,
    score: component.area * component.peak,
  }));
}

const PARTICLE_SPRITE_CACHE = new Map();

function hashUnit3(a, b, c) {
  const value = (
    Math.imul((a + 1) | 0, 73856093) ^
    Math.imul((b + 1) | 0, 19349663) ^
    Math.imul((c + 1) | 0, 83492791)
  ) >>> 0;
  return value / 4294967295;
}

function getParticleSprite(color, radius = 0.32) {
  const bucket = Math.max(1, Math.min(8, Math.round(radius * 24)));
  const key = `${color.r},${color.g},${color.b},${bucket}`;
  if (PARTICLE_SPRITE_CACHE.has(key)) {
    return PARTICLE_SPRITE_CACHE.get(key);
  }

  const outerRadius = Math.max(1, Math.round(1 + bucket * 0.28));
  const size = outerRadius * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.imageSmoothingEnabled = true;

  const center = outerRadius;
  const core = mixRgb(color, { r: 255, g: 255, b: 255 }, 0.84);
  const halo = mixRgb(color, { r: 255, g: 255, b: 255 }, 0.3);
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, outerRadius);
  gradient.addColorStop(0, rgba(core, 1));
  gradient.addColorStop(0.16, rgba(core, 0.94));
  gradient.addColorStop(0.42, rgba(halo, 0.34));
  gradient.addColorStop(0.76, rgba(color, 0.08));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const sprite = { canvas, radius: outerRadius };
  PARTICLE_SPRITE_CACHE.set(key, sprite);
  return sprite;
}

// Particle layers draw through an auxiliary glow pass so the same sprite renderer can be reused
// by the tracker bank and the datamosh signal-loss overlay without rewriting the blend logic.
function drawGlowDotsComposite(layer, dots, {
  blur = 0.6,
  composite = "screen",
  alpha = 0.94,
} = {}) {
  const auxCtx = layer.runtime.auxCtx;
  const auxCanvas = layer.runtime.auxCanvas;
  const ctx = layer.runtime.ctx;
  const baseColor = getEffectColor(layer);

  auxCtx.clearRect(0, 0, auxCanvas.width, auxCanvas.height);
  auxCtx.save();
  auxCtx.globalCompositeOperation = "lighter";
  auxCtx.imageSmoothingEnabled = true;
  dots.forEach((dot) => {
    const color = dot.color || baseColor;
    const sprite = getParticleSprite(color, dot.radius ?? 0.32);
    auxCtx.globalAlpha = dot.alpha ?? 0.42;
    auxCtx.drawImage(sprite.canvas, dot.x - sprite.radius, dot.y - sprite.radius);
  });
  auxCtx.restore();

  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = alpha;
  ctx.drawImage(auxCanvas, 0, 0);
  if (blur > 0.01) {
    ctx.globalAlpha = Math.min(0.24, 0.08 + blur * 0.08);
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(auxCanvas, 0, 0);
    ctx.filter = "none";
  }
  ctx.restore();
}

function renderGlowDotsLayer(layer, dots, {
  trail = 0,
  blur = 0.6,
  blackBackground = false,
  composite = "screen",
} = {}) {
  const ctx = layer.runtime.ctx;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (blackBackground) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  if (trail > 0.001) {
    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.globalAlpha = 0.06 + trail * 0.22;
    ctx.filter = `blur(${Math.max(0.3, trail * 2.2)}px)`;
    ctx.drawImage(layer.runtime.ghostCanvas, 0, 0);
    ctx.filter = "none";
    ctx.restore();
  }

  drawGlowDotsComposite(layer, dots, { blur, composite });
  finishLayerTrail(layer);
}

// Track vectors are reused by multiple effects: the datamosh layer needs them for smear offsets
// and the particle tracker bank needs them to emit persistent particles from the same motion paths.
function buildTrackMotionVectors(tracks) {
  const vectors = [];

  tracks.forEach((track) => {
    if (track.missed > 1 || track.trail.length < 2) {
      return;
    }

    const current = track.trail[track.trail.length - 1];
    const previous = track.trail[track.trail.length - 2];
    const magnitude = distance(previous.x, previous.y, current.x, current.y);
    if (magnitude < 0.2) {
      return;
    }

    vectors.push({
      fromX: previous.x,
      fromY: previous.y,
      toX: current.x,
      toY: current.y,
      magnitude,
      width: track.width,
      height: track.height,
    });
  });

  return vectors;
}

// This collapses the mosh buffer toward a coarse 1% signal so the new Signal Loss slider can
// progressively strip detail, chunk the image into macro blocks, and push the layer into breakup.
function writeSignalLossFrame(buffer, sourceData, width, height, amount) {
  if (amount <= 0.001) {
    buffer.data.set(sourceData);
    return;
  }

  const scale = Math.max(0.01, 1 - amount * 0.99);
  const blockSize = Math.max(1, Math.round(1 / scale));
  const levels = Math.max(2, Math.round(12 - amount * 10));

  for (let blockY = 0; blockY < height; blockY += blockSize) {
    const rowDrift = Math.round((hashUnit3(blockY, blockSize, 17) - 0.5) * blockSize * (0.25 + amount * 1.75));
    const maxY = Math.min(height, blockY + blockSize);

    for (let blockX = 0; blockX < width; blockX += blockSize) {
      const cellDrift = Math.round((hashUnit3(blockX, blockY, 31) - 0.5) * blockSize * amount);
      const sampleX = clamp(blockX + Math.round(blockSize * 0.45) + rowDrift + cellDrift, 0, width - 1);
      const sampleY = clamp(
        blockY + Math.round(blockSize * 0.45) + Math.round((hashUnit3(blockY, blockX, 41) - 0.5) * blockSize * amount),
        0,
        height - 1,
      );
      const samplePx = (sampleY * width + sampleX) * 4;
      const red = quantizeChannel(sourceData[samplePx], levels);
      const green = quantizeChannel(sourceData[samplePx + 1], levels);
      const blue = quantizeChannel(sourceData[samplePx + 2], levels);
      const maxX = Math.min(width, blockX + blockSize);

      for (let y = blockY; y < maxY; y += 1) {
        const row = y * width;
        for (let x = blockX; x < maxX; x += 1) {
          const px = (row + x) * 4;
          buffer.data[px] = red;
          buffer.data[px + 1] = green;
          buffer.data[px + 2] = blue;
          buffer.data[px + 3] = 255;
        }
      }
    }
  }
}

// Unlike the original one-frame dot renderer, this keeps a live particle pool per layer so the
// new emission and lifetime sliders actually change how many particles spawn and how long they persist.
function updateTrackedParticles(layer, analysis, vectors, preset, elapsed = 0, options = {}) {
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const color = getEffectColor(layer);
  const highlight = { r: 255, g: 248, b: 255 };
  const alpha = options.alpha ?? 0.82;
  const emissionRate = clamp(options.emissionRate ?? layer.params.emissionRate ?? 1, 0, 3);
  const lifetime = clamp(options.lifetime ?? layer.params.lifetime ?? 0.4, 0.05, 1);
  const activeVectors = [];
  let requestedParticles = 0;

  vectors.forEach((vector) => {
    const magnitude = vector.magnitude ?? distance(vector.fromX, vector.fromY, vector.toX, vector.toY);
    if (magnitude < 0.05) {
      return;
    }
    const count = Math.round(((options.particlesPerVector ?? 34) + Math.min(22, magnitude * 7)) * emissionRate * (0.3 + magnitude * 0.15));
    if (count < 1) {
      return;
    }
    activeVectors.push({ vector, magnitude, count });
    requestedParticles += count + 1;
  });

  const budget = Math.max(320, Math.round(options.budget ?? (1800 + (preset?.scale || 1) * 6800)));
  const hardCap = budget * 2;
  const densityScale = requestedParticles > budget ? budget / requestedParticles : 1;
  const previousStamp = state.particleStamp ?? elapsed;
  const delta = clamp(previousStamp === elapsed ? 1 / 30 : elapsed - previousStamp, 1 / 120, 0.12);
  const dragScale = 0.45 + (1 - lifetime) * 1.35;
  const minLifetime = 0.08 + lifetime * 0.22;
  const maxLifetime = 0.16 + lifetime * 1.5;
  const particles = [];

  (state.particles || []).forEach((particle) => {
    particle.life -= delta;
    if (particle.life <= 0.001) {
      return;
    }

    particle.x += particle.vx * delta * 60;
    particle.y += particle.vy * delta * 60;
    const velocityDecay = clamp(1 - delta * (2.2 + particle.drag * dragScale), 0.58, 0.985);
    particle.vx *= velocityDecay;
    particle.vy *= velocityDecay;

    if (particle.x < -18 || particle.y < -18 || particle.x > analysis.width + 18 || particle.y > analysis.height + 18) {
      return;
    }

    particles.push(particle);
  });

  activeVectors.forEach(({ vector, magnitude, count }, vectorIndex) => {
    const dx = vector.toX - vector.fromX;
    const dy = vector.toY - vector.fromY;
    const invMagnitude = magnitude > 0.0001 ? 1 / magnitude : 0;
    const perpX = -dy * invMagnitude;
    const perpY = dx * invMagnitude;
    const particleCount = Math.max(1, Math.round(count * densityScale));
    const seedX = Math.round(vector.fromX * 4);
    const seedY = Math.round(vector.fromY * 4);

    for (let index = 0; index < particleCount; index += 1) {
      const seed = vectorIndex * 257 + index;
      const jitterA = hashUnit3(seedX, seedY, seed);
      const jitterB = hashUnit3(seedY, seedX, seed + 17);
      const jitterC = hashUnit3(seedX + seedY, seed + 31, vectorIndex + 11);
      const t = clamp((index + 0.5) / particleCount + (jitterA - 0.5) * 0.08, 0, 1);
      const spread = (jitterB - 0.5) * (0.4 + magnitude * 0.3);
      const along = (jitterC - 0.5) * 0.3;
      const sparkle = 0.35 + jitterA * 0.65;
      const life = lerp(minLifetime, maxLifetime, 0.3 + jitterC * 0.7);

      particles.push({
        x: lerp(vector.fromX, vector.toX, t) + dx * along * 0.22 + perpX * spread,
        y: lerp(vector.fromY, vector.toY, t) + dy * along * 0.22 + perpY * spread,
        vx: dx * (0.08 + jitterA * 0.16) + perpX * spread * 0.18,
        vy: dy * (0.08 + jitterA * 0.16) + perpY * spread * 0.18,
        drag: 0.35 + jitterB * 0.65,
        life,
        maxLife: life,
        radius: 0.014 + sparkle * 0.024,
        alpha: clamp(alpha * (0.14 + sparkle * 0.18), 0.05, 0.32),
        color: mixRgb(color, highlight, 0.3 + jitterC * 0.5),
      });
    }

    particles.push({
      x: vector.toX,
      y: vector.toY,
      vx: dx * 0.1,
      vy: dy * 0.1,
      drag: 0.25,
      life: maxLifetime * 0.45,
      maxLife: maxLifetime * 0.45,
      radius: 0.02 + Math.min(0.03, magnitude * 0.004),
      alpha: clamp(alpha * 0.3, 0.12, 0.34),
      color: highlight,
    });
  });

  if (particles.length > hardCap) {
    particles.sort((a, b) => (b.life / b.maxLife) - (a.life / a.maxLife));
    particles.length = hardCap;
  }

  state.particles = particles;
  state.particleStamp = elapsed;

  return particles.map((particle) => ({
    x: particle.x,
    y: particle.y,
    radius: particle.radius,
    alpha: clamp(particle.alpha * Math.pow(particle.life / particle.maxLife, 0.62), 0.02, 0.34),
    color: particle.color,
  }));
}

function renderClusterTrackLayer(layer, analysis, preset) {
  // Cluster Track is the dense motion HUD: it boxes active regions, draws track ids, and leaves
  // a labeled trail so you can see how the motion model is grouping subjects over time.
  const color = getEffectColor(layer);
  const density = ensureClusterDensity(analysis);
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const blockSize = getDetailBlockSize(layer.params, preset, 0.92);
  const { components } = buildComponentsFromValues(analysis, density, blockSize, {
    cacheKey: "cluster-density",
    threshold: 0.09 + clamp(layer.params.threshold || 0.22, 0, 1) * 0.34,
    minCells: 1,
  });
  const tracks = updateTracks(state, components, {
    maxDistance: Math.max(30, blockSize * 4),
    trailLength: 20,
    smoothing: 0.34,
  });

  beginLayerTrail(layer, layer.params.trail ?? DEFAULT_TRAIL, "screen");
  const ctx = layer.runtime.ctx;
  ctx.save();
  ctx.strokeStyle = rgba(color, 0.85);
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = rgba(color, 0.42);
  ctx.shadowBlur = 12;

  tracks.forEach((track, index) => {
    if (track.missed > 2) {
      return;
    }
    drawTrail(ctx, track.trail, color, 1.4, 0.42);
    const x = track.x - track.width * 0.5;
    const y = track.y - track.height * 0.5;
    ctx.strokeRect(x, y, track.width, track.height);
    drawCrosshair(ctx, track.x, track.y, 5, color, 0.84);
    if (layer.params.showLabels) {
      ctx.fillStyle = rgba(color, 0.92);
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillText(`T${track.id}`, x + 2, Math.max(10, y - 4 - (index % 2) * 11));
    }
  });

  if (tracks.length > 1) {
    ctx.strokeStyle = rgba(color, 0.24);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tracks[0].x, tracks[0].y);
    for (let index = 1; index < tracks.length; index += 1) {
      ctx.lineTo(tracks[index].x, tracks[index].y);
    }
    ctx.stroke();
  }

  ctx.restore();
  finishLayerTrail(layer);
}

function renderTemporalAverageLayer(layer, analysis) {
  // Temporal Avg BG uses a rolling background estimate to reveal anything that diverges from
  // the recent average, which makes slow ghosts and lingering motion read clearly.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const mask = updateTemporalAverageMask(state, analysis, layer.params.bufferFrames || 18, clamp(layer.params.threshold || 0.16, 0, 1));
  renderTintedMask(layer, analysis, mask, {
    trail: layer.params.trail ?? 0.32,
    blur: 2.2,
    alphaScale: 0.92,
    sourceMix: 0.12,
  });
}

function renderMotionThresholdLayer(layer, analysis) {
  // Motion Threshold is the simplest diff view: anything that changes enough between frames gets
  // pushed into a bright tinted mask with a soft trail behind it.
  const mask = buildMotionThresholdMask(analysis, layer.params);
  renderTintedMask(layer, analysis, mask, {
    trail: layer.params.trail ?? 0.2,
    blur: 1.4,
    alphaScale: 0.88,
    sourceMix: 0.04,
  });
}

// NEW EFFECTS TESTING
// Datamosh Smear reuses motion tracks to drag old frame data forward, and the new Signal Loss
// slider progressively crushes the image into a coarse, particle-heavy breakup state.
function renderDatamoshSmearLayer(layer, analysis, preset, elapsed = 0) {
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const buffer = ensureImageBuffer(state, "datamosh-smear", analysis.width, analysis.height);
  const displayBuffer = ensureImageBuffer(state, "datamosh-display", analysis.width, analysis.height);
  const refresh = clamp(layer.params.refresh ?? 0.18, 0.02, 0.95);
  const smear = clamp(layer.params.smear ?? 0.62, 0, 1);
  const threshold = clamp(layer.params.threshold ?? 0.18, 0, 1);
  const signalLoss = clamp(layer.params.signalLoss ?? 0, 0, 1);
  const smearBoost = clamp(smear + signalLoss * 0.22, 0, 1);

  if (!state.moshFrame || state.moshFrame.length !== analysis.data.length || !analysis.previousFrame) {
    state.moshFrame = new Uint8ClampedArray(analysis.data);
    layer.runtime.ctx.clearRect(0, 0, analysis.width, analysis.height);
    writeSignalLossFrame(displayBuffer, state.moshFrame, analysis.width, analysis.height, signalLoss);
    layer.runtime.ctx.putImageData(displayBuffer.imageData, 0, 0);
    finishLayerTrail(layer);
    return;
  }

  const previousMosh = state.moshFrame;
  const hold = clamp(1 - refresh * (0.72 - signalLoss * 0.18), 0.1, 0.985);
  for (let index = 0, px = 0; index < analysis.pixels; index += 1, px += 4) {
    buffer.data[px] = clamp(Math.round(previousMosh[px] * hold + analysis.data[px] * refresh), 0, 255);
    buffer.data[px + 1] = clamp(Math.round(previousMosh[px + 1] * hold + analysis.data[px + 1] * refresh), 0, 255);
    buffer.data[px + 2] = clamp(Math.round(previousMosh[px + 2] * hold + analysis.data[px + 2] * refresh), 0, 255);
    buffer.data[px + 3] = 255;
  }

  const trackParams = {
    threshold,
    detail: layer.params.detail ?? 0.5,
  };
  const motionMask = buildDensityMask(analysis, trackParams);
  const detections = buildTrackerDetections(analysis, motionMask, trackParams, preset, {
    cacheKey: "datamosh-smear",
    threshold: 0.05 + threshold * 0.22,
    minCells: 1,
    multiplier: 1.18,
  });
  const tracks = updateTracks(state, detections, {
    maxDistance: Math.max(28, getDetailBlockSize(trackParams, preset, 1.05) * 4),
    trailLength: 10,
    smoothing: 0.42,
    maxMissed: 3,
  });
  const motionVectors = buildTrackMotionVectors(tracks);
  let smearedTrackCount = 0;

  tracks.forEach((track) => {
    if (track.missed > 1 || track.trail.length < 2) {
      return;
    }

    const current = track.trail[track.trail.length - 1];
    const previous = track.trail[track.trail.length - 2];
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const magnitude = Math.hypot(dx, dy);
    if (magnitude < 0.2) {
      return;
    }
    smearedTrackCount += 1;

    const offsetX = Math.round(dx * (1.4 + smearBoost * 4.8));
    const offsetY = Math.round(dy * (1.4 + smearBoost * 4.8));
    const extentX = Math.round(track.width * (0.45 + smearBoost * 0.52) + Math.abs(offsetX) * 2);
    const extentY = Math.round(track.height * (0.45 + smearBoost * 0.52) + Math.abs(offsetY) * 2);
    const minX = clamp(Math.floor(track.x - extentX * 0.5), 0, analysis.width - 1);
    const maxX = clamp(Math.ceil(track.x + extentX * 0.5), 0, analysis.width - 1);
    const minY = clamp(Math.floor(track.y - extentY * 0.5), 0, analysis.height - 1);
    const maxY = clamp(Math.ceil(track.y + extentY * 0.5), 0, analysis.height - 1);
    const radiusX = Math.max(1, extentX * 0.5);
    const radiusY = Math.max(1, extentY * 0.5);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const nx = (x - track.x) / radiusX;
        const ny = (y - track.y) / radiusY;
        const influence = clamp(1 - Math.hypot(nx, ny), 0, 1);
        if (influence <= 0.001) {
          continue;
        }

        const dstPx = (y * analysis.width + x) * 4;
        const srcPx = getPixelOffset(analysis.width, analysis.height, x - offsetX, y - offsetY);
        const smearMix = clamp(influence * (0.2 + magnitude * 0.1 + smearBoost * 0.54), 0.08, 0.92);
        buffer.data[dstPx] = Math.round(lerp(buffer.data[dstPx], previousMosh[srcPx], smearMix));
        buffer.data[dstPx + 1] = Math.round(lerp(buffer.data[dstPx + 1], previousMosh[srcPx + 1], smearMix));
        buffer.data[dstPx + 2] = Math.round(lerp(buffer.data[dstPx + 2], previousMosh[srcPx + 2], smearMix));
      }
    }
  });

  if (!smearedTrackCount && analysis.previousFrame) {
    const blockSize = Math.max(6, getDetailBlockSize(trackParams, preset, 0.7));
    const motionGrid = buildActivityGrid(motionMask, analysis.width, analysis.height, blockSize, 255);
    for (let gridY = 0; gridY < motionGrid.gridHeight; gridY += 1) {
      for (let gridX = 0; gridX < motionGrid.gridWidth; gridX += 1) {
        const gridIndex = gridY * motionGrid.gridWidth + gridX;
        const activity = motionGrid.activity[gridIndex];
        if (activity <= 0.08) {
          continue;
        }
        const dir = hashUnit3(gridX, gridY, Math.round(analysis.averageMotion * 10)) > 0.5 ? 1 : -1;
        const offsetX = Math.round(dir * (2 + smearBoost * 12) * activity);
        const offsetY = Math.round((hashUnit3(gridY, gridX, 7) - 0.5) * (1 + smearBoost * 5) * activity);
        const maxY = Math.min(analysis.height, (gridY + 1) * blockSize);
        const maxX = Math.min(analysis.width, (gridX + 1) * blockSize);
        for (let y = gridY * blockSize; y < maxY; y += 1) {
          for (let x = gridX * blockSize; x < maxX; x += 1) {
            const dstPx = (y * analysis.width + x) * 4;
            const srcPx = getPixelOffset(analysis.width, analysis.height, x - offsetX, y - offsetY);
            const smearMix = 0.18 + activity * (0.36 + smearBoost * 0.36);
            buffer.data[dstPx] = Math.round(lerp(buffer.data[dstPx], previousMosh[srcPx], smearMix));
            buffer.data[dstPx + 1] = Math.round(lerp(buffer.data[dstPx + 1], previousMosh[srcPx + 1], smearMix));
            buffer.data[dstPx + 2] = Math.round(lerp(buffer.data[dstPx + 2], previousMosh[srcPx + 2], smearMix));
          }
        }
      }
    }
  }

  state.moshFrame.set(buffer.data);
  writeSignalLossFrame(displayBuffer, state.moshFrame, analysis.width, analysis.height, signalLoss);
  layer.runtime.ctx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.ctx.putImageData(displayBuffer.imageData, 0, 0);

  const particleDots = updateTrackedParticles(layer, analysis, motionVectors, preset, elapsed, {
    alpha: 0.3 + signalLoss * 0.52,
    blur: 0.4 + signalLoss * 1.1,
    particlesPerVector: 84,
    emissionRate: (layer.params.emissionRate ?? 1) * signalLoss * 2,
    lifetime: layer.params.lifetime ?? 0.42,
    budget: 900 + signalLoss * 3200,
  });
  if (particleDots.length) {
    drawGlowDotsComposite(layer, particleDots, {
      blur: 0.3 + signalLoss * 1.4,
      composite: "screen",
      alpha: 0.68 + signalLoss * 0.18,
    });
  }

  finishLayerTrail(layer);
}

function renderFeedbackTrailsLayer(layer, analysis, elapsed = 0) {
  // Feedback Trails reprojects the previous output back onto itself with a subtle zoom and drift,
  // using motion centroids to steer the recursion when the scene has a clear moving subject.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const sourceBuffer = ensureImageBuffer(state, "feedback-source", analysis.width, analysis.height);
  sourceBuffer.data.set(analysis.data);
  layer.runtime.auxCtx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.auxCtx.putImageData(sourceBuffer.imageData, 0, 0);

  if (!analysis.previousFrame) {
    layer.runtime.ctx.clearRect(0, 0, analysis.width, analysis.height);
    layer.runtime.ctx.putImageData(sourceBuffer.imageData, 0, 0);
    finishLayerTrail(layer);
    return;
  }

  const mask = buildMotionThresholdMask(analysis, { threshold: 0.14 });
  const centroid = computeCentroid(mask, analysis.width, analysis.height);
  const feedback = clamp(layer.params.feedback ?? 0.82, 0.1, 0.99);
  const zoom = 1 + clamp(layer.params.zoom ?? 0.22, 0, 1) * 0.032;
  const sourceMix = clamp(layer.params.sourceMix ?? 0.72, 0.02, 1);
  const drift = clamp(layer.params.drift ?? 0.24, 0, 1);
  const driftX = centroid
    ? ((centroid.x - analysis.width * 0.5) / analysis.width) * (8 + drift * 20)
    : Math.sin(elapsed * (0.8 + drift)) * drift * 4;
  const driftY = centroid
    ? ((centroid.y - analysis.height * 0.5) / analysis.height) * (8 + drift * 20)
    : Math.cos(elapsed * (1 + drift * 0.7)) * drift * 3;

  const ctx = layer.runtime.ctx;
  ctx.clearRect(0, 0, analysis.width, analysis.height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, analysis.width, analysis.height);

  ctx.save();
  ctx.globalAlpha = 0.24 + feedback * 0.72;
  ctx.translate(analysis.width * 0.5 + driftX, analysis.height * 0.5 + driftY);
  ctx.scale(zoom, zoom);
  ctx.translate(-analysis.width * 0.5, -analysis.height * 0.5);
  ctx.drawImage(layer.runtime.ghostCanvas, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.28 + sourceMix * 0.68;
  ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
  ctx.restore();

  finishLayerTrail(layer);
}

function renderEdgeGlowLayer(layer, analysis) {
  // Edge Glow darkens the source image and then screens a softened edge buffer over the top so
  // contours pop like a neon-outline pass.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const color = getEffectColor(layer);
  const baseBuffer = ensureImageBuffer(state, "edge-glow-base", analysis.width, analysis.height);
  const edgeBuffer = ensureImageBuffer(state, "edge-glow-edges", analysis.width, analysis.height);
  const edge = ensureFrameDerivatives(analysis.currentFrame).edge;
  const threshold = 10 + clamp(layer.params.threshold ?? 0.12, 0, 1) * 120;
  const darkness = clamp(layer.params.darkness ?? 0.4, 0, 1);
  const glow = clamp(layer.params.glow ?? 0.82, 0, 1);
  const baseScale = 1 - darkness * 0.82;

  for (let index = 0, px = 0; index < analysis.pixels; index += 1, px += 4) {
    baseBuffer.data[px] = clamp(Math.round(analysis.data[px] * baseScale), 0, 255);
    baseBuffer.data[px + 1] = clamp(Math.round(analysis.data[px + 1] * baseScale), 0, 255);
    baseBuffer.data[px + 2] = clamp(Math.round(analysis.data[px + 2] * baseScale), 0, 255);
    baseBuffer.data[px + 3] = 255;

    const intensity = clamp((edge[index] - threshold) / Math.max(1, 255 - threshold), 0, 1);
    if (intensity <= 0.001) {
      edgeBuffer.data[px + 3] = 0;
      continue;
    }

    const neon = mixRgb(color, { r: 255, g: 255, b: 255 }, 0.35 + intensity * 0.45);
    edgeBuffer.data[px] = neon.r;
    edgeBuffer.data[px + 1] = neon.g;
    edgeBuffer.data[px + 2] = neon.b;
    edgeBuffer.data[px + 3] = Math.round(Math.pow(intensity, 0.78) * 255);
  }

  const ctx = layer.runtime.ctx;
  layer.runtime.bufferCtx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.bufferCtx.putImageData(baseBuffer.imageData, 0, 0);
  layer.runtime.auxCtx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.auxCtx.putImageData(edgeBuffer.imageData, 0, 0);

  ctx.clearRect(0, 0, analysis.width, analysis.height);
  ctx.save();
  ctx.globalAlpha = 0.28 + (1 - darkness) * 0.44;
  ctx.drawImage(layer.runtime.bufferCanvas, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.95;
  ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
  ctx.globalAlpha = 0.2 + glow * 0.34;
  ctx.filter = `blur(${1.2 + glow * 4.2}px)`;
  ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
  ctx.globalAlpha = 0.08 + glow * 0.14;
  ctx.filter = `blur(${3 + glow * 8}px)`;
  ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
  ctx.filter = "none";
  ctx.restore();
  finishLayerTrail(layer);
}

function renderFilmGrainLayer(layer, analysis, elapsed = 0) {
  // Film Grain synthesizes mono and per-channel noise over the source frame so the effect reads
  // more like a textured print or scanned stock than a flat digital overlay.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const buffer = ensureImageBuffer(state, "film-grain", analysis.width, analysis.height);
  const amount = clamp(layer.params.amount ?? 0.42, 0, 1);
  const contrast = 1 + clamp(layer.params.contrast ?? 0.3, 0, 1) * 1.45;
  const grainSize = Math.max(1, layer.params.grainSize ?? 1.4);
  const speed = clamp(layer.params.speed ?? 0.62, 0.05, 1);
  const timeSeed = Math.floor(elapsed * (12 + speed * 54));

  for (let y = 0; y < analysis.height; y += 1) {
    const cellY = Math.floor(y / grainSize);
    const row = y * analysis.width;
    for (let x = 0; x < analysis.width; x += 1) {
      const index = row + x;
      const px = index * 4;
      const cellX = Math.floor(x / grainSize);
      const monoNoise = hashUnit3(cellX, cellY, timeSeed) * 2 - 1;
      const channelNoiseR = hashUnit3(cellX + 13, cellY, timeSeed + 5) * 2 - 1;
      const channelNoiseB = hashUnit3(cellX, cellY + 11, timeSeed + 9) * 2 - 1;
      const midtone = 0.45 + (1 - Math.abs(analysis.luma[index] - 128) / 128) * 0.55;
      const grain = monoNoise * (6 + amount * 44) * midtone;
      const colorDrift = amount * 10;
      const baseR = (analysis.data[px] - 128) * contrast + 128;
      const baseG = (analysis.data[px + 1] - 128) * contrast + 128;
      const baseB = (analysis.data[px + 2] - 128) * contrast + 128;

      buffer.data[px] = clamp(Math.round(baseR + grain + channelNoiseR * colorDrift), 0, 255);
      buffer.data[px + 1] = clamp(Math.round(baseG + grain * 0.95), 0, 255);
      buffer.data[px + 2] = clamp(Math.round(baseB + grain + channelNoiseB * colorDrift), 0, 255);
      buffer.data[px + 3] = 255;
    }
  }

  layer.runtime.ctx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.ctx.putImageData(buffer.imageData, 0, 0);
  finishLayerTrail(layer);
}

function renderVoronoiShadingLayer(layer, analysis) {
  // Voronoi Shade converts detected features into chunky cells, then shades each cell from the
  // sampled source color for a procedural posterized mosaic look.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const buffer = ensureImageBuffer(state, "voronoi-shading", analysis.width, analysis.height);
  const accent = getEffectColor(layer);
  const pointCount = Math.round(layer.params.pointCount || 24);
  const cellSize = Math.max(4, Math.round(layer.params.cellSize || 10));
  const posterize = clamp(layer.params.posterize ?? 0.52, 0, 1);
  const levels = Math.max(2, Math.round(2 + posterize * 6));
  const seedDetail = clamp(1 - (cellSize - 4) / 18, 0.18, 0.9);
  const seeds = detectFastKeypoints(analysis.currentFrame, null, {
    count: pointCount,
    threshold: 0.12,
    detail: seedDetail,
  }).slice(0, pointCount);

  if (seeds.length < pointCount) {
    const gridColumns = Math.max(2, Math.round(Math.sqrt(pointCount * analysis.width / Math.max(1, analysis.height))));
    const gridRows = Math.max(2, Math.ceil(pointCount / gridColumns));
    for (let row = 0; row < gridRows && seeds.length < pointCount; row += 1) {
      for (let column = 0; column < gridColumns && seeds.length < pointCount; column += 1) {
        const x = Math.round(((column + 0.5) / gridColumns) * (analysis.width - 1));
        const y = Math.round(((row + 0.5) / gridRows) * (analysis.height - 1));
        seeds.push({ x, y, score: 0 });
      }
    }
  }

  if (!seeds.length) {
    buffer.data.set(analysis.data);
    layer.runtime.ctx.clearRect(0, 0, analysis.width, analysis.height);
    layer.runtime.ctx.putImageData(buffer.imageData, 0, 0);
    finishLayerTrail(layer);
    return;
  }

  const enrichedSeeds = seeds.map((seed) => {
    const px = getPixelOffset(analysis.width, analysis.height, seed.x, seed.y);
    return {
      x: seed.x,
      y: seed.y,
      r: analysis.data[px],
      g: analysis.data[px + 1],
      b: analysis.data[px + 2],
      luma: analysis.luma[(Math.round(seed.y) * analysis.width) + Math.round(seed.x)] / 255,
    };
  });

  for (let blockY = 0; blockY < analysis.height; blockY += cellSize) {
    for (let blockX = 0; blockX < analysis.width; blockX += cellSize) {
      const centerX = Math.min(analysis.width - 1, blockX + cellSize * 0.5);
      const centerY = Math.min(analysis.height - 1, blockY + cellSize * 0.5);
      let bestSeed = enrichedSeeds[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      let secondDistance = Number.POSITIVE_INFINITY;

      enrichedSeeds.forEach((seed) => {
        const dist = (seed.x - centerX) * (seed.x - centerX) + (seed.y - centerY) * (seed.y - centerY);
        if (dist < bestDistance) {
          secondDistance = bestDistance;
          bestDistance = dist;
          bestSeed = seed;
        } else if (dist < secondDistance) {
          secondDistance = dist;
        }
      });

      const edgeFactor = clamp(1 - (Math.sqrt(secondDistance) - Math.sqrt(bestDistance)) / Math.max(1, cellSize * 0.95), 0, 1);
      const shade = 0.68 + bestSeed.luma * 0.38;
      const baseColor = {
        r: quantizeChannel(bestSeed.r * shade, levels),
        g: quantizeChannel(bestSeed.g * shade, levels),
        b: quantizeChannel(bestSeed.b * shade, levels),
      };
      const finalColor = mixRgb(baseColor, accent, edgeFactor * 0.36);
      const maxY = Math.min(analysis.height, blockY + cellSize);
      const maxX = Math.min(analysis.width, blockX + cellSize);

      for (let y = blockY; y < maxY; y += 1) {
        const row = y * analysis.width;
        for (let x = blockX; x < maxX; x += 1) {
          const px = (row + x) * 4;
          buffer.data[px] = finalColor.r;
          buffer.data[px + 1] = finalColor.g;
          buffer.data[px + 2] = finalColor.b;
          buffer.data[px + 3] = 255;
        }
      }
    }
  }

  layer.runtime.ctx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.ctx.putImageData(buffer.imageData, 0, 0);
  finishLayerTrail(layer);
}

function renderPunchBlackWhiteLayer(layer, analysis) {
  // Punch B&W crushes the source into a graphic halftone treatment with edge-boosted ink coverage
  // so motion scenes read like printed zines instead of grayscale video.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const buffer = ensureImageBuffer(state, "punch-black-white", analysis.width, analysis.height);
  const edge = ensureFrameDerivatives(analysis.currentFrame).edge;
  const contrast = 1 + clamp(layer.params.contrast ?? 0.84, 0, 1) * 4.8;
  const screenScale = 4 + clamp(layer.params.screen ?? 0.38, 0, 1) * 14;
  const crush = clamp(layer.params.crush ?? 0.44, 0, 1);
  const roughness = clamp(layer.params.roughness ?? 0.26, 0, 1);
  const invSqrt2 = 0.7071067811865476;

  for (let y = 0; y < analysis.height; y += 1) {
    const row = y * analysis.width;
    for (let x = 0; x < analysis.width; x += 1) {
      const index = row + x;
      const px = index * 4;
      let tone = analysis.luma[index] / 255;
      const edgeBoost = Math.pow(edge[index] / 255, 0.84);

      tone = clamp((tone - 0.5) * contrast + 0.5, 0, 1);
      tone = tone < 0.5
        ? Math.pow(tone * 2, 1.85) * 0.5
        : 1 - Math.pow((1 - tone) * 2, 1.35) * 0.5;
      tone = clamp(tone + edgeBoost * 0.12 - 0.05, 0, 1);

      const inkCoverage = clamp((1 - tone) * (1.04 + crush * 1.08) + edgeBoost * 0.18, 0, 1.2);
      const rotatedX = (x + y) * invSqrt2 / screenScale;
      const rotatedY = (x - y) * invSqrt2 / screenScale;
      const localX = wrapUnit(rotatedX) - 0.5;
      const localY = wrapUnit(rotatedY) - 0.5;
      const dot = clamp(1 - Math.hypot(localX, localY) * 2.7, 0, 1);
      const line = clamp(1 - Math.abs(localX) * 5.4, 0, 1);
      const grain = (hashUnit3((x / 2) | 0, (y / 2) | 0, 91) - 0.5) * roughness * 0.34;
      const threshold = 0.58 - dot * (0.28 + crush * 0.12) - line * (0.15 + crush * 0.1) + grain;
      const value = inkCoverage > threshold ? 0 : 255;

      buffer.data[px] = value;
      buffer.data[px + 1] = value;
      buffer.data[px + 2] = value;
      buffer.data[px + 3] = 255;
    }
  }

  layer.runtime.ctx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.ctx.putImageData(buffer.imageData, 0, 0);
  finishLayerTrail(layer);
}

// Particle tracker effects now share the same persistent pool so lifetime and emission controls
// behave consistently across sparse flow, corners, ORB, FAST, and the datamosh signal-loss mode.
function renderTrackedParticles(layer, analysis, vectors, preset, elapsed = 0, options = {}) {
  const lifetime = clamp(options.lifetime ?? layer.params.lifetime ?? 0.4, 0.05, 1);
  const dots = updateTrackedParticles(layer, analysis, vectors, preset, elapsed, options);
  renderGlowDotsLayer(layer, dots, {
    trail: options.trail ?? (0.02 + lifetime * 0.22),
    blur: options.blur ?? 1.4,
  });
}

function renderSparseOpticalFlowLayer(layer, analysis, preset, elapsed = 0) {
  // Sparse Flow finds bright feature points and patch-matches them into moving particle streaks.
  const points = detectFastKeypoints(analysis.previousFrame, analysis, {
    count: Math.round(layer.params.featureCount || 44),
    threshold: 0.12,
    detail: layer.params.detail || 0.56,
  });
  const matches = trackPointsByPatch(analysis, points, layer.params);
  renderTrackedParticles(layer, analysis, matches, preset, elapsed, {
    alpha: 0.82,
    particlesPerVector: 132,
    blur: 0.4,
    emissionRate: layer.params.emissionRate ?? 1,
    lifetime: layer.params.lifetime ?? 0.4,
  });
}

function renderHarrisCornersLayer(layer, analysis, preset, elapsed = 0) {
  // Harris Corners emits particles from stronger corner responses, which biases the effect toward
  // edges, architecture, and more geometric structures in the frame.
  const count = Math.round(layer.params.featureCount || 54);
  const currentPoints = detectHarrisFeatures(analysis.currentFrame, analysis, {
    count,
    threshold: layer.params.threshold || 0.18,
    detail: layer.params.detail || 0.58,
  });
  const previousPoints = detectHarrisFeatures(analysis.previousFrame, analysis, {
    count,
    threshold: layer.params.threshold || 0.18,
    detail: layer.params.detail || 0.58,
  });
  const sourcePoints = previousPoints.length ? previousPoints : currentPoints;
  const matches = trackPointsByPatch(analysis, sourcePoints, {
    search: 0.42,
    detail: layer.params.detail || 0.58,
  });
  renderTrackedParticles(layer, analysis, matches, preset, elapsed, {
    alpha: 0.86,
    particlesPerVector: 124,
    blur: 0.34,
    emissionRate: layer.params.emissionRate ?? 1,
    lifetime: layer.params.lifetime ?? 0.4,
  });
}

function renderOrbTrackingLayer(layer, analysis, preset, elapsed = 0) {
  // ORB Tracking uses descriptor matching between frames so particles follow repeated features
  // with more identity than pure patch matching.
  const matches = analysis.previousFrame
    ? matchDescriptors(
      detectFastKeypoints(analysis.previousFrame, analysis, {
        count: Math.round(layer.params.featureCount || 48),
        threshold: layer.params.threshold || 0.18,
        detail: layer.params.detail || 0.54,
      }),
      detectFastKeypoints(analysis.currentFrame, analysis, {
        count: Math.round(layer.params.featureCount || 48),
        threshold: layer.params.threshold || 0.18,
        detail: layer.params.detail || 0.54,
      }),
      analysis.previousFrame,
      analysis.currentFrame,
      { maxDistance: 14 },
    )
    : [];
  renderTrackedParticles(layer, analysis, matches.map((match) => ({
    fromX: match.fromX,
    fromY: match.fromY,
    toX: match.toX,
    toY: match.toY,
    magnitude: distance(match.fromX, match.fromY, match.toX, match.toY),
  })), preset, elapsed, {
    alpha: 0.8,
    particlesPerVector: 128,
    blur: 0.32,
    emissionRate: layer.params.emissionRate ?? 1,
    lifetime: layer.params.lifetime ?? 0.38,
  });
}

function renderFastKeypointsLayer(layer, analysis, preset, elapsed = 0) {
  // FAST Keypoints is the busiest particle mode: it samples lots of quick corners and turns them
  // into a denser shower of reactive particles.
  const previousPoints = detectFastKeypoints(analysis.previousFrame, analysis, {
    count: Math.round(layer.params.featureCount || 68),
    threshold: layer.params.threshold || 0.18,
    detail: layer.params.detail || 0.6,
  });
  const matches = trackPointsByPatch(analysis, previousPoints, {
    search: 0.4,
    detail: layer.params.detail || 0.6,
  });
  renderTrackedParticles(layer, analysis, matches, preset, elapsed, {
    alpha: 0.84,
    particlesPerVector: 140,
    blur: 0.28,
    emissionRate: layer.params.emissionRate ?? 1,
    lifetime: layer.params.lifetime ?? 0.36,
  });
}

function renderTrackBoxesLayer(layer, analysis, preset, style = "boxes") {
  // Blob Tracker and Bounding Boxes share this renderer: one draws elliptical blobs, the other
  // draws cleaner rectangles, but both use the same motion components and smoothed track trails.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const mask = buildDensityMask(analysis, layer.params);
  const detections = buildTrackerDetections(analysis, mask, layer.params, preset, {
    cacheKey: `${style}-tracks`,
    threshold: 0.08 + (layer.params.threshold || 0.16) * 0.28,
  });
  const tracks = updateTracks(state, detections, {
    maxDistance: Math.max(34, getDetailBlockSize(layer.params, preset, 1.15) * 4),
    trailLength: style === "blob" ? 24 : 18,
    smoothing: style === "boxes" ? 0.52 : 0.4,
  });
  const color = getEffectColor(layer);

  beginLayerTrail(layer, layer.params.trail ?? 0.24, "screen");
  const ctx = layer.runtime.ctx;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = rgba(color, 0.24);
  ctx.shadowBlur = 10;

  tracks.forEach((track) => {
    if (track.missed > 2) {
      return;
    }

    if (style === "blob") {
      drawTrail(ctx, track.trail, color, 1.6, 0.42);
      ctx.fillStyle = rgba(color, 0.16);
      ctx.strokeStyle = rgba(color, 0.82);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(track.x, track.y, track.width * 0.34, track.height * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawCrosshair(ctx, track.x, track.y, 4, color, 0.82);
      return;
    }

    drawTrail(ctx, track.trail, color, 1.1, 0.28);
    ctx.strokeStyle = rgba(color, 0.88);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(track.x - track.width * 0.5, track.y - track.height * 0.5, track.width, track.height);
  });

  ctx.restore();
  finishLayerTrail(layer);
}

function renderSkinToneLayer(layer, analysis) {
  // Skin Mask isolates likely skin pixels directly from color space thresholds so it can be used
  // as a clean matte layer without needing motion to be present.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const skinMask = buildSkinMask(analysis);
  const buffer = ensureImageBuffer(state, "skin-mask", analysis.width, analysis.height);
  writeMaskedSourceToBuffer(buffer, analysis, skinMask);
  layer.runtime.ctx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.ctx.putImageData(buffer.imageData, 0, 0);
  finishLayerTrail(layer);
}

function renderGreenScreenMotionLayer(layer, analysis) {
  // Green Screen first keys the scene for green hues, then subtracts those keyed pixels from the
  // motion mask so only non-green moving regions light up.
  const greenMask = buildGreenMask(analysis, layer.params.hueWidth || 0.1);
  const motionMask = buildDensityMask(analysis, layer.params, null, greenMask);
  renderTintedMask(layer, analysis, motionMask, {
    trail: layer.params.trail ?? 0.2,
    blur: 1.6,
    alphaScale: 0.92,
    sourceMix: 0.18,
  });
}

function renderColorCentroidLayer(layer, analysis) {
  // Color Centroid tracks the center of a chosen hue over time, leaving a trail so the selected
  // color behaves like a simple live target tracker.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const hueMask = buildHueMask(analysis, {
    hue: layer.params.hue ?? 0,
    hueWidth: layer.params.hueWidth ?? 0.08,
    minSaturation: 0.22,
    minValue: 0.18,
  });
  const centroid = computeCentroid(hueMask, analysis.width, analysis.height);
  if (centroid) {
    state.centroidTrail.push({ x: centroid.x, y: centroid.y });
    if (state.centroidTrail.length > 30) {
      state.centroidTrail.shift();
    }
  } else if (state.centroidTrail.length > 0) {
    state.centroidTrail.shift();
  }

  renderTintedMask(layer, analysis, hueMask, {
    trail: 0.08,
    blur: 1.4,
    alphaScale: 0.75,
    sourceMix: 0.28,
  });

  if (!state.centroidTrail.length) {
    return;
  }

  const color = getEffectColor(layer);
  const ctx = layer.runtime.ctx;
  ctx.save();
  drawTrail(ctx, state.centroidTrail, color, 1.5, 0.5);
  const current = state.centroidTrail[state.centroidTrail.length - 1];
  drawCrosshair(ctx, current.x, current.y, 8, color, 0.95);
  ctx.restore();
  finishLayerTrail(layer);
}

export function renderMotionVideoEffectLayer({
  layer,
  sourceImageData,
  elapsed,
  previousSourceImageData,
  getQualityPreset,
}) {
  // The public dispatcher keeps the workspace generic: it builds shared frame analysis once and
  // routes each motion layer to the renderer that owns that specific effect type.
  if (!layer || !sourceImageData || !MOTION_EFFECT_TYPES.has(layer.type)) {
    return false;
  }

  const analysis = getSharedAnalysis(sourceImageData, previousSourceImageData);
  const preset = getQualityPreset ? getQualityPreset() : null;

  if (layer.type === "clusterTrack") {
    renderClusterTrackLayer(layer, analysis, preset);
    return true;
  }

  if (layer.type === "temporalAverage") {
    renderTemporalAverageLayer(layer, analysis);
    return true;
  }

  if (layer.type === "motionThreshold") {
    renderMotionThresholdLayer(layer, analysis);
    return true;
  }

  if (layer.type === "datamoshSmear") {
    renderDatamoshSmearLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "feedbackTrails") {
    renderFeedbackTrailsLayer(layer, analysis, elapsed);
    return true;
  }

  if (layer.type === "edgeGlow") {
    renderEdgeGlowLayer(layer, analysis);
    return true;
  }

  if (layer.type === "filmGrain") {
    renderFilmGrainLayer(layer, analysis, elapsed);
    return true;
  }

  if (layer.type === "voronoiShading") {
    renderVoronoiShadingLayer(layer, analysis);
    return true;
  }

  if (layer.type === "punchBlackWhite") {
    renderPunchBlackWhiteLayer(layer, analysis);
    return true;
  }

  if (layer.type === "sparseOpticalFlow") {
    renderSparseOpticalFlowLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "harrisCorners") {
    renderHarrisCornersLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "orbTracking") {
    renderOrbTrackingLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "fastKeypoints") {
    renderFastKeypointsLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "multiBlob") {
    renderTrackBoxesLayer(layer, analysis, preset, "blob");
    return true;
  }

  if (layer.type === "boundingBoxes") {
    renderTrackBoxesLayer(layer, analysis, preset, "boxes");
    return true;
  }

  if (layer.type === "skinTone") {
    renderSkinToneLayer(layer, analysis);
    return true;
  }

  if (layer.type === "greenScreenMotion") {
    renderGreenScreenMotionLayer(layer, analysis);
    return true;
  }

  if (layer.type === "colorCentroid") {
    renderColorCentroidLayer(layer, analysis);
    return true;
  }

  return false;
}
