const VFX_MODULE_URL = "https://esm.sh/@vfx-js/core@0.8.0";
const IMAGE_EFFECT_ASSETS = Object.freeze({
  imageFlash: Object.freeze({
    src: new URL("../images/forvideo/money.png", import.meta.url).href,
  }),
});
const FILM_MATTE_MAX_BUFFER_DIMENSION = 480;
const FILM_MATTE_BUFFER_FPS = 20;

let vfxModulePromise = null;
const imageEffectAssetCache = new Map();

function loadVfxModule() {
  if (!vfxModulePromise) {
    vfxModulePromise = import(VFX_MODULE_URL);
  }
  return vfxModulePromise;
}

function hideVfxNode(node) {
  if (!node) {
    return;
  }
  node.setAttribute("aria-hidden", "true");
  node.style.opacity = "0";
  node.style.pointerEvents = "none";
  node.style.zIndex = "-1";
}

function getVfxDisplayCanvasSize(fallbackWidth, fallbackHeight) {
  const displayCanvas = document.getElementById("video-canvas");
  const width = Math.max(1, Math.round(displayCanvas?.clientWidth || fallbackWidth || 1));
  const height = Math.max(1, Math.round(displayCanvas?.clientHeight || fallbackHeight || 1));
  return { width, height };
}

function resizeVfxSourceCanvas(surface, width, height) {
  if (surface.sourceCanvas.width !== width || surface.sourceCanvas.height !== height) {
    surface.sourceCanvas.width = width;
    surface.sourceCanvas.height = height;
  }
  surface.sourceCanvas.style.width = `${width}px`;
  surface.sourceCanvas.style.height = `${height}px`;
}

function cleanupVfxSurface(surface) {
  if (!surface || surface.disposed) {
    return;
  }
  surface.disposed = true;
  try {
    surface.vfx?.destroy?.();
  } catch (error) {
    console.error("Failed to destroy VFX surface.", error);
  }
  surface.host?.remove();
  if (surface.outputCanvas?.isConnected) {
    surface.outputCanvas.remove();
  }
}

function loadImageEffectAsset(key, requestPreviewRefresh) {
  const definition = IMAGE_EFFECT_ASSETS[key];
  if (!definition) {
    return null;
  }

  const existing = imageEffectAssetCache.get(key);
  if (existing) {
    return existing;
  }

  const image = new Image();
  const entry = {
    key,
    image,
    ready: false,
    error: null,
    loggedError: false,
  };

  imageEffectAssetCache.set(key, entry);
  image.decoding = "async";
  image.onload = () => {
    entry.ready = true;
    requestPreviewRefresh?.();
  };
  image.onerror = () => {
    entry.error = new Error(`Failed to load image effect asset: ${definition.src}`);
    requestPreviewRefresh?.();
  };
  image.src = definition.src;
  return entry;
}

async function initializeVfxSurface(surface, requestPreviewRefresh) {
  const existingCanvases = new Set(Array.from(document.body.querySelectorAll("body > canvas")));
  const { VFX } = await loadVfxModule();
  if (surface.disposed) {
    return;
  }

  const vfx = new VFX({
    autoplay: false,
    scrollPadding: false,
    pixelRatio: 1,
    zIndex: -1,
  });
  const outputCanvas = Array.from(document.body.querySelectorAll("body > canvas"))
    .find((node) => !existingCanvases.has(node));

  if (!outputCanvas) {
    throw new Error("VFX.js did not expose a render canvas.");
  }

  hideVfxNode(outputCanvas);
  outputCanvas.dataset.motionvideoVfxCanvas = surface.key;

  await vfx.add(surface.sourceCanvas, {
    shader: surface.shader,
    overflow: 0,
    overlay: false,
    uniforms: surface.uniformGenerators,
  });

  surface.vfx = vfx;
  surface.outputCanvas = outputCanvas;
  surface.ready = true;
  requestPreviewRefresh?.();
}

function createVfxSurface(layer, shader, uniformGenerators, requestPreviewRefresh) {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "hidden";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = 1;
  sourceCanvas.height = 1;
  sourceCanvas.style.position = "fixed";
  sourceCanvas.style.left = "0";
  sourceCanvas.style.top = "0";
  sourceCanvas.style.width = "1px";
  sourceCanvas.style.height = "1px";
  sourceCanvas.style.opacity = "0";
  sourceCanvas.style.pointerEvents = "none";
  host.appendChild(sourceCanvas);
  document.body.appendChild(host);

  const surface = {
    key: `${layer.id}-${shader}`,
    layerId: layer.id,
    shader,
    host,
    sourceCanvas,
    sourceCtx: sourceCanvas.getContext("2d", { alpha: true }),
    outputCanvas: null,
    vfx: null,
    ready: false,
    disposed: false,
    initPromise: null,
    uniformState: {},
    uniformGenerators,
  };

  surface.initPromise = initializeVfxSurface(surface, requestPreviewRefresh).catch((error) => {
    surface.error = error;
    console.error(`Failed to initialize VFX.js shader "${shader}".`, error);
    requestPreviewRefresh?.();
  });

  layer.runtime.vfxSurface = surface;
  layer.runtime.dispose = () => cleanupVfxSurface(surface);
  return surface;
}

function ensureVfxSurface(layer, shader, uniformGenerators, requestPreviewRefresh) {
  const existing = layer.runtime.vfxSurface;
  if (existing && existing.shader === shader && !existing.disposed) {
    return existing;
  }

  cleanupVfxSurface(existing);
  return createVfxSurface(layer, shader, uniformGenerators, requestPreviewRefresh);
}

function renderVfxCanvasShaderLayer({
  layer,
  sourceImageData,
  shader,
  uniforms = {},
  requestPreviewRefresh,
}) {
  if (!layer?.runtime || !sourceImageData) {
    return false;
  }

  const surface = ensureVfxSurface(layer, shader, uniforms, requestPreviewRefresh);
  surface.uniformState = uniforms;

  const { width: displayWidth, height: displayHeight } = getVfxDisplayCanvasSize(
    sourceImageData.width,
    sourceImageData.height,
  );
  resizeVfxSourceCanvas(surface, displayWidth, displayHeight);

  layer.runtime.bufferCtx.putImageData(sourceImageData, 0, 0);
  surface.sourceCtx.clearRect(0, 0, displayWidth, displayHeight);
  surface.sourceCtx.drawImage(layer.runtime.bufferCanvas, 0, 0, displayWidth, displayHeight);

  const targetCtx = layer.runtime.ctx;
  targetCtx.clearRect(0, 0, sourceImageData.width, sourceImageData.height);

  if (!surface.ready || !surface.outputCanvas || !surface.vfx) {
    return false;
  }

  surface.vfx.update(surface.sourceCanvas);
  surface.vfx.render();
  targetCtx.drawImage(
    surface.outputCanvas,
    0,
    0,
    displayWidth,
    displayHeight,
    0,
    0,
    sourceImageData.width,
    sourceImageData.height,
  );
  return true;
}

// Core math and color helpers are shared by every effect pass in this file. They keep the later
// renderers focused on look-dev logic instead of repeating low-level clamp, mix, and conversion code.
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
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

function withHighImageSmoothing(ctx, callback) {
  if (!ctx || typeof callback !== "function") {
    return;
  }

  const previousEnabled = ctx.imageSmoothingEnabled;
  const previousQuality = typeof ctx.imageSmoothingQuality === "string" ? ctx.imageSmoothingQuality : null;
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = "high";
  }

  try {
    callback();
  } finally {
    ctx.imageSmoothingEnabled = previousEnabled;
    if ("imageSmoothingQuality" in ctx) {
      ctx.imageSmoothingQuality = previousQuality || "low";
    }
  }
}

const EFFECT_COLORS = Object.freeze({
  clusterTrack: "#7ff4d8",
  motionThreshold: "#ff5a8e",
  datamoshSmear: "#ff7a64",
  greenCrt: "#66ff8d",
  blueCrt: "#5ca8ff",
  redCrt: "#c91f2c",
  nightVision: "#97ff58",
  vfxHalftone: "#ffd85b",
  vfxDuotone: "#ff86c3",
  prismExtrude: "#ff8fff",
  chromeRelief: "#dceaff",
  paperStack: "#ffbf7d",
  diamondPulse: "#ff86f6",
  orbitRings: "#70f5ff",
  warpMesh: "#ffd66c",
  totemEcho: "#8d9cff",
  scribbleAura: "#ff9b7e",
  highlightsOnly: "#f7f7ff",
  midtonesOnly: "#4fa8ff",
  shadowsOnly: "#3c538c",
  edgeGlow: "#61c8ff",
  filmGrain: "#d8d0be",
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
  imageFlash: "#ffe57f",
  filmMatteEffect: "#f3f3f3",
});

const DEFAULT_BLEND = "screen";
const DEFAULT_TRAIL = 0.28;

