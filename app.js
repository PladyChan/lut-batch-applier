"use strict";

const state = {
  images: [],
  currentIndex: 0,
  lut: null,
  watermarkStyle: "metadata",
  renderToken: 0
};

const $ = (id) => document.getElementById(id);

const els = {
  imageInput: $("imageInput"),
  lutInput: $("lutInput"),
  imageDropzone: $("imageDropzone"),
  lutDropzone: $("lutDropzone"),
  imageMeta: $("imageMeta"),
  lutMeta: $("lutMeta"),
  previewCanvas: $("previewCanvas"),
  emptyState: $("emptyState"),
  previewTitle: $("previewTitle"),
  imageCounter: $("imageCounter"),
  imageQueue: $("imageQueue"),
  log: $("log"),
  exportButton: $("exportButton"),
  prevImage: $("prevImage"),
  nextImage: $("nextImage"),
  resetAdjustments: $("resetAdjustments"),
  lutIntensity: $("lutIntensity"),
  exposure: $("exposure"),
  contrast: $("contrast"),
  saturation: $("saturation"),
  watermarkEnabled: $("watermarkEnabled"),
  watermarkTitle: $("watermarkTitle"),
  watermarkSubtitle: $("watermarkSubtitle"),
  fontSize: $("fontSize"),
  watermarkOpacity: $("watermarkOpacity"),
  textColor: $("textColor"),
  frameColor: $("frameColor"),
  maxEdge: $("maxEdge"),
  jpegQuality: $("jpegQuality"),
  intensityValue: $("intensityValue"),
  exposureValue: $("exposureValue"),
  contrastValue: $("contrastValue"),
  saturationValue: $("saturationValue"),
  fontSizeValue: $("fontSizeValue"),
  opacityValue: $("opacityValue"),
  maxEdgeValue: $("maxEdgeValue"),
  qualityValue: $("qualityValue")
};

function setLog(message) {
  els.log.textContent = message;
}

function readSettings() {
  return {
    lutIntensity: Number(els.lutIntensity.value) / 100,
    exposure: Number(els.exposure.value),
    contrast: Number(els.contrast.value),
    saturation: Number(els.saturation.value),
    watermarkEnabled: els.watermarkEnabled.checked,
    watermarkTitle: els.watermarkTitle.value.trim() || "PLADY",
    watermarkSubtitle: els.watermarkSubtitle.value.trim(),
    watermarkStyle: state.watermarkStyle,
    fontSize: Number(els.fontSize.value),
    watermarkOpacity: Number(els.watermarkOpacity.value) / 100,
    textColor: els.textColor.value,
    frameColor: els.frameColor.value,
    maxEdge: Number(els.maxEdge.value),
    jpegQuality: Number(els.jpegQuality.value) / 100
  };
}

function updateOutputs() {
  els.intensityValue.textContent = `${els.lutIntensity.value}%`;
  els.exposureValue.textContent = els.exposure.value;
  els.contrastValue.textContent = els.contrast.value;
  els.saturationValue.textContent = els.saturation.value;
  els.fontSizeValue.textContent = els.fontSize.value;
  els.opacityValue.textContent = `${els.watermarkOpacity.value}%`;
  els.maxEdgeValue.textContent = `${els.maxEdge.value}px`;
  els.qualityValue.textContent = `${els.jpegQuality.value}%`;
}

function parseCube(content) {
  let title = "";
  let size = 0;
  const data = [];
  const lines = content.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const upper = line.toUpperCase();
    if (upper.startsWith("TITLE")) {
      const match = line.match(/"([^"]+)"/);
      title = match ? match[1] : line.replace(/^TITLE\s+/i, "").trim();
      continue;
    }
    if (upper.startsWith("LUT_3D_SIZE")) {
      const parts = line.split(/\s+/);
      size = Number(parts[parts.length - 1]);
      continue;
    }
    if (upper.startsWith("DOMAIN_MIN") || upper.startsWith("DOMAIN_MAX")) continue;

    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      data.push(
        clamp(parts[0], 0, 1),
        clamp(parts[1], 0, 1),
        clamp(parts[2], 0, 1)
      );
    }
  }

  if (!size) throw new Error("LUT 缺少 LUT_3D_SIZE");
  if (data.length !== size * size * size * 3) {
    throw new Error(`LUT 数据长度不正确：需要 ${size * size * size} 组 RGB，实际 ${data.length / 3} 组`);
  }
  return { title: title || `Cube ${size}`, size, data: new Float32Array(data) };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function cubeIndex(size, r, g, b) {
  return ((b * size * size) + (g * size) + r) * 3;
}

