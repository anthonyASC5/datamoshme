const STATE_PLAY_A = "PLAY_A";
const STATE_HOLD_A = "HOLD_A";
const STATE_MOSH = "MOSH";
const STATE_PLAY_B = "PLAY_B";

const METHOD_LABELS = {
  removeI: "RMV",
  duplicateD: "DUP",
  hybrid: "HYB",
};

const stageCanvas = document.getElementById("stage-canvas");
const frameCanvas = document.getElementById("frame-canvas");
const videoASource = document.getElementById("video-a-source");
const videoBSource = document.getElementById("video-b-source");
const pickAButton = document.getElementById("pick-a-button");
const pickBButton = document.getElementById("pick-b-button");
const playAButton = document.getElementById("play-a-button");
const transitionButton = document.getElementById("transition-button");
const videoAInput = document.getElementById("video-a-input");
const videoBInput = document.getElementById("video-b-input");
const videoAMeta = document.getElementById("video-a-meta");
const videoBMeta = document.getElementById("video-b-meta");
const speedSlider = document.getElementById("speed-slider");
const holdSlider = document.getElementById("hold-slider");
const moshSlider = document.getElementById("mosh-slider");
const methodSelect = document.getElementById("method-select");
const speedOutput = document.getElementById("speed-output");
const holdOutput = document.getElementById("hold-output");
const moshOutput = document.getElementById("mosh-output");
const methodOutput = document.getElementById("method-output");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const logOutput = document.getElementById("log-output");

const stageCtx = stageCanvas.getContext("2d", { alpha: false });
const frameCtx = frameCanvas.getContext("2d", { alpha: false });

const state = {
  encoder: null,
  decoder: null,
  animationFrame: 0,
  sourceUrls: { a: null, b: null },
  currentState: STATE_PLAY_A,
  speed: 3,
  holdFrames: 8,
  moshFrames: 42,
  method: "removeI",
  ready: false,
  frameCounter: 0,
  transitionArmed: false,
  holdCounter: 0,
  moshCounter: 0,
  lastKeyChunkA: null,
  nextBKeyAllowed: false,
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

function cloneChunk(chunk) {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return new EncodedVideoChunk({
    type: chunk.type,
    timestamp: chunk.timestamp,
    duration: chunk.duration,
    data,
  });
}

function clearStage() {
  stageCtx.fillStyle = "#000000";
  stageCtx.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
}

function stopAnimation() {
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = 0;
}

function updateCanvasSize() {
  const source = videoASource.videoWidth && videoASource.videoHeight
    ? { width: videoASource.videoWidth, height: videoASource.videoHeight }
    : videoBSource.videoWidth && videoBSource.videoHeight
      ? { width: videoBSource.videoWidth, height: videoBSource.videoHeight }
      : { width: 1280, height: 720 };
  const scale = Math.min(1280 / source.width, 1);
  const width = Math.max(640, Math.round(source.width * scale));
  const height = Math.max(360, Math.round(source.height * scale));
  stageCanvas.width = width;
  stageCanvas.height = height;
  frameCanvas.width = width;
  frameCanvas.height = height;
}

function drawSourceCover(video) {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) {
    return;
  }

  const dw = frameCanvas.width;
  const dh = frameCanvas.height;
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

  frameCtx.fillStyle = "#000000";
  frameCtx.fillRect(0, 0, dw, dh);
  frameCtx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, dw, dh);
}

function drawDecodedFrame(frame) {
  stageCtx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
  stageCtx.drawImage(frame, 0, 0, stageCanvas.width, stageCanvas.height);
  frame.close();
}

async function destroyCodecs() {
  state.ready = false;
  if (state.encoder) {
    try {
      await state.encoder.flush();
    } catch (error) {
      appendLog(`Encoder flush skipped: ${error.message}`);
    }
    state.encoder.close();
    state.encoder = null;
  }
  if (state.decoder) {
    try {
      await state.decoder.flush();
    } catch (error) {
      appendLog(`Decoder flush skipped: ${error.message}`);
    }
    state.decoder.close();
    state.decoder = null;
  }
}