// Rack definitions power the "Add Layer" buttons and the inline controls exposed inside each layer.
// Each entry declares the layer type, its default params, and the controls available in the stack.
const EFFECT_DEFINITIONS = [
  {
    type: "clusterTrack",
    label: "Cluster Track",
    buttonLabel: "Cluster Track",
    accent: EFFECT_COLORS.clusterTrack,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { threshold: 0.18, detail: 0.68, trail: 0.48, size: 0.92, hue: 0.46, showTrails: true, showConnections: true, showLabels: true },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
      createSlider("size", "Size", 0.2, 1, 0.01),
      createSlider("hue", "Hue", 0, 1, 0.01),
      createToggle("showTrails", "Trails"),
      createToggle("showConnections", "Connections"),
      createToggle("showLabels", "Labels"),
    ],
  },
  {
    type: "motionThreshold",
    label: "Motion Threshold",
    buttonLabel: "Motion Threshold",
    accent: EFFECT_COLORS.motionThreshold,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { threshold: 0.15, detail: 0.64, trail: 0.34 },
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
    defaultParams: { threshold: 0.14, detail: 0.7, trail: 0.48, showTrails: true },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
      createToggle("showTrails", "Trails"),
    ],
  },
  {
    type: "boundingBoxes",
    label: "Bounding Boxes",
    buttonLabel: "Bounding Boxes",
    accent: EFFECT_COLORS.boundingBoxes,
    defaultBlend: DEFAULT_BLEND,
    defaultParams: { threshold: 0.14, detail: 0.7, trail: 0.28, showTrails: true },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
      createToggle("showTrails", "Trails"),
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
    defaultParams: { threshold: 0.12, hueWidth: 0.12, trail: 0.32 },
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
    defaultParams: { hue: 0.0, hueWidth: 0.07, trail: 0.68 },
    controls: [
      createSlider("hue", "Hue", 0, 1, 0.01),
      createSlider("hueWidth", "Hue Width", 0.02, 0.25, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
    ],
  },
  {
    type: "datamoshSmear",
    label: "Blur Smear",
    buttonLabel: "Blur Smear",
    accent: EFFECT_COLORS.datamoshSmear,
    rackDividerLabel: "NEW EFFECTS TESTING",
    defaultBlend: "normal",
    defaultParams: { threshold: 0.12, smear: 0.86, refresh: 0.08, detail: 0.64, signalLoss: 0.08, emissionRate: 1.35, lifetime: 0.5 },
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
    type: "imageFlash",
    label: "Flash",
    buttonLabel: "Flash",
    accent: EFFECT_COLORS.imageFlash,
    defaultBlend: "normal",
    defaultParams: { duration: 3, size: 0.34, travel: 0.72, flashRate: 5.6, glow: 0.56 },
    controls: [
      createSlider("duration", "Duration", 0.5, 6, 0.1, 1),
      createSlider("size", "Size", 0.12, 0.72, 0.01),
      createSlider("travel", "Travel", 0, 1, 0.01),
      createSlider("flashRate", "Flash Rate", 1, 12, 0.1, 1),
      createSlider("glow", "Glow", 0, 1, 0.01),
    ],
  },
  {
    type: "filmMatteEffect",
    label: "Film Matte Effect",
    buttonLabel: "Film Matte",
    accent: EFFECT_COLORS.filmMatteEffect,
    defaultBlend: "normal",
    defaultParams: {
      frameCount: 5,
      loopDuration: 3,
      offsetSpread: 1,
      framePadding: 18,
      grainIntensity: 0.24,
      flickerIntensity: 0.2,
    },
    controls: [
      createSlider("frameCount", "Frame Count", 3, 7, 1, 0),
      createSlider("loopDuration", "Loop Duration", 1, 6, 0.1, 1),
      createSlider("offsetSpread", "Offset Spread", 0.2, 2, 0.01),
      createSlider("framePadding", "Frame Padding", 0, 48, 1, 0),
      createSlider("grainIntensity", "Grain Intensity", 0, 1, 0.01),
      createSlider("flickerIntensity", "Flicker Intensity", 0, 1, 0.01),
    ],
  },
  {
    type: "vfxHalftone",
    label: "Halftone",
    buttonLabel: "Halftone",
    accent: EFFECT_COLORS.vfxHalftone,
    defaultBlend: "normal",
    defaultParams: {},
    controls: [],
  },
  {
    type: "vfxDuotone",
    label: "Duotone",
    buttonLabel: "Duotone",
    accent: EFFECT_COLORS.vfxDuotone,
    defaultBlend: "normal",
    defaultParams: {
      color1Hue: 0.62,
      color1Saturation: 0.74,
      color1Lightness: 0.18,
      color2Hue: 0.12,
      color2Saturation: 0.94,
      color2Lightness: 0.72,
      speed: 0.12,
    },
    controls: [
      createSlider("color1Hue", "Color 1 Hue", 0, 1, 0.01),
      createSlider("color1Saturation", "Color 1 Sat", 0, 1, 0.01),
      createSlider("color1Lightness", "Color 1 Light", 0, 1, 0.01),
      createSlider("color2Hue", "Color 2 Hue", 0, 1, 0.01),
      createSlider("color2Saturation", "Color 2 Sat", 0, 1, 0.01),
      createSlider("color2Lightness", "Color 2 Light", 0, 1, 0.01),
      createSlider("speed", "Speed", 0, 1, 0.01),
    ],
  },
  {
    type: "greenCrt",
    label: "Green CRT",
    buttonLabel: "Green Filter",
    accent: EFFECT_COLORS.greenCrt,
    defaultBlend: "normal",
    defaultParams: { intensity: 2.1, contrast: 1.7, grid: 1.4, glow: 1.6 },
    controls: [
      createSlider("intensity", "Intensity", 0, 5, 0.01),
      createSlider("contrast", "Contrast", 0, 5, 0.01),
      createSlider("grid", "Grid", 0, 5, 0.01),
      createSlider("glow", "Glow", 0, 5, 0.01),
    ],
  },
  {
    type: "blueCrt",
    label: "Blue CRT",
    buttonLabel: "Blue Filter",
    accent: EFFECT_COLORS.blueCrt,
    defaultBlend: "normal",
    defaultParams: { intensity: 2.1, contrast: 1.7, grid: 1.4, glow: 1.6 },
    controls: [
      createSlider("intensity", "Intensity", 0, 5, 0.01),
      createSlider("contrast", "Contrast", 0, 5, 0.01),
      createSlider("grid", "Grid", 0, 5, 0.01),
      createSlider("glow", "Glow", 0, 5, 0.01),
    ],
  },
  {
    type: "redCrt",
    label: "Red CRT",
    buttonLabel: "Red Filter",
    accent: EFFECT_COLORS.redCrt,
    defaultBlend: "normal",
    defaultParams: { intensity: 2.1, contrast: 1.7, grid: 1.4, glow: 1.6 },
    controls: [
      createSlider("intensity", "Intensity", 0, 5, 0.01),
      createSlider("contrast", "Contrast", 0, 5, 0.01),
      createSlider("grid", "Grid", 0, 5, 0.01),
      createSlider("glow", "Glow", 0, 5, 0.01),
    ],
  },
  {
    type: "nightVision",
    label: "Night Vision",
    buttonLabel: "Night Vision",
    accent: EFFECT_COLORS.nightVision,
    defaultBlend: "normal",
    defaultParams: {
      gain: 3.2,
      gamma: 1.6,
      contrast: 1.35,
      greenIntensity: 0.92,
      tintBalance: 0.42,
      desaturation: 0.88,
      noiseAmount: 0.22,
      noiseSize: 1.2,
      noiseFlicker: 0.72,
      bloom: 0.38,
      bloomThreshold: 0.64,
      vignetteStrength: 0.4,
      vignetteRadius: 0.72,
      sharpness: 0.28,
      edgeEnhance: 0.24,
      scanlineIntensity: 0.16,
      scanlineSpacing: 3,
      scanlineSpeed: 0.18,
      hotspot: 0.34,
      hotspotFalloff: 0.62,
      deadPixels: 0.08,
    },
    controls: [
      createSlider("gain", "Gain / Exposure", 0.4, 5, 0.01),
      createSlider("gamma", "Gamma", 0.4, 3, 0.01),
      createSlider("contrast", "Contrast", 0, 3, 0.01),
      createSlider("greenIntensity", "Green Intensity", 0, 1, 0.01),
      createSlider("tintBalance", "Tint Balance", 0, 1, 0.01),
      createSlider("desaturation", "Desaturation", 0, 1, 0.01),
      createSlider("noiseAmount", "Noise Amount", 0, 1, 0.01),
      createSlider("noiseSize", "Noise Size", 0.5, 4, 0.01),
      createSlider("noiseFlicker", "Noise Flicker", 0, 2, 0.01),
      createSlider("bloom", "Bloom / Glow", 0, 1.5, 0.01),
      createSlider("bloomThreshold", "Bloom Threshold", 0.2, 1, 0.01),
      createSlider("vignetteStrength", "Vignette Strength", 0, 1, 0.01),
      createSlider("vignetteRadius", "Vignette Radius", 0.2, 1.2, 0.01),
      createSlider("sharpness", "Sharpness", 0, 1, 0.01),
      createSlider("edgeEnhance", "Edge Enhance", 0, 1, 0.01),
      createSlider("scanlineIntensity", "Scanline Intensity", 0, 1, 0.01),
      createSlider("scanlineSpacing", "Scanline Spacing", 1, 10, 1, 0),
      createSlider("scanlineSpeed", "Scanline Speed", 0, 1, 0.01),
      createSlider("hotspot", "IR Hotspot", 0, 1, 0.01),
      createSlider("hotspotFalloff", "Hotspot Falloff", 0.1, 1, 0.01),
      createSlider("deadPixels", "Dead Pixels", 0, 1, 0.01),
    ],
  },
  {
    type: "prismExtrude",
    label: "Prism Extrude",
    buttonLabel: "Prism Extrude",
    accent: EFFECT_COLORS.prismExtrude,
    defaultBlend: "normal",
    defaultParams: { depth: 0.6, spread: 0.48, glow: 0.42, hue: 0.82 },
    controls: [
      createSlider("depth", "Depth", 0, 1, 0.01),
      createSlider("spread", "Spread", 0, 1, 0.01),
      createSlider("glow", "Glow", 0, 1, 0.01),
      createSlider("hue", "Hue", 0, 1, 0.01),
    ],
  },
  {
    type: "chromeRelief",
    label: "Chrome Relief",
    buttonLabel: "Chrome Relief",
    accent: EFFECT_COLORS.chromeRelief,
    defaultBlend: "normal",
    defaultParams: { depth: 0.78, polish: 0.72, edge: 0.64, tint: 0.58 },
    controls: [
      createSlider("depth", "Depth", 0, 1, 0.01),
      createSlider("polish", "Polish", 0, 1, 0.01),
      createSlider("edge", "Edge", 0, 1, 0.01),
      createSlider("tint", "Tint", 0, 1, 0.01),
    ],
  },
  {
    type: "diamondPulse",
    label: "Diamond Pulse",
    buttonLabel: "Diamond Pulse",
    accent: EFFECT_COLORS.diamondPulse,
    defaultBlend: "normal",
    defaultParams: { threshold: 0.14, detail: 0.66, trail: 0.32, hue: 0.88, size: 0.88, pulse: 0.6 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
      createSlider("hue", "Hue", 0, 1, 0.01),
      createSlider("size", "Size", 0.3, 1.6, 0.01),
      createSlider("pulse", "Pulse", 0, 1, 0.01),
    ],
  },
  {
    type: "orbitRings",
    label: "Orbit Rings",
    buttonLabel: "Orbit Rings",
    accent: EFFECT_COLORS.orbitRings,
    defaultBlend: "normal",
    defaultParams: { threshold: 0.14, detail: 0.64, trail: 0.24, hue: 0.16, radius: 0.84, sweep: 0.62 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
      createSlider("hue", "Hue", 0, 1, 0.01),
      createSlider("radius", "Radius", 0.2, 1.6, 0.01),
      createSlider("sweep", "Sweep", 0, 1, 0.01),
    ],
  },
  {
    type: "warpMesh",
    label: "Warp Mesh",
    buttonLabel: "Warp Mesh",
    accent: EFFECT_COLORS.warpMesh,
    defaultBlend: "normal",
    defaultParams: { threshold: 0.13, detail: 0.68, trail: 0.3, hue: 0.13, warp: 0.58, links: 0.68 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
      createSlider("hue", "Hue", 0, 1, 0.01),
      createSlider("warp", "Warp", 0, 1, 0.01),
      createSlider("links", "Links", 0, 1, 0.01),
    ],
  },
  {
    type: "totemEcho",
    label: "Totem Echo",
    buttonLabel: "Totem Echo",
    accent: EFFECT_COLORS.totemEcho,
    defaultBlend: "normal",
    defaultParams: { threshold: 0.14, detail: 0.62, trail: 0.38, hue: 0.66, depth: 0.62, drift: 0.48 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
      createSlider("hue", "Hue", 0, 1, 0.01),
      createSlider("depth", "Depth", 0, 1, 0.01),
      createSlider("drift", "Drift", 0, 1, 0.01),
    ],
  },
  {
    type: "scribbleAura",
    label: "Scribble Aura",
    buttonLabel: "Scribble Aura",
    accent: EFFECT_COLORS.scribbleAura,
    defaultBlend: "normal",
    defaultParams: { threshold: 0.14, detail: 0.72, trail: 0.3, hue: 0.04, wobble: 0.6, loops: 0.68 },
    controls: [
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("trail", "Trail", 0, 1, 0.01),
      createSlider("hue", "Hue", 0, 1, 0.01),
      createSlider("wobble", "Wobble", 0, 1, 0.01),
      createSlider("loops", "Loops", 0, 1, 0.01),
    ],
  },
  {
    type: "paperStack",
    label: "Paper Stack",
    buttonLabel: "Paper Stack",
    accent: EFFECT_COLORS.paperStack,
    defaultBlend: "normal",
    defaultParams: { offset: 0.48, poster: 0.68, shadow: 0.62, hue: 0.08 },
    controls: [
      createSlider("offset", "Offset", 0, 1, 0.01),
      createSlider("poster", "Poster", 0, 1, 0.01),
      createSlider("shadow", "Shadow", 0, 1, 0.01),
      createSlider("hue", "Hue", 0, 1, 0.01),
    ],
  },
  {
    type: "highlightsOnly",
    label: "Highlights Only",
    buttonLabel: "Highlights",
    accent: EFFECT_COLORS.highlightsOnly,
    defaultBlend: "normal",
    defaultParams: { blur: 0, brightness: 1.8, contrast: 2.6, softness: 0.16 },
    controls: [
      createSlider("blur", "Blur", 0, 12, 0.5, 1),
      createSlider("brightness", "Brightness", 0.6, 2.6, 0.01),
      createSlider("contrast", "Contrast", 0.6, 3.2, 0.01),
      createSlider("softness", "Softness", 0.04, 0.5, 0.01),
    ],
  },
  {
    type: "midtonesOnly",
    label: "Midtones Only",
    buttonLabel: "Midtones",
    accent: EFFECT_COLORS.midtonesOnly,
    defaultBlend: "normal",
    defaultParams: { blur: 0, brightness: 1.6, contrast: 2.2, softness: 0.18 },
    controls: [
      createSlider("blur", "Blur", 0, 12, 0.5, 1),
      createSlider("brightness", "Brightness", 0.6, 2.6, 0.01),
      createSlider("contrast", "Contrast", 0.6, 3.2, 0.01),
      createSlider("softness", "Softness", 0.04, 0.5, 0.01),
    ],
  },
  {
    type: "shadowsOnly",
    label: "Shadows Only",
    buttonLabel: "Shadows",
    accent: EFFECT_COLORS.shadowsOnly,
    defaultBlend: "normal",
    defaultParams: { blur: 0, brightness: 2.2, contrast: 2.9, softness: 0.16 },
    controls: [
      createSlider("blur", "Blur", 0, 12, 0.5, 1),
      createSlider("brightness", "Brightness", 0.6, 2.6, 0.01),
      createSlider("contrast", "Contrast", 0.6, 3.2, 0.01),
      createSlider("softness", "Softness", 0.04, 0.5, 0.01),
    ],
  },
  {
    type: "edgeGlow",
    label: "Edge Glow",
    buttonLabel: "Edge Glow",
    accent: EFFECT_COLORS.edgeGlow,
    defaultBlend: "screen",
    defaultParams: { threshold: 0.06, darkness: 0.34, glow: 1 },
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
    defaultParams: { amount: 0.5, contrast: 0.26, grainSize: 1.1, speed: 0.78 },
    controls: [
      createSlider("amount", "Amount", 0, 1, 0.01),
      createSlider("contrast", "Contrast", 0, 1, 0.01),
      createSlider("grainSize", "Grain Size", 1, 6, 0.1, 1),
      createSlider("speed", "Speed", 0.05, 1, 0.01),
    ],
  },
  {
    type: "punchBlackWhite",
    label: "Punch B&W",
    buttonLabel: "Punch B&W",
    accent: EFFECT_COLORS.punchBlackWhite,
    defaultBlend: "normal",
    defaultParams: { contrast: 0.96, screen: 0.44, crush: 0.56, roughness: 0.34 },
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
    defaultParams: { featureCount: 58, search: 0.62, detail: 0.66, emissionRate: 1.3, lifetime: 0.46 },
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
    defaultParams: { featureCount: 66, threshold: 0.16, detail: 0.68, emissionRate: 1.32, lifetime: 0.46 },
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
    defaultParams: { featureCount: 60, threshold: 0.16, detail: 0.64, emissionRate: 1.28, lifetime: 0.44 },
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
    defaultParams: { featureCount: 80, threshold: 0.16, detail: 0.7, emissionRate: 1.34, lifetime: 0.42 },
    controls: [
      createSlider("featureCount", "Features", 8, 112, 1, 0),
      createSlider("threshold", "Threshold", 0.02, 0.96, 0.01),
      createSlider("detail", "Detail", 0, 1, 0.01),
      createSlider("emissionRate", "Particle Emit", 0.1, 3, 0.01),
      createSlider("lifetime", "Particle Life", 0.05, 1, 0.01),
    ],
  },
];