function sampleLut(lut, r, g, b) {
  const max = lut.size - 1;
  const rr = r * max;
  const gg = g * max;
  const bb = b * max;
  const r0 = Math.floor(rr);
  const g0 = Math.floor(gg);
  const b0 = Math.floor(bb);
  const r1 = Math.min(max, r0 + 1);
  const g1 = Math.min(max, g0 + 1);
  const b1 = Math.min(max, b0 + 1);
  const fr = rr - r0;
  const fg = gg - g0;
  const fb = bb - b0;

  const out = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const c000 = lut.data[cubeIndex(lut.size, r0, g0, b0) + channel];
    const c100 = lut.data[cubeIndex(lut.size, r1, g0, b0) + channel];
    const c010 = lut.data[cubeIndex(lut.size, r0, g1, b0) + channel];
    const c110 = lut.data[cubeIndex(lut.size, r1, g1, b0) + channel];
    const c001 = lut.data[cubeIndex(lut.size, r0, g0, b1) + channel];
    const c101 = lut.data[cubeIndex(lut.size, r1, g0, b1) + channel];
    const c011 = lut.data[cubeIndex(lut.size, r0, g1, b1) + channel];
    const c111 = lut.data[cubeIndex(lut.size, r1, g1, b1) + channel];
    const c00 = lerp(c000, c100, fr);
    const c10 = lerp(c010, c110, fr);
    const c01 = lerp(c001, c101, fr);
    const c11 = lerp(c011, c111, fr);
    const c0 = lerp(c00, c10, fg);
    const c1 = lerp(c01, c11, fg);
    out[channel] = lerp(c0, c1, fb);
  }
  return out;
}

function applyAdjustments(imageData, settings) {
  const pixels = imageData.data;
  const exposureMul = Math.pow(2, settings.exposure / 100);
  const contrast = 1 + settings.contrast / 120;
  const saturation = Math.max(0, 1 + settings.saturation / 100);

  for (let i = 0; i < pixels.length; i += 4) {
    let r = pixels[i] / 255;
    let g = pixels[i + 1] / 255;
    let b = pixels[i + 2] / 255;

    if (state.lut && settings.lutIntensity > 0) {
      const lutColor = sampleLut(state.lut, r, g, b);
      r = lerp(r, lutColor[0], settings.lutIntensity);
      g = lerp(g, lutColor[1], settings.lutIntensity);
      b = lerp(b, lutColor[2], settings.lutIntensity);
    }

    r *= exposureMul;
    g *= exposureMul;
    b *= exposureMul;

    r = (r - 0.5) * contrast + 0.5;
    g = (g - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;

    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    r = lerp(luma, r, saturation);
    g = lerp(luma, g, saturation);
    b = lerp(luma, b, saturation);

    pixels[i] = Math.round(clamp(r, 0, 1) * 255);
    pixels[i + 1] = Math.round(clamp(g, 0, 1) * 255);
    pixels[i + 2] = Math.round(clamp(b, 0, 1) * 255);
  }
}

function fitSize(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function drawWatermark(ctx, width, height, imageName, settings) {
  if (!settings.watermarkEnabled) return;

  const pad = Math.max(18, Math.round(width * 0.025));
  const fontSize = Math.round(settings.fontSize * Math.max(0.65, Math.min(1.4, width / 2400)));
  const title = settings.watermarkTitle;
  const details = [
    settings.watermarkSubtitle,
    state.lut ? state.lut.title : "",
    imageName
  ].filter(Boolean).join(" · ");

  ctx.save();
  ctx.globalAlpha = settings.watermarkOpacity;

  if (settings.watermarkStyle === "frame") {
    const frame = Math.max(42, Math.round(width * 0.045));
    const source = ctx.getImageData(0, 0, width, height);
    ctx.canvas.width = width + frame * 2;
    ctx.canvas.height = height + frame * 2;
    ctx.fillStyle = settings.frameColor;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.putImageData(source, frame, frame);
    ctx.fillStyle = settings.textColor;
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(14, fontSize)}px Inter, system-ui, sans-serif`;
    ctx.fillText(title, frame, frame / 2);
    ctx.font = `400 ${Math.max(11, Math.round(fontSize * 0.48))}px Inter, system-ui, sans-serif`;
    const detailText = trimToWidth(ctx, details, ctx.canvas.width - frame * 2);
    ctx.fillText(detailText, frame, ctx.canvas.height - frame / 2);
    ctx.restore();
    return;
  }

  ctx.textBaseline = "bottom";
  ctx.font = `800 ${fontSize}px Inter, system-ui, sans-serif`;
  const titleWidth = ctx.measureText(title).width;
  ctx.font = `500 ${Math.max(11, Math.round(fontSize * 0.46))}px Inter, system-ui, sans-serif`;
  const detailText = trimToWidth(ctx, details, Math.max(120, width * 0.56));
  const detailWidth = ctx.measureText(detailText).width;
  const boxWidth = Math.max(titleWidth, detailWidth) + pad * 1.1;
  const boxHeight = fontSize * 1.85;
  const x = width - boxWidth - pad;
  const y = height - boxHeight - pad;

  ctx.fillStyle = settings.frameColor;
  roundedRect(ctx, x, y, boxWidth, boxHeight, 8);
  ctx.fill();
  ctx.fillStyle = settings.textColor;
  ctx.font = `800 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.fillText(title, x + pad * 0.55, y + fontSize * 1.06);
  ctx.font = `500 ${Math.max(11, Math.round(fontSize * 0.46))}px Inter, system-ui, sans-serif`;
  ctx.fillText(detailText, x + pad * 0.55, y + boxHeight - pad * 0.42);
  ctx.restore();
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function trimToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 4 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -2);
  }
  return `${trimmed}...`;
}

