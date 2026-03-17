import { renderMotionVideoEffectLayer, layerNeedsMotionSourceImageData, motionVideoEffectDefinitions } from "./motionvideofx.js";
import { createVideoWorkspace } from "./video-workspace-base.js";

createVideoWorkspace({
  title: "MOTION VIDEO",
  recordingFilename: "motionvideo-recording.webm",
  effectDefinitions: motionVideoEffectDefinitions,
  renderEffectLayer: renderMotionVideoEffectLayer,
  layerNeedsSourceImageData: layerNeedsMotionSourceImageData,
});
