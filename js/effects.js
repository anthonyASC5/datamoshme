function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapUnit(value) {
  return ((value % 1) + 1) % 1;
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

const SOURCE_IMAGE_REQUIRED_TYPES = new Set([
  "cluster",
  "clusterOnly",
  "clusterTrack",
  "monitor",
  "black",
  "blu",
  "infrared",
  "detect",
]);

export function layerNeedsSourceImageData(layer) {
  if (!layer?.visible || layer.opacity <= 0) {
    return false;
  }
  if (layer.type === "crt") {
    return (layer.params.edgeGlow || 0) > 0;
  }
  return SOURCE_IMAGE_REQUIRED_TYPES.has(layer.type);
}

// Effect: Black Data / BLU
// What it does: Rebuilds the frame into high-contrast monochrome or blue surveillance textures with ghost feedback.
// Framework: Canvas 2D CPU pixel processing with per-frame buffer reuse.
function buildPresetImage(imageData, elapsed, layer) {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data.length);
  const ghost = layer.runtime.presetGhostData || new Uint8ClampedArray(data.length);
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

  layer.runtime.presetGhostData = out.slice();
  return new ImageData(out, width, height);
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

// Effect: Infrared Camera
// What it does: Remaps source luminance into a thermal-style false-color image with a soft bloom trail.
// Framework: Canvas 2D CPU pixel remap plus Canvas compositing.
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

// Effect: Cluster Tracker
// What it does: Finds bright moving edges, groups them into clusters, and draws tracked boxes, lines, and glow trails.
// Framework: Canvas 2D edge/motion analysis with CPU cluster scoring and Canvas compositing.
function renderClusterLayer(layer, sourceImageData, elapsed, previousSourceImageData, getQualityPreset) {
  const { width, height, data } = sourceImageData;
  const previousData = previousSourceImageData ? previousSourceImageData.data : null;
  const params = layer.params;
  const targetCtx = layer.runtime.ctx;
  const ghostCtx = layer.runtime.ghostCtx;
  const intenseTrack = layer.type === "clusterTrack";
  const clusterOnly = layer.type === "clusterOnly" || intenseTrack;
  const preset = getQualityPreset();
  const trackSamplingScale = intenseTrack ? 1.18 : 1;
  const trackSpanScale = intenseTrack ? 1.12 : 1;
  const trackLimitScale = intenseTrack ? 0.78 : 1;
  const step = Math.max(2, Math.round((5 - Math.min(params.grit, 1.35) * 0.75 - params.clusterQuantity * 1.6) * preset.clusterStepScale * trackSamplingScale));
  const clusterSpan = Math.max(8, Math.round((10 + params.clusterSize * 24 + (1 - params.clusterQuantity) * 14) * trackSpanScale));
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
  const maxClusters = Math.max(
    intenseTrack ? 10 : 12,
    Math.round((16 + params.clusterQuantity * (intenseTrack ? 180 : clusterOnly ? 92 : 54)) * preset.clusterLimitScale * trackLimitScale),
  );
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

// Effect: CRT Monitor
// What it does: Reinterprets the source as a phosphor monitor with triads, vignette, bloom, and scanline texture.
// Framework: Canvas 2D CPU pixel generation plus Canvas screen compositing.
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

// Effect: CRT Pass
// What it does: Applies RGB split, scanlines, glow, and blocky edge bloom directly on top of the live source.
// Framework: Canvas 2D compositing with CPU edge sampling.
function renderCrtLayer(layer, sourceImageData, sourceCanvas, sourceCtx, getQualityPreset) {
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

// Effect: Detect
// What it does: Compares the current frame to the previous one and turns motion blocks into glowing alert regions.
// Framework: Canvas 2D block-based motion analysis with Canvas compositing.
function renderDetectLayer(layer, sourceImageData, previousSourceImageData, getQualityPreset) {
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

// Effect Entry Point
// What it does: Routes a CRT video layer to the correct extracted effect renderer.
// Framework: ES module dispatcher for Canvas 2D layer-effects.
export function renderEffectLayer({
  layer,
  sourceImageData,
  elapsed,
  sourceCanvas,
  sourceCtx,
  previousSourceImageData,
  getQualityPreset,
}) {
  if (!layer) {
    return false;
  }

  if (layer.type === "crt") {
    renderCrtLayer(layer, sourceImageData, sourceCanvas, sourceCtx, getQualityPreset);
    return true;
  }

  if (layer.type === "cluster" || layer.type === "clusterOnly" || layer.type === "clusterTrack") {
    if (sourceImageData) {
      renderClusterLayer(layer, sourceImageData, elapsed, previousSourceImageData, getQualityPreset);
    }
    return true;
  }

  if (layer.type === "monitor") {
    if (sourceImageData) {
      renderMonitorLayer(layer, sourceImageData, elapsed);
    }
    return true;
  }

  if (layer.type === "infrared") {
    if (sourceImageData) {
      renderInfraredLayer(layer, sourceImageData, elapsed);
    }
    return true;
  }

  if (layer.type === "detect") {
    if (sourceImageData) {
      renderDetectLayer(layer, sourceImageData, previousSourceImageData, getQualityPreset);
    }
    return true;
  }

  if (layer.type === "black" || layer.type === "blu") {
    if (sourceImageData) {
      renderPresetLayer(layer, sourceImageData, elapsed);
    }
    return true;
  }

  return false;
}