async function renderImage(asset, targetCanvas, maxEdge, includeWatermark) {
  const settings = readSettings();
  settings.maxEdge = maxEdge;
  settings.watermarkEnabled = includeWatermark && settings.watermarkEnabled;
  const size = fitSize(asset.bitmap.width, asset.bitmap.height, settings.maxEdge);
  targetCanvas.width = size.width;
  targetCanvas.height = size.height;
  const ctx = targetCanvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.drawImage(asset.bitmap, 0, 0, size.width, size.height);
  const imageData = ctx.getImageData(0, 0, size.width, size.height);
  applyAdjustments(imageData, settings);
  ctx.putImageData(imageData, 0, 0);
  drawWatermark(ctx, size.width, size.height, asset.file.name, settings);
  return targetCanvas;
}

async function renderPreview() {
  updateOutputs();
  const token = ++state.renderToken;
  const asset = state.images[state.currentIndex];
  const hasImage = Boolean(asset);
  els.emptyState.style.display = hasImage ? "none" : "grid";
  els.exportButton.disabled = !hasImage;
  els.previewTitle.textContent = hasImage ? asset.file.name : "等待导入图片";
  els.imageCounter.textContent = `${hasImage ? state.currentIndex + 1 : 0} / ${state.images.length}`;
  els.prevImage.disabled = state.images.length < 2;
  els.nextImage.disabled = state.images.length < 2;

  if (!asset) return;
  await renderImage(asset, els.previewCanvas, 1800, true);
  if (token === state.renderToken) setLog("预览已更新");
}

async function handleImages(files) {
  const imageFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;
  setLog("正在读取图片...");
  const loaded = [];
  for (const file of imageFiles) {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    loaded.push({
      file,
      bitmap,
      url: URL.createObjectURL(file)
    });
  }
  state.images.push(...loaded);
  state.currentIndex = Math.max(0, state.images.length - loaded.length);
  els.imageMeta.textContent = `${state.images.length} 张图片`;
  buildQueue();
  await renderPreview();
}

