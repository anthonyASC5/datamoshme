const BLEND_MODE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "darken", label: "Darken" },
  { value: "multiply", label: "Multiply" },
  { value: "lighten", label: "Lighten" },
  { value: "screen", label: "Screen" },
  { value: "dodge", label: "Color Dodge" },
  { value: "add", label: "Linear Dodge" },
  { value: "overlay", label: "Overlay" },
  { value: "softLight", label: "Soft Light" },
  { value: "hardLight", label: "Hard Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "subtract", label: "Subtract" },
];

// these blend modes map ui labels to the canvas composite pass.
function defaultLayerParams(type) {
  if (type === "crt") {
    return { glow: 0.4, rgb: 0.003, scan: 0.04, edgeGlow: 0.28 };
  }

  if (type === "datamosh") {
    return { speed: 2, keyframeEvery: 10, mirror: true };
  }

  if (type === "monitor") {
    return {};
  }

  if (type === "black") {
    return { grit: 1, color: 0, invertBlack: 0.5, hue: 0.62, reduceWhite: 0.18, reduceBlack: 0.16 };
  }

  if (type === "blu") {
    return { grit: 0, color: 1, invertBlack: 0.5, hue: 0.62, reduceWhite: 0.46, reduceBlack: 0.89 };
  }

  if (type === "infrared") {
    return { colorOffset: 0 };
  }

  if (type === "detect") {
    return { threshold: 0.18, decay: 0.52, trigger: 0.18 };
  }

  if (type === "cluster") {
    return {
      grit: 1.12,
      color: 0.26,
      invertBlack: 0.5,
      hue: 0.62,
      reduceWhite: 0.32,
      reduceBlack: 0.72,
      clusterSize: 0.18,
      clusterShape: 0.14,
      clusterQuantity: 0.66,
      showCoordinates: false,
      showLines: false,
      clusterMode: "square",
    };
  }

  if (type === "clusterOnly") {
    return {
      grit: 1.35,
      color: 0.12,
      invertBlack: 0.5,
      hue: 0.62,
      reduceWhite: 0.08,
      reduceBlack: 0.24,
      clusterSize: 0.22,
      clusterShape: 0.18,
      clusterQuantity: 0.86,
      showCoordinates: true,
      showLines: true,
      clusterMode: "square",
    };
  }

  if (type === "clusterTrack") {
    return {
      grit: 1.24,
      color: 0.2,
      invertBlack: 0.5,
      hue: 0.62,
      reduceWhite: 0.06,
      reduceBlack: 0.52,
      clusterSize: 0.08,
      clusterShape: 0.08,
      clusterQuantity: 1,
      showCoordinates: true,
      showLines: true,
      clusterMode: "square",
    };
  }

  if (type === "editor") {
    return {
      brightness: 0,
      contrast: 1,
      highlights: 0,
      shadows: 0,
      sharpness: 0,
      edgeGlow: 0,
      crtGlow: 0,
    };
  }

  return {};
}

function defaultBlendForType(type) {
  if (type === "crt" || type === "cluster" || type === "clusterOnly" || type === "clusterTrack" || type === "monitor" || type === "detect") {
    return "screen";
  }
  if (type === "datamosh") {
    return "normal";
  }
  if (type === "editor") {
    return "normal";
  }
  return "normal";
}

function layerLabelForType(type) {
  return (
    {
      video: "Base Video",
      datamosh: "Datamosh",
      crt: "CRT Pass",
      monitor: "CRT Monitor",
      black: "Black Data",
      blu: "BLU",
      infrared: "Infrared Camera",
      detect: "Detect",
      cluster: "Cluster Edge Tracker",
      clusterOnly: "Cluster Only",
      clusterTrack: "Full Cluster Track",
      editor: "Adjustments",
    }[type] || "Layer"
  );
}

function setControlsDisabled(container, disabled) {
  container.querySelectorAll("input, select").forEach((control) => {
    control.disabled = disabled;
  });
}

