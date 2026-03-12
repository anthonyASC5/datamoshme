import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { trackEvent } from "./analytics.js";

const LOOP_DURATION = 7;
const MAX_TEXTURE_SIZE = 2048;

const root = document.getElementById("scene-root");
const fileInput = document.getElementById("file-input");
const exportButton = document.getElementById("export-button");
const statusText = document.getElementById("status-text");
const fileNameText = document.getElementById("file-name");

const glowSlider = document.getElementById("glow-slider");
const rgbSlider = document.getElementById("rgb-slider");
const scanSlider = document.getElementById("scan-slider");
const gritSlider = document.getElementById("grit-slider");
const colorSlider = document.getElementById("color-slider");
const backgroundSelect = document.getElementById("background-select");
const blackDataToggle = document.getElementById("black-data-toggle");

const glowOutput = document.getElementById("glow-output");
const rgbOutput = document.getElementById("rgb-output");
const scanOutput = document.getElementById("scan-output");
const gritOutput = document.getElementById("grit-output");
const colorOutput = document.getElementById("color-output");

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: false,
});
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 4);
let cameraZoom = 4;

const planeGeometry = new THREE.PlaneGeometry(2.2, 2.2, 1, 1);
const planeMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.97,
  side: THREE.DoubleSide,
});
const hologramPlane = new THREE.Mesh(planeGeometry, planeMaterial);
hologramPlane.rotation.set(-0.08, 0.18, -0.03);
scene.add(hologramPlane);

const ambientGlow = new THREE.PointLight(0x55f7ff, 0.9, 8, 2);
ambientGlow.position.set(-0.7, 0.6, 2.8);
scene.add(ambientGlow);

const magentaGlow = new THREE.PointLight(0xff4fcf, 0.7, 9, 2);
magentaGlow.position.set(0.8, -0.5, 2.2);
scene.add(magentaGlow);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
renderPass.clearAlpha = 0;
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.4,
  0.4,
  0.2,
);
composer.addPass(bloomPass);

const crtPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    rgbSplit: { value: parseFloat(rgbSlider.value) },
    scanStrength: { value: parseFloat(scanSlider.value) },
    warpStrength: { value: 0.11 },
    noiseAmount: { value: 0.028 },
    blackDataMix: { value: 0 },
    blackDataThreshold: { value: 0.52 },
    blackDataEdge: { value: 1.15 },
    blackDataGrit: { value: 1.0 },
    blackDataColorMix: { value: 0.0 },
    pixelStep: { value: new THREE.Vector2(1 / window.innerWidth, 1 / window.innerHeight) },
    resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float rgbSplit;
    uniform float scanStrength;
    uniform float warpStrength;
    uniform float noiseAmount;
    uniform float blackDataMix;
    uniform float blackDataThreshold;
    uniform float blackDataEdge;
    uniform float blackDataGrit;
    uniform float blackDataColorMix;
    uniform vec2 pixelStep;
    uniform vec2 resolution;

    varying vec2 vUv;

    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float luminance(vec3 color) {
      return dot(color, vec3(0.299, 0.587, 0.114));
    }

    vec2 barrelWarp(vec2 uv, float amount) {
      vec2 centered = uv * 2.0 - 1.0;
      float radius = dot(centered, centered);
      centered *= 1.0 + amount * radius;
      return centered * 0.5 + 0.5;
    }

    void main() {
      vec2 warpedUv = barrelWarp(vUv, warpStrength);
      if (warpedUv.x < 0.0 || warpedUv.x > 1.0 || warpedUv.y < 0.0 || warpedUv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
      }

      vec2 splitOffset = vec2(rgbSplit, 0.0);
      vec4 sourceSample = texture2D(tDiffuse, warpedUv);
      float r = texture2D(tDiffuse, warpedUv + splitOffset).r;
      float g = sourceSample.g;
      float b = texture2D(tDiffuse, warpedUv - splitOffset).b;

      vec3 color = vec3(r, g, b);

      float scan = sin(warpedUv.y * resolution.y * 1.15) * scanStrength;
      float verticalBand = sin((warpedUv.y + time * 0.3) * 22.0) * 0.015;
      float flicker = 0.985 + sin(time * 18.0) * 0.015;
      float grain = random(warpedUv * vec2(318.0, 512.0) + time * 0.37) * noiseAmount;
      float sourceAlpha = sourceSample.a;

      color += scan + verticalBand;
      color += grain;
      color *= flicker;
      color = max(color, vec3(0.0));

      if (blackDataMix > 0.0) {
        vec2 px = pixelStep;
        float center = luminance(texture2D(tDiffuse, warpedUv).rgb);
        float north = luminance(texture2D(tDiffuse, warpedUv + vec2(0.0, px.y)).rgb);
        float south = luminance(texture2D(tDiffuse, warpedUv - vec2(0.0, px.y)).rgb);
        float east = luminance(texture2D(tDiffuse, warpedUv + vec2(px.x, 0.0)).rgb);
        float west = luminance(texture2D(tDiffuse, warpedUv - vec2(px.x, 0.0)).rgb);
        float edge = clamp(abs(east - west) + abs(north - south), 0.0, 1.0);
        float inverted = 1.0 - center;
        float isolation = smoothstep(blackDataThreshold, 1.0, inverted + edge * 0.45);
        float etched = clamp((inverted - 0.5) * 3.2 + 0.5 + edge * blackDataEdge, 0.0, 1.0);
        float digitalGrain = step(0.3, random(floor(warpedUv * resolution.xy * (0.14 + blackDataGrit * 0.12)) + time * 0.91));
        float blackData = clamp(mix(etched, isolation, 0.45) + edge * 0.28 + digitalGrain * (0.08 + blackDataGrit * 0.12), 0.0, 1.0);
        vec3 sourceTint = mix(vec3(center), color, blackDataColorMix);
        vec3 blackDataColor = mix(vec3(blackData), vec3(blackData) * sourceTint * 1.35, blackDataColorMix);
        color = mix(color, blackDataColor, blackDataMix);
      }

      gl_FragColor = vec4(color, sourceAlpha);
    }
  `,
});
composer.addPass(crtPass);

const clock = new THREE.Clock();
let activeObjectUrl = null;
let activeTexture = null;
let isRecording = false;
let activeBackground = backgroundSelect?.value || "black";

function applyBackgroundPreset(preset, elapsed = 0) {
  activeBackground = preset;
  const movingShift = Math.sin(elapsed * 0.35) * 18;
  const styles = {
    transparent:
      "linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.08) 75%), linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.08) 75%)",
    black: "#000000",
    navy: "#09142f",
    orange: "#ff6a00",
    purple: "#35114d",
    green: "#0f2f16",
    "vhs-noise":
      "radial-gradient(circle at top, rgba(255,255,255,0.12), transparent 30%), repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 4px), linear-gradient(135deg, #040404, #161616)",
    "art-paper":
      "radial-gradient(circle at 20% 20%, rgba(255,188,112,0.18), transparent 22%), radial-gradient(circle at 80% 24%, rgba(110,180,255,0.18), transparent 24%), linear-gradient(135deg, #2b1f17, #6f4638 40%, #1c253f)",
    "moving-aurora":
      `radial-gradient(circle at ${35 + movingShift}% 20%, rgba(255,123,84,0.42), transparent 28%), radial-gradient(circle at ${70 - movingShift}% 30%, rgba(97,200,255,0.3), transparent 24%), linear-gradient(135deg, #020613, #122648 48%, #082411)`,
  };

  root.style.background = styles[preset] || styles.black;
  root.style.backgroundSize = preset === "transparent" ? "24px 24px, 24px 24px" : "cover";
  root.style.backgroundPosition = preset === "transparent" ? "0 0, 12px 12px" : "center";
}