async function handleLut(file) {
  if (!file) return;
  try {
    const content = await file.text();
    state.lut = parseCube(content);
    els.lutMeta.textContent = `${state.lut.title} · ${state.lut.size}³`;
    setLog("LUT 已载入");
    await renderPreview();
  } catch (error) {
    state.lut = null;
    els.lutMeta.textContent = "LUT 载入失败";
    setLog(error.message);
  }
}

function buildQueue() {
  els.imageQueue.innerHTML = "";
  state.images.forEach((asset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `thumb${index === state.currentIndex ? " active" : ""}`;
    button.title = asset.file.name;
    const img = document.createElement("img");
    img.src = asset.url;
    img.alt = asset.file.name;
    button.appendChild(img);
    button.addEventListener("click", async () => {
      state.currentIndex = index;
      buildQueue();
      await renderPreview();
    });
    els.imageQueue.appendChild(button);
  });
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function u16(value) {
  return [value & 255, (value >>> 8) & 255];
}

function u32(value) {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

async function makeZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(now.dosTime), ...u16(now.dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)
    ]);
    chunks.push(local, nameBytes, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  }

  let centralSize = 0;
  const centralOffset = offset;
  for (const entry of central) {
    const header = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(now.dosTime), ...u16(now.dosDate),
      ...u32(entry.crc), ...u32(entry.size), ...u32(entry.size), ...u16(entry.nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(entry.offset)
    ]);
    chunks.push(header, entry.nameBytes);
    centralSize += header.length + entry.nameBytes.length;
  }

  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(centralSize), ...u32(centralOffset), ...u16(0)
  ]);
  chunks.push(end);
  return new Blob(chunks, { type: "application/zip" });
}

function safeName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 80) || "image";
}

async function exportZip() {
  if (!state.images.length) return;
  els.exportButton.disabled = true;
  setLog("正在批量导出...");
  try {
    const files = [];
    const canvas = document.createElement("canvas");
    for (let i = 0; i < state.images.length; i += 1) {
      const asset = state.images[i];
      setLog(`正在处理 ${i + 1} / ${state.images.length}: ${asset.file.name}`);
      await renderImage(asset, canvas, Number(els.maxEdge.value), true);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", Number(els.jpegQuality.value) / 100));
      files.push({ name: `${safeName(asset.file.name)}_plady.jpg`, blob });
    }
    const zip = await makeZip(files);
    const url = URL.createObjectURL(zip);
    const link = document.createElement("a");
    link.href = url;
    link.download = `plady-export-${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setLog(`已导出 ${files.length} 张图片`);
  } catch (error) {
    setLog(`导出失败：${error.message}`);
  } finally {
    els.exportButton.disabled = !state.images.length;
  }
}

function wireDropzone(zone, input, handler) {
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", async (event) => {
    event.preventDefault();
    zone.classList.remove("dragover");
    await handler(event.dataTransfer.files);
  });
  input.addEventListener("change", async () => handler(input.files));
}

function setup() {
  wireDropzone(els.imageDropzone, els.imageInput, handleImages);
  wireDropzone(els.lutDropzone, els.lutInput, (files) => handleLut([...files][0]));

  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.watermarkStyle = button.dataset.style;
      await renderPreview();
    });
  });

  [
    els.lutIntensity, els.exposure, els.contrast, els.saturation,
    els.watermarkEnabled, els.watermarkTitle, els.watermarkSubtitle,
    els.fontSize, els.watermarkOpacity, els.textColor, els.frameColor,
    els.maxEdge, els.jpegQuality
  ].forEach((input) => {
    input.addEventListener("input", renderPreview);
  });

  els.resetAdjustments.addEventListener("click", async () => {
    els.lutIntensity.value = 100;
    els.exposure.value = 0;
    els.contrast.value = 0;
    els.saturation.value = 0;
    await renderPreview();
  });

  els.prevImage.addEventListener("click", async () => {
    if (!state.images.length) return;
    state.currentIndex = (state.currentIndex - 1 + state.images.length) % state.images.length;
    buildQueue();
    await renderPreview();
  });

  els.nextImage.addEventListener("click", async () => {
    if (!state.images.length) return;
    state.currentIndex = (state.currentIndex + 1) % state.images.length;
    buildQueue();
    await renderPreview();
  });

  els.exportButton.addEventListener("click", exportZip);
  updateOutputs();
  renderPreview();
}

setup();