async function setupWebCodecs() {
  if (!window.VideoEncoder || !window.VideoDecoder || !window.VideoFrame) {
    throw new Error("This browser does not support VideoEncoder, VideoDecoder, and VideoFrame.");
  }

  await destroyCodecs();

  state.encoder = new VideoEncoder({
    output: handleEncodedChunk,
    error: (error) => {
      appendLog(`Encoder error: ${error.message}`);
      setStatus("Encoder error.");
    },
  });

  state.encoder.configure({
    codec: "vp8",
    width: stageCanvas.width,
    height: stageCanvas.height,
    bitrate: 2_500_000,
    framerate: 30,
  });

  state.decoder = new VideoDecoder({
    output: drawDecodedFrame,
    error: (error) => {
      appendLog(`Decoder error: ${error.message}`);
      setStatus("Decoder error.");
    },
  });

  state.decoder.configure({ codec: "vp8" });
  state.ready = true;
  appendLog(`WebCodecs configured at ${stageCanvas.width}x${stageCanvas.height}`);
}

function decodeChunkCopies(chunk, copies) {
  for (let i = 0; i < copies; i += 1) {
    state.decoder.decode(cloneChunk(chunk));
  }
}

function handleEncodedChunk(chunk) {
  if (!state.decoder || state.decoder.state !== "configured") {
    return;
  }

  if (state.currentState === STATE_PLAY_A) {
    if (chunk.type === "key") {
      state.lastKeyChunkA = cloneChunk(chunk);
    }
    state.decoder.decode(cloneChunk(chunk));
    return;
  }

  if (state.currentState === STATE_HOLD_A) {
    return;
  }

  if (state.currentState === STATE_MOSH) {
    const duplicateCount = state.method === "removeI" ? 1 : state.speed;

    if (chunk.type === "delta") {
      decodeChunkCopies(chunk, duplicateCount);
      state.moshCounter += 1;
      if (state.moshCounter >= state.moshFrames) {
        state.currentState = STATE_PLAY_B;
        state.nextBKeyAllowed = true;
        appendLog("MOSH -> PLAY_B");
      }
      return;
    }

    if (chunk.type === "key") {
      if (state.method === "duplicateD") {
        state.decoder.decode(cloneChunk(chunk));
        return;
      }
      if (state.method === "hybrid" && state.moshCounter > Math.floor(state.moshFrames * 0.75)) {
        state.decoder.decode(cloneChunk(chunk));
        state.currentState = STATE_PLAY_B;
        state.nextBKeyAllowed = false;
        appendLog("MOSH -> PLAY_B (hybrid restore)");
      }
      return;
    }
  }

  if (state.currentState === STATE_PLAY_B) {
    if (state.nextBKeyAllowed && chunk.type !== "key") {
      return;
    }
    state.decoder.decode(cloneChunk(chunk));
    if (chunk.type === "key") {
      state.nextBKeyAllowed = false;
    }
  }
}

function encodeFrameFrom(video, forceKeyFrame = false) {
  drawSourceCover(video);
  const frame = new VideoFrame(frameCanvas, { timestamp: Math.round((state.frameCounter / 30) * 1_000_000) });
  state.encoder.encode(frame, { keyFrame: forceKeyFrame });
  frame.close();
  state.frameCounter += 1;
}

async function waitForVideoReady(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return;
  }
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
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function loadSource(file, video, key) {
  if (state.sourceUrls[key]) {
    URL.revokeObjectURL(state.sourceUrls[key]);
  }
  const url = URL.createObjectURL(file);
  state.sourceUrls[key] = url;
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.loop = false;
  video.load();
  await waitForVideoReady(video);
}

function describeFile(file, video) {
  return `${file.name} • ${video.duration.toFixed(2)}s • ${video.videoWidth}x${video.videoHeight}`;
}

async function playA() {
  if (!videoASource.src || !videoBSource.src) {
    setStatus("Load clip A and clip B first.");
    return;
  }

  updateCanvasSize();
  await setupWebCodecs();
  clearStage();
  state.currentState = STATE_PLAY_A;
  state.transitionArmed = false;
  state.holdCounter = 0;
  state.moshCounter = 0;
  state.frameCounter = 0;
  state.lastKeyChunkA = null;
  state.nextBKeyAllowed = false;
  videoASource.currentTime = 0;
  videoBSource.pause();
  videoBSource.currentTime = 0;
  await videoASource.play();
  setStatus("Clip A playing.");
  appendLog("State -> PLAY_A");
  stopAnimation();
  renderLoop();
}