function setStatus(message) {
  statusText.textContent = message;
}

function updateOutputs() {
  glowOutput.value = Number(glowSlider.value).toFixed(2);
  rgbOutput.value = Number(rgbSlider.value).toFixed(4);
  scanOutput.value = Number(scanSlider.value).toFixed(3);
  gritOutput.value = Number(gritSlider.value).toFixed(2);
  colorOutput.value = Number(colorSlider.value).toFixed(2);
}

function applyControlValues() {
  bloomPass.strength = parseFloat(glowSlider.value);
  crtPass.uniforms.rgbSplit.value = parseFloat(rgbSlider.value);
  crtPass.uniforms.scanStrength.value = parseFloat(scanSlider.value);
  crtPass.uniforms.blackDataMix.value = blackDataToggle.checked ? 1 : 0;
  crtPass.uniforms.blackDataGrit.value = parseFloat(gritSlider.value);
  crtPass.uniforms.blackDataColorMix.value = parseFloat(colorSlider.value);
}

function createFallbackTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const gradient = ctx.createLinearGradient(160, 220, 760, 800);
  gradient.addColorStop(0, "#61f5ff");
  gradient.addColorStop(0.5, "#ffffff");
  gradient.addColorStop(1, "#ff4fcf");

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);

  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.ellipse(0, 20, 280, 180, -0.24, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(0, -220);
  ctx.lineTo(24, -44);
  ctx.lineTo(180, -16);
  ctx.lineTo(34, 28);
  ctx.lineTo(0, 204);
  ctx.lineTo(-34, 28);
  ctx.lineTo(-180, -16);
  ctx.lineTo(-24, -44);
  ctx.closePath();
  ctx.fill();

  ctx.font = "700 150px Orbitron, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = gradient;
  ctx.fillText("CRT", 0, 10);

  ctx.font = "800 112px Orbitron, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("WRLD", 0, 150);

  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function disposeActiveTexture() {
  if (activeTexture) {
    activeTexture.dispose();
  }
  activeTexture = null;

  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
  }
  activeObjectUrl = null;
}

function applyTexture(texture, label = "Custom texture loaded", objectUrl = null) {
  disposeActiveTexture();
  activeTexture = texture;
  activeObjectUrl = objectUrl;
  activeTexture.colorSpace = THREE.SRGBColorSpace;
  activeTexture.minFilter = THREE.LinearFilter;
  activeTexture.magFilter = THREE.LinearFilter;
  activeTexture.generateMipmaps = false;

  planeMaterial.map = activeTexture;
  planeMaterial.needsUpdate = true;

  const image = activeTexture.image;
  const aspect = image && image.width && image.height ? image.width / image.height : 1;
  const height = 1.55;
  hologramPlane.scale.set(Math.min(2.1, Math.max(0.8, aspect)) * height, height, 1);

  fileNameText.textContent = label;
  setStatus("Hologram texture updated.");
  trackEvent("image_upload", {
    file_name: label,
  });
}

