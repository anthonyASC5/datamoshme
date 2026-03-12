const STATE_NORMAL_A = "NORMAL_A";
const STATE_FREEZE = "FREEZE";
const STATE_MOSH = "MOSH";
const STATE_FROZEN_MOSHED_B = "FROZEN_MOSHED_B";
const STATE_MOSHED_B = "MOSHED_B";
const STATE_NORMAL_B = "NORMAL_B";

const stageCanvas = document.getElementById("stage-canvas");
const frameSourceCanvas = document.getElementById("frame-source-canvas");
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
const freezeSlider = document.getElementById("freeze-slider");
const moshSlider = document.getElementById("mosh-slider");
const speedOutput = document.getElementById("speed-output");
const freezeOutput = document.getElementById("freeze-output");
const moshOutput = document.getElementById("mosh-output");
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const logOutput = document.getElementById("log-output");

const stageCtx = stageCanvas.getContext("2d", { alpha: false });
const frameSourceCtx = frameSourceCanvas.getContext("2d", { alpha: false });

const state = {
  encoderA: null,
  encoderB: null,
  decoder: null,
  animationFrame: 0,
  sourceUrls: { a: null, b: null },
  mode: STATE_NORMAL_A,
  speed: 2,
  freezeFrames: 15,
  moshLength: 30,
  ready: false,
  timelineStart: 0,
  frameCounterA: 0,
  frameCounterB: 0,
  freezeCounter: 0,
  corruptionFrames: 0,
  frozenMoshedFrames: 0,
  movingMoshedFrames: 0,
  forceNextBKeyframe: false,
  lastKeyFrameA: null,
};

function setStatus(message) {
  statusText.textContent = message;
}

function setTimeline(message) {
  timelineLabel.textContent = message;
}

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  logOutput.textContent = `[${timestamp}] ${message}\n${logOutput.textContent}`.slice(0, 20000);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateCanvasSize() {
  const source = videoASource.videoWidth && videoASource.videoHeight
    ? { width: videoASource.videoWidth, height: videoASource.videoHeight }
    : videoBSource.videoWidth && videoBSource.videoHeight
      ? { width: videoBSource.videoWidth, height: videoBSource.videoHeight }
      : { width: 1280, height: 720 };
  const maxWidth = 1280;
  const scale = Math.min(maxWidth / source.width, 1);
  const width = Math.max(640, Math.round(source.width * scale));
  const height = Math.max(360, Math.round(source.height * scale));
  stageCanvas.width = width;
  stageCanvas.height = height;
  frameSourceCanvas.width = width;
  frameSourceCanvas.height = height;
}

function drawSourceCover(source) {
  const sw = source.videoWidth;
  const sh = source.videoHeight;
  if (!sw || !sh) {
    return;
  }

  const dw = frameSourceCanvas.width;
  const dh = frameSourceCanvas.height;
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

  frameSourceCtx.fillStyle = "#000000";
  frameSourceCtx.fillRect(0, 0, dw, dh);
  frameSourceCtx.drawImage(source, sx, sy, sWidth, sHeight, 0, 0, dw, dh);
}

function clearStage() {
  stageCtx.fillStyle = "#000000";
  stageCtx.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
}