const EFFECT_RACK_GROUP_ORDER = Object.freeze({
  tracking: 0,
  color: 1,
  particles: 2,
  new: 3,
});

const EFFECT_RACK_GROUP_LABELS = Object.freeze({
  tracking: "Tracking",
  color: "Color Effects",
  particles: "Particle Trackers",
  new: "NEW EFFECTS TESTING",
});

const EFFECT_TYPE_TO_RACK_GROUP = Object.freeze({
  clusterTrack: "tracking",
  motionThreshold: "tracking",
  multiBlob: "tracking",
  boundingBoxes: "tracking",
  skinTone: "tracking",
  greenScreenMotion: "tracking",
  colorCentroid: "tracking",
  diamondPulse: "tracking",
  orbitRings: "tracking",
  warpMesh: "tracking",
  totemEcho: "tracking",
  scribbleAura: "tracking",
  datamoshSmear: "color",
  vfxHalftone: "color",
  vfxDuotone: "color",
  greenCrt: "color",
  blueCrt: "color",
  redCrt: "color",
  prismExtrude: "color",
  chromeRelief: "color",
  paperStack: "color",
  highlightsOnly: "color",
  midtonesOnly: "color",
  shadowsOnly: "color",
  edgeGlow: "color",
  filmGrain: "color",
  punchBlackWhite: "color",
  imageFlash: "new",
  filmMatteEffect: "new",
  sparseOpticalFlow: "particles",
  harrisCorners: "particles",
  orbTracking: "particles",
  fastKeypoints: "particles",
  nightVision: "new",
});

EFFECT_DEFINITIONS.forEach((definition) => {
  const rackGroup = EFFECT_TYPE_TO_RACK_GROUP[definition.type] || "tracking";
  definition.rackGroup = rackGroup;
  definition.rackGroupLabel = EFFECT_RACK_GROUP_LABELS[rackGroup];
  definition.rackGroupOrder = EFFECT_RACK_GROUP_ORDER[rackGroup] ?? Number.MAX_SAFE_INTEGER;
});

const EFFECT_MAP = new Map(EFFECT_DEFINITIONS.map((definition) => [definition.type, definition]));

const MOTION_EFFECT_TYPES = new Set(EFFECT_DEFINITIONS.map((definition) => definition.type));

const CRT_FILTER_PROFILES = Object.freeze({
  greenCrt: Object.freeze({
    base: Object.freeze({ r: 88, g: 255, b: 136 }),
    highlight: Object.freeze({ r: 236, g: 255, b: 236 }),
    shadow: Object.freeze({ r: 4, g: 18, b: 7 }),
    stripe: Object.freeze([0.44, 1.08, 0.54]),
  }),
  blueCrt: Object.freeze({
    base: Object.freeze({ r: 86, g: 148, b: 255 }),
    highlight: Object.freeze({ r: 230, g: 242, b: 255 }),
    shadow: Object.freeze({ r: 4, g: 8, b: 18 }),
    stripe: Object.freeze([0.48, 0.58, 1.08]),
  }),
  redCrt: Object.freeze({
    base: Object.freeze({ r: 205, g: 18, b: 28 }),
    highlight: Object.freeze({ r: 255, g: 118, b: 112 }),
    shadow: Object.freeze({ r: 12, g: 0, b: 1 }),
    stripe: Object.freeze([1.18, 0.28, 0.22]),
  }),
});

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
    lumaIntegral: null,
    blurredLumaCache: new Map(),
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

function ensureLumaIntegral(analysis) {
  if (analysis.lumaIntegral) {
    return analysis.lumaIntegral;
  }

  const stride = analysis.width + 1;
  const integral = new Float32Array((analysis.height + 1) * stride);

  for (let y = 0; y < analysis.height; y += 1) {
    let rowSum = 0;
    const srcRow = y * analysis.width;
    const dstRow = (y + 1) * stride;
    const prevRow = y * stride;
    for (let x = 0; x < analysis.width; x += 1) {
      rowSum += analysis.luma[srcRow + x];
      integral[dstRow + x + 1] = integral[prevRow + x + 1] + rowSum;
    }
  }

  analysis.lumaIntegral = integral;
  return integral;
}

function ensureBlurredLuma(analysis, radius = 0) {
  const blurRadius = Math.max(0, Math.round(radius));
  if (analysis.blurredLumaCache.has(blurRadius)) {
    return analysis.blurredLumaCache.get(blurRadius);
  }

  if (blurRadius <= 0) {
    analysis.blurredLumaCache.set(0, analysis.luma);
    return analysis.luma;
  }

  const output = new Float32Array(analysis.pixels);
  const integral = ensureLumaIntegral(analysis);
  const stride = analysis.width + 1;

  for (let y = 0; y < analysis.height; y += 1) {
    const top = Math.max(0, y - blurRadius);
    const bottom = Math.min(analysis.height - 1, y + blurRadius);
    const row = y * analysis.width;
    for (let x = 0; x < analysis.width; x += 1) {
      const left = Math.max(0, x - blurRadius);
      const right = Math.min(analysis.width - 1, x + blurRadius);
      const sum = (
        integral[(bottom + 1) * stride + (right + 1)]
        - integral[top * stride + (right + 1)]
        - integral[(bottom + 1) * stride + left]
        + integral[top * stride + left]
      );
      const area = (right - left + 1) * (bottom - top + 1);
      output[row + x] = sum / area;
    }
  }

  analysis.blurredLumaCache.set(blurRadius, output);
  return output;
}

function ensureLayerState(layer, width, height) {
  const runtime = layer.runtime;
  const pixels = width * height;
  if (runtime.motionState?.width === width && runtime.motionState?.height === height) {
    return runtime.motionState;
  }

  // Each effect layer keeps its own track state, centroid trails, and particle pools so the
  // overlays survive frame-to-frame without leaking into other layers.
  runtime.motionState = {
    width,
    height,
    pixels,
    buffers: {},
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

function copyFrameToBuffer(buffer, analysis) {
  buffer.data.set(analysis.data);
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
      buffer.data[px] = analysis.data[px];
      buffer.data[px + 1] = analysis.data[px + 1];
      buffer.data[px + 2] = analysis.data[px + 2];
      buffer.data[px + 3] = Math.round(clamp(intensity, 0, 1) * 255);
    } else {
      buffer.data[px] = 0;
      buffer.data[px + 1] = 0;
      buffer.data[px + 2] = 0;
      buffer.data[px + 3] = 0;
    }
  }
}

function buildTonalIsolationMask(analysis, params, mode = "highlights") {
  const blur = clamp(params.blur ?? 0, 0, 12);
  const brightness = clamp(params.brightness ?? 1, 0.4, 3);
  const contrast = clamp(params.contrast ?? 1, 0.4, 4);
  const softness = clamp(params.softness ?? 0.18, 0.04, 0.5);
  const luma = ensureBlurredLuma(analysis, blur);
  const output = new Uint8Array(analysis.pixels);

  for (let index = 0; index < analysis.pixels; index += 1) {
    const normalized = clamp(luma[index] / 255, 0, 1);
    const filtered = clamp((normalized * brightness - 0.5) * contrast + 0.5, 0, 1);
    let intensity = 0;

    if (mode === "highlights") {
      const start = clamp(0.54 - softness * 0.14, 0.18, 0.86);
      const end = clamp(0.82 + softness * 0.08, start + 0.05, 0.99);
      intensity = Math.pow(smoothstep(start, end, filtered), 0.8);
    } else if (mode === "midtones") {
      const center = 0.52;
      const inner = 0.04 + softness * 0.08;
      const outer = inner + 0.16 + softness * 0.22;
      const distanceToCenter = Math.abs(filtered - center);
      intensity = 1 - smoothstep(inner, outer, distanceToCenter);
      intensity = Math.pow(clamp(intensity, 0, 1), 1.05);
    } else {
      const low = clamp(0.12 - softness * 0.04, 0.01, 0.36);
      const high = clamp(0.4 + softness * 0.12, low + 0.05, 0.82);
      intensity = Math.pow(1 - smoothstep(low, high, filtered), 0.9);
    }

    output[index] = Math.round(clamp(intensity, 0, 1) * 255);
  }

  return output;
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

function drawTargetReticle(ctx, x, y, size, color, alpha = 0.9) {
  const outer = Math.max(8, size);
  const gap = Math.max(3, outer * 0.28);
  const corner = outer * 0.72;
  const bracket = Math.max(3, outer * 0.24);

  ctx.save();
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  ctx.moveTo(x - outer, y);
  ctx.lineTo(x - gap, y);
  ctx.moveTo(x + gap, y);
  ctx.lineTo(x + outer, y);
  ctx.moveTo(x, y - outer);
  ctx.lineTo(x, y - gap);
  ctx.moveTo(x, y + gap);
  ctx.lineTo(x, y + outer);

  ctx.moveTo(x - corner, y - corner);
  ctx.lineTo(x - corner + bracket, y - corner);
  ctx.moveTo(x - corner, y - corner);
  ctx.lineTo(x - corner, y - corner + bracket);

  ctx.moveTo(x + corner, y - corner);
  ctx.lineTo(x + corner - bracket, y - corner);
  ctx.moveTo(x + corner, y - corner);
  ctx.lineTo(x + corner, y - corner + bracket);

  ctx.moveTo(x - corner, y + corner);
  ctx.lineTo(x - corner + bracket, y + corner);
  ctx.moveTo(x - corner, y + corner);
  ctx.lineTo(x - corner, y + corner - bracket);

  ctx.moveTo(x + corner, y + corner);
  ctx.lineTo(x + corner - bracket, y + corner);
  ctx.moveTo(x + corner, y + corner);
  ctx.lineTo(x + corner, y + corner - bracket);

  ctx.stroke();
  ctx.restore();
}

function drawDiamond(ctx, x, y, width, height, color, alpha = 0.9, rotation = 0, fillAlpha = 0) {
  const hw = width * 0.5;
  const hh = height * 0.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.lineTo(hw, 0);
  ctx.lineTo(0, hh);
  ctx.lineTo(-hw, 0);
  ctx.closePath();
  if (fillAlpha > 0.001) {
    ctx.fillStyle = rgba(color, fillAlpha);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(color, alpha);
  ctx.stroke();
  ctx.restore();
}

function drawSquareNode(ctx, x, y, size, color, alpha = 0.9, rotation = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-size * 0.5, -size * 0.5, size, size);
  ctx.restore();
}

const FILM_MATTE_SLOT_TEMPLATES = Object.freeze([
  Object.freeze({ x: 0.28, y: 0.18, width: 0.44, height: 0.64 }),
  Object.freeze({ x: 0.05, y: 0.07, width: 0.19, height: 0.24 }),
  Object.freeze({ x: 0.76, y: 0.07, width: 0.19, height: 0.24 }),
  Object.freeze({ x: 0.05, y: 0.69, width: 0.19, height: 0.24 }),
  Object.freeze({ x: 0.76, y: 0.69, width: 0.19, height: 0.24 }),
  Object.freeze({ x: 0.33, y: 0.05, width: 0.34, height: 0.15 }),
  Object.freeze({ x: 0.33, y: 0.8, width: 0.34, height: 0.15 }),
]);

const FILM_MATTE_VARIATIONS = Object.freeze([
  Object.freeze({ focusX: 0.5, focusY: 0.48, zoom: 1.06, rotation: -0.5, brightness: 0.02 }),
  Object.freeze({ focusX: 0.33, focusY: 0.32, zoom: 1.14, rotation: -1.4, brightness: -0.01 }),
  Object.freeze({ focusX: 0.68, focusY: 0.34, zoom: 1.12, rotation: 1.5, brightness: 0.01 }),
  Object.freeze({ focusX: 0.34, focusY: 0.72, zoom: 1.15, rotation: -1.1, brightness: -0.02 }),
  Object.freeze({ focusX: 0.69, focusY: 0.68, zoom: 1.13, rotation: 1.2, brightness: 0 }),
  Object.freeze({ focusX: 0.5, focusY: 0.28, zoom: 1.18, rotation: 0.7, brightness: 0.01 }),
  Object.freeze({ focusX: 0.5, focusY: 0.73, zoom: 1.16, rotation: -0.8, brightness: -0.01 }),
]);

function buildRoundedRectPath(ctx, x, y, width, height, radius) {
  const corner = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + corner, y);
  ctx.lineTo(x + width - corner, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + corner);
  ctx.lineTo(x + width, y + height - corner);
  ctx.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
  ctx.lineTo(x + corner, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - corner);
  ctx.lineTo(x, y + corner);
  ctx.quadraticCurveTo(x, y, x + corner, y);
  ctx.closePath();
}

