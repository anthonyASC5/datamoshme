const { FFmpeg } = window.FFmpegWASM;
const { fetchFile, toBlobURL } = window.FFmpegUtil;

const FREEZE_SECONDS = 0.5;
const MOSH_HEAD_SECONDS = 2;
const NORMALIZE_FILTER = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=30";

const ffmpeg = new FFmpeg();

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
const statusText = document.getElementById("status-text");
const timelineLabel = document.getElementById("timeline-label");
const logOutput = document.getElementById("log-output");

const state = {
  clipA: null,
  clipB: null,
  clipADuration: 0,
  clipBDuration: 0,
  previewUrl: null,
  ffmpegLoaded: false,
};

function setStatus(message) {
  statusText.textContent = message;
}

function appendLog(message) {
  logOutput.textContent = `${message}\n${logOutput.textContent}`.slice(0, 12000);
}

function updateTransitionOutput() {
  transitionOutput.value = `${Number(transitionSlider.value).toFixed(1)}s`;
}

function revokePreviewUrl() {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
}

async function loadVideoMeta(file, videoNode) {
  const url = URL.createObjectURL(file);
  videoNode.src = url;
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
      URL.revokeObjectURL(url);
    };
    videoNode.addEventListener("loadedmetadata", onLoaded, { once: true });
    videoNode.addEventListener("error", onError, { once: true });
  });
}

function updateSliderBounds() {
  if (!state.clipADuration) {
    return;
  }
  transitionSlider.max = Math.max(0.1, Number((state.clipADuration - 0.1).toFixed(1)));
  transitionSlider.value = Math.min(state.clipADuration - 0.1, 2).toFixed(1);
  updateTransitionOutput();
}

async function ensureFFmpegLoaded() {
  if (state.ffmpegLoaded) {
    return;
  }

  setStatus("Loading ffmpeg.wasm core...");
  appendLog("Loading ffmpeg.wasm core");

  ffmpeg.on("log", ({ message }) => {
    appendLog(message);
  });

  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  state.ffmpegLoaded = true;
  appendLog("ffmpeg.wasm ready");
}

function validateReady() {
  if (!state.clipA || !state.clipB) {
    setStatus("Load clip A and clip B first.");
    return false;
  }
  return true;
}

async function exec(args) {
  appendLog(`$ ffmpeg ${args.join(" ")}`);
  await ffmpeg.exec(args);
}

async function writeTextFile(path, contents) {
  await ffmpeg.writeFile(path, new TextEncoder().encode(contents));
}

async function renderDatamosh() {
  if (!validateReady()) {
    return;
  }

  renderButton.disabled = true;
  revokePreviewUrl();

  try {
    await ensureFFmpegLoaded();
    setStatus("Writing files to ffmpeg FS...");
    timelineLabel.textContent = "Preparing source files";

    await ffmpeg.writeFile("A.mp4", await fetchFile(state.clipA));
    await ffmpeg.writeFile("B.mp4", await fetchFile(state.clipB));

    const transitionStart = Math.min(Number(transitionSlider.value), Math.max(0.1, state.clipADuration - 0.1));
    const bHeadDuration = Math.min(MOSH_HEAD_SECONDS, Math.max(0.5, state.clipBDuration));
    const bTailStart = Math.min(bHeadDuration, Math.max(0, state.clipBDuration - 0.1));

    timelineLabel.textContent = "Rendering A play segment";
    await exec([
      "-i", "A.mp4",
      "-t", transitionStart.toFixed(3),
      "-vf", NORMALIZE_FILTER,
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "A_play.mp4",
    ]);

    timelineLabel.textContent = "Extracting freeze frame";
    await exec([
      "-ss", transitionStart.toFixed(3),
      "-i", "A.mp4",
      "-vf", NORMALIZE_FILTER,
      "-frames:v", "1",
      "freeze.png",
    ]);

    timelineLabel.textContent = "Building freeze loop";
    await exec([
      "-loop", "1",
      "-framerate", "30",
      "-t", String(FREEZE_SECONDS),
      "-i", "freeze.png",
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "freeze_loop.mp4",
    ]);

    timelineLabel.textContent = "Rendering clean B head";
    await exec([
      "-i", "B.mp4",
      "-t", bHeadDuration.toFixed(3),
      "-vf", NORMALIZE_FILTER,
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "B_head.mp4",
    ]);

    timelineLabel.textContent = "Encoding mosh intro GOP";
    await writeTextFile("mosh_intro.txt", "file 'freeze_loop.mp4'\nfile 'B_head.mp4'\n");
    await exec([
      "-f", "concat",
      "-safe", "0",
      "-i", "mosh_intro.txt",
      "-an",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      "-g", "9999",
      "-keyint_min", "9999",
      "-sc_threshold", "1000000000",
      "-bf", "0",
      "-movflags", "+faststart",
      "mosh_intro.mp4",
    ]);

    timelineLabel.textContent = "Rendering clean B tail";
    await exec([
      "-ss", bTailStart.toFixed(3),
      "-i", "B.mp4",
      "-vf", NORMALIZE_FILTER,
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "B_tail.mp4",
    ]);

    timelineLabel.textContent = "Assembling final output";
    await writeTextFile("final_list.txt", "file 'A_play.mp4'\nfile 'mosh_intro.mp4'\nfile 'B_tail.mp4'\n");
    await exec([
      "-f", "concat",
      "-safe", "0",
      "-i", "final_list.txt",
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "output.mp4",
    ]);

    const data = await ffmpeg.readFile("output.mp4");
    state.previewUrl = URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }));
    preview.src = state.previewUrl;
    preview.currentTime = 0;
    preview.play().catch(() => {});
    timelineLabel.textContent = "Render complete";
    setStatus("Datamosh V3 render complete.");
  } catch (error) {
    console.error(error);
    setStatus("Datamosh V3 failed.");
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
  state.clipA = file;
  await loadVideoMeta(file, videoAMetaSource);
  state.clipADuration = videoAMetaSource.duration;
  videoAMeta.textContent = `${file.name} • ${videoAMetaSource.duration.toFixed(2)}s • ${videoAMetaSource.videoWidth}x${videoAMetaSource.videoHeight}`;
  updateSliderBounds();
  setStatus("Clip A loaded.");
});

videoBInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  state.clipB = file;
  await loadVideoMeta(file, videoBMetaSource);
  state.clipBDuration = videoBMetaSource.duration;
  videoBMeta.textContent = `${file.name} • ${videoBMetaSource.duration.toFixed(2)}s • ${videoBMetaSource.videoWidth}x${videoBMetaSource.videoHeight}`;
  setStatus("Clip B loaded.");
});

transitionSlider.addEventListener("input", updateTransitionOutput);
renderButton.addEventListener("click", () => {
  renderDatamosh();
});

window.addEventListener("beforeunload", () => {
  revokePreviewUrl();
});

updateTransitionOutput();