function stopAnimation() {
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = 0;
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

function drawDecodedFrame(frame) {
  stageCtx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
  stageCtx.drawImage(frame, 0, 0, stageCanvas.width, stageCanvas.height);
  frame.close();
}

function handleEncodedChunkA(chunk) {
  if (!state.decoder || state.decoder.state !== "configured") {
    return;
  }

  if (chunk.type === "key") {
    state.lastKeyFrameA = cloneChunk(chunk);
  }

  if (state.mode === STATE_NORMAL_A) {
    state.decoder.decode(cloneChunk(chunk));
  }
}

function handleEncodedChunkB(chunk) {
  if (!state.decoder || state.decoder.state !== "configured") {
    return;
  }

  if (state.mode === STATE_MOSH) {
    if (chunk.type === "delta") {
      for (let i = 0; i < state.speed; i += 1) {
        state.decoder.decode(cloneChunk(chunk));
      }
      state.corruptionFrames += 1;
      if (state.corruptionFrames >= Math.max(1, Math.ceil(state.speed * 0.5))) {
        state.mode = STATE_FROZEN_MOSHED_B;
        state.frozenMoshedFrames = state.freezeFrames;
        videoBSource.pause();
        appendLog("MOSH -> FROZEN_MOSHED_B");
      }
    }
    return;
  }

  if (state.mode === STATE_MOSHED_B) {
    if (chunk.type === "delta") {
      for (let i = 0; i < state.speed; i += 1) {
        state.decoder.decode(cloneChunk(chunk));
      }
      state.movingMoshedFrames += 1;
      if (state.movingMoshedFrames >= state.moshLength) {
        state.mode = STATE_NORMAL_B;
        state.forceNextBKeyframe = true;
        appendLog("MOSHED_B -> NORMAL_B");
      }
    }
    return;
  }

  if (state.mode === STATE_NORMAL_B) {
    if (state.forceNextBKeyframe && chunk.type !== "key") {
      return;
    }
    state.decoder.decode(cloneChunk(chunk));
    if (chunk.type === "key") {
      state.forceNextBKeyframe = false;
    }
  }
}

async function destroyCodecs() {
  state.ready = false;

  for (const encoder of [state.encoderA, state.encoderB]) {
    if (!encoder) {
      continue;
    }
    try {
      await encoder.flush();
    } catch (error) {
      appendLog(`Encoder flush skipped: ${error.message}`);
    }
    encoder.close();
  }

  if (state.decoder) {
    try {
      await state.decoder.flush();
    } catch (error) {
      appendLog(`Decoder flush skipped: ${error.message}`);
    }
    state.decoder.close();
  }

  state.encoderA = null;
  state.encoderB = null;
  state.decoder = null;
}

async function setupWebCodecs() {
  if (!window.VideoEncoder || !window.VideoDecoder || !window.VideoFrame) {
    throw new Error("This browser does not support VideoEncoder, VideoDecoder, and VideoFrame.");
  }

  await destroyCodecs();

  state.encoderA = new VideoEncoder({
    output: handleEncodedChunkA,
    error: (error) => {
      appendLog(`Encoder A error: ${error.message}`);
      setStatus("Encoder A error.");
    },
  });

  state.encoderB = new VideoEncoder({
    output: handleEncodedChunkB,
    error: (error) => {
      appendLog(`Encoder B error: ${error.message}`);
      setStatus("Encoder B error.");
    },
  });

  const config = {
    codec: "vp8",
    width: stageCanvas.width,
    height: stageCanvas.height,
    bitrate: 2_500_000,
    framerate: 30,
  };

  state.encoderA.configure(config);
  state.encoderB.configure(config);

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

function stopSources() {
  ["a", "b"].forEach((key) => {
    const video = key === "a" ? videoASource : videoBSource;
    video.pause();
    if (state.sourceUrls[key]) {
      URL.revokeObjectURL(state.sourceUrls[key]);
      state.sourceUrls[key] = null;
    }
    video.removeAttribute("src");
    video.load();
  });
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

function encodeFromVideo(video, encoder, forceKeyFrame, frameCounter) {
  drawSourceCover(video);
  const timestamp = Math.round((frameCounter / 30) * 1_000_000);
  const frame = new VideoFrame(frameSourceCanvas, { timestamp });
  encoder.encode(frame, { keyFrame: forceKeyFrame });
  frame.close();
}

async function playClipA() {
  if (!videoASource.src || !videoBSource.src) {
    setStatus("Load clip A and clip B first.");
    return;
  }

  updateCanvasSize();
  await setupWebCodecs();
  clearStage();
  state.mode = STATE_NORMAL_A;
  state.freezeCounter = 0;
  state.corruptionFrames = 0;
  state.frozenMoshedFrames = 0;
  state.movingMoshedFrames = 0;
  state.forceNextBKeyframe = false;
  state.frameCounterA = 0;
  state.frameCounterB = 0;
  state.timelineStart = performance.now();
  state.lastKeyFrameA = null;
  videoASource.currentTime = 0;
  videoBSource.pause();
  videoBSource.currentTime = 0;
  await videoASource.play();
  setStatus("Clip A playing.");
  appendLog("State -> NORMAL_A");
  stopAnimation();
  renderLoop();
}

function startTransition() {
  if (state.mode !== STATE_NORMAL_A || !state.lastKeyFrameA) {
    setStatus("Play clip A until a keyframe has been captured, then start the transition.");
    return;
  }

  videoASource.pause();
  videoBSource.currentTime = 0;
  videoBSource.pause();
  state.mode = STATE_FREEZE;
  state.freezeCounter = state.freezeFrames;
  state.corruptionFrames = 0;
  state.frozenMoshedFrames = 0;
  state.movingMoshedFrames = 0;
  state.forceNextBKeyframe = false;
  setStatus("Transition started.");
  appendLog("State -> FREEZE");
}

function updateTimeline() {
  if (state.mode === STATE_NORMAL_A) {
    setTimeline(`A ${videoASource.currentTime.toFixed(2)}s`);
  } else if (state.mode === STATE_FREEZE) {
    setTimeline(`Freeze ${state.freezeCounter}`);
  } else if (state.mode === STATE_MOSH) {
    setTimeline(`Mosh ${state.corruptionFrames}`);
  } else if (state.mode === STATE_FROZEN_MOSHED_B) {
    setTimeline(`Frozen Moshed B ${state.frozenMoshedFrames}`);
  } else if (state.mode === STATE_MOSHED_B) {
    setTimeline(`Moshed B ${state.movingMoshedFrames}/${state.moshLength}`);
  } else if (state.mode === STATE_NORMAL_B) {
    setTimeline(`B ${videoBSource.currentTime.toFixed(2)}s`);
  }
}

function renderLoop() {
  if (!state.ready) {
    state.animationFrame = requestAnimationFrame(renderLoop);
    return;
  }

  updateTimeline();

  try {
    if (state.mode === STATE_NORMAL_A) {
      if (!videoASource.paused && !videoASource.ended && videoASource.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const forceKeyFrame = state.frameCounterA % 45 === 0;
        encodeFromVideo(videoASource, state.encoderA, forceKeyFrame, state.frameCounterA);
        state.frameCounterA += 1;
      }
    } else if (state.mode === STATE_FREEZE) {
      if (state.lastKeyFrameA) {
        state.decoder.decode(cloneChunk(state.lastKeyFrameA));
      }
      state.freezeCounter -= 1;
      if (state.freezeCounter <= 0) {
        state.mode = STATE_MOSH;
        videoBSource.play().catch(() => {});
        appendLog("State -> MOSH");
      }
    } else if (state.mode === STATE_FROZEN_MOSHED_B) {
      state.frozenMoshedFrames -= 1;
      if (state.frozenMoshedFrames <= 0) {
        state.mode = STATE_MOSHED_B;
        videoBSource.play().catch(() => {});
        appendLog("State -> MOSHED_B");
      }
    } else if ((state.mode === STATE_MOSH || state.mode === STATE_MOSHED_B || state.mode === STATE_NORMAL_B) && videoBSource.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const forceKeyFrame = state.mode === STATE_NORMAL_B && state.forceNextBKeyframe;
      encodeFromVideo(videoBSource, state.encoderB, forceKeyFrame, state.frameCounterB);
      state.frameCounterB += 1;
    }
  } catch (error) {
    appendLog(`Render loop error: ${error.message}`);
  }

  state.animationFrame = requestAnimationFrame(renderLoop);
}

pickAButton.addEventListener("click", () => videoAInput.click());
pickBButton.addEventListener("click", () => videoBInput.click());
playAButton.addEventListener("click", () => {
  playClipA().catch((error) => {
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

freezeSlider.addEventListener("input", () => {
  state.freezeFrames = Number(freezeSlider.value);
  freezeOutput.value = String(state.freezeFrames);
});

moshSlider.addEventListener("input", () => {
  state.moshLength = Number(moshSlider.value);
  moshOutput.value = String(state.moshLength);
});

window.addEventListener("beforeunload", async () => {
  stopAnimation();
  stopSources();
  await destroyCodecs();
});

clearStage();
speedOutput.value = String(state.speed);
freezeOutput.value = String(state.freezeFrames);
moshOutput.value = String(state.moshLength);
setTimeline("Load two clips");
setStatus("Load clip A and clip B.");
appendLog("Datamosh V7 ready.");