function startTransition() {
  if (state.currentState !== STATE_PLAY_A || !state.lastKeyChunkA) {
    setStatus("Play clip A until a keyframe has been captured, then start transition.");
    return;
  }

  videoASource.pause();
  videoBSource.currentTime = 0;
  videoBSource.play().catch(() => {});
  state.currentState = STATE_HOLD_A;
  state.holdCounter = state.holdFrames;
  state.moshCounter = 0;
  state.nextBKeyAllowed = false;
  setStatus("Transition started.");
  appendLog("State -> HOLD_A");
}

function renderLoop() {
  if (!state.ready) {
    state.animationFrame = requestAnimationFrame(renderLoop);
    return;
  }

  try {
    if (state.currentState === STATE_PLAY_A) {
      setTimeline(`A ${videoASource.currentTime.toFixed(2)}s`);
      if (!videoASource.paused && !videoASource.ended && videoASource.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        encodeFrameFrom(videoASource, state.frameCounter % 45 === 0);
      }
    } else if (state.currentState === STATE_HOLD_A) {
      setTimeline(`Hold ${state.holdCounter}`);
      if (state.lastKeyChunkA) {
        state.decoder.decode(cloneChunk(state.lastKeyChunkA));
      }
      state.holdCounter -= 1;
      if (state.holdCounter <= 0) {
        state.currentState = STATE_MOSH;
        appendLog(`State -> MOSH (${state.method})`);
      }
    } else if (state.currentState === STATE_MOSH) {
      setTimeline(`Mosh ${state.moshCounter}/${state.moshFrames}`);
      if (videoBSource.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        encodeFrameFrom(videoBSource, false);
      }
    } else if (state.currentState === STATE_PLAY_B) {
      setTimeline(`B ${videoBSource.currentTime.toFixed(2)}s`);
      if (videoBSource.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        encodeFrameFrom(videoBSource, state.nextBKeyAllowed);
      }
    }
  } catch (error) {
    appendLog(`Render loop error: ${error.message}`);
  }

  state.animationFrame = requestAnimationFrame(renderLoop);
}

pickAButton.addEventListener("click", () => videoAInput.click());
pickBButton.addEventListener("click", () => videoBInput.click());
playAButton.addEventListener("click", () => {
  playA().catch((error) => {
    console.error(error);
    setStatus("Clip A failed to start.");
    appendLog(`ERROR: ${error.message}`);
  });
});
transitionButton.addEventListener("click", startTransition);

videoAInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    await loadSource(file, videoASource, "a");
    updateCanvasSize();
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
    updateCanvasSize();
    videoBMeta.textContent = describeFile(file, videoBSource);
    setStatus("Clip B loaded.");
    appendLog(`Clip B loaded: ${videoBMeta.textContent}`);
  } catch (error) {
    setStatus("Clip B failed to load.");
    appendLog(`ERROR: ${error.message}`);
  }
});

speedSlider.addEventListener("input", () => {
  state.speed = Number(speedSlider.value);
  speedOutput.value = String(state.speed);
});

holdSlider.addEventListener("input", () => {
  state.holdFrames = Number(holdSlider.value);
  holdOutput.value = String(state.holdFrames);
});

moshSlider.addEventListener("input", () => {
  state.moshFrames = Number(moshSlider.value);
  moshOutput.value = String(state.moshFrames);
});

methodSelect.addEventListener("change", () => {
  state.method = methodSelect.value;
  methodOutput.value = METHOD_LABELS[state.method] || "---";
  appendLog(`Method set to ${state.method}`);
});

window.addEventListener("beforeunload", async () => {
  stopAnimation();
  await destroyCodecs();
  ["a", "b"].forEach((key) => {
    if (state.sourceUrls[key]) {
      URL.revokeObjectURL(state.sourceUrls[key]);
      state.sourceUrls[key] = null;
    }
  });
});

clearStage();
speedOutput.value = String(state.speed);
holdOutput.value = String(state.holdFrames);
moshOutput.value = String(state.moshFrames);
methodOutput.value = METHOD_LABELS[state.method];
setTimeline("Load two clips");
setStatus("Load clip A and clip B.");
appendLog("Datamosh V8 ready.");
