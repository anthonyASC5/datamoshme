# Datamosh V5 Spec

## Goal
Create a new Datamosh V5 renderer that starts from scratch and does not reuse prior datamosh render logic.

## Input
- Clip A
- Clip B
- One slider: transition start time on Clip A

## Timeline
1. Clip A plays as normal video until the selected transition start.
2. The last frame of Clip A freezes for 0.5 seconds.
3. Clip B enters in a heavy datamoshed state while the frozen color information from Clip A initially carries over.
4. The retained color influence from Clip A decays as Clip B becomes more visible.
5. Clip B resolves back to regular video.

## Rendering Approach
- Use Three.js as the display pipeline.
- Use a `THREE.DataTexture` as the frame source uploaded to the GPU each render step.
- Use raw RGBA frame buffers sampled from hidden HTML video elements.
- No bloom, CRT, vignette, or other stylization passes.
- The visible effect must come only from frame corruption logic and recovery to clean video.

## Corruption Model
- During the datamosh phase, blocks pull pixels from prior output state and displaced Clip B pixels.
- Motion between the current and previous Clip B frame increases block drift.
- Frozen Clip A colors remain mixed into the corrupted output at the start of the datamosh phase.
- That color carry decays over time until clean Clip B is shown.

## Export
- Render the generated frames to the visible Three.js canvas.
- Record the canvas output to WebM with `MediaRecorder`.
- Convert the WebM result to MP4 with `ffmpeg.wasm`.
- Preview and download the resulting MP4.

## Constraints
- Start new logic.
- UI can follow the existing datamosh page structure.
- Only one transition slider.
- No extra effects beyond datamoshing and recovery.
