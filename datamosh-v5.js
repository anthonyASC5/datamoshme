import * as THREE from "three";

const { FFmpeg } = window.FFmpegWASM;
const { fetchFile, toBlobURL } = window.FFmpegUtil;

const FREEZE_SECONDS = 0.5;
const MAX_RENDER_WIDTH = 1280;
const DEFAULT_FPS = 30;

const pickAButton = document.getElementById("pick-a-button");
const pickBButton = document.getElementById("pick-b-button");
const videoAInput = document.getElementById("video-a-input");
const videoBInput = document.getElementById("video-b-input");
const videoAMetaSource = document.getElementById("video-a-meta-source");
const videoBMetaSource = document.getElementById("video-b-meta-source");
const videoAMeta = document.getElementById("video-a-meta");
const videoBMeta = document.getElementById("video-b-meta");
const transitionSlider = document.getElementById("transition-slider");
const transitionOutput = document.getElementById("transition-output");
const renderButton = document.getElementById("render-button");
const preview = document.getElementById("preview");
const renderCanvas = document.getElementById("render-canvas");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const logOutput = document.getElementById("log-output");
const compatibilityNote = document.getElementById("compatibility-note");

const ffmpeg = new FFmpeg();
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const renderer = new THREE.WebGLRenderer({
  canvas: renderCanvas,
  antialias: false,
  alpha: false,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
texture.needsUpdate = true;
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.LinearFilter;
texture.colorSpace = THREE.SRGBColorSpace;

const material = new THREE.ShaderMaterial({
  uniforms: {
    uTexture: { value: texture },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D uTexture;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(uTexture, vUv);
    }
  `,
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

const sampleCanvasA = document.createElement("canvas");
const sampleCtxA = sampleCanvasA.getContext("2d", { alpha: false, willReadFrequently: true });
const sampleCanvasB = document.createElement("canvas");
const sampleCtxB = sampleCanvasB.getContext("2d", { alpha: false, willReadFrequently: true });

const state = {
  clipA: null,
  clipB: null,
  clipADuration: 0,
  clipBDuration: 0,
  previewUrl: null,
  metaUrls: { a: null, b: null },
  ffmpegLoaded: false,
  width: 1280,
  height: 720,
};

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function updateTransitionOutput() {
  transitionOutput.value = `${Number(transitionSlider.value).toFixed(2)}s`;
}

function revokePreviewUrl() {
  if (!state.previewUrl) {
    return;
  }
  URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
}

function revokeMetaUrl(key, videoNode) {
  if (!state.metaUrls[key]) {
    return;
  }
  URL.revokeObjectURL(state.metaUrls[key]);
  state.metaUrls[key] = null;
  videoNode.removeAttribute("src");
  videoNode.load();
}

async function loadVideoMeta(file, videoNode, key) {
  revokeMetaUrl(key, videoNode);
  const url = URL.createObjectURL(file);
  state.metaUrls[key] = url;
  videoNode.src = url;
  videoNode.muted = true;
  videoNode.playsInline = true;
  videoNode.preload = "auto";
  videoNode.load();

  await new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to read video metadata."));
    };
    const cleanup = () => {
      videoNode.removeEventListener("loadedmetadata", onLoaded);
      videoNode.removeEventListener("error", onError);
    };

    videoNode.addEventListener("loadedmetadata", onLoaded, { once: true });
    videoNode.addEventListener("error", onError, { once: true });
  });
}

function describeMeta(file, videoNode) {
  return `${file.name} • ${videoNode.duration.toFixed(2)}s • ${videoNode.videoWidth}x${videoNode.videoHeight}`;
}

function updateSliderBounds() {
  if (!state.clipADuration) {
    return;
  }
  const max = Math.max(0.05, Number((state.clipADuration - 0.05).toFixed(2)));
  transitionSlider.max = String(max);
  transitionSlider.value = String(Math.min(max, 2));
  updateTransitionOutput();
}

function resizeRenderTargets(width, height) {
  state.width = width;
  state.height = height;
  renderCanvas.width = width;
  renderCanvas.height = height;
  renderer.setSize(width, height, false);
  sampleCanvasA.width = width;
  sampleCanvasA.height = height;
  sampleCanvasB.width = width;
  sampleCanvasB.height = height;

  texture.image.data = new Uint8Array(width * height * 4);
  texture.image.width = width;
  texture.image.height = height;
  texture.needsUpdate = true;
}

function updateRenderSize() {
  const sourceA = videoAMetaSource.videoWidth && videoAMetaSource.videoHeight
    ? { width: videoAMetaSource.videoWidth, height: videoAMetaSource.videoHeight }
    : null;
  const sourceB = videoBMetaSource.videoWidth && videoBMetaSource.videoHeight
    ? { width: videoBMetaSource.videoWidth, height: videoBMetaSource.videoHeight }
    : null;
  const source = sourceA || sourceB || { width: 1280, height: 720 };
  const scale = Math.min(MAX_RENDER_WIDTH / source.width, 1);
  const width = Math.max(320, Math.round(source.width * scale));
  const height = Math.max(180, Math.round(source.height * scale));
  resizeRenderTargets(width, height);
}

function drawVideoCover(video, targetCtx) {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) {
    return;
  }

  const dw = targetCtx.canvas.width;
  const dh = targetCtx.canvas.height;
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

  targetCtx.fillStyle = "#000000";
  targetCtx.fillRect(0, 0, dw, dh);
  targetCtx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, dw, dh);
}

async function seekVideo(video, time) {
  const targetTime = clamp(time, 0, Math.max(0, video.duration || 0));
  if (Math.abs(video.currentTime - targetTime) < 0.012) {
    return;
  }

  await new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video seek failed."));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = targetTime;
  });
}

async function sampleFrame(video, time, ctx) {
  await seekVideo(video, time);
  drawVideoCover(video, ctx);
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
}

function createSeededNoise(seed) {
  const raw = Math.sin(seed * 12.9898 + seed * seed * 0.00131) * 43758.5453;
  return raw - Math.floor(raw);
}

function samplePixel(buffer, width, height, x, y, channel) {
  const px = clamp(Math.round(x), 0, width - 1);
  const py = clamp(Math.round(y), 0, height - 1);
  return buffer[(py * width + px) * 4 + channel];
}

function buildMoshedFrame({ anchorFrame, currentBFrame, previousBFrame, previousOutput, width, height, progress, frameIndex }) {
  const output = new Uint8Array(previousOutput.length);
  const blockSize = Math.max(6, Math.round(28 - progress * 18));
  const holdProbability = 0.78 - progress * 0.62;
  const anchorCarry = Math.pow(1 - progress, 1.15) * 0.82;
  const displacementBoost = 1.6 - progress * 0.9;

  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      const centerX = Math.min(width - 1, bx + Math.floor(blockSize * 0.5));
      const centerY = Math.min(height - 1, by + Math.floor(blockSize * 0.5));
      const centerIndex = (centerY * width + centerX) * 4;
      const diffR = Math.abs(currentBFrame[centerIndex] - previousBFrame[centerIndex]);
      const diffG = Math.abs(currentBFrame[centerIndex + 1] - previousBFrame[centerIndex + 1]);
      const diffB = Math.abs(currentBFrame[centerIndex + 2] - previousBFrame[centerIndex + 2]);
      const motion = (diffR + diffG + diffB) / 255;
      const drift = (0.8 + motion * 2.4) * displacementBoost;
      const jitterA = createSeededNoise(frameIndex * 91 + bx * 0.17 + by * 0.11);
      const jitterB = createSeededNoise(frameIndex * 57 + bx * 0.07 + by * 0.29);
      const shiftX = Math.round((jitterA - 0.5) * blockSize * drift * 2.2);
      const shiftY = Math.round((jitterB - 0.5) * blockSize * drift * 1.8);
      const reusePrevious = createSeededNoise(frameIndex * 19 + bx * 0.03 + by * 0.05) < holdProbability;

      const maxY = Math.min(height, by + blockSize);
      const maxX = Math.min(width, bx + blockSize);
      for (let y = by; y < maxY; y += 1) {
        for (let x = bx; x < maxX; x += 1) {
          const index = (y * width + x) * 4;
          const sourceBuffer = reusePrevious ? previousOutput : currentBFrame;
          const shiftedR = samplePixel(sourceBuffer, width, height, x + shiftX, y + shiftY, 0);
          const shiftedG = samplePixel(sourceBuffer, width, height, x + shiftX, y + shiftY, 1);
          const shiftedB = samplePixel(sourceBuffer, width, height, x + shiftX, y + shiftY, 2);
          const anchorR = anchorFrame[index];
          const anchorG = anchorFrame[index + 1];
          const anchorB = anchorFrame[index + 2];
          const cleanR = currentBFrame[index];
          const cleanG = currentBFrame[index + 1];
          const cleanB = currentBFrame[index + 2];
          const corruptionMix = 0.85 - progress * 0.55;

          const moshedR = shiftedR * corruptionMix + cleanR * (1 - corruptionMix);
          const moshedG = shiftedG * corruptionMix + cleanG * (1 - corruptionMix);
          const moshedB = shiftedB * corruptionMix + cleanB * (1 - corruptionMix);

          output[index] = Math.round(moshedR * (1 - anchorCarry) + anchorR * anchorCarry);
          output[index + 1] = Math.round(moshedG * (1 - anchorCarry) + anchorG * anchorCarry);
          output[index + 2] = Math.round(moshedB * (1 - anchorCarry) + anchorB * anchorCarry);
          output[index + 3] = 255;
        }
      }
    }
  }

  return output;
}

function uploadFrame(buffer) {
  texture.image.data.set(buffer);
  texture.needsUpdate = true;
  renderer.render(scene, camera);
}

async function ensureFFmpegLoaded() {
  if (state.ffmpegLoaded) {
    return;
  }

  setStatus("Loading ffmpeg.wasm core...");
  appendLog("Loading ffmpeg.wasm core");
  ffmpeg.on("log", ({ message }) => appendLog(message));

  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  state.ffmpegLoaded = true;
  appendLog("ffmpeg.wasm ready");
}

function getRecordingMimeType() {
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    return "video/webm;codecs=vp9";
  }
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
    return "video/webm;codecs=vp8";
  }
  return "video/webm";
}

function waitForRecorderStop(recorder) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => reject(new Error("Canvas recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
  });
}

async function convertWebmToMp4(blob) {
  await ensureFFmpegLoaded();
  appendLog("Transcoding render.webm -> render.mp4");
  await ffmpeg.writeFile("render.webm", await fetchFile(blob));
  await ffmpeg.exec([
    "-i", "render.webm",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "render.mp4",
  ]);
  const data = await ffmpeg.readFile("render.mp4");
  return new Blob([data.buffer], { type: "video/mp4" });
}

function validateReady() {
  if (!state.clipA || !state.clipB) {
    setStatus("Load clip A and clip B first.");
    return false;
  }
  if (!window.MediaRecorder) {
    setStatus("This browser does not support MediaRecorder.");
    return false;
  }
  return true;
}

async function renderDatamoshV5() {
  if (!validateReady()) {
    return;
  }

  renderButton.disabled = true;
  revokePreviewUrl();
  preview.removeAttribute("src");
  preview.load();

  try {
    updateRenderSize();
    const fps = DEFAULT_FPS;
    const transitionStart = Math.min(Number(transitionSlider.value), Math.max(0.05, state.clipADuration - 0.05));
    const corruptionDuration = Math.min(Math.max(0.85, state.clipBDuration * 0.32), 1.6, state.clipBDuration);
    const cleanBDuration = Math.max(0, state.clipBDuration - corruptionDuration);
    const totalDuration = transitionStart + FREEZE_SECONDS + corruptionDuration + cleanBDuration;
    const totalFrames = Math.max(1, Math.ceil(totalDuration * fps));

    appendLog(`Render size ${state.width}x${state.height}`);
    appendLog(`Transition ${transitionStart.toFixed(2)}s | corruption ${corruptionDuration.toFixed(2)}s | clean B ${cleanBDuration.toFixed(2)}s`);
    compatibilityNote.textContent = `V5 timeline: A ${transitionStart.toFixed(2)}s -> freeze 0.50s -> B corrupt ${corruptionDuration.toFixed(2)}s -> clean B ${cleanBDuration.toFixed(2)}s`;

    const captureTrackProbe = renderCanvas.captureStream(0).getVideoTracks()[0];
    const supportsManualFrames = Boolean(captureTrackProbe?.requestFrame);
    captureTrackProbe?.stop();
    const trackStream = renderCanvas.captureStream(supportsManualFrames ? 0 : fps);
    const captureTrack = trackStream.getVideoTracks()[0];
    const recorder = new MediaRecorder(trackStream, {
      mimeType: getRecordingMimeType(),
      videoBitsPerSecond: 8_000_000,
    });
    const stopPromise = waitForRecorderStop(recorder);
    recorder.start();

    setStatus("Sampling frozen A frame...");
    setTimeline("Preparing source frames");
    const frozenA = new Uint8Array(await sampleFrame(videoAMetaSource, transitionStart, sampleCtxA));
    let previousB = new Uint8Array(await sampleFrame(videoBMetaSource, 0, sampleCtxB));
    let previousOutput = new Uint8Array(frozenA);

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      const time = frameIndex / fps;
      let buffer;
      let phaseLabel;

      if (time < transitionStart) {
        phaseLabel = "Playing clip A";
        buffer = new Uint8Array(await sampleFrame(videoAMetaSource, time, sampleCtxA));
      } else if (time < transitionStart + FREEZE_SECONDS) {
        phaseLabel = "Freeze last frame of A";
        buffer = frozenA;
      } else if (time < transitionStart + FREEZE_SECONDS + corruptionDuration) {
        const corruptionTime = time - transitionStart - FREEZE_SECONDS;
        const progress = clamp(corruptionTime / Math.max(corruptionDuration, 0.001), 0, 1);
        phaseLabel = "Corrupting into B";
        const currentB = new Uint8Array(await sampleFrame(videoBMetaSource, corruptionTime, sampleCtxB));
        buffer = buildMoshedFrame({
          anchorFrame: frozenA,
          currentBFrame: currentB,
          previousBFrame: previousB,
          previousOutput,
          width: state.width,
          height: state.height,
          progress,
          frameIndex,
        });
        previousB = currentB;
        previousOutput = new Uint8Array(buffer);
      } else {
        const cleanTime = time - transitionStart - FREEZE_SECONDS;
        phaseLabel = "Clean B recovery";
        buffer = new Uint8Array(await sampleFrame(videoBMetaSource, cleanTime, sampleCtxB));
      }

      uploadFrame(buffer);
      setTimeline(`${phaseLabel} • ${time.toFixed(2)}s / ${totalDuration.toFixed(2)}s`);
      setStatus(`Rendering frame ${frameIndex + 1}/${totalFrames}`);
      if (captureTrack.requestFrame) {
        captureTrack.requestFrame();
      }
      await sleep(supportsManualFrames ? 0 : Math.round(1000 / fps));
    }

    recorder.stop();
    const recordedWebm = await stopPromise;
    trackStream.getTracks().forEach((track) => track.stop());

    setStatus("Converting render to MP4...");
    setTimeline("ffmpeg.wasm transcode");
    const mp4Blob = await convertWebmToMp4(recordedWebm);
    state.previewUrl = URL.createObjectURL(mp4Blob);
    preview.src = state.previewUrl;
    preview.currentTime = 0;
    preview.play().catch(() => {});

    const anchor = document.createElement("a");
    anchor.href = state.previewUrl;
    anchor.download = "datamosh-v5.mp4";
    anchor.click();

    setStatus("Datamosh V5 render complete.");
    setTimeline("Render complete");
    appendLog(`Output ready: ${Math.round(mp4Blob.size / 1024)} KB`);
  } catch (error) {
    console.error(error);
    setStatus("Datamosh V5 failed.");
    setTimeline("Render failed");
    appendLog(`ERROR: ${error.message}`);
  } finally {
    renderButton.disabled = false;
  }
}

pickAButton.addEventListener("click", () => {
  videoAInput.click();
});

pickBButton.addEventListener("click", () => {
  videoBInput.click();
});

videoAInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    await loadVideoMeta(file, videoAMetaSource, "a");
    state.clipA = file;
    state.clipADuration = videoAMetaSource.duration;
    videoAMeta.textContent = describeMeta(file, videoAMetaSource);
    updateRenderSize();
    updateSliderBounds();
    setStatus("Clip A loaded.");
    appendLog(`Clip A loaded: ${videoAMeta.textContent}`);
  } catch (error) {
    setStatus("Clip A failed to load.");
    appendLog(`ERROR: ${error.message}`);
  }
});

videoBInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    await loadVideoMeta(file, videoBMetaSource, "b");
    state.clipB = file;
    state.clipBDuration = videoBMetaSource.duration;
    videoBMeta.textContent = describeMeta(file, videoBMetaSource);
    updateRenderSize();
    setStatus("Clip B loaded.");
    appendLog(`Clip B loaded: ${videoBMeta.textContent}`);
  } catch (error) {
    setStatus("Clip B failed to load.");
    appendLog(`ERROR: ${error.message}`);
  }
});

transitionSlider.addEventListener("input", updateTransitionOutput);
renderButton.addEventListener("click", () => {
  renderDatamoshV5();
});

window.addEventListener("beforeunload", () => {
  revokePreviewUrl();
  revokeMetaUrl("a", videoAMetaSource);
  revokeMetaUrl("b", videoBMetaSource);
  renderer.dispose();
  texture.dispose();
  material.dispose();
});

resizeRenderTargets(1280, 720);
uploadFrame(texture.image.data);
setTimeline("Waiting for two clips");
updateTransitionOutput();
