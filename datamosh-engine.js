const DEFAULT_FREEZE_SECONDS = 0.5;
const DEFAULT_CORRUPTION_SECONDS = 1.0;
const CLUSTER_MAX_MS = 30000;

function cloneConfig(config) {
  return {
    codec: config.codec,
    codedWidth: config.codedWidth,
    codedHeight: config.codedHeight,
    description: config.description ? config.description.slice() : undefined,
  };
}

function almostEqualBytes(a, b) {
  if (!a || !b || a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

function fitRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  const x = Math.floor((targetWidth - width) / 2);
  const y = Math.floor((targetHeight - height) / 2);
  return { x, y, width, height };
}

function createFrameQueue() {
  const frames = [];
  const waiters = [];
  let failed = null;

  return {
    push(frame) {
      if (waiters.length) {
        waiters.shift().resolve(frame);
        return;
      }
      frames.push(frame);
    },
    fail(error) {
      failed = error;
      while (waiters.length) {
        waiters.shift().reject(error);
      }
    },
    async next() {
      if (frames.length) {
        return frames.shift();
      }
      if (failed) {
        throw failed;
      }
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
  };
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

function toUint8(value) {
  return Uint8Array.from([value]);
}

function encodeUnsigned(value) {
  if (value === 0) {
    return Uint8Array.from([0]);
  }

  const bytes = [];
  let remaining = value;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Uint8Array.from(bytes);
}

function encodeAscii(value) {
  return new TextEncoder().encode(value);
}

function encodeVintSize(value) {
  for (let width = 1; width <= 8; width += 1) {
    const max = 2 ** (7 * width) - 2;
    if (value <= max) {
      const bytes = new Uint8Array(width);
      let remaining = value;
      for (let index = width - 1; index >= 0; index -= 1) {
        bytes[index] = remaining & 0xff;
        remaining = Math.floor(remaining / 256);
      }
      bytes[0] |= 1 << (8 - width);
      return bytes;
    }
  }

  throw new Error("EBML size too large.");
}

function encodeUnknownSize(width = 8) {
  return new Uint8Array(width).fill(0xff);
}

function encodeEbmlId(id) {
  const bytes = [];
  let remaining = id;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Uint8Array.from(bytes);
}

function ebmlElement(id, data) {
  const payload = data instanceof Uint8Array ? data : Uint8Array.from(data);
  return concatBytes([encodeEbmlId(id), encodeVintSize(payload.length), payload]);
}

function masterElement(id, children) {
  return ebmlElement(id, concatBytes(children));
}

class WebMMuxer {
  constructor({ codecId, width, height, frameDurationUs }) {
    this.codecId = codecId;
    this.width = width;
    this.height = height;
    this.frameDurationNs = Math.round(frameDurationUs * 1000);
    this.parts = [];
    this.clusterTimecodeMs = null;
    this.pendingCluster = [];
    this.writeHeader();
  }

  writeHeader() {
    const ebmlHeader = masterElement(0x1a45dfa3, [
      ebmlElement(0x4286, toUint8(1)),
      ebmlElement(0x42f7, toUint8(1)),
      ebmlElement(0x42f2, toUint8(4)),
      ebmlElement(0x42f3, toUint8(8)),
      ebmlElement(0x4282, encodeAscii("webm")),
      ebmlElement(0x4287, toUint8(2)),
      ebmlElement(0x4285, toUint8(2)),
    ]);

    const info = masterElement(0x1549a966, [
      ebmlElement(0x2ad7b1, encodeUnsigned(1000000)),
      ebmlElement(0x4d80, encodeAscii("CRTWRLD Datamosh V4")),
      ebmlElement(0x5741, encodeAscii("CRTWRLD Datamosh V4")),
    ]);

    const trackEntry = masterElement(0xae, [
      ebmlElement(0xd7, toUint8(1)),
      ebmlElement(0x73c5, toUint8(1)),
      ebmlElement(0x83, toUint8(1)),
      ebmlElement(0x86, encodeAscii(this.codecId)),
      ebmlElement(0x23e383, encodeUnsigned(this.frameDurationNs)),
      masterElement(0xe0, [
        ebmlElement(0xb0, encodeUnsigned(this.width)),
        ebmlElement(0xba, encodeUnsigned(this.height)),
      ]),
    ]);

    const tracks = masterElement(0x1654ae6b, [trackEntry]);
    const segmentHeader = concatBytes([encodeEbmlId(0x18538067), encodeUnknownSize()]);

    this.parts.push(ebmlHeader, segmentHeader, info, tracks);
  }

  flushCluster() {
    if (!this.pendingCluster.length || this.clusterTimecodeMs === null) {
      return;
    }

    const cluster = concatBytes([
      encodeEbmlId(0x1f43b675),
      encodeUnknownSize(),
      ebmlElement(0xe7, encodeUnsigned(this.clusterTimecodeMs)),
      ...this.pendingCluster,
    ]);

    this.parts.push(cluster);
    this.pendingCluster = [];
    this.clusterTimecodeMs = null;
  }

  addChunk(chunk, isKeyframe) {
    const timestampMs = Math.floor(chunk.timestamp / 1000);

    if (
      this.clusterTimecodeMs === null ||
      timestampMs - this.clusterTimecodeMs > CLUSTER_MAX_MS ||
      timestampMs - this.clusterTimecodeMs > 32767
    ) {
      this.flushCluster();
      this.clusterTimecodeMs = timestampMs;
    }

    const relativeTimecode = timestampMs - this.clusterTimecodeMs;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);

    const block = new Uint8Array(4 + data.length);
    block[0] = 0x81;
    block[1] = (relativeTimecode >> 8) & 0xff;
    block[2] = relativeTimecode & 0xff;
    block[3] = isKeyframe ? 0x80 : 0x00;
    block.set(data, 4);

    this.pendingCluster.push(ebmlElement(0xa3, block));
  }

  finalize() {
    this.flushCluster();
    return new Blob(this.parts, { type: "video/webm" });
  }
}

async function chooseEncoderConfig(width, height, fps) {
  const candidates = [
    {
      codec: "vp09.00.10.08",
      codecId: "V_VP9",
      width,
      height,
      bitrate: 8_000_000,
      framerate: Math.max(12, Math.round(fps)),
      latencyMode: "quality",
    },
    {
      codec: "vp8",
      codecId: "V_VP8",
      width,
      height,
      bitrate: 8_000_000,
      framerate: Math.max(12, Math.round(fps)),
      latencyMode: "quality",
    },
  ];

  for (const candidate of candidates) {
    // `isConfigSupported` is the only reliable way to avoid failing the encode path at runtime.
    const support = await VideoEncoder.isConfigSupported(candidate);
    if (support.supported) {
      return {
        config: support.config,
        codecId: candidate.codecId,
      };
    }
  }

  throw new Error("No supported WebCodecs encoder found for VP9/VP8 WebM output.");
}

function yieldToMainThread() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export class DatamoshEngine {
  constructor(options = {}) {
    this.freezeSeconds = options.freezeSeconds ?? DEFAULT_FREEZE_SECONDS;
    this.corruptionSeconds = options.corruptionSeconds ?? DEFAULT_CORRUPTION_SECONDS;
  }

  validateCompatibility(trackA, trackB) {
    const sameCodec = trackA.decoderConfig.codec === trackB.decoderConfig.codec;
    const sameSize =
      trackA.decoderConfig.codedWidth === trackB.decoderConfig.codedWidth &&
      trackA.decoderConfig.codedHeight === trackB.decoderConfig.codedHeight;
    const sameDescription = almostEqualBytes(trackA.decoderConfig.description, trackB.decoderConfig.description);

    return {
      sameCodec,
      sameSize,
      sameDescription,
      supported: sameCodec,
    };
  }

  buildTransition(aSamples, bSamples, transitionSeconds) {
    const transitionTimestamp = Math.max(0, Math.round(transitionSeconds * 1_000_000));
    let transitionIndex = aSamples.findIndex((sample) => sample.timestamp >= transitionTimestamp);

    if (transitionIndex === -1) {
      transitionIndex = Math.max(0, aSamples.length - 1);
    }

    const aHead = aSamples.slice(0, transitionIndex + 1);
    const freezeSource = aHead[aHead.length - 1];
    const targetCorruptionUs = Math.round(this.corruptionSeconds * 1_000_000);

    const corruption = [];
    let corruptionElapsedUs = 0;
    let resetIndex = -1;

    for (let index = 0; index < bSamples.length; index += 1) {
      const chunk = bSamples[index];

      if (corruptionElapsedUs < targetCorruptionUs) {
        if (chunk.type === "delta") {
          corruption.push(chunk);
          corruptionElapsedUs += chunk.duration;
        }
        continue;
      }

      if (chunk.type === "key") {
        resetIndex = index;
        break;
      }

      corruption.push(chunk);
      corruptionElapsedUs += chunk.duration;
    }

    return {
      transitionIndex,
      aHead,
      freezeSource,
      corruption,
      cleanB: resetIndex >= 0 ? bSamples.slice(resetIndex) : [],
    };
  }

  createDecoder(config) {
    const frameQueue = createFrameQueue();
    const decoder = new VideoDecoder({
      output: (frame) => frameQueue.push(frame),
      error: (error) => frameQueue.fail(error),
    });

    decoder.configure(cloneConfig(config));

    return {
      decoder,
      async decode(sample) {
        decoder.decode(
          new EncodedVideoChunk({
            type: sample.type,
            timestamp: sample.timestamp,
            duration: sample.duration,
            data: sample.data,
          }),
        );
        return frameQueue.next();
      },
      async flush() {
        await decoder.flush();
      },
      close() {
        decoder.close();
      },
    };
  }

  resizeCanvas(canvas, width, height) {
    const safeWidth = Math.max(320, width || 1280);
    const safeHeight = Math.max(180, height || 720);
    canvas.width = safeWidth;
    canvas.height = safeHeight;
  }

  drawFrame(ctx, frame, width, height) {
    const rect = fitRect(frame.displayWidth || frame.codedWidth, frame.displayHeight || frame.codedHeight, width, height);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(frame, rect.x, rect.y, rect.width, rect.height);
  }

  async createOfflineEncoder({ width, height, fps, frameDurationUs }) {
    const { config, codecId } = await chooseEncoderConfig(width, height, fps);
    const muxer = new WebMMuxer({
      codecId,
      width,
      height,
      frameDurationUs,
    });

    const pending = [];
    let encoderFailure = null;
    const encoder = new VideoEncoder({
      output: (chunk) => {
        const copy = new EncodedVideoChunk({
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration,
          data: (() => {
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            return bytes;
          })(),
        });
        pending.push(copy);
      },
      error: (error) => {
        encoderFailure = error;
      },
    });

    encoder.configure(config);

    return {
      async encodeCanvasFrame(canvas, timestampUs, durationUs, keyFrame) {
        if (encoderFailure) {
          throw encoderFailure;
        }
        const frame = new VideoFrame(canvas, {
          timestamp: timestampUs,
          duration: durationUs,
        });
        try {
          encoder.encode(frame, { keyFrame });
        } finally {
          frame.close();
        }
      },
      async flush() {
        await encoder.flush();
        if (encoderFailure) {
          throw encoderFailure;
        }
        while (pending.length) {
          const chunk = pending.shift();
          muxer.addChunk(chunk, chunk.type === "key");
        }
      },
      close() {
        encoder.close();
      },
      finalize() {
        return muxer.finalize();
      },
    };
  }

  async render(options) {
    const {
      trackA,
      trackB,
      transitionSeconds,
      canvas,
      onStatus = () => {},
      onTimeline = () => {},
      onLog = () => {},
    } = options;

    if (!window.VideoDecoder || !window.VideoEncoder) {
      throw new Error("This browser does not support the required WebCodecs VideoDecoder/VideoEncoder APIs.");
    }

    const compatibility = this.validateCompatibility(trackA, trackB);
    if (!compatibility.supported) {
      throw new Error(`Clip codecs do not match. A is ${trackA.decoderConfig.codec}, B is ${trackB.decoderConfig.codec}.`);
    }

    const maxWidth = Math.max(trackA.decoderConfig.codedWidth, trackB.decoderConfig.codedWidth);
    const maxHeight = Math.max(trackA.decoderConfig.codedHeight, trackB.decoderConfig.codedHeight);
    const fps = Math.max(trackA.fps || 30, trackB.fps || 30, 12);
    const defaultFrameDurationUs = Math.max(1, Math.round(1_000_000 / fps));
    const ctx = canvas.getContext("2d", { alpha: false });
    const freezeCanvas = document.createElement("canvas");
    const freezeCtx = freezeCanvas.getContext("2d", { alpha: false });
    const plan = this.buildTransition(trackA.samples, trackB.samples, transitionSeconds);

    this.resizeCanvas(canvas, maxWidth, maxHeight);
    this.resizeCanvas(freezeCanvas, maxWidth, maxHeight);

    onLog(`Compatibility: codec=${compatibility.sameCodec}, size=${compatibility.sameSize}, avcC=${compatibility.sameDescription}`);
    onLog(`Frames: A=${trackA.samples.length}, B=${trackB.samples.length}, corruption=${plan.corruption.length}, reset=${plan.cleanB.length}`);

    const decoder = this.createDecoder(trackA.decoderConfig);
    const encoder = await this.createOfflineEncoder({
      width: canvas.width,
      height: canvas.height,
      fps,
      frameDurationUs: defaultFrameDurationUs,
    });

    let timelineUs = 0;
    let encodedFrameCount = 0;

    const encodeCurrentCanvas = async (durationUs, forceKeyframe = false) => {
      await encoder.encodeCanvasFrame(canvas, timelineUs, durationUs, forceKeyframe || encodedFrameCount === 0 || encodedFrameCount % 90 === 0);
      timelineUs += durationUs;
      encodedFrameCount += 1;

      if (encodedFrameCount % 24 === 0) {
        await encoder.flush();
        await yieldToMainThread();
      }
    };

    const holdCurrentCanvas = async (holdDurationUs) => {
      let remainingUs = holdDurationUs;
      while (remainingUs > 0) {
        const sliceUs = Math.min(defaultFrameDurationUs, remainingUs);
        await encodeCurrentCanvas(sliceUs);
        remainingUs -= sliceUs;
      }
    };

    try {
      onStatus("Rendering A.");
      onTimeline("Playing clip A");

      for (let index = 0; index < plan.aHead.length; index += 1) {
        const sample = plan.aHead[index];
        const frame = await decoder.decode(sample);
        this.drawFrame(ctx, frame, canvas.width, canvas.height);
        freezeCtx.drawImage(canvas, 0, 0, freezeCanvas.width, freezeCanvas.height);
        await encodeCurrentCanvas(sample.duration, index === 0);
        frame.close();
      }

      onStatus("Holding A freeze.");
      onTimeline("Freeze last frame of A for 0.5s");
      await holdCurrentCanvas(Math.round(this.freezeSeconds * 1_000_000));

      onStatus("Injecting B deltas.");
      onTimeline("Delta-only corruption from clip B");

      for (let index = 0; index < plan.corruption.length; index += 1) {
        const sample = plan.corruption[index];
        const frame = await decoder.decode(sample);
        const progress = plan.corruption.length > 1 ? index / (plan.corruption.length - 1) : 1;
        const overlayAlpha = Math.max(0, 0.72 - progress * 0.72);

        this.drawFrame(ctx, frame, canvas.width, canvas.height);
        if (overlayAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = overlayAlpha;
          ctx.drawImage(freezeCanvas, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        }

        await encodeCurrentCanvas(sample.duration);
        frame.close();
      }

      if (plan.cleanB.length) {
        onStatus("Resetting to clean B.");
        onTimeline("Allow next B keyframe and continue clean");

        for (const sample of plan.cleanB) {
          const frame = await decoder.decode(sample);
          this.drawFrame(ctx, frame, canvas.width, canvas.height);
          await encodeCurrentCanvas(sample.duration);
          frame.close();
        }
      }

      await decoder.flush();
      decoder.close();
      await encoder.flush();
      encoder.close();

      return {
        blob: encoder.finalize(),
        plan,
        compatibility,
        outputDuration: timelineUs / 1_000_000,
      };
    } catch (error) {
      try {
        decoder.close();
      } catch {
        // No-op.
      }
      try {
        encoder.close();
      } catch {
        // No-op.
      }
      throw error;
    }
  }
}