export function createLayerEditor({
  dom,
  createLayerRuntime,
  getCanvasSize,
  hasSource,
  requestRender,
  setStatus,
  setOutput,
  markControlTouched,
  trackLayerAdd,
  disposeLayerRuntime,
}) {
  let layers = [];
  let selectedLayerId = null;
  let nextLayerId = 1;

  function getLayerById(layerId) {
    return layers.find((layer) => layer.id === layerId) || null;
  }

  function getSelectedLayer() {
    return getLayerById(selectedLayerId);
  }

  function getEditorLayer() {
    return layers.find((layer) => layer.type === "editor") || null;
  }

  function getVisibleLayers() {
    return layers.filter((layer) => layer.type !== "editor");
  }

  // this keeps paused previews in sync after layer changes.
  function notifyRender() {
    requestRender?.();
  }

  function buildLayerName(type) {
    const baseName = layerLabelForType(type);
    const count = layers.filter((layer) => layer.type === type).length + 1;
    return `${baseName} ${count}`;
  }

  function createLayer(type) {
    const { width, height } = getCanvasSize();
    return {
      id: nextLayerId += 1,
      type,
      name: type === "video" ? "Base Video" : buildLayerName(type),
      visible: true,
      blend: defaultBlendForType(type),
      opacity: 1,
      controlsOpen: type !== "video" && type !== "editor",
      params: defaultLayerParams(type),
      runtime: createLayerRuntime(width, height),
    };
  }

  function createInlineSlider(label, key, value, min, max, step) {
    return `
      <div class="layer-inline-row">
        <label>${label}</label>
        <div class="layer-inline-control">
          <input data-inline-slider="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${Number(value).toFixed(2)}" />
          <output data-inline-output="${key}">${Number(value).toFixed(2)}</output>
        </div>
      </div>
    `;
  }

  function createInlineToggle(label, key, checked) {
    return `
      <div class="layer-inline-row">
        <label>${label}</label>
        <div class="layer-inline-control layer-inline-toggle">
          <input data-inline-toggle="${key}" class="toggle-check" type="checkbox" ${checked ? "checked" : ""} />
          <output data-inline-output="${key}">${checked ? "On" : "Off"}</output>
        </div>
      </div>
    `;
  }

  function buildInlineControls(layer) {
    if (layer.type === "crt") {
      return createInlineSlider("Edge Glow", "edgeGlow", layer.params.edgeGlow, 0, 1, 0.01);
    }

    if (layer.type === "datamosh") {
      let controls = "";
      controls += createInlineSlider("Speed", "speed", layer.params.speed, 1, 10, 1);
      controls += createInlineSlider("Clean Rate", "keyframeEvery", layer.params.keyframeEvery, 1, 24, 1);
      controls += createInlineToggle("Mirror", "mirror", Boolean(layer.params.mirror));
      return controls;
    }

    if (layer.type === "infrared") {
      return createInlineSlider("Color Offset", "colorOffset", layer.params.colorOffset, 0, 1, 0.01);
    }

    if (layer.type === "detect") {
      let controls = "";
      controls += createInlineSlider("Threshold", "threshold", layer.params.threshold, 0.02, 0.5, 0.01);
      controls += createInlineSlider("Decay", "decay", layer.params.decay, 0, 1, 0.01);
      controls += createInlineSlider("Trigger", "trigger", layer.params.trigger, 0, 1, 0.01);
      return controls;
    }

    if (!["black", "blu", "cluster", "clusterOnly", "clusterTrack"].includes(layer.type)) {
      return "";
    }

    let controls = "";
    controls += createInlineSlider("Grit", "grit", layer.params.grit, 0, 1.5, 0.01);
    if (layer.type === "black") {
      controls += createInlineSlider("Black To White", "invertBlack", layer.params.invertBlack, 0, 1, 0.01);
    }
    controls += createInlineSlider("Reduce White", "reduceWhite", layer.params.reduceWhite, 0, 1, 0.01);
    controls += createInlineSlider("Reduce Black", "reduceBlack", layer.params.reduceBlack, 0, 1, 0.01);

    if (["cluster", "clusterOnly", "clusterTrack"].includes(layer.type)) {
      controls += createInlineSlider("Cluster Size", "clusterSize", layer.params.clusterSize, 0, 1, 0.01);
      controls += createInlineSlider("Shape Boost", "clusterShape", layer.params.clusterShape, 0, 1, 0.01);
      controls += createInlineSlider("Blob Quantity", "clusterQuantity", layer.params.clusterQuantity, 0, 1, 0.01);
      controls += createInlineToggle("Coordinates", "showCoordinates", Boolean(layer.params.showCoordinates));
      controls += createInlineToggle("Connecting Lines", "showLines", Boolean(layer.params.showLines));
    }

    return controls;
  }

  // this rebuilds the layer cards whenever the stack changes.
  function renderLayerList() {
    dom.layersList.innerHTML = "";
    const visibleLayers = getVisibleLayers();
    dom.layersEmpty.hidden = visibleLayers.length > 0;

    [...visibleLayers].reverse().forEach((layer) => {
      const actualIndex = layers.findIndex((entry) => entry.id === layer.id);
      const row = document.createElement("div");
      row.className = `layer-row-card${layer.id === selectedLayerId ? " selected" : ""}`;
      row.dataset.layerId = String(layer.id);
      row.dataset.layerType = layer.type;
      row.innerHTML = `
        <div class="layer-topline">
          <div>
            <div class="layer-name">${layer.name}</div>
            <div class="layer-type">${layer.type}</div>
          </div>
          <div class="layer-actions">
            <button class="mini-button" data-action="toggle-controls" type="button">${layer.controlsOpen ? "▾" : "▸"}</button>
            <button class="mini-button ${layer.visible ? "active" : ""}" data-action="toggle-visibility" type="button">${layer.visible ? "Eye" : "Off"}</button>
            <button class="mini-button" data-action="move-up" type="button">↑</button>
            <button class="mini-button" data-action="move-down" type="button">↓</button>
            <button class="mini-button" data-action="duplicate" type="button">Dup</button>
            <button class="mini-button" data-action="delete" type="button">Del</button>
          </div>
        </div>
        <div class="layer-grid">
          <div class="layer-field">
            <label>Blend</label>
            <select data-action="blend">
              ${BLEND_MODE_OPTIONS.map((option) => `<option value="${option.value}" ${option.value === layer.blend ? "selected" : ""}>${option.label}</option>`).join("")}
            </select>
          </div>
          <div class="layer-field">
            <label>Opacity</label>
            <div class="layer-opacity">
              <input data-action="opacity" type="range" min="0" max="1" step="0.01" value="${layer.opacity.toFixed(2)}" />
              <output>${Math.round(layer.opacity * 100)}%</output>
            </div>
          </div>
        </div>
        ${layer.controlsOpen && buildInlineControls(layer) ? `<div class="layer-inline-panel">${buildInlineControls(layer)}</div>` : ""}
      `;

      row.addEventListener("click", () => {
        selectedLayerId = layer.id;
        renderLayerList();
        syncControlsFromSelection();
      });

      const blendSelect = row.querySelector('select[data-action="blend"]');
      const opacityInput = row.querySelector('input[data-action="opacity"]');
      const opacityOutput = row.querySelector("output");

      blendSelect.addEventListener("click", (event) => event.stopPropagation());
      blendSelect.addEventListener("change", (event) => {
        layer.blend = event.target.value;
        notifyRender();
      });

      opacityInput.addEventListener("click", (event) => event.stopPropagation());
      opacityInput.addEventListener("input", (event) => {
        layer.opacity = Number(event.target.value);
        opacityInput.classList.add("touched");
        opacityOutput.value = `${Math.round(layer.opacity * 100)}%`;
        notifyRender();
      });

      row.querySelectorAll("[data-action]").forEach((button) => {
        if (button === blendSelect || button === opacityInput) {
          return;
        }

        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const { action } = button.dataset;
          if (action === "toggle-visibility") {
            layer.visible = !layer.visible;
            renderLayerList();
            notifyRender();
            return;
          }
          if (action === "toggle-controls") {
            layer.controlsOpen = !layer.controlsOpen;
            renderLayerList();
            return;
          }
          if (action === "move-up") {
            moveLayer(layer.id, 1);
            return;
          }
          if (action === "move-down") {
            moveLayer(layer.id, -1);
            return;
          }
          if (action === "duplicate") {
            duplicateLayer(layer.id);
            return;
          }
          if (action === "delete") {
            deleteLayer(layer.id);
          }
        });
      });

      const isProtected = layer.type === "video" || layer.type === "editor";
      row.querySelector('[data-action="duplicate"]').disabled = isProtected;
      row.querySelector('[data-action="delete"]').disabled = isProtected;
      row.querySelector('[data-action="move-up"]').disabled = actualIndex === layers.length - 1;
      row.querySelector('[data-action="move-down"]').disabled = actualIndex === 0 || layer.type === "video";
      row.querySelector('[data-action="toggle-controls"]').disabled = layer.type === "video" || layer.type === "editor";

      row.querySelectorAll("[data-inline-slider]").forEach((slider) => {
        slider.addEventListener("click", (event) => event.stopPropagation());
        slider.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          markControlTouched(slider);
        });
        slider.addEventListener("input", (event) => {
          event.stopPropagation();
          const key = slider.dataset.inlineSlider;
          const value = Number(slider.value);
          layer.params[key] = value;
          markControlTouched(slider);
          const output = row.querySelector(`[data-inline-output="${key}"]`);
          setOutput(output, value);
          notifyRender();
        });
      });

      row.querySelectorAll("[data-inline-toggle]").forEach((toggle) => {
        toggle.addEventListener("click", (event) => event.stopPropagation());
        toggle.addEventListener("change", (event) => {
          event.stopPropagation();
          const key = toggle.dataset.inlineToggle;
          layer.params[key] = toggle.checked;
          markControlTouched(toggle);
          const output = row.querySelector(`[data-inline-output="${key}"]`);
          setOutput(output, toggle.checked ? "On" : "Off");
          notifyRender();
        });
      });

      dom.layersList.append(row);
    });
  }

  // this mirrors the selected layer state back into the adjustments panel.
  function syncControlsFromSelection() {
    const layer = getSelectedLayer();
    const editorLayer = getEditorLayer();
    const isEffectLayer = Boolean(layer && layer.type !== "video" && layer.type !== "editor");
    dom.editorPanel.hidden = false;
    dom.layerSelectionLabel.textContent = isEffectLayer ? layer.name : "Effects";
    dom.editorSelectionLabel.textContent = editorLayer ? editorLayer.name : "Adjustments";
    dom.editorControls.hidden = !editorLayer;

    if (editorLayer) {
      dom.brightnessSlider.value = String(editorLayer.params.brightness);
      dom.contrastSlider.value = String(editorLayer.params.contrast);
      dom.highlightsSlider.value = String(editorLayer.params.highlights);
      dom.shadowsSlider.value = String(editorLayer.params.shadows);
      dom.sharpnessSlider.value = String(editorLayer.params.sharpness);
      dom.editorEdgeGlowSlider.value = String(editorLayer.params.edgeGlow);
      dom.crtGlowSlider.value = String(editorLayer.params.crtGlow);
      setOutput(dom.brightnessOutput, editorLayer.params.brightness);
      setOutput(dom.contrastOutput, editorLayer.params.contrast);
      setOutput(dom.highlightsOutput, editorLayer.params.highlights);
      setOutput(dom.shadowsOutput, editorLayer.params.shadows);
      setOutput(dom.sharpnessOutput, editorLayer.params.sharpness);
      setOutput(dom.editorEdgeGlowOutput, editorLayer.params.edgeGlow);
      setOutput(dom.crtGlowOutput, editorLayer.params.crtGlow);
    }

    if (!layer || layer.type === "video") {
      setControlsDisabled(dom.editorControls, !editorLayer);
      return;
    }
    setControlsDisabled(dom.editorControls, !editorLayer);
  }

  // the base video layer is created lazily after a source loads.
  function ensureBaseLayer() {
    const baseLayer = layers.find((layer) => layer.type === "video");
    if (baseLayer) {
      return baseLayer;
    }

    const layer = {
      id: nextLayerId += 1,
      type: "video",
      name: "Base Video",
      visible: true,
      blend: "normal",
      opacity: 1,
      params: {},
      runtime: createLayerRuntime(getCanvasSize().width, getCanvasSize().height),
    };
    layers = [layer];
    selectedLayerId = layer.id;
    return layer;
  }

  // the adjustments layer stays at the top of the stack.
  function ensureEditorLayer() {
    const existing = getEditorLayer();
    if (existing) {
      return existing;
    }

    const layer = createLayer("editor");
    layer.name = "Adjustments";
    layers.push(layer);
    return layer;
  }

  function addLayer(type) {
    if (!hasSource() && type !== "video") {
      setStatus("Upload a video first so the base layer exists.");
      return;
    }

    ensureBaseLayer();
    const editorLayer = ensureEditorLayer();
    const layer = createLayer(type);
    const editorIndex = layers.findIndex((entry) => entry.id === editorLayer.id);
    layers.splice(editorIndex, 0, layer);
    selectedLayerId = layer.id;
    renderLayerList();
    syncControlsFromSelection();
    notifyRender();
    setStatus(`${layerLabelForType(type)} layer added.`);
    trackLayerAdd(type);
  }

  // duplicate and delete keep the stack order stable for the compositor.
  function duplicateLayer(layerId) {
    const original = getLayerById(layerId);
    if (!original || original.type === "video" || original.type === "editor") {
      return;
    }

    const { width, height } = getCanvasSize();
    const duplicate = {
      ...original,
      id: nextLayerId += 1,
      name: `${original.name} Copy`,
      params: { ...original.params },
      runtime: createLayerRuntime(width, height),
    };
    const index = layers.findIndex((layer) => layer.id === layerId);
    layers.splice(index + 1, 0, duplicate);
    selectedLayerId = duplicate.id;
    renderLayerList();
    syncControlsFromSelection();
    notifyRender();
  }

  function deleteLayer(layerId) {
    const layer = getLayerById(layerId);
    if (!layer || layer.type === "video" || layer.type === "editor") {
      return;
    }

    disposeLayerRuntime?.(layer);
    layers = layers.filter((entry) => entry.id !== layerId);
    if (selectedLayerId === layerId) {
      selectedLayerId = layers[layers.length - 1]?.id ?? null;
    }
    renderLayerList();
    syncControlsFromSelection();
    notifyRender();
  }

  function moveLayer(layerId, direction) {
    const index = layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) {
      return;
    }

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= layers.length) {
      return;
    }

    const moving = layers[index];
    if (moving.type === "video") {
      return;
    }
    if (moving.type === "editor") {
      return;
    }
    if (layers[targetIndex].type === "video" && direction > 0) {
      return;
    }
    if (layers[targetIndex].type === "editor") {
      return;
    }

    layers.splice(index, 1);
    layers.splice(targetIndex, 0, moving);
    renderLayerList();
    notifyRender();
  }

  function resizeRuntimes(width, height) {
    layers.forEach((layer) => {
      if (!layer.runtime) {
        layer.runtime = createLayerRuntime(width, height);
        return;
      }
      layer.runtime.canvas.width = width;
      layer.runtime.canvas.height = height;
      layer.runtime.ghostCanvas.width = width;
      layer.runtime.ghostCanvas.height = height;
      layer.runtime.auxCanvas.width = width;
      layer.runtime.auxCanvas.height = height;
      layer.runtime.presetGhostData = null;
    });
  }

  function reset() {
    layers.forEach((layer) => disposeLayerRuntime?.(layer));
    layers = [];
    selectedLayerId = null;
  }

  function resetEffects() {
    const baseLayer = layers.find((layer) => layer.type === "video") || null;
    const editorLayer = getEditorLayer();
    layers.forEach((layer) => {
      if (layer !== baseLayer && layer !== editorLayer) {
        disposeLayerRuntime?.(layer);
      }
    });
    if (editorLayer) {
      editorLayer.params = defaultLayerParams("editor");
      editorLayer.visible = true;
      editorLayer.opacity = 1;
      editorLayer.blend = defaultBlendForType("editor");
      editorLayer.name = "Adjustments";
    }
    layers = [baseLayer, editorLayer].filter(Boolean);
    selectedLayerId = baseLayer?.id ?? null;
    renderLayerList();
    syncControlsFromSelection();
    notifyRender();
  }

  return {
    addLayer,
    ensureBaseLayer,
    ensureEditorLayer,
    getEditorLayer,
    getLayers: () => layers,
    getSelectedLayer,
    renderLayerList,
    reset,
    resetEffects,
    resizeRuntimes,
    syncControlsFromSelection,
  };
}