function fitImageDimensions(width, height) {
  const longest = Math.max(width, height);
  if (longest <= MAX_TEXTURE_SIZE) {
    return { width, height };
  }

  const scale = MAX_TEXTURE_SIZE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function downscaleImage(image) {
  const target = fitImageDimensions(image.width, image.height);
  if (target.width === image.width && target.height === image.height) {
    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    return texture;
  }

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(image, 0, 0, target.width, target.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function loadUserTexture(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("Unsupported file type. Use PNG, JPG, or WebP.");
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const texture = downscaleImage(img);
    applyTexture(texture, file.name, objectUrl);
  };
  img.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    setStatus("Failed to load image.");
  };
  img.src = objectUrl;
  setStatus("Loading image...");
}

async function exportLoop() {
  if (isRecording) {
    return;
  }

  const stream = renderer.domElement.captureStream(30);
  if (!stream) {
    setStatus("Canvas capture is unavailable in this browser.");
    return;
  }

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";

  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  });

  isRecording = true;
  exportButton.disabled = true;
  setStatus("Recording 7 second loop...");
  trackEvent("image_export_start", {
    background: activeBackground,
    black_data: blackDataToggle.checked,
  });

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  recorder.onerror = () => {
    isRecording = false;
    exportButton.disabled = false;
    setStatus("Recording failed.");
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "crt-image-loop.webm";
    anchor.click();
    URL.revokeObjectURL(url);

    stream.getTracks().forEach((track) => track.stop());
    isRecording = false;
    exportButton.disabled = false;
    setStatus("Export complete. Downloaded `crt-image-loop.webm`.");
    trackEvent("image_export_complete", {
      background: activeBackground,
      black_data: blackDataToggle.checked,
    });
  };

  recorder.start();
  window.setTimeout(() => {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }, LOOP_DURATION * 1000);
}

function onResize() {
  const width = Math.max(1, root.clientWidth);
  const height = Math.max(1, root.clientHeight);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height);
  composer.setSize(width, height);
  crtPass.uniforms.resolution.value.set(width, height);
  crtPass.uniforms.pixelStep.value.set(1 / width, 1 / height);
}

function onWheel(event) {
  event.preventDefault();
  cameraZoom = THREE.MathUtils.clamp(cameraZoom + event.deltaY * 0.0025, 2.6, 6.2);
}

function render() {
  const elapsed = clock.getElapsedTime();
  const loopTime = elapsed % LOOP_DURATION;
  const phase = (loopTime / LOOP_DURATION) * Math.PI * 2;

  crtPass.uniforms.time.value = loopTime;
  applyBackgroundPreset(activeBackground, elapsed);

  hologramPlane.rotation.y = 0.12 + Math.sin(loopTime * 0.4) * 0.2 + Math.sin(phase) * 0.03;
  hologramPlane.rotation.x = -0.08 + Math.cos(loopTime * 0.32) * 0.05;
  hologramPlane.position.y = Math.sin(loopTime * 0.6) * 0.1;
  hologramPlane.position.x = Math.sin(loopTime * 0.23) * 0.06;
  planeMaterial.opacity = 0.95 + Math.sin(loopTime * 30.0) * 0.03;

  camera.position.x = Math.sin(loopTime * 0.2) * 0.1;
  camera.position.y = Math.cos(loopTime * 0.17) * 0.04;
  camera.position.z = cameraZoom;
  camera.lookAt(0, 0, 0);

  composer.render();
  requestAnimationFrame(render);
}

glowSlider.addEventListener("input", () => {
  updateOutputs();
  applyControlValues();
});

rgbSlider.addEventListener("input", () => {
  updateOutputs();
  applyControlValues();
});

scanSlider.addEventListener("input", () => {
  updateOutputs();
  applyControlValues();
});

gritSlider.addEventListener("input", () => {
  updateOutputs();
  applyControlValues();
});

colorSlider.addEventListener("input", () => {
  updateOutputs();
  applyControlValues();
});

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  loadUserTexture(file);
});

exportButton.addEventListener("click", () => {
  exportLoop();
});

backgroundSelect.addEventListener("change", () => {
  applyBackgroundPreset(backgroundSelect.value, clock.getElapsedTime());
  trackEvent("image_background_change", {
    background: backgroundSelect.value,
  });
});

blackDataToggle.addEventListener("change", () => {
  applyControlValues();
  trackEvent("image_black_data_toggle", {
    enabled: blackDataToggle.checked,
  });
});

window.addEventListener("resize", onResize);
root.addEventListener("wheel", onWheel, { passive: false });

updateOutputs();
applyControlValues();
applyTexture(createFallbackTexture(), "Demo texture loaded");
applyBackgroundPreset(activeBackground, 0);
onResize();
render();
