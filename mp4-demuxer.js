const CONTAINER_BOXES = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "edts",
  "dinf",
  "mvex",
  "moof",
  "traf",
  "udta",
  "meta",
]);

function readType(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readUint64(view, offset) {
  const high = view.getUint32(offset);
  const low = view.getUint32(offset + 4);
  return high * 2 ** 32 + low;
}

function parseBoxes(view, start, end) {
  const boxes = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = readType(view, offset + 4);
    let headerSize = 8;

    if (size === 1) {
      size = readUint64(view, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (!Number.isFinite(size) || size < headerSize || offset + size > end) {
      break;
    }

    const box = {
      type,
      start: offset,
      size,
      headerSize,
      dataStart: offset + headerSize,
      end: offset + size,
      children: [],
    };

    if (CONTAINER_BOXES.has(type)) {
      let childStart = box.dataStart;
      if (type === "meta") {
        childStart += 4;
      }
      box.children = parseBoxes(view, childStart, box.end);
    }

    boxes.push(box);
    offset += size;
  }

  return boxes;
}

function findChild(box, type) {
  return box.children.find((child) => child.type === type) || null;
}

function findChildren(box, type) {
  return box.children.filter((child) => child.type === type);
}

function parseHandlerType(view, box) {
  return readType(view, box.dataStart + 8);
}

function parseMdhdTimescale(view, box) {
  const version = view.getUint8(box.dataStart);
  return version === 1 ? view.getUint32(box.dataStart + 20) : view.getUint32(box.dataStart + 12);
}

function parseStts(view, box) {
  const entryCount = view.getUint32(box.dataStart + 4);
  const durations = [];
  let offset = box.dataStart + 8;

  for (let i = 0; i < entryCount; i += 1) {
    const sampleCount = view.getUint32(offset);
    const sampleDelta = view.getUint32(offset + 4);
    offset += 8;
    for (let j = 0; j < sampleCount; j += 1) {
      durations.push(sampleDelta);
    }
  }

  return durations;
}

function parseCtts(view, box) {
  if (!box) {
    return [];
  }

  const version = view.getUint8(box.dataStart);
  const entryCount = view.getUint32(box.dataStart + 4);
  const offsets = [];
  let offset = box.dataStart + 8;

  for (let i = 0; i < entryCount; i += 1) {
    const sampleCount = view.getUint32(offset);
    const sampleOffset = version === 1 ? view.getInt32(offset + 4) : view.getUint32(offset + 4);
    offset += 8;
    for (let j = 0; j < sampleCount; j += 1) {
      offsets.push(sampleOffset);
    }
  }

  return offsets;
}

function parseStsz(view, box) {
  const defaultSize = view.getUint32(box.dataStart + 4);
  const sampleCount = view.getUint32(box.dataStart + 8);
  const sizes = [];
  let offset = box.dataStart + 12;

  if (defaultSize !== 0) {
    for (let i = 0; i < sampleCount; i += 1) {
      sizes.push(defaultSize);
    }
    return sizes;
  }

  for (let i = 0; i < sampleCount; i += 1) {
    sizes.push(view.getUint32(offset));
    offset += 4;
  }

  return sizes;
}

function parseStsc(view, box) {
  const entryCount = view.getUint32(box.dataStart + 4);
  const entries = [];
  let offset = box.dataStart + 8;

  for (let i = 0; i < entryCount; i += 1) {
    entries.push({
      firstChunk: view.getUint32(offset),
      samplesPerChunk: view.getUint32(offset + 4),
      sampleDescriptionIndex: view.getUint32(offset + 8),
    });
    offset += 12;
  }

  return entries;
}

function parseChunkOffsets(view, box) {
  const entryCount = view.getUint32(box.dataStart + 4);
  const offsets = [];
  let offset = box.dataStart + 8;

  if (box.type === "co64") {
    for (let i = 0; i < entryCount; i += 1) {
      offsets.push(readUint64(view, offset));
      offset += 8;
    }
    return offsets;
  }

  for (let i = 0; i < entryCount; i += 1) {
    offsets.push(view.getUint32(offset));
    offset += 4;
  }

  return offsets;
}

function parseSyncSamples(view, box, sampleCount) {
  if (!box) {
    return new Set(Array.from({ length: sampleCount }, (_, index) => index + 1));
  }

  const entryCount = view.getUint32(box.dataStart + 4);
  const syncSamples = new Set();
  let offset = box.dataStart + 8;

  for (let i = 0; i < entryCount; i += 1) {
    syncSamples.add(view.getUint32(offset));
    offset += 4;
  }

  return syncSamples;
}

function parseAvcSampleDescription(view, box) {
  const entryCount = view.getUint32(box.dataStart + 4);
  if (entryCount < 1) {
    throw new Error("The MP4 track has no sample descriptions.");
  }

  const entryOffset = box.dataStart + 8;
  const entrySize = view.getUint32(entryOffset);
  const entryType = readType(view, entryOffset + 4);

  if (entryType !== "avc1" && entryType !== "avc3") {
    throw new Error(`Unsupported MP4 video codec "${entryType}". Use H.264 MP4 clips.`);
  }

  const width = view.getUint16(entryOffset + 32);
  const height = view.getUint16(entryOffset + 34);
  const childStart = entryOffset + 86;
  const childEnd = entryOffset + entrySize;
  const children = parseBoxes(view, childStart, childEnd);
  const avcC = children.find((child) => child.type === "avcC");

  if (!avcC) {
    throw new Error("Missing avcC box. The MP4 cannot be configured for WebCodecs.");
  }

  const description = new Uint8Array(view.buffer.slice(avcC.dataStart, avcC.end));
  const profile = description[1].toString(16).padStart(2, "0");
  const compatibility = description[2].toString(16).padStart(2, "0");
  const level = description[3].toString(16).padStart(2, "0");

  return {
    codec: `${entryType}.${profile}${compatibility}${level}`,
    codedWidth: width,
    codedHeight: height,
    description,
  };
}

function buildSamples(view, buffer, tables, timescale) {
  const {
    sttsDurations,
    cttsOffsets,
    sampleSizes,
    stscEntries,
    chunkOffsets,
    syncSamples,
  } = tables;

  const samples = [];
  let sampleIndex = 0;
  let dts = 0;

  for (let stscIndex = 0; stscIndex < stscEntries.length; stscIndex += 1) {
    const current = stscEntries[stscIndex];
    const next = stscEntries[stscIndex + 1];
    const chunkStart = current.firstChunk - 1;
    const chunkEnd = next ? next.firstChunk - 1 : chunkOffsets.length;

    for (let chunkIndex = chunkStart; chunkIndex < chunkEnd; chunkIndex += 1) {
      let sampleOffset = chunkOffsets[chunkIndex];

      for (let localIndex = 0; localIndex < current.samplesPerChunk; localIndex += 1) {
        const size = sampleSizes[sampleIndex];
        const duration = sttsDurations[sampleIndex] ?? sttsDurations[sttsDurations.length - 1] ?? 0;
        const compositionOffset = cttsOffsets[sampleIndex] ?? 0;
        const timestampUs = Math.round(((dts + compositionOffset) / timescale) * 1_000_000);
        const durationUs = Math.max(1, Math.round((duration / timescale) * 1_000_000));
        const data = new Uint8Array(buffer.slice(sampleOffset, sampleOffset + size));

        samples.push({
          type: syncSamples.has(sampleIndex + 1) ? "key" : "delta",
          timestamp: timestampUs,
          duration: durationUs,
          timescaleTimestamp: dts + compositionOffset,
          data,
        });

        sampleOffset += size;
        dts += duration;
        sampleIndex += 1;
      }
    }
  }

  return samples;
}

export class MP4Demuxer {
  async extractChunks(file) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const rootBoxes = parseBoxes(view, 0, view.byteLength);
    const moov = rootBoxes.find((box) => box.type === "moov");

    if (!moov) {
      throw new Error("The file is not a valid MP4. Missing moov box.");
    }

    const videoTrack = findChildren(moov, "trak").find((trak) => {
      const mdia = findChild(trak, "mdia");
      const hdlr = mdia ? findChild(mdia, "hdlr") : null;
      return hdlr ? parseHandlerType(view, hdlr) === "vide" : false;
    });

    if (!videoTrack) {
      throw new Error("No video track found in the MP4.");
    }

    const mdia = findChild(videoTrack, "mdia");
    const minf = mdia ? findChild(mdia, "minf") : null;
    const stbl = minf ? findChild(minf, "stbl") : null;
    const mdhd = mdia ? findChild(mdia, "mdhd") : null;
    const stsd = stbl ? findChild(stbl, "stsd") : null;
    const stts = stbl ? findChild(stbl, "stts") : null;
    const stsz = stbl ? findChild(stbl, "stsz") : null;
    const stsc = stbl ? findChild(stbl, "stsc") : null;
    const stco = stbl ? findChild(stbl, "stco") || findChild(stbl, "co64") : null;

    if (!mdhd || !stbl || !stsd || !stts || !stsz || !stsc || !stco) {
      throw new Error("The MP4 is missing required video sample tables.");
    }

    const timescale = parseMdhdTimescale(view, mdhd);
    const sttsDurations = parseStts(view, stts);
    const cttsOffsets = parseCtts(view, findChild(stbl, "ctts"));
    const sampleSizes = parseStsz(view, stsz);
    const stscEntries = parseStsc(view, stsc);
    const chunkOffsets = parseChunkOffsets(view, stco);
    const syncSamples = parseSyncSamples(view, findChild(stbl, "stss"), sampleSizes.length);
    const decoderConfig = parseAvcSampleDescription(view, stsd);
    const samples = buildSamples(
      view,
      buffer,
      { sttsDurations, cttsOffsets, sampleSizes, stscEntries, chunkOffsets, syncSamples },
      timescale,
    );

    const totalDurationUs = samples.reduce((sum, sample) => sum + sample.duration, 0);
    const averageFrameDurationUs = samples.length ? totalDurationUs / samples.length : 0;
    const fps = averageFrameDurationUs ? 1_000_000 / averageFrameDurationUs : 30;

    return {
      decoderConfig,
      samples,
      fps,
      duration: totalDurationUs / 1_000_000,
    };
  }
}