function drawImageCoverWithFocus(ctx, source, dx, dy, dw, dh, {
  focusX = 0.5,
  focusY = 0.5,
  zoom = 1,
} = {}) {
  const sw = source?.videoWidth || source?.width || 0;
  const sh = source?.videoHeight || source?.height || 0;
  if (!sw || !sh || !dw || !dh) {
    return;
  }

  const destAspect = dw / dh;
  let sWidth = sw;
  let sHeight = sh;
  if (sw / sh > destAspect) {
    sWidth = sh * destAspect;
  } else {
    sHeight = sw / destAspect;
  }

  const zoomValue = Math.max(1, zoom);
  sWidth /= zoomValue;
  sHeight /= zoomValue;
  const sx = clamp(focusX * sw - sWidth * 0.5, 0, Math.max(0, sw - sWidth));
  const sy = clamp(focusY * sh - sHeight * 0.5, 0, Math.max(0, sh - sHeight));
  ctx.drawImage(source, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
}

function buildFilmMatteLayout(width, height, frameCount, padding) {
  return FILM_MATTE_SLOT_TEMPLATES
    .slice(0, Math.max(0, frameCount))
    .map((slot) => {
      const x = slot.x * width;
      const y = slot.y * height;
      const slotWidth = slot.width * width;
      const slotHeight = slot.height * height;
      const inset = Math.min(padding, slotWidth * 0.18, slotHeight * 0.18);
      return {
        x: x + inset,
        y: y + inset,
        width: Math.max(24, slotWidth - inset * 2),
        height: Math.max(24, slotHeight - inset * 2),
      };
    });
}

function createFilmMatteFrame(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = "medium";
  }
  return {
    canvas,
    ctx,
    captureTime: 0,
    stamp: 0,
  };
}

function resetFilmMatteBuffer(buffer) {
  if (!buffer) {
    return;
  }
  buffer.writeIndex = 0;
  buffer.filled = 0;
  buffer.lastCaptureMediaTime = null;
}

function ensureFilmMatteBuffer(state, source, loopDuration) {
  const sourceWidth = source?.videoWidth || source?.width || state.width;
  const sourceHeight = source?.videoHeight || source?.height || state.height;
  const snapshotScale = Math.min(1, FILM_MATTE_MAX_BUFFER_DIMENSION / Math.max(1, sourceWidth, sourceHeight));
  const snapshotWidth = Math.max(96, Math.round(sourceWidth * snapshotScale));
  const snapshotHeight = Math.max(54, Math.round(sourceHeight * snapshotScale));
  const maxFrames = Math.max(24, Math.min(160, Math.ceil(loopDuration * FILM_MATTE_BUFFER_FPS) + 10));
  const key = `${snapshotWidth}x${snapshotHeight}:${maxFrames}`;

  if (state.filmMatteBuffer?.key === key) {
    return state.filmMatteBuffer;
  }

  const frames = Array.from({ length: maxFrames }, () => createFilmMatteFrame(snapshotWidth, snapshotHeight));
  state.filmMatteBuffer = {
    key,
    frames,
    snapshotWidth,
    snapshotHeight,
    maxFrames,
    writeIndex: 0,
    filled: 0,
    stamp: 0,
    lastCaptureMediaTime: null,
    lastObservedMediaTime: null,
  };
  return state.filmMatteBuffer;
}

function captureFilmMatteFrame(buffer, source, mediaTime, loopDuration) {
  if (!buffer || !source) {
    return;
  }

  const currentTime = Number.isFinite(mediaTime) ? Math.max(0, mediaTime) : 0;
  const previousObservedTime = buffer.lastObservedMediaTime;
  buffer.lastObservedMediaTime = currentTime;

  if (previousObservedTime != null) {
    const delta = currentTime - previousObservedTime;
    if (delta < -0.05 || delta > Math.max(0.5, loopDuration * 0.35)) {
      resetFilmMatteBuffer(buffer);
    }
  }

  const captureStep = 1 / FILM_MATTE_BUFFER_FPS;
  if (
    buffer.lastCaptureMediaTime != null
    && Math.abs(currentTime - buffer.lastCaptureMediaTime) < captureStep * 0.7
  ) {
    return;
  }

  const frame = buffer.frames[buffer.writeIndex];
  frame.ctx.clearRect(0, 0, buffer.snapshotWidth, buffer.snapshotHeight);
  frame.ctx.drawImage(source, 0, 0, buffer.snapshotWidth, buffer.snapshotHeight);
  frame.captureTime = currentTime;
  buffer.stamp += 1;
  frame.stamp = buffer.stamp;
  buffer.lastCaptureMediaTime = currentTime;
  buffer.writeIndex = (buffer.writeIndex + 1) % buffer.maxFrames;
  buffer.filled = Math.min(buffer.filled + 1, buffer.maxFrames);
}

function resolveFilmMatteBufferedFrame(buffer, desiredPhase, loopDuration) {
  if (!buffer || !buffer.filled) {
    return null;
  }

  let bestFrame = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestStamp = -1;

  for (let index = 0; index < buffer.filled; index += 1) {
    const frame = buffer.frames[index];
    if (!frame?.stamp) {
      continue;
    }
    const phase = ((frame.captureTime % loopDuration) + loopDuration) % loopDuration;
    const delta = Math.abs(phase - desiredPhase);
    const circularDistance = Math.min(delta, loopDuration - delta);
    if (
      circularDistance < bestDistance - 0.0001
      || (Math.abs(circularDistance - bestDistance) <= 0.0001 && frame.stamp > bestStamp)
    ) {
      bestDistance = circularDistance;
      bestStamp = frame.stamp;
      bestFrame = frame;
    }
  }

  return bestFrame?.canvas || null;
}

function drawFilmMatteGrain(ctx, rect, elapsed, intensity, seed = 0) {
  if (intensity <= 0.001) {
    return;
  }

  const step = 4;
  const alphaScale = 0.028 + intensity * 0.1;
  for (let y = rect.y; y < rect.y + rect.height; y += step) {
    for (let x = rect.x; x < rect.x + rect.width; x += step) {
      const noise = sampleFilmNoise(
        x + seed * 13.7,
        y - seed * 7.3,
        elapsed * (0.8 + intensity * 2.4),
        0.075,
        911 + seed * 17,
      );
      const alpha = Math.abs(noise) * alphaScale;
      if (alpha <= 0.004) {
        continue;
      }
      ctx.fillStyle = noise >= 0
        ? `rgba(255, 255, 255, ${alpha})`
        : `rgba(0, 0, 0, ${alpha * 0.86})`;
      ctx.fillRect(x, y, step, step);
    }
  }
}

function buildTrackDistortedLoop(track, elapsed, amount = 0.4, points = 12) {
  const loop = [];
  const rx = track.width * 0.5;
  const ry = track.height * 0.5;
  for (let index = 0; index < points; index += 1) {
    const t = index / points;
    const angle = t * Math.PI * 2;
    const noise = sampleValueNoise(
      Math.cos(angle) * 1.7 + track.id * 0.33 + elapsed * 0.8,
      Math.sin(angle) * 1.7 + track.id * 0.21 - elapsed * 0.5,
      71,
    ) - 0.5;
    const radiusX = rx * (1 + noise * amount);
    const radiusY = ry * (1 + noise * amount);
    loop.push({
      x: track.x + Math.cos(angle) * radiusX,
      y: track.y + Math.sin(angle) * radiusY,
    });
  }
  return loop;
}

