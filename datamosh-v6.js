const TRANSITION_SECONDS = 3;
const OUTPUT_FPS = 30;
const MAX_WIDTH = 1280;
const OUTPUT_BITS_PER_SECOND = 8_000_000;

const pickAButton = document.getElementById("pick-a-button");
const pickBButton = document.getElementById("pick-b-button");
const renderButton = document.getElementById("render-button");
const videoAInput = document.getElementById("video-a-input");
const videoBInput = document.getElementById("video-b-input");
const videoASource = document.getElementById("video-a-source");
const videoBSource = document.getElementById("video-b-source");
const videoAMeta = document.getElementById("video-a-meta");
const videoBMeta = document.getElementById("video-b-meta");
const renderCanvas = document.getElementById("render-canvas");
const preview = document.getElementById("preview");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const logOutput = document.getElementById("log-output");

const ctx = renderCanvas.getContext("2d", { alpha: false });

const state = {
  clipA: null,
  clipB: null,
  previewUrl: null,
  sourceUrls: { a: null, b: null },
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
  logOutput.textContent = `[${timestamp}] ${message}\n${logOutput.textContent}`.slice(0, 18000);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function revokePreviewUrl() {
  if (!state.previewUrl) {
    return;
  }
  URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
}

function revokeSourceUrl(key, video) {
  if (!state.sourceUrls[key]) {
    return;
  }
  URL.revokeObjectURL(state.sourceUrls[key]);
  state.sourceUrls[key] = null;
  video.removeAttribute("src");
  video.load();
}

async function loadSource(file, video, key) {
  revokeSourceUrl(key, video);
  const url = URL.createObjectURL(file);
  state.sourceUrls[key] = url;
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
      reject(new Error("Video failed to load in this browser."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function describeFile(file, video) {
  return `${file.name} • ${video.duration.toFixed(2)}s • ${video.videoWidth}x${video.videoHeight}`;
}

function updateRenderSize() {
  const source = videoASource.videoWidth && videoASource.videoHeight
    ? { width: videoASource.videoWidth, height: videoASource.videoHeight }
    : videoBSource.videoWidth && videoBSource.videoHeight
      ? { width: videoBSource.videoWidth, height: videoBSource.videoHeight }
      : { width: 1280, height: 720 };
  const scale = Math.min(MAX_WIDTH / source.width, 1);
  state.width = Math.max(320, Math.round(source.width * scale));
  state.height = Math.max(180, Math.round(source.height * scale));
  renderCanvas.width = state.width;
  renderCanvas.height = state.height;
}

function drawVideoCover(video) {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) {
    return;
  }

  const dw = state.width;
  const dh = state.height;
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

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, dw, dh);
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

function getMp4RecordMimeType() {
  const options = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
  ];

  return options.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || "";
}

function getDatamosherConstructor() {
  const candidates = [
    window.datamosher,
    window.Datamosher,
    window.DataMosher,
    window.dmosh,
    window.Dmosh,
  ];

  return candidates.find((candidate) => typeof candidate === "function") || null;
}

function bytesToBinaryString(bytes) {
  const chunkSize = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    out += String.fromCharCode(...chunk);
  }
  return out;
}

function createDatamosherFile(DatamosherCtor, filename, bytes) {
  const dotIndex = filename.lastIndexOf(".");
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const fileType = dotIndex > 0 ? filename.slice(dotIndex + 1).toLowerCase() : "mp4";
  const rawData = new Uint8Array(bytes);
  const file = Object.create(DatamosherCtor.prototype);
  file.fileName = baseName;
  file.fileType = fileType;
  file.rawData = rawData;
  file.data = bytesToBinaryString(rawData);
  return file;
}

function datamoshWithLibrary(blob, cutPercent) {
  const DatamosherCtor = getDatamosherConstructor();
  if (!DatamosherCtor) {
    throw new Error("datamosher library was not found on window. Check the CDN script load.");
  }
  if (typeof DatamosherCtor.prototype?.glitchMP4 !== "function") {
    throw new Error("datamosher library loaded, but glitchMP4 is unavailable.");
  }

  return blob.arrayBuffer().then((buffer) => {
    const file = createDatamosherFile(DatamosherCtor, "datamosh-v6.mp4", new Uint8Array(buffer));
    file.glitchMP4(0, 1, 12, Math.max(0, cutPercent - 1), 100, 8, 88);
    return new Blob([file.rawData], { type: blob.type || "video/mp4" });
  });
}

async function recordStitchedMp4() {
  const mimeType = getMp4RecordMimeType();
  if (!mimeType) {
    throw new Error("This browser cannot record MP4 with MediaRecorder. Datamosher V6 now requires MP4 capture because datamosher does not support WebM.");
  }

  const cutA = Math.min(TRANSITION_SECONDS, Math.max(0, videoASource.duration || 0));
  const durationB = Math.max(0, videoBSource.duration || 0);
  const totalDuration = cutA + durationB;
  const totalFrames = Math.max(1, Math.ceil(totalDuration * OUTPUT_FPS));

  appendLog(`Timeline: A 0.00-${cutA.toFixed(2)}s, then B 0.00-${durationB.toFixed(2)}s`);
  appendLog(`Recording format: ${mimeType}`);

  const captureTrackProbe = renderCanvas.captureStream(0).getVideoTracks()[0];
  const supportsManualFrames = Boolean(captureTrackProbe?.requestFrame);
  captureTrackProbe?.stop();

  const stream = renderCanvas.captureStream(supportsManualFrames ? 0 : OUTPUT_FPS);
  const track = stream.getVideoTracks()[0];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: OUTPUT_BITS_PER_SECOND });

  const stopPromise = new Promise((resolve, reject) => {
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => reject(new Error("MediaRecorder failed during MP4 capture."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start();

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const outputTime = frameIndex / OUTPUT_FPS;
    if (outputTime < cutA) {
      await seekVideo(videoASource, outputTime);
      drawVideoCover(videoASource);
      setTimeline(`Clip A • ${outputTime.toFixed(2)}s / ${totalDuration.toFixed(2)}s`);
    } else {
      const bTime = outputTime - cutA;
      await seekVideo(videoBSource, bTime);
      drawVideoCover(videoBSource);
      setTimeline(`Clip B • ${outputTime.toFixed(2)}s / ${totalDuration.toFixed(2)}s`);
    }
    setStatus(`Rendering frame ${frameIndex + 1}/${totalFrames}`);
    if (track.requestFrame) {
      track.requestFrame();
    }
    await sleep(supportsManualFrames ? 0 : Math.round(1000 / OUTPUT_FPS));
  }

  recorder.stop();
  const blob = await stopPromise;
  stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
  return { blob, cutA, totalDuration, mimeType };
}

async function renderDatamoshV6() {
  if (!state.clipA || !state.clipB) {
    setStatus("Load clip A and clip B first.");
    return;
  }
  if (!window.MediaRecorder) {
    setStatus("This browser does not support MediaRecorder.");
    return;
  }

  renderButton.disabled = true;
  revokePreviewUrl();
  preview.removeAttribute("src");
  preview.load();

  try {
    updateRenderSize();
    setStatus("Recording stitched MP4...");
    setTimeline("Clip A to Clip B cut at 3.00s");

    const { blob, cutA, totalDuration, mimeType } = await recordStitchedMp4();
    appendLog(`Recorded MP4 ${Math.round(blob.size / 1024)} KB`);

    const cutPercent = totalDuration > 0 ? (cutA / totalDuration) * 100 : 0;
    const outputBlob = await datamoshWithLibrary(blob, cutPercent);
    appendLog(`datamosher.glitchMP4 applied from ${Math.max(0, cutPercent - 1).toFixed(2)}% to 100.00%`);

    state.previewUrl = URL.createObjectURL(outputBlob);
    preview.src = state.previewUrl;
    preview.currentTime = 0;
    preview.play().catch(() => {});

    const anchor = document.createElement("a");
    anchor.href = state.previewUrl;
    anchor.download = "datamosh-v6.mp4";
    anchor.click();

    setStatus("Datamosh V6 render complete.");
    setTimeline("Render complete");
    appendLog(`Output ${Math.round(outputBlob.size / 1024)} KB • ${mimeType}`);
  } catch (error) {
    console.error(error);
    setStatus("Datamosh V6 failed.");
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
    await loadSource(file, videoASource, "a");
    state.clipA = file;
    updateRenderSize();
    videoAMeta.textContent = describeFile(file, videoASource);
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
    await loadSource(file, videoBSource, "b");
    state.clipB = file;
    updateRenderSize();
    videoBMeta.textContent = describeFile(file, videoBSource);
    setStatus("Clip B loaded.");
    appendLog(`Clip B loaded: ${videoBMeta.textContent}`);
  } catch (error) {
    setStatus("Clip B failed to load.");
    appendLog(`ERROR: ${error.message}`);
  }
});

renderButton.addEventListener("click", () => {
  renderDatamoshV6();
});

window.addEventListener("beforeunload", () => {
  revokePreviewUrl();
  revokeSourceUrl("a", videoASource);
  revokeSourceUrl("b", videoBSource);
});

ctx.fillStyle = "#000000";
ctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
setTimeline("Waiting for two clips");