function strokeClosedLoop(ctx, points, color, alpha = 0.8) {
  if (!points || points.length < 3) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = rgba(color, alpha);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function resolveMotionTrackingColor(layer, fallbackHue = 0.6, saturation = 0.88, lightness = 0.66) {
  return typeof layer.params.hue === "number"
    ? hslToRgb(clamp(layer.params.hue, 0, 1), saturation, lightness)
    : hslToRgb(fallbackHue, saturation, lightness);
}

function collectStylizedMotionTracks(layer, analysis, preset, options = {}) {
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const mask = buildDensityMask(analysis, layer.params);
  const detections = buildTrackerDetections(analysis, mask, layer.params, preset, {
    cacheKey: options.cacheKey || `${layer.type}-tracks`,
    threshold: options.threshold ?? (0.08 + clamp(layer.params.threshold || 0.16, 0, 1) * 0.28),
    minCells: options.minCells || 2,
    multiplier: options.multiplier || 1,
  });
  const tracks = updateTracks(state, detections, {
    maxDistance: options.maxDistance ?? Math.max(32, getDetailBlockSize(layer.params, preset, 1.1) * 4),
    trailLength: options.trailLength || 20,
    smoothing: options.smoothing ?? 0.4,
    maxMissed: options.maxMissed || 8,
  });

  return { state, tracks };
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

function sampleValueNoise(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);

  const n00 = hashUnit3(x0, y0, seed);
  const n10 = hashUnit3(x0 + 1, y0, seed);
  const n01 = hashUnit3(x0, y0 + 1, seed);
  const n11 = hashUnit3(x0 + 1, y0 + 1, seed);

  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function sampleFilmNoise(x, y, time, scale, seed = 0) {
  const nx = x * scale;
  const ny = y * scale;
  const octaveA = sampleValueNoise(nx + time * 0.9, ny - time * 0.35, seed);
  const octaveB = sampleValueNoise(nx * 2.1 - time * 1.7, ny * 2.1 + time * 0.8, seed + 17);
  const octaveC = sampleValueNoise(nx * 4.4 + time * 2.6, ny * 4.1 - time * 1.9, seed + 53);
  return ((octaveA - 0.5) * 0.55 + (octaveB - 0.5) * 0.3 + (octaveC - 0.5) * 0.15) * 2;
}

function ensureDeadPixelField(state, width, height, amount = 0) {
  const clampedAmount = clamp(amount, 0, 1);
  const count = Math.round(clampedAmount * Math.max(0, Math.min(640, (width * height) / 2200)));
  const cacheKey = `${width}x${height}:${count}`;

  if (state.deadPixelField?.key === cacheKey) {
    return state.deadPixelField.items;
  }

  const items = [];
  for (let index = 0; index < count; index += 1) {
    items.push({
      x: Math.floor(hashUnit3(index, width, 911) * width),
      y: Math.floor(hashUnit3(height, index, 131) * height),
      strength: 0.45 + hashUnit3(index, 7, 19) * 0.55,
      size: hashUnit3(index, 27, 41) > 0.86 ? 2 : 1,
    });
  }

  state.deadPixelField = { key: cacheKey, items };
  return items;
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
  const color = typeof layer.params.hue === "number"
    ? hslToRgb(clamp(layer.params.hue, 0, 1), 0.86, 0.66)
    : getEffectColor(layer);
  const showTrails = layer.params.showTrails !== false;
  const showConnections = layer.params.showConnections !== false;
  const sizeScale = clamp(layer.params.size ?? 1, 0.2, 1);
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

  beginLayerTrail(layer, showTrails ? (layer.params.trail ?? DEFAULT_TRAIL) : 0, "screen");
  const ctx = layer.runtime.ctx;
  ctx.save();
  ctx.strokeStyle = rgba(color, 0.85);
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = showTrails ? rgba(color, 0.42) : "rgba(0, 0, 0, 0)";
  ctx.shadowBlur = showTrails ? 12 : 0;

  tracks.forEach((track, index) => {
    if (track.missed > 2) {
      return;
    }
    if (showTrails) {
      drawTrail(ctx, track.trail, color, 1.4, 0.42);
    }
    const drawWidth = track.width * sizeScale;
    const drawHeight = track.height * sizeScale;
    const x = track.x - drawWidth * 0.5;
    const y = track.y - drawHeight * 0.5;
    ctx.strokeRect(x, y, drawWidth, drawHeight);
    drawCrosshair(ctx, track.x, track.y, 3.5 + sizeScale * 1.5, color, 0.84);
    if (layer.params.showLabels) {
      ctx.fillStyle = rgba(color, 0.92);
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillText(`T${track.id}`, x + 2, Math.max(10, y - 4 - (index % 2) * 11));
    }
  });

  if (showConnections && tracks.length > 1) {
    ctx.strokeStyle = rgba(color, showTrails ? 0.24 : 0.52);
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
// Blur Smear reuses motion tracks to drag old frame data forward, and the new Signal Loss
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

function renderEdgeGlowLayer(layer, analysis) {
  // Edge Glow darkens the source image and then screens a softened edge buffer over the top so
  // contours pop like a neon-outline pass.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const color = getEffectColor(layer);
  const baseBuffer = ensureImageBuffer(state, "edge-glow-base", analysis.width, analysis.height);
  const edgeBuffer = ensureImageBuffer(state, "edge-glow-edges", analysis.width, analysis.height);
  const edge = ensureFrameDerivatives(analysis.currentFrame).edge;
  const threshold = 4 + clamp(layer.params.threshold ?? 0.08, 0, 1) * 88;
  const darkness = clamp(layer.params.darkness ?? 0.28, 0, 1);
  const glow = clamp(layer.params.glow ?? 0.92, 0, 1);
  const baseScale = 1 - darkness * 0.54;

  for (let index = 0, px = 0; index < analysis.pixels; index += 1, px += 4) {
    baseBuffer.data[px] = clamp(Math.round(analysis.data[px] * baseScale), 0, 255);
    baseBuffer.data[px + 1] = clamp(Math.round(analysis.data[px + 1] * baseScale), 0, 255);
    baseBuffer.data[px + 2] = clamp(Math.round(analysis.data[px + 2] * baseScale), 0, 255);
    baseBuffer.data[px + 3] = 255;

    const contrastBoost = clamp(analysis.colorDiff[index] / 255, 0, 1);
    const edgeLift = clamp((edge[index] - threshold) / Math.max(1, 172 - threshold), 0, 1);
    const intensity = clamp(Math.pow(edgeLift, 0.58) + contrastBoost * 0.22, 0, 1);
    if (intensity <= 0.002) {
      edgeBuffer.data[px + 3] = 0;
      continue;
    }

    const neon = mixRgb(color, { r: 255, g: 255, b: 255 }, 0.52 + intensity * 0.34);
    edgeBuffer.data[px] = neon.r;
    edgeBuffer.data[px + 1] = neon.g;
    edgeBuffer.data[px + 2] = neon.b;
    edgeBuffer.data[px + 3] = Math.round(clamp(0.08 + intensity * (0.78 + glow * 0.28), 0, 1) * 255);
  }

  const ctx = layer.runtime.ctx;
  layer.runtime.bufferCtx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.bufferCtx.putImageData(baseBuffer.imageData, 0, 0);
  layer.runtime.auxCtx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.auxCtx.putImageData(edgeBuffer.imageData, 0, 0);

  ctx.clearRect(0, 0, analysis.width, analysis.height);
  ctx.save();
  ctx.globalAlpha = 0.42 + (1 - darkness) * 0.32;
  ctx.drawImage(layer.runtime.bufferCanvas, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.92;
  ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.34 + glow * 0.46;
  ctx.filter = `blur(${2.2 + glow * 5.8}px)`;
  ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
  ctx.globalAlpha = 0.16 + glow * 0.28;
  ctx.filter = `blur(${7 + glow * 11}px)`;
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
  const amount = clamp(layer.params.amount ?? 0.38, 0, 1);
  const contrast = 1 + clamp(layer.params.contrast ?? 0.18, 0, 1) * 1.15;
  const grainSize = Math.max(1, layer.params.grainSize ?? 1.2);
  const speed = clamp(layer.params.speed ?? 0.68, 0.05, 1);
  const grainScale = 0.7 / (0.8 + grainSize * 0.7);
  const time = elapsed * (0.8 + speed * 3.4);

  for (let y = 0; y < analysis.height; y += 1) {
    const row = y * analysis.width;
    for (let x = 0; x < analysis.width; x += 1) {
      const index = row + x;
      const px = index * 4;
      const tone = analysis.luma[index] / 255;
      const response = clamp(0.24 + (1 - Math.abs(tone - 0.42) * 1.55), 0.18, 1.06);
      const monoNoise = sampleFilmNoise(x, y, time, grainScale, 91);
      const clumpNoise = sampleFilmNoise(x, y, time * 0.62, grainScale * 0.45, 173);
      const chromaNoiseR = sampleFilmNoise(x + 7.3, y - 2.9, time * 1.18, grainScale * 1.22, 227);
      const chromaNoiseB = sampleFilmNoise(x - 5.1, y + 9.7, time * 1.06, grainScale * 1.28, 317);
      const grain = (monoNoise * 0.76 + clumpNoise * 0.24) * (4 + amount * 24) * response;
      const colorDrift = amount * 3.8 * response;
      const baseR = (analysis.data[px] - 128) * contrast + 128;
      const baseG = (analysis.data[px + 1] - 128) * contrast + 128;
      const baseB = (analysis.data[px + 2] - 128) * contrast + 128;

      buffer.data[px] = clamp(Math.round(baseR + grain + chromaNoiseR * colorDrift), 0, 255);
      buffer.data[px + 1] = clamp(Math.round(baseG + grain * 0.94), 0, 255);
      buffer.data[px + 2] = clamp(Math.round(baseB + grain + chromaNoiseB * colorDrift), 0, 255);
      buffer.data[px + 3] = 255;
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
  const showTrails = layer.params.showTrails !== false;
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

  beginLayerTrail(layer, showTrails ? (layer.params.trail ?? 0.24) : 0, "screen");
  const ctx = layer.runtime.ctx;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = showTrails ? rgba(color, 0.24) : "rgba(0, 0, 0, 0)";
  ctx.shadowBlur = showTrails ? 10 : 0;

  tracks.forEach((track) => {
    if (track.missed > 2) {
      return;
    }

    if (style === "blob") {
      if (showTrails) {
        drawTrail(ctx, track.trail, color, 1.6, 0.42);
      }
      drawTargetReticle(ctx, track.x, track.y, Math.max(track.width, track.height) * 0.36, color, 0.88);
      return;
    }

    if (showTrails) {
      drawTrail(ctx, track.trail, color, 1.1, 0.28);
    }
    ctx.strokeStyle = rgba(color, 0.88);
    ctx.lineWidth = 1.4;
    const left = track.x - track.width * 0.5;
    const top = track.y - track.height * 0.5;
    const right = left + track.width;
    const bottom = top + track.height;
    ctx.strokeRect(left, top, track.width, track.height);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(right, bottom);
    ctx.moveTo(right, top);
    ctx.lineTo(left, bottom);
    ctx.stroke();
  });

  ctx.restore();
  finishLayerTrail(layer);
}

function renderTonalIsolationLayer(layer, analysis, mode = "highlights") {
  // These tone-isolation layers mimic the highlight/midtone/shadow webcam masks by filtering the
  // frame down to one tonal band and returning only those source pixels on black.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const buffer = ensureImageBuffer(state, `${mode}-tone-mask`, analysis.width, analysis.height);
  const mask = buildTonalIsolationMask(analysis, layer.params, mode);
  writeMaskedSourceToBuffer(buffer, analysis, mask);
  layer.runtime.ctx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.ctx.putImageData(buffer.imageData, 0, 0);
  finishLayerTrail(layer);
}

function renderCrtTintFilterLayer(layer, analysis, elapsed = 0) {
  // These RGB CRT filters are full-frame treatments: they crush the source into a harsh
  // monochrome phosphor pass, then layer in a fine slot-mask/grid so the image feels like it is
  // being viewed through a colored monitor instead of a flat tint overlay.
  const profile = CRT_FILTER_PROFILES[layer.type] || CRT_FILTER_PROFILES.greenCrt;
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const displayBuffer = ensureImageBuffer(state, `${layer.type}-crt-display`, analysis.width, analysis.height);
  const glowBuffer = ensureImageBuffer(state, `${layer.type}-crt-glow`, analysis.width, analysis.height);
  const intensity = clamp(layer.params.intensity ?? 0, 0, 5);
  const contrast = clamp(layer.params.contrast ?? 0, 0, 5);
  const grid = clamp(layer.params.grid ?? 1, 0, 5);
  const glow = clamp(layer.params.glow ?? 1, 0, 5);
  const contrastGain = 1 + contrast * 1.6;
  const intensityGain = intensity / 5;
  const gridStrength = grid;
  const glowStrength = glow;
  const flicker = 0.988 + Math.sin(elapsed * 15.2) * (0.01 + glowStrength * 0.002);

  for (let y = 0; y < analysis.height; y += 1) {
    const row = y * analysis.width;
    const scanMask = y % 3 === 0 ? clamp(1 - gridStrength * 0.045, 0.58, 1) : 1;
    const rowGrid = y % 6 === 0 ? clamp(1 - gridStrength * 0.026, 0.68, 1) : 1;
    const slotLine = y % 9 === 0 ? clamp(1 - gridStrength * 0.016, 0.78, 1) : 1;

    for (let x = 0; x < analysis.width; x += 1) {
      const index = row + x;
      const px = index * 4;
      const tone = analysis.luma[index] / 255;
      const sourcePeak = Math.max(analysis.data[px], analysis.data[px + 1], analysis.data[px + 2]) / 255;
      const contrastTone = clamp((tone - 0.5) * contrastGain + 0.5, 0, 1);
      const beam = clamp(
        Math.pow(contrastTone, clamp(0.72 - intensityGain * 0.48, 0.18, 1.1))
          * (0.78 + intensityGain * 1.8)
          + sourcePeak * (0.16 + intensityGain * 0.42),
        0,
        1,
      );
      const stripe = profile.stripe[x % 3];
      const columnGrid = x % 4 === 0
        ? clamp(1 - gridStrength * 0.09, 0.34, 1)
        : x % 4 === 3
          ? clamp(1 - gridStrength * 0.02, 0.8, 1)
          : 1;
      const microGrid = x % 9 === 0 ? clamp(1 - gridStrength * 0.03, 0.62, 1) : 1;
      const mask = stripe * columnGrid * microGrid * scanMask * rowGrid * slotLine * flicker;
      const drive = clamp(beam * mask, 0, 1);
      const tint = mixRgb(profile.base, profile.highlight, Math.pow(beam, 0.82) * (0.6 + intensityGain * 0.28));
      const shadowLift = 0.02 + beam * (0.08 + glowStrength * 0.008);

      displayBuffer.data[px] = clamp(Math.round(profile.shadow.r * shadowLift + tint.r * drive), 0, 255);
      displayBuffer.data[px + 1] = clamp(Math.round(profile.shadow.g * shadowLift + tint.g * drive), 0, 255);
      displayBuffer.data[px + 2] = clamp(Math.round(profile.shadow.b * shadowLift + tint.b * drive), 0, 255);
      displayBuffer.data[px + 3] = 255;

      const bloom = Math.pow(clamp((beam - (0.64 - intensityGain * 0.18)) / 0.42, 0, 1), 1.35);
      glowBuffer.data[px] = tint.r;
      glowBuffer.data[px + 1] = tint.g;
      glowBuffer.data[px + 2] = tint.b;
      glowBuffer.data[px + 3] = Math.round(clamp(bloom * (0.06 + glowStrength * 0.12), 0, 1) * 255);
    }
  }

  const ctx = layer.runtime.ctx;
  layer.runtime.bufferCtx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.bufferCtx.putImageData(displayBuffer.imageData, 0, 0);
  layer.runtime.auxCtx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.auxCtx.putImageData(glowBuffer.imageData, 0, 0);

  ctx.clearRect(0, 0, analysis.width, analysis.height);
  ctx.drawImage(layer.runtime.bufferCanvas, 0, 0);

  if (glowStrength > 0.001) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = Math.min(0.72, 0.1 + glowStrength * 0.12);
    ctx.filter = `blur(${0.6 + glowStrength * 1.7}px)`;
    ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
    if (glowStrength > 1.2) {
      ctx.globalAlpha = Math.min(0.5, 0.08 + glowStrength * 0.06);
      ctx.filter = `blur(${2 + glowStrength * 1.35}px)`;
      ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
    }
    ctx.filter = "none";
    ctx.restore();
  }

  finishLayerTrail(layer);
}

function renderNightVisionLayer(layer, analysis, elapsed = 0) {
  // Night Vision mimics a phosphor tube pass by lifting dark detail, pushing it into a green
  // palette, then layering in bloom, sensor noise, scanlines, and tube-style falloff.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const displayBuffer = ensureImageBuffer(state, "night-vision-display", analysis.width, analysis.height);
  const glowBuffer = ensureImageBuffer(state, "night-vision-glow", analysis.width, analysis.height);
  const gain = clamp(layer.params.gain ?? 3.2, 0.4, 5);
  const gamma = clamp(layer.params.gamma ?? 1.6, 0.4, 3);
  const contrast = clamp(layer.params.contrast ?? 1.35, 0, 3);
  const greenIntensity = clamp(layer.params.greenIntensity ?? 0.92, 0, 1);
  const tintBalance = clamp(layer.params.tintBalance ?? 0.42, 0, 1);
  const desaturation = clamp(layer.params.desaturation ?? 0.88, 0, 1);
  const noiseAmount = clamp(layer.params.noiseAmount ?? 0.22, 0, 1);
  const noiseSize = Math.max(0.5, layer.params.noiseSize ?? 1.2);
  const noiseFlicker = clamp(layer.params.noiseFlicker ?? 0.72, 0, 2);
  const bloom = clamp(layer.params.bloom ?? 0.38, 0, 1.5);
  const bloomThreshold = clamp(layer.params.bloomThreshold ?? 0.64, 0.2, 1);
  const vignetteStrength = clamp(layer.params.vignetteStrength ?? 0.4, 0, 1);
  const vignetteRadius = clamp(layer.params.vignetteRadius ?? 0.72, 0.2, 1.2);
  const sharpness = clamp(layer.params.sharpness ?? 0.28, 0, 1);
  const edgeEnhance = clamp(layer.params.edgeEnhance ?? 0.24, 0, 1);
  const scanlineIntensity = clamp(layer.params.scanlineIntensity ?? 0.16, 0, 1);
  const scanlineSpacing = Math.max(1, Math.round(layer.params.scanlineSpacing ?? 3));
  const scanlineSpeed = clamp(layer.params.scanlineSpeed ?? 0.18, 0, 1);
  const hotspot = clamp(layer.params.hotspot ?? 0.34, 0, 1);
  const hotspotFalloff = clamp(layer.params.hotspotFalloff ?? 0.62, 0.1, 1);
  const deadPixels = clamp(layer.params.deadPixels ?? 0.08, 0, 1);
  const sharpenLuma = ensureBlurredLuma(analysis, sharpness > 0.001 ? 1 : 0);
  const bloomLuma = ensureBlurredLuma(analysis, bloom > 0.001 ? 1 + Math.round(bloom * 4) : 0);
  const edge = ensureFrameDerivatives(analysis.currentFrame).edge;
  const phosphor = hslToRgb(lerp(0.22, 0.42, tintBalance), 0.84, 0.56);
  const highlight = mixRgb(phosphor, { r: 245, g: 255, b: 224 }, 0.5);
  const shadow = { r: 2, g: 8, b: 2 };
  const grainScale = 0.92 / (0.7 + noiseSize * 0.88);
  const time = elapsed * (0.7 + noiseFlicker * 4.6);
  const centerX = analysis.width * 0.5;
  const centerY = analysis.height * 0.48;
  const radiusPivot = 0.3 + vignetteRadius * 0.78;
  const hotspotRadius = 0.18 + hotspotFalloff * 0.72;

  for (let y = 0; y < analysis.height; y += 1) {
    const row = y * analysis.width;
    const normalizedY = (y + 0.5 - centerY) / (analysis.height * 0.5);
    const scanWave = 0.5 + 0.5 * Math.cos((((y / scanlineSpacing) + elapsed * scanlineSpeed * 6) * Math.PI * 2));
    const scanMask = 1 - scanlineIntensity * (0.1 + scanWave * 0.34);

    for (let x = 0; x < analysis.width; x += 1) {
      const index = row + x;
      const px = index * 4;
      const normalizedX = (x + 0.5 - centerX) / (analysis.width * 0.5);
      const radial = Math.hypot(normalizedX / 1.02, normalizedY / 0.84);
      const rawLuma = analysis.luma[index] / 255;
      const avgSource = (analysis.data[px] + analysis.data[px + 1] + analysis.data[px + 2]) / 765;
      const mono = lerp(avgSource, rawLuma, 0.35 + desaturation * 0.65);
      const lifted = Math.pow(clamp(mono, 0, 1), 1 / gamma);
      const exposed = lifted * gain;
      const contrastTone = clamp((exposed - 0.5) * (1 + contrast * 1.8) + 0.5, 0, 1.9);
      const sharpen = sharpness > 0.001 ? (rawLuma - sharpenLuma[index] / 255) * sharpness * 1.85 : 0;
      const edgeBoost = (edge[index] / 255) * edgeEnhance * 0.34;
      const vignette = 1 - vignetteStrength * Math.pow(clamp((radial - radiusPivot * 0.5) / (1.28 - radiusPivot * 0.18), 0, 1), 1.7);
      const hotspotMask = Math.pow(clamp(1 - radial / hotspotRadius, 0, 1), 1.6 + (1 - hotspotFalloff) * 2.4);
      const illumination = clamp(vignette + hotspot * hotspotMask * 0.78, 0.16, 1.5);
      const noise = sampleFilmNoise(x, y, time, grainScale, 403) * noiseAmount * (0.08 + contrastTone * 0.2);
      const beam = clamp((contrastTone + sharpen + edgeBoost + noise) * illumination * scanMask, 0, 2.2);
      const tintMix = clamp(greenIntensity * (0.78 + beam * 0.12), 0, 1);
      const monoByte = clamp(beam, 0, 1.3) * 255;
      const tintedR = monoByte * lerp(1, phosphor.r / 255, tintMix);
      const tintedG = monoByte * lerp(1, phosphor.g / 255, tintMix);
      const tintedB = monoByte * lerp(1, phosphor.b / 255, tintMix);
      const visibleMix = clamp(beam * 0.88, 0, 1);
      let outR = lerp(shadow.r, tintedR, visibleMix);
      let outG = lerp(shadow.g, tintedG, visibleMix);
      let outB = lerp(shadow.b, tintedB, visibleMix);
      const highlightMix = clamp((beam - 0.72) * 1.2, 0, 1);
      outR = lerp(outR, highlight.r, highlightMix * 0.58);
      outG = lerp(outG, highlight.g, highlightMix * 0.64);
      outB = lerp(outB, highlight.b, highlightMix * 0.42);

      displayBuffer.data[px] = clamp(Math.round(outR), 0, 255);
      displayBuffer.data[px + 1] = clamp(Math.round(outG), 0, 255);
      displayBuffer.data[px + 2] = clamp(Math.round(outB), 0, 255);
      displayBuffer.data[px + 3] = 255;

      const bloomSource = bloomLuma[index] / 255;
      const bloomResponse = Math.pow(clamp((bloomSource * Math.min(gain, 2.4) - bloomThreshold) / Math.max(0.08, 1 - bloomThreshold), 0, 1), 1.2);
      glowBuffer.data[px] = highlight.r;
      glowBuffer.data[px + 1] = highlight.g;
      glowBuffer.data[px + 2] = highlight.b;
      glowBuffer.data[px + 3] = Math.round(clamp(bloomResponse * (0.04 + bloom * 0.18), 0, 1) * 255);
    }
  }

  const ctx = layer.runtime.ctx;
  ctx.clearRect(0, 0, analysis.width, analysis.height);
  ctx.putImageData(displayBuffer.imageData, 0, 0);

  if (bloom > 0.001) {
    layer.runtime.auxCtx.clearRect(0, 0, analysis.width, analysis.height);
    layer.runtime.auxCtx.putImageData(glowBuffer.imageData, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = Math.min(0.86, 0.08 + bloom * 0.16);
    ctx.filter = `blur(${0.8 + bloom * 2.8}px)`;
    ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
    if (bloom > 0.45) {
      ctx.globalAlpha = Math.min(0.42, 0.04 + bloom * 0.08);
      ctx.filter = `blur(${2 + bloom * 4.6}px)`;
      ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
    }
    ctx.filter = "none";
    ctx.restore();
  }

  const stuckPixels = ensureDeadPixelField(state, analysis.width, analysis.height, deadPixels);
  if (stuckPixels.length) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    stuckPixels.forEach((pixel, index) => {
      const blink = 0.72 + Math.sin(elapsed * (1.3 + pixel.strength) + index * 0.9) * 0.18;
      ctx.fillStyle = rgba(highlight, clamp(pixel.strength * blink, 0, 1));
      ctx.fillRect(pixel.x, pixel.y, pixel.size, pixel.size);
    });
    ctx.restore();
  }

  finishLayerTrail(layer);
}

function renderVfxHalftoneLayer(layer, sourceImageData, requestPreviewRefresh) {
  renderVfxCanvasShaderLayer({
    layer,
    sourceImageData,
    shader: "halftone",
    requestPreviewRefresh,
  });
  finishLayerTrail(layer);
}

function renderVfxDuotoneLayer(layer, sourceImageData, requestPreviewRefresh) {
  const color1 = hslToRgb(
    clamp(layer.params.color1Hue ?? 0.62, 0, 1),
    clamp(layer.params.color1Saturation ?? 0.74, 0, 1),
    clamp(layer.params.color1Lightness ?? 0.18, 0, 1),
  );
  const color2 = hslToRgb(
    clamp(layer.params.color2Hue ?? 0.12, 0, 1),
    clamp(layer.params.color2Saturation ?? 0.94, 0, 1),
    clamp(layer.params.color2Lightness ?? 0.72, 0, 1),
  );

  renderVfxCanvasShaderLayer({
    layer,
    sourceImageData,
    shader: "duotone",
    requestPreviewRefresh,
    uniforms: {
      color1: () => [color1.r / 255, color1.g / 255, color1.b / 255, 1],
      color2: () => [color2.r / 255, color2.g / 255, color2.b / 255, 1],
      speed: () => clamp(layer.params.speed ?? 0.12, 0, 1),
    },
  });
  finishLayerTrail(layer);
}

function renderImageFlashLayer(layer, analysis, mediaTime = 0, requestPreviewRefresh) {
  const ctx = layer.runtime.ctx;
  ctx.clearRect(0, 0, analysis.width, analysis.height);

  const asset = loadImageEffectAsset("imageFlash", requestPreviewRefresh);
  if (!asset) {
    finishLayerTrail(layer);
    return;
  }

  if (asset.error) {
    if (!asset.loggedError) {
      asset.loggedError = true;
      console.error(asset.error);
    }
    finishLayerTrail(layer);
    return;
  }

  if (!asset.ready || !asset.image?.width || !asset.image?.height) {
    finishLayerTrail(layer);
    return;
  }

  const duration = clamp(layer.params.duration ?? 3, 0.5, 6);
  const currentTime = Number.isFinite(mediaTime) ? Math.max(0, mediaTime) : 0;
  if (currentTime > duration) {
    finishLayerTrail(layer);
    return;
  }

  const progress = clamp(currentTime / duration, 0, 1);
  const entry = smoothstep(0, 0.44, progress);
  const exit = 1 - smoothstep(0.82, 1, progress);
  const envelope = entry * exit;
  const flashRate = clamp(layer.params.flashRate ?? 5.6, 1, 12);
  const flashPulse = 0.5 + 0.5 * Math.abs(Math.sin(currentTime * Math.PI * flashRate));
  const flashAlpha = clamp(envelope * (0.4 + flashPulse * 0.6), 0, 1);
  const size = clamp(layer.params.size ?? 0.34, 0.12, 0.72);
  const travel = clamp(layer.params.travel ?? 0.72, 0, 1);
  const glow = clamp(layer.params.glow ?? 0.56, 0, 1);
  const baseSize = Math.min(analysis.width, analysis.height) * (0.16 + size * 0.54);
  const imageAspect = asset.image.width / Math.max(1, asset.image.height);
  const breathing = 1 + Math.sin(progress * Math.PI) * 0.05 + flashPulse * 0.02;
  const drawWidth = baseSize * breathing;
  const drawHeight = drawWidth / Math.max(0.001, imageAspect);
  const offscreenX = -drawWidth * (0.8 + travel * 0.85);
  const finalX = analysis.width * 0.53 - drawWidth * 0.5;
  const startY = analysis.height * (0.76 + travel * 0.06) - drawHeight * 0.5;
  const finalY = analysis.height * 0.58 - drawHeight * 0.5;
  const drawX = lerp(offscreenX, finalX, entry);
  const drawY = lerp(startY, finalY, entry) - Math.sin(entry * Math.PI) * (6 + travel * 14);
  const centerX = drawX + drawWidth * 0.5;
  const centerY = drawY + drawHeight * 0.5;
  const rotation = lerp(-0.26 - travel * 0.08, -0.03, entry);
  const haloAlpha = flashAlpha * (0.08 + glow * 0.16) * (0.6 + flashPulse * 0.4);
  const haloRadius = Math.max(drawWidth, drawHeight) * (0.42 + glow * 0.4);
  const flashOffset = (flashPulse - 0.5) * (6 + glow * 12);

  if (haloAlpha > 0.001) {
    const gradient = ctx.createRadialGradient(centerX, centerY, haloRadius * 0.08, centerX, centerY, haloRadius);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${haloAlpha})`);
    gradient.addColorStop(0.4, `rgba(255, 246, 186, ${haloAlpha * 0.72})`);
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, analysis.width, analysis.height);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(centerX - flashOffset * 0.4, centerY + flashOffset * 0.18);
  ctx.rotate(rotation * 0.92);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = flashAlpha * (0.18 + glow * 0.22);
  ctx.filter = `blur(${1.2 + glow * 8}px)`;
  withHighImageSmoothing(ctx, () => {
    ctx.drawImage(asset.image, -drawWidth * 0.56, -drawHeight * 0.56, drawWidth * 1.12, drawHeight * 1.12);
  });
  ctx.restore();

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(rotation);
  ctx.globalAlpha = flashAlpha;
  ctx.shadowColor = `rgba(255, 248, 220, ${0.24 + glow * 0.3})`;
  ctx.shadowBlur = 8 + glow * 20;
  withHighImageSmoothing(ctx, () => {
    ctx.drawImage(asset.image, -drawWidth * 0.5, -drawHeight * 0.5, drawWidth, drawHeight);
  });
  ctx.restore();

  ctx.save();
  ctx.translate(centerX + flashOffset, centerY - flashOffset * 0.4);
  ctx.rotate(rotation * 0.8);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = flashAlpha * (0.1 + glow * 0.12);
  withHighImageSmoothing(ctx, () => {
    ctx.drawImage(asset.image, -drawWidth * 0.48, -drawHeight * 0.48, drawWidth * 0.96, drawHeight * 0.96);
  });
  ctx.restore();

  finishLayerTrail(layer);
}

function renderFilmMatteEffectLayer(layer, analysis, sourceFrameCanvas, mediaTime = 0, elapsed = 0) {
  const ctx = layer.runtime.ctx;
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const frameCount = Math.max(3, Math.min(7, Math.round(layer.params.frameCount ?? 5)));
  const loopDuration = clamp(layer.params.loopDuration ?? 3, 1, 6);
  const offsetSpread = clamp(layer.params.offsetSpread ?? 1, 0.2, 2);
  const framePadding = clamp(layer.params.framePadding ?? 18, 0, 48);
  const grainIntensity = clamp(layer.params.grainIntensity ?? 0.24, 0, 1);
  const flickerIntensity = clamp(layer.params.flickerIntensity ?? 0.2, 0, 1);

  ctx.clearRect(0, 0, analysis.width, analysis.height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, analysis.width, analysis.height);

  if (!sourceFrameCanvas) {
    finishLayerTrail(layer);
    return;
  }

  const buffer = ensureFilmMatteBuffer(state, sourceFrameCanvas, loopDuration);
  captureFilmMatteFrame(buffer, sourceFrameCanvas, mediaTime, loopDuration);

  const phaseBase = ((mediaTime % loopDuration) + loopDuration) % loopDuration;
  const offsetStep = (loopDuration / frameCount) * offsetSpread;
  const slots = buildFilmMatteLayout(analysis.width, analysis.height, frameCount, framePadding);

  slots.forEach((rect, index) => {
    const variation = FILM_MATTE_VARIATIONS[index % FILM_MATTE_VARIATIONS.length];
    const phase = (phaseBase + offsetStep * index) % loopDuration;
    const frame = resolveFilmMatteBufferedFrame(buffer, phase, loopDuration) || sourceFrameCanvas;
    const rotationJitter = (sampleValueNoise(index * 0.41, elapsed * 2.6, 733) - 0.5) * 2;
    const flicker = (sampleValueNoise(index * 0.83 + 9, elapsed * 5.8, 877) - 0.5) * flickerIntensity;
    const brightness = clamp(1 + (variation.brightness || 0) + flicker * 0.1, 0.84, 1.16);
    const radius = Math.min(rect.width, rect.height) * 0.12;
    const centerX = rect.x + rect.width * 0.5;
    const centerY = rect.y + rect.height * 0.5;

    ctx.save();
    buildRoundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
    ctx.clip();
    ctx.fillStyle = "#030303";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(((variation.rotation || 0) + rotationJitter * flickerIntensity * 0.8) * (Math.PI / 180));
    ctx.filter = `brightness(${brightness.toFixed(3)}) contrast(1.03)`;
    withHighImageSmoothing(ctx, () => {
      drawImageCoverWithFocus(
        ctx,
        frame,
        -rect.width * 0.5,
        -rect.height * 0.5,
        rect.width,
        rect.height,
        {
          focusX: variation.focusX,
          focusY: variation.focusY,
          zoom: variation.zoom,
        },
      );
    });
    ctx.filter = "none";
    ctx.restore();

    const vignette = ctx.createRadialGradient(
      centerX,
      centerY,
      Math.min(rect.width, rect.height) * 0.14,
      centerX,
      centerY,
      Math.max(rect.width, rect.height) * 0.78,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.08)");
    vignette.addColorStop(1, `rgba(0, 0, 0, ${0.28 + flickerIntensity * 0.1})`);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = vignette;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.globalCompositeOperation = "source-over";

    drawFilmMatteGrain(ctx, rect, elapsed, grainIntensity, index);

    ctx.fillStyle = `rgba(255, 255, 255, ${0.012 + Math.max(0, flicker) * 0.06})`;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
    buildRoundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
    ctx.stroke();
    ctx.restore();
  });

  finishLayerTrail(layer);
}

function renderPrismExtrudeLayer(layer, analysis, elapsed = 0) {
  // Prism Extrude turns the source into stacked chromatic slabs so the frame feels like it has
  // been pulled into a translucent neon sculpture.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const sourceBuffer = ensureImageBuffer(state, "prism-extrude-source", analysis.width, analysis.height);
  copyFrameToBuffer(sourceBuffer, analysis);
  layer.runtime.bufferCtx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.bufferCtx.putImageData(sourceBuffer.imageData, 0, 0);

  const depth = clamp(layer.params.depth ?? 0.42, 0, 1);
  const spread = clamp(layer.params.spread ?? 0.34, 0, 1);
  const glow = clamp(layer.params.glow ?? 0.28, 0, 1);
  const hue = wrapUnit(layer.params.hue ?? 0.82);
  const passes = 5 + Math.round(depth * 7);
  const ctx = layer.runtime.ctx;
  const auxCtx = layer.runtime.auxCtx;

  ctx.clearRect(0, 0, analysis.width, analysis.height);
  ctx.fillStyle = "rgb(7, 4, 18)";
  ctx.fillRect(0, 0, analysis.width, analysis.height);

  for (let pass = passes; pass >= 0; pass -= 1) {
    const t = pass / Math.max(1, passes);
    const offset = 4 + t * (18 + spread * 52 + glow * 14);
    const angle = hue * Math.PI * 2 + t * 1.18 + elapsed * 0.2;
    const dx = Math.cos(angle) * offset;
    const dy = Math.sin(angle * 1.36 - 0.6) * offset * 0.34 - t * t * (6 + depth * 10);
    const scale = 1 + t * (0.02 + depth * 0.08);
    const dw = analysis.width * scale;
    const dh = analysis.height * scale;
    const drawX = (analysis.width - dw) * 0.5 + dx;
    const drawY = (analysis.height - dh) * 0.5 + dy;
    const tint = hslToRgb(wrapUnit(hue + 0.05 + t * 0.14), 0.94, 0.64);

    auxCtx.save();
    auxCtx.clearRect(0, 0, analysis.width, analysis.height);
    auxCtx.drawImage(layer.runtime.bufferCanvas, 0, 0);
    auxCtx.globalCompositeOperation = "source-atop";
    auxCtx.fillStyle = rgba(tint, 0.92);
    auxCtx.fillRect(0, 0, analysis.width, analysis.height);
    auxCtx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.08 + t * (0.16 + glow * 0.14);
    ctx.filter = `blur(${0.15 + glow * 4.6 * t}px)`;
    ctx.drawImage(layer.runtime.auxCanvas, drawX, drawY, dw, dh);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.drawImage(layer.runtime.bufferCanvas, 0, 0);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.04 + glow * 0.08;
  for (let x = 0; x < analysis.width; x += 24) {
    ctx.fillStyle = x % 48 === 0 ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(x, 0, 1, analysis.height);
  }
  ctx.restore();
  finishLayerTrail(layer);
}

function renderDiamondPulseLayer(layer, analysis, preset, elapsed = 0) {
  // Diamond Pulse anchors rotating neon diamonds to motion clusters so subjects feel like they are
  // pushing luminous geometric markers through the frame.
  const { tracks } = collectStylizedMotionTracks(layer, analysis, preset, {
    cacheKey: "diamond-pulse",
    trailLength: 24,
    smoothing: 0.34,
  });
  const baseHue = clamp(layer.params.hue ?? 0.88, 0, 1);
  const sizeScale = Math.max(0.3, layer.params.size ?? 0.72);
  const pulse = clamp(layer.params.pulse ?? 0.42, 0, 1);
  const trail = clamp(layer.params.trail ?? 0.24, 0, 1);

  beginLayerTrail(layer, trail, "screen");
  const ctx = layer.runtime.ctx;
  ctx.save();
  ctx.lineWidth = 1.3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  tracks.forEach((track) => {
    if (track.missed > 2) {
      return;
    }
    drawTrail(ctx, track.trail, resolveMotionTrackingColor(layer, baseHue), 1.2, 0.22 + trail * 0.3);
    const color = hslToRgb(wrapUnit(baseHue + track.id * 0.07), 0.92, 0.68);
    const outer = Math.max(track.width, track.height) * (0.38 + sizeScale * 0.72);
    const beat = 0.82 + Math.sin(elapsed * (2.6 + pulse * 3.8) + track.id * 0.8) * (0.12 + pulse * 0.16);
    const rotation = elapsed * (0.5 + pulse * 1.9) + track.id * 0.27;
    ctx.shadowColor = rgba(color, 0.36);
    ctx.shadowBlur = 8 + pulse * 14;
    drawDiamond(ctx, track.x, track.y, outer * beat, outer * beat * 0.78, color, 0.94, rotation, 0.06);
    drawDiamond(
      ctx,
      track.x,
      track.y,
      outer * 0.56 * beat,
      outer * 0.56 * beat * 0.78,
      mixRgb(color, { r: 255, g: 255, b: 255 }, 0.4),
      0.82,
      -rotation * 1.35,
      0,
    );
    drawCrosshair(ctx, track.x, track.y, 4 + sizeScale * 2, color, 0.84);
  });

  ctx.restore();
  finishLayerTrail(layer);
}

function renderOrbitRingsLayer(layer, analysis, preset, elapsed = 0) {
  // Orbit Rings wraps each tracked cluster in radar-style circles, sweep arcs, and orbiting nodes
  // so motion feels like it is being scanned by a live sci-fi targeting rig.
  const { tracks } = collectStylizedMotionTracks(layer, analysis, preset, {
    cacheKey: "orbit-rings",
    trailLength: 18,
    smoothing: 0.42,
  });
  const baseHue = clamp(layer.params.hue ?? 0.16, 0, 1);
  const radiusScale = Math.max(0.2, layer.params.radius ?? 0.72);
  const sweep = clamp(layer.params.sweep ?? 0.46, 0, 1);
  const trail = clamp(layer.params.trail ?? 0.18, 0, 1);

  beginLayerTrail(layer, trail, "screen");
  const ctx = layer.runtime.ctx;
  ctx.save();
  ctx.lineWidth = 1.2;

  tracks.forEach((track) => {
    if (track.missed > 2) {
      return;
    }

    const color = hslToRgb(wrapUnit(baseHue + track.id * 0.05), 0.9, 0.68);
    const radius = Math.max(track.width, track.height) * (0.32 + radiusScale * 0.76);
    const sweepAngle = elapsed * (1.3 + sweep * 3.4) + track.id * 0.63;
    drawTrail(ctx, track.trail, color, 1, 0.18 + trail * 0.32);

    ctx.save();
    ctx.strokeStyle = rgba(color, 0.74);
    ctx.shadowColor = rgba(color, 0.3);
    ctx.shadowBlur = 7 + sweep * 10;
    ctx.setLineDash([8 + sweep * 10, 5 + sweep * 8]);
    ctx.beginPath();
    ctx.arc(track.x, track.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(track.x, track.y, radius * 0.58, sweepAngle - 0.65, sweepAngle + 0.48);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(track.x, track.y);
    ctx.lineTo(track.x + Math.cos(sweepAngle) * radius, track.y + Math.sin(sweepAngle) * radius);
    ctx.stroke();
    ctx.restore();

    for (let orbit = 0; orbit < 3; orbit += 1) {
      const orbitAngle = sweepAngle * (0.68 + orbit * 0.18) + orbit * 2.1;
      const orbitRadius = radius * (0.48 + orbit * 0.2);
      const dotColor = mixRgb(color, { r: 255, g: 255, b: 255 }, 0.38 + orbit * 0.12);
      ctx.fillStyle = rgba(dotColor, 0.84);
      ctx.beginPath();
      ctx.arc(
        track.x + Math.cos(orbitAngle) * orbitRadius,
        track.y + Math.sin(orbitAngle) * orbitRadius,
        1.8 + orbit * 0.7,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  });

  ctx.restore();
  finishLayerTrail(layer);
}

function renderWarpMeshLayer(layer, analysis, preset, elapsed = 0) {
  // Warp Mesh links nearby trackers with noisy curves so moving subjects become a reactive,
  // stretched wireframe that breathes as detections drift.
  const { tracks } = collectStylizedMotionTracks(layer, analysis, preset, {
    cacheKey: "warp-mesh",
    trailLength: 16,
    smoothing: 0.36,
  });
  const baseHue = clamp(layer.params.hue ?? 0.13, 0, 1);
  const warp = clamp(layer.params.warp ?? 0.38, 0, 1);
  const links = clamp(layer.params.links ?? 0.52, 0, 1);
  const trail = clamp(layer.params.trail ?? 0.22, 0, 1);
  const maxLinks = 1 + Math.round(links * 2);

  beginLayerTrail(layer, trail, "screen");
  const ctx = layer.runtime.ctx;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  tracks.forEach((track) => {
    if (track.missed > 2) {
      return;
    }
    const color = hslToRgb(wrapUnit(baseHue + track.id * 0.035), 0.88, 0.66);
    drawTrail(ctx, track.trail, color, 1, 0.16 + trail * 0.26);
  });

  const pairs = [];
  tracks.forEach((track) => {
    const nearest = tracks
      .filter((other) => other !== track && other.missed <= 2)
      .map((other) => ({ other, dist: distance(track.x, track.y, other.x, other.y) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, maxLinks);

    nearest.forEach(({ other, dist }) => {
      if (track.id < other.id) {
        pairs.push({ a: track, b: other, dist });
      }
    });
  });

  pairs.forEach(({ a, b, dist }, pairIndex) => {
    const hue = wrapUnit(baseHue + pairIndex * 0.018);
    const color = hslToRgb(hue, 0.92, 0.68);
    const midX = (a.x + b.x) * 0.5;
    const midY = (a.y + b.y) * 0.5;
    const invDistance = dist > 0.001 ? 1 / dist : 0;
    const perpX = -(b.y - a.y) * invDistance;
    const perpY = (b.x - a.x) * invDistance;
    const wobble = (sampleValueNoise(pairIndex * 0.41 + elapsed * 0.8, hue * 13, 53) - 0.5) * (10 + warp * dist * 0.28);
    const ctrlX = midX + perpX * wobble;
    const ctrlY = midY + perpY * wobble;

    ctx.save();
    ctx.strokeStyle = rgba(color, 0.34 + links * 0.22);
    ctx.lineWidth = 1 + links * 1.2;
    ctx.shadowColor = rgba(color, 0.24);
    ctx.shadowBlur = 6 + warp * 10;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(ctrlX, ctrlY, b.x, b.y);
    ctx.stroke();
    ctx.restore();
  });

  tracks.forEach((track, index) => {
    if (track.missed > 2) {
      return;
    }
    const color = hslToRgb(wrapUnit(baseHue + index * 0.06), 0.9, 0.66);
    drawSquareNode(ctx, track.x, track.y, 6 + Math.max(track.width, track.height) * 0.08, color, 0.84, elapsed * 0.35 + index * 0.2);
  });

  ctx.restore();
  finishLayerTrail(layer);
}

function renderChromeReliefLayer(layer, analysis) {
  // Chrome Relief turns edges into a beveled metal surface with a moving light cue, so the whole
  // image reads like machined chrome instead of flat video.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const buffer = ensureImageBuffer(state, "chrome-relief", analysis.width, analysis.height);
  const highlightBuffer = ensureImageBuffer(state, "chrome-relief-highlight", analysis.width, analysis.height);
  const { gradX, gradY, edge } = ensureFrameDerivatives(analysis.currentFrame);
  const depth = clamp(layer.params.depth ?? 0.62, 0, 1);
  const polish = clamp(layer.params.polish ?? 0.52, 0, 1);
  const edgeAmount = clamp(layer.params.edge ?? 0.48, 0, 1);
  const tint = clamp(layer.params.tint ?? 0.58, 0, 1);
  const shadowColor = hslToRgb(wrapUnit(0.57 + tint * 0.16), 0.22, 0.12);
  const midColor = hslToRgb(wrapUnit(0.56 + tint * 0.12), 0.12, 0.48);
  const lightColor = hslToRgb(wrapUnit(0.54 + tint * 0.1), 0.24, 0.9);
  const light = { x: -0.44, y: -0.58, z: 0.68 };

  for (let index = 0, px = 0; index < analysis.pixels; index += 1, px += 4) {
    let nx = -(gradX[index] / 255) * (0.8 + depth * 2.8);
    let ny = -(gradY[index] / 255) * (0.8 + depth * 2.8);
    let nz = 1;
    const invLength = 1 / Math.hypot(nx, ny, nz);
    nx *= invLength;
    ny *= invLength;
    nz *= invLength;

    const lightDot = clamp(nx * light.x + ny * light.y + nz * light.z, -1, 1);
    const shade = clamp(0.5 + lightDot * 0.5, 0, 1);
    const specular = Math.pow(clamp(shade, 0, 1), 4.2 - polish * 2.8) * (0.2 + polish * 0.78);
    const rim = Math.pow(edge[index] / 255, 0.82) * edgeAmount * 0.82;
    const baseTone = analysis.luma[index] / 255;
    const metal = clamp(shade * 0.72 + specular + rim + (baseTone - 0.5) * 0.16, 0, 1);
    const base = mixRgb(shadowColor, midColor, clamp(metal * 1.08, 0, 1));
    const final = mixRgb(base, lightColor, clamp(specular * 0.82 + rim * 0.55, 0, 1));

    buffer.data[px] = final.r;
    buffer.data[px + 1] = final.g;
    buffer.data[px + 2] = final.b;
    buffer.data[px + 3] = 255;
    highlightBuffer.data[px] = lightColor.r;
    highlightBuffer.data[px + 1] = lightColor.g;
    highlightBuffer.data[px + 2] = lightColor.b;
    highlightBuffer.data[px + 3] = Math.round(clamp(specular * 0.78 + rim * 0.2, 0, 1) * 255);
  }

  const ctx = layer.runtime.ctx;
  ctx.clearRect(0, 0, analysis.width, analysis.height);
  ctx.putImageData(buffer.imageData, 0, 0);
  layer.runtime.auxCtx.clearRect(0, 0, analysis.width, analysis.height);
  layer.runtime.auxCtx.putImageData(highlightBuffer.imageData, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.14 + polish * 0.18;
  ctx.filter = `blur(${0.8 + polish * 3.4}px)`;
  ctx.drawImage(layer.runtime.auxCanvas, 0, 0);
  ctx.filter = "none";
  ctx.restore();
  finishLayerTrail(layer);
}

function renderTotemEchoLayer(layer, analysis, preset, elapsed = 0) {
  // Totem Echo extrudes stacked tracker slabs along the motion direction so subjects feel like
  // they are leaving sculpted neon monuments behind them.
  const { tracks } = collectStylizedMotionTracks(layer, analysis, preset, {
    cacheKey: "totem-echo",
    trailLength: 22,
    smoothing: 0.38,
  });
  const baseHue = clamp(layer.params.hue ?? 0.66, 0, 1);
  const depth = clamp(layer.params.depth ?? 0.46, 0, 1);
  const drift = clamp(layer.params.drift ?? 0.34, 0, 1);
  const trail = clamp(layer.params.trail ?? 0.28, 0, 1);
  const stackCount = 3 + Math.round(depth * 5);

  beginLayerTrail(layer, trail, "screen");
  const ctx = layer.runtime.ctx;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  tracks.forEach((track, index) => {
    if (track.missed > 2) {
      return;
    }
    const color = hslToRgb(wrapUnit(baseHue + index * 0.04), 0.84, 0.68);
    drawTrail(ctx, track.trail, color, 1.1, 0.22 + trail * 0.22);

    const previous = track.trail[track.trail.length - 2] || track.trail[track.trail.length - 1] || { x: track.x, y: track.y };
    const vx = track.x - previous.x;
    const vy = track.y - previous.y;
    const offsetXBase = vx * (2.4 + drift * 4.2) + (hashUnit3(track.id, index, 17) - 0.5) * (8 + drift * 16);
    const offsetYBase = vy * (2.1 + drift * 3.6) + (hashUnit3(index, track.id, 19) - 0.5) * (6 + drift * 12);

    for (let depthIndex = stackCount; depthIndex >= 0; depthIndex -= 1) {
      const t = depthIndex / Math.max(1, stackCount);
      const dx = offsetXBase * t * 0.34;
      const dy = offsetYBase * t * 0.34 - t * (2 + depth * 9);
      const w = track.width * (0.6 + depth * 0.24);
      const h = track.height * (0.6 + depth * 0.24);
      const tint = mixRgb(color, { r: 255, g: 255, b: 255 }, 0.22 + t * 0.3);
      ctx.strokeStyle = rgba(tint, 0.18 + t * 0.42);
      ctx.fillStyle = rgba(tint, 0.03 + t * 0.06);
      ctx.lineWidth = 1 + t * 1.2;
      ctx.shadowColor = rgba(color, 0.16 + t * 0.24);
      ctx.shadowBlur = 4 + depth * 10;
      ctx.strokeRect(track.x - w * 0.5 + dx, track.y - h * 0.5 + dy, w, h);
      ctx.fillRect(track.x - w * 0.5 + dx, track.y - h * 0.5 + dy, w, h);
    }

    drawCrosshair(ctx, track.x, track.y, 4, color, 0.82);
  });

  ctx.restore();
  finishLayerTrail(layer);
}

function renderScribbleAuraLayer(layer, analysis, preset, elapsed = 0) {
  // Scribble Aura wraps each tracker in noisy hand-drawn contours so motion becomes a sketched,
  // unstable halo instead of a literal box.
  const { tracks } = collectStylizedMotionTracks(layer, analysis, preset, {
    cacheKey: "scribble-aura",
    trailLength: 20,
    smoothing: 0.44,
  });
  const baseHue = clamp(layer.params.hue ?? 0.04, 0, 1);
  const wobble = clamp(layer.params.wobble ?? 0.44, 0, 1);
  const loops = clamp(layer.params.loops ?? 0.52, 0, 1);
  const trail = clamp(layer.params.trail ?? 0.24, 0, 1);
  const loopCount = 2 + Math.round(loops * 3);
  const pointCount = 10 + Math.round(loops * 10);

  beginLayerTrail(layer, trail, "screen");
  const ctx = layer.runtime.ctx;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  tracks.forEach((track, index) => {
    if (track.missed > 2) {
      return;
    }
    const color = hslToRgb(wrapUnit(baseHue + index * 0.055), 0.88, 0.66);
    drawTrail(ctx, track.trail, color, 1.1, 0.18 + trail * 0.26);

    for (let loopIndex = 0; loopIndex < loopCount; loopIndex += 1) {
      const expand = 1 + loopIndex * 0.16;
      const points = buildTrackDistortedLoop({
        ...track,
        width: track.width * expand,
        height: track.height * expand,
      }, elapsed + loopIndex * 0.21, 0.12 + wobble * 0.74, pointCount);
      ctx.lineWidth = 1 + loopIndex * 0.36;
      ctx.shadowColor = rgba(color, 0.18 + loopIndex * 0.08);
      ctx.shadowBlur = 4 + wobble * 8;
      strokeClosedLoop(ctx, points, color, 0.52 - loopIndex * 0.08);
    }

    drawSquareNode(ctx, track.x, track.y, 5 + Math.max(track.width, track.height) * 0.05, color, 0.74, index * 0.2);
  });

  ctx.restore();
  finishLayerTrail(layer);
}

function renderPaperStackLayer(layer, analysis) {
  // Paper Stack posterizes the frame into offset cutout bands with shadows so the image feels
  // like stacked collage cards floating in space.
  const state = ensureLayerState(layer, analysis.width, analysis.height);
  const offset = clamp(layer.params.offset ?? 0.36, 0, 1);
  const poster = clamp(layer.params.poster ?? 0.52, 0, 1);
  const shadow = clamp(layer.params.shadow ?? 0.48, 0, 1);
  const hue = wrapUnit(layer.params.hue ?? 0.08);
  const bandCount = 4;
  const blurredLuma = ensureBlurredLuma(analysis, 1 + Math.round(poster * 5));
  const contrast = 1 + poster * 2.4;
  const background = hslToRgb(wrapUnit(hue - 0.04), 0.26, 0.1);
  const ctx = layer.runtime.ctx;

  ctx.clearRect(0, 0, analysis.width, analysis.height);
  ctx.fillStyle = rgba(background, 1);
  ctx.fillRect(0, 0, analysis.width, analysis.height);

  for (let band = 0; band < bandCount; band += 1) {
    const bandBuffer = ensureImageBuffer(state, `paper-stack-${band}`, analysis.width, analysis.height);
    const low = band / bandCount;
    const high = (band + 1) / bandCount;
    const paletteBase = hslToRgb(wrapUnit(hue + band * 0.035), 0.52 + band * 0.08, 0.18 + band * 0.14);
    const paperTint = mixRgb(paletteBase, { r: 250, g: 240, b: 228 }, 0.18 + band * 0.08);

    for (let index = 0, px = 0; index < analysis.pixels; index += 1, px += 4) {
      const tone = clamp((blurredLuma[index] / 255 - 0.5) * contrast + 0.5, 0, 1);
      const inBand = tone >= low && (band === bandCount - 1 ? tone <= high : tone < high);
      if (!inBand) {
        bandBuffer.data[px] = 0;
        bandBuffer.data[px + 1] = 0;
        bandBuffer.data[px + 2] = 0;
        bandBuffer.data[px + 3] = 0;
        continue;
      }

      const sourceMix = 0.12 + band * 0.12;
      bandBuffer.data[px] = Math.round(lerp(paperTint.r, analysis.data[px], sourceMix));
      bandBuffer.data[px + 1] = Math.round(lerp(paperTint.g, analysis.data[px + 1], sourceMix));
      bandBuffer.data[px + 2] = Math.round(lerp(paperTint.b, analysis.data[px + 2], sourceMix));
      bandBuffer.data[px + 3] = 255;
    }

    layer.runtime.bufferCtx.clearRect(0, 0, analysis.width, analysis.height);
    layer.runtime.bufferCtx.putImageData(bandBuffer.imageData, 0, 0);
    const shift = band - (bandCount - 1) * 0.5;
    const dx = shift * (1.4 + offset * 12);
    const dy = shift * (-0.6 - offset * 7);

    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.08 + shadow * 0.12 + band * 0.03;
    ctx.filter = `blur(${0.6 + shadow * 5}px)`;
    ctx.drawImage(layer.runtime.bufferCanvas, dx + 2 + shadow * 6, dy + 3 + shadow * 4);
    ctx.restore();

    ctx.save();
    ctx.drawImage(layer.runtime.bufferCanvas, dx, dy);
    ctx.restore();
  }

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
  mediaTime,
  sourceFrameCanvas,
  previousSourceImageData,
  getQualityPreset,
  requestPreviewRefresh,
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

  if (layer.type === "motionThreshold") {
    renderMotionThresholdLayer(layer, analysis);
    return true;
  }

  if (layer.type === "datamoshSmear") {
    renderDatamoshSmearLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "imageFlash") {
    renderImageFlashLayer(layer, analysis, mediaTime, requestPreviewRefresh);
    return true;
  }

  if (layer.type === "filmMatteEffect") {
    renderFilmMatteEffectLayer(layer, analysis, sourceFrameCanvas, mediaTime, elapsed);
    return true;
  }

  if (layer.type === "vfxHalftone") {
    renderVfxHalftoneLayer(layer, sourceImageData, requestPreviewRefresh);
    return true;
  }

  if (layer.type === "vfxDuotone") {
    renderVfxDuotoneLayer(layer, sourceImageData, requestPreviewRefresh);
    return true;
  }

  if (layer.type === "greenCrt" || layer.type === "blueCrt" || layer.type === "redCrt") {
    renderCrtTintFilterLayer(layer, analysis, elapsed);
    return true;
  }

  if (layer.type === "nightVision") {
    renderNightVisionLayer(layer, analysis, elapsed);
    return true;
  }

  if (layer.type === "prismExtrude") {
    renderPrismExtrudeLayer(layer, analysis, elapsed);
    return true;
  }

  if (layer.type === "chromeRelief") {
    renderChromeReliefLayer(layer, analysis);
    return true;
  }

  if (layer.type === "diamondPulse") {
    renderDiamondPulseLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "orbitRings") {
    renderOrbitRingsLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "warpMesh") {
    renderWarpMeshLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "totemEcho") {
    renderTotemEchoLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "scribbleAura") {
    renderScribbleAuraLayer(layer, analysis, preset, elapsed);
    return true;
  }

  if (layer.type === "paperStack") {
    renderPaperStackLayer(layer, analysis);
    return true;
  }

  if (layer.type === "highlightsOnly") {
    renderTonalIsolationLayer(layer, analysis, "highlights");
    return true;
  }

  if (layer.type === "midtonesOnly") {
    renderTonalIsolationLayer(layer, analysis, "midtones");
    return true;
  }

  if (layer.type === "shadowsOnly") {
    renderTonalIsolationLayer(layer, analysis, "shadows");
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
