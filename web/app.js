"use strict";

const state = {
  images: [],
  currentIndex: 0,
  lut: null,
  watermarkStyle: "frame",
  renderToken: 0,
  fontLoadPromise: null
};

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

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
  lutIntensity: $("lutIntensity"),
  watermarkEnabled: $("watermarkEnabled"),
  watermarkTitle: $("watermarkTitle"),
  watermarkSubtitle: $("watermarkSubtitle"),
  fontSize: $("fontSize"),
  watermarkOpacity: $("watermarkOpacity"),
  photoThemeEnabled: $("photoThemeEnabled"),
  textColor: $("textColor"),
  frameColor: $("frameColor"),
  maxEdge: $("maxEdge"),
  jpegQuality: $("jpegQuality"),
  intensityValue: $("intensityValue"),
  fontSizeValue: $("fontSizeValue"),
  opacityValue: $("opacityValue"),
  maxEdgeValue: $("maxEdgeValue"),
  qualityValue: $("qualityValue")
};

function setLog(message) {
  els.log.textContent = message;
}

window.addEventListener("error", (event) => {
  if (els.log) els.log.textContent = `页面错误：${event.message}`;
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason && event.reason.message ? event.reason.message : String(event.reason || "未知错误");
  if (els.log) els.log.textContent = `处理失败：${reason}`;
});

function readSettings() {
  return {
    lutIntensity: Number(els.lutIntensity.value) / 100,
    watermarkEnabled: els.watermarkEnabled.checked,
    watermarkTitle: els.watermarkTitle.value.trim() || "PLADY",
    watermarkSubtitle: els.watermarkSubtitle.value.trim(),
    watermarkStyle: state.watermarkStyle,
    fontSize: Number(els.fontSize.value),
    watermarkOpacity: Number(els.watermarkOpacity.value) / 100,
    photoThemeEnabled: els.photoThemeEnabled.checked,
    textColor: els.textColor.value,
    frameColor: els.frameColor.value,
    maxEdge: Number(els.maxEdge.value),
    jpegQuality: Number(els.jpegQuality.value) / 100
  };
}

async function ensureWatermarkFonts() {
  if (!("FontFace" in window) || !document.fonts) return;
  if (!state.fontLoadPromise) {
    state.fontLoadPromise = Promise.all([
      new FontFace("Stanger", 'url("./assets/fonts/Stanger.otf")').load(),
      new FontFace("Nyght Serif", 'url("./assets/fonts/NyghtSerif-RegularItalic.otf")', { style: "italic" }).load()
    ]).then((fonts) => {
      fonts.forEach((font) => document.fonts.add(font));
    }).catch((error) => {
      console.warn("Watermark font loading failed", error);
    });
  }
  await state.fontLoadPromise;
}

function updateOutputs() {
  els.intensityValue.textContent = `${els.lutIntensity.value}%`;
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

function applyLut(imageData, settings) {
  const pixels = imageData.data;

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

function safeRenderEdge(maxEdge) {
  return isIOS ? Math.min(maxEdge, 1800) : maxEdge;
}

function drawWatermark(ctx, width, height, asset, settings) {
  if (!settings.watermarkEnabled) return;

  if (settings.watermarkStyle === "frame") {
    drawLumixFrame(ctx, width, height, asset, settings);
  } else {
    drawMetadataWatermark(ctx, width, height, asset, settings);
  }
}

function cleanWatermarkLine(value) {
  const line = String(value || "").trim();
  return line ? line : null;
}

function cleanCameraText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/Panasonic/gi, "LUMIX")
    .replace(/\bDC-/gi, "")
    .trim();
}

function metadataContent(asset) {
  const metadata = asset.metadata || {};
  const lutName = state.lut ? state.lut.title.replace(/\.[^.]+$/, "") : null;
  return {
    camera: cleanWatermarkLine(metadata.cameraModel),
    lens: cleanWatermarkLine(metadata.lensModel),
    focalLength: cleanWatermarkLine(metadata.focalLength),
    aperture: cleanWatermarkLine(metadata.aperture),
    shutterSpeed: cleanWatermarkLine(metadata.shutterSpeed),
    iso: cleanWatermarkLine(metadata.iso),
    whiteBalance: cleanWatermarkLine(metadata.whiteBalance),
    lutName: cleanWatermarkLine(lutName)
  };
}

function drawMetadataWatermark(ctx, width, height, asset, settings) {
  const content = metadataContent(asset);
  const primaryLine = content.camera;
  const leftDetailLine = content.lens;
  const exposureLine = [
    content.focalLength,
    content.aperture,
    content.shutterSpeed,
    content.iso,
    content.whiteBalance
  ].filter(Boolean).join("  ");
  const rightLines = [exposureLine, content.lutName].filter(Boolean);
  if (!primaryLine && !leftDetailLine && !rightLines.length) return;

  const shortEdge = Math.min(width, height);
  const fontScale = clamp(settings.fontSize / 30, 0.45, 1.8);
  const padding = Math.max(18, shortEdge * 0.028);
  const primarySize = Math.max(14, shortEdge * 0.05 * fontScale);
  const detailSize = Math.max(8, shortEdge * 0.022 * fontScale);
  const detailBoldSize = Math.max(9, shortEdge * 0.024 * fontScale);
  const primaryMaxWidth = width * 0.48;
  const detailMaxWidth = width * 0.5;
  const leftDetailBaselineY = height - padding;
  const primaryBaselineY = leftDetailLine ? height - (padding + detailSize * 1.18) : height - padding;
  const detailLineHeight = detailSize * 1.22;
  const detailBlockHeight = rightLines.reduce((total, _line, index) => {
    const isLast = index === rightLines.length - 1 && Boolean(content.lutName);
    return total + (isLast ? detailBoldSize : detailSize) * 1.22;
  }, 0);
  let detailY = height - (padding + Math.max(0, (primarySize - detailBlockHeight) * 0.45));

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = Math.max(2.5, shortEdge * 0.004);
  ctx.shadowOffsetY = 1;

  if (primaryLine) {
    drawTruncatedCanvasText(ctx, primaryLine, padding, primaryBaselineY, primaryMaxWidth, {
      font: `${primarySize}px ${settings.watermarkFont || "Google Sans"}, system-ui, sans-serif`,
      color: "rgba(255, 255, 255, 0.98)",
      align: "left",
      baseline: "bottom"
    });
  }

  if (leftDetailLine) {
    drawTruncatedCanvasText(ctx, leftDetailLine, padding, leftDetailBaselineY, primaryMaxWidth, {
      font: `${detailSize}px ${settings.watermarkFont || "Google Sans"}, system-ui, sans-serif`,
      color: "rgba(255, 255, 255, 0.9)",
      align: "left",
      baseline: "bottom"
    });
  }

  rightLines.forEach((line, index) => {
    const isLast = index === rightLines.length - 1 && Boolean(content.lutName);
    const fontSize = isLast ? detailBoldSize : detailSize;
    drawTruncatedCanvasText(ctx, line, width - padding - detailMaxWidth, detailY, detailMaxWidth, {
      font: `${isLast ? "700 " : ""}${fontSize}px ${settings.watermarkFont || "Google Sans"}, system-ui, sans-serif`,
      color: `rgba(255, 255, 255, ${isLast ? 0.96 : 0.9})`,
      align: "right",
      baseline: "alphabetic"
    });
    detailY += isLast ? detailBoldSize * 1.2 : detailLineHeight;
  });
  ctx.restore();
}

function lumixFrameLayout(imageWidth, imageHeight) {
  const designWidth = 360;
  const designHeight = 640;
  const aspect = designWidth / designHeight;
  const photoWidthRatio = 340 / 360;
  const photoHeightRatio = 471 / 640;
  const frameWidthForPhotoWidth = imageWidth / photoWidthRatio;
  const frameWidthForPhotoHeight = aspect * (imageHeight / photoHeightRatio);
  const frameWidth = Math.ceil(Math.max(designWidth, frameWidthForPhotoWidth, frameWidthForPhotoHeight));
  const frameHeight = Math.round(frameWidth / aspect);
  const unit = frameWidth / designWidth;
  const verticalUnit = frameHeight / designHeight;
  const photoTop = (40 + 52 + 10) * verticalUnit;
  const photoSize = { width: 340 * unit, height: 471 * verticalUnit };
  const photoOrigin = { x: 10 * unit, y: photoTop };
  const fitScale = Math.min(photoSize.width / imageWidth, photoSize.height / imageHeight);
  const fittedSize = { width: imageWidth * fitScale, height: imageHeight * fitScale };
  const fittedTopLeft = {
    x: photoOrigin.x + (photoSize.width - fittedSize.width) / 2,
    y: photoOrigin.y + (photoSize.height - fittedSize.height) / 2
  };

  return {
    frameWidth,
    frameHeight,
    imageRect: {
      x: Math.round(fittedTopLeft.x),
      y: Math.round(fittedTopLeft.y),
      width: Math.round(fittedSize.width),
      height: Math.round(fittedSize.height)
    },
    horizontalPadding: 10 * unit,
    titleFontSize: 40 * unit,
    footerFontSize: 8 * unit,
    lutFontSize: 16 * unit,
    titleBaselineY: (40 + 40) * verticalUnit,
    lensBaselineY: frameHeight - (52 * verticalUnit),
    exposureBaselineY: frameHeight - (42 * verticalUnit),
    lutBaselineY: frameHeight - (42 * verticalUnit)
  };
}

function drawLumixFrame(ctx, width, height, asset, settings) {
  const source = ctx.getImageData(0, 0, width, height);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  sourceCanvas.getContext("2d").putImageData(source, 0, 0);
  const layout = lumixFrameLayout(width, height);
  const content = metadataContent(asset);
  const exposure = [
    content.aperture,
    content.shutterSpeed,
    content.iso,
    content.whiteBalance
  ].filter(Boolean).join("  ");
  const frameContent = {
    camera: cleanWatermarkLine(settings.watermarkTitle) || content.camera || "LUMIX L10",
    lens: content.lens || "LENS",
    exposure: exposure || "F2.4  1/60s  ISO400 WB",
    lutName: cleanWatermarkLine(settings.watermarkSubtitle) || content.lutName || "Y2000-LX Plady"
  };
  const colors = settings.photoThemeEnabled
    ? photoDominantFrameTheme(asset) || { background: settings.frameColor || "#ffffff", text: settings.textColor || "#000000" }
    : { background: settings.frameColor || "#ffffff", text: settings.textColor || "#000000" };

  ctx.canvas.width = layout.frameWidth;
  ctx.canvas.height = layout.frameHeight;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, layout.frameWidth, layout.frameHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, layout.imageRect.x, layout.imageRect.y, layout.imageRect.width, layout.imageRect.height);
  ctx.fillStyle = colors.text;
  ctx.shadowColor = "transparent";

  drawTruncatedCanvasText(ctx, frameContent.camera, layout.horizontalPadding, layout.titleBaselineY, layout.frameWidth - layout.horizontalPadding * 2, {
    font: `${layout.titleFontSize}px "Stanger", "Times New Roman", serif`,
    color: colors.text,
    align: "left",
    baseline: "alphabetic"
  });
  drawTruncatedCanvasText(ctx, frameContent.lens, layout.horizontalPadding, layout.lensBaselineY, layout.frameWidth * 0.45, {
    font: `italic ${layout.footerFontSize}px "Nyght Serif", Georgia, serif`,
    color: colors.text,
    align: "left",
    baseline: "alphabetic"
  });
  drawTruncatedCanvasText(ctx, frameContent.exposure, layout.horizontalPadding, layout.exposureBaselineY, layout.frameWidth * 0.6, {
    font: `italic ${layout.footerFontSize}px "Nyght Serif", Georgia, serif`,
    color: colors.text,
    align: "left",
    baseline: "alphabetic"
  });
  drawTruncatedCanvasText(ctx, frameContent.lutName, layout.frameWidth - layout.horizontalPadding - layout.frameWidth * 0.45, layout.lutBaselineY, layout.frameWidth * 0.45, {
    font: `italic ${layout.lutFontSize}px "Nyght Serif", Georgia, serif`,
    color: colors.text,
    align: "right",
    baseline: "alphabetic"
  });
}

function photoDominantFrameTheme(asset) {
  try {
    const size = 96;
    const sampleCanvas = document.createElement("canvas");
    const sourceWidth = asset.bitmap.naturalWidth || asset.bitmap.width || 1;
    const sourceHeight = asset.bitmap.naturalHeight || asset.bitmap.height || 1;
    const scale = Math.min(1, size / Math.max(sourceWidth, sourceHeight));
    sampleCanvas.width = Math.max(1, Math.round(sourceWidth * scale));
    sampleCanvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    sampleCtx.imageSmoothingEnabled = true;
    sampleCtx.imageSmoothingQuality = "low";
    sampleCtx.drawImage(asset.bitmap, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const pixels = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    let redTotal = 0;
    let greenTotal = 0;
    let blueTotal = 0;
    let weightTotal = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] / 255;
      const green = pixels[index + 1] / 255;
      const blue = pixels[index + 2] / 255;
      const maxChannel = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      const saturation = maxChannel === 0 ? 0 : (maxChannel - minChannel) / maxChannel;
      const brightness = maxChannel;
      const weight = Math.max(0.08, saturation) * (0.35 + brightness * 0.65);
      redTotal += red * weight;
      greenTotal += green * weight;
      blueTotal += blue * weight;
      weightTotal += weight;
    }

    if (weightTotal <= 0) return null;
    const average = {
      r: redTotal / weightTotal,
      g: greenTotal / weightTotal,
      b: blueTotal / weightTotal
    };
    const hsv = rgbToHsv(average.r, average.g, average.b);
    const backgroundSaturation = Math.min(0.30, Math.max(0.10, hsv.s * 0.34));
    const textSaturation = Math.min(0.62, Math.max(0.18, hsv.s * 0.72));
    return {
      background: rgbToHex(hsvToRgb(hsv.h, backgroundSaturation, 0.94)),
      text: rgbToHex(hsvToRgb(hsv.h, textSaturation, 0.13))
    };
  } catch (_error) {
    return null;
  }
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max
  };
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}

function rgbToHex(color) {
  const channel = (value) => Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function drawTruncatedCanvasText(ctx, text, x, y, maxWidth, options) {
  ctx.save();
  ctx.font = options.font;
  ctx.fillStyle = options.color;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "alphabetic";
  const displayText = trimToWidth(ctx, text, maxWidth);
  ctx.fillText(displayText, options.align === "right" ? x + maxWidth : x, y);
  ctx.restore();
}

function trimToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 4 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -2);
  }
  return `${trimmed}…`;
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
  applyLut(imageData, settings);
  ctx.putImageData(imageData, 0, 0);
  await ensureWatermarkFonts();
  drawWatermark(ctx, size.width, size.height, asset, settings);
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
  await renderImage(asset, els.previewCanvas, isIOS ? 1100 : 1800, true);
  if (token === state.renderToken) setLog("预览已更新");
}

async function handleImages(files) {
  const imageFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;
  setLog("正在读取图片...");
  const loaded = [];
  for (const file of imageFiles) {
    const [bitmap, metadata] = await Promise.all([
      loadBitmap(file),
      readImageMetadata(file)
    ]);
    loaded.push({
      file,
      bitmap,
      metadata,
      url: URL.createObjectURL(file)
    });
  }
  state.images.push(...loaded);
  state.currentIndex = Math.max(0, state.images.length - loaded.length);
  els.imageMeta.textContent = `${state.images.length} 张图片`;
  buildQueue();
  await renderPreview();
}

function loadBitmap(file) {
  if ("createImageBitmap" in window && !isIOS) {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  return loadImageElement(file);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    image.src = url;
  });
}

async function readImageMetadata(file) {
  if (!/jpe?g$/i.test(file.name) && file.type !== "image/jpeg") return {};
  try {
    const buffer = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
    return parseExifMetadata(buffer);
  } catch (_error) {
    return {};
  }
}

function parseExifMetadata(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};
  let offset = 2;

  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const segmentLength = view.getUint16(offset + 2, false);
    if (marker === 0xe1 && offset + 4 + segmentLength <= view.byteLength) {
      const exifOffset = offset + 4;
      if (readAscii(view, exifOffset, 6) === "Exif\0\0") {
        return parseTiffMetadata(view, exifOffset + 6);
      }
    }
    offset += 2 + segmentLength;
  }
  return {};
}

function parseTiffMetadata(view, tiffStart) {
  const endian = readAscii(view, tiffStart, 2);
  const littleEndian = endian === "II";
  if (!littleEndian && endian !== "MM") return {};
  const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
  const ifd0 = readIfd(view, tiffStart, firstIfdOffset, littleEndian);
  const exifOffset = ifd0[0x8769] ? Number(ifd0[0x8769].value) : 0;
  const exif = exifOffset ? readIfd(view, tiffStart, exifOffset, littleEndian) : {};

  const make = cleanCameraText(ifdValue(ifd0[0x010f]));
  const model = cleanCameraText(ifdValue(ifd0[0x0110]));
  const lensMake = cleanCameraText(ifdValue(exif[0xa433]));
  const lensModel = cleanCameraText(ifdValue(exif[0xa434]));
  const cameraModel = formatCameraModel(make, model);
  const lens = formatCameraModel(lensMake, lensModel);
  const focalEquivalent = numberValue(ifdValue(exif[0xa405]));
  const focalActual = numberValue(ifdValue(exif[0x920a]));
  const aperture = numberValue(ifdValue(exif[0x829d]));
  const shutter = numberValue(ifdValue(exif[0x829a]));
  const iso = numberValue(firstArrayValue(ifdValue(exif[0x8827])));
  const lightSource = numberValue(ifdValue(exif[0x9208]));
  const whiteBalance = numberValue(ifdValue(exif[0xa403]));
  const hasLightSource = Object.prototype.hasOwnProperty.call(exif, 0x9208);
  const hasWhiteBalance = Object.prototype.hasOwnProperty.call(exif, 0xa403);

  return {
    cameraModel: cameraModel || null,
    lensModel: lens || null,
    focalLength: focalEquivalent > 0 ? formatFocalLength(focalEquivalent) : formatFocalLength(focalActual),
    aperture: formatFNumber(aperture),
    shutterSpeed: formatExposureTime(shutter),
    iso: iso > 0 ? `ISO ${Math.round(iso)}` : null,
    whiteBalance: formatWhiteBalance(hasLightSource ? lightSource : null, hasWhiteBalance ? whiteBalance : null)
  };
}

function readIfd(view, tiffStart, ifdOffset, littleEndian) {
  const absoluteOffset = tiffStart + ifdOffset;
  if (absoluteOffset < 0 || absoluteOffset + 2 > view.byteLength) return {};
  const count = view.getUint16(absoluteOffset, littleEndian);
  const tags = {};
  for (let index = 0; index < count; index += 1) {
    const entry = absoluteOffset + 2 + index * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, littleEndian);
    const type = view.getUint16(entry + 2, littleEndian);
    const valueCount = view.getUint32(entry + 4, littleEndian);
    tags[tag] = {
      type,
      count: valueCount,
      value: readIfdValue(view, tiffStart, entry, type, valueCount, littleEndian)
    };
  }
  return tags;
}

function readIfdValue(view, tiffStart, entry, type, count, littleEndian) {
  const typeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
  const byteLength = typeSize * count;
  const inlineOffset = entry + 8;
  const valueOffset = byteLength <= 4 ? inlineOffset : tiffStart + view.getUint32(inlineOffset, littleEndian);
  if (valueOffset < 0 || valueOffset + byteLength > view.byteLength) return null;

  if (type === 2) return readAscii(view, valueOffset, count).replace(/\0+$/, "");
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const offset = valueOffset + i * typeSize;
    if (type === 3) values.push(view.getUint16(offset, littleEndian));
    else if (type === 4) values.push(view.getUint32(offset, littleEndian));
    else if (type === 5) values.push(view.getUint32(offset, littleEndian) / Math.max(1, view.getUint32(offset + 4, littleEndian)));
    else if (type === 9) values.push(view.getInt32(offset, littleEndian));
    else if (type === 10) values.push(view.getInt32(offset, littleEndian) / Math.max(1, view.getInt32(offset + 4, littleEndian)));
    else values.push(view.getUint8(offset));
  }
  return count === 1 ? values[0] : values;
}

function ifdValue(entry) {
  return entry ? entry.value : null;
}

function firstArrayValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function numberValue(value) {
  const first = firstArrayValue(value);
  const number = Number(first);
  return Number.isFinite(number) ? number : 0;
}

function readAscii(view, offset, length) {
  let text = "";
  for (let i = 0; i < length && offset + i < view.byteLength; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

function formatCameraModel(make, model) {
  if (model) {
    return make && !model.toLowerCase().startsWith(make.toLowerCase()) ? cleanCameraText(`${make} ${model}`) : cleanCameraText(model);
  }
  return make || null;
}

function compactNumber(value, maximumFractionDigits) {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

function formatFNumber(value) {
  return value > 0 ? `f/${compactNumber(value, value >= 10 ? 0 : 1)}` : null;
}

function formatExposureTime(value) {
  if (!(value > 0)) return null;
  if (value < 1) return `1/${Math.round(1 / value)}s`;
  return `${compactNumber(value, value >= 10 ? 0 : 1)}s`;
}

function formatFocalLength(value) {
  return value > 0 ? `${compactNumber(value, value >= 100 ? 0 : 1)}MM` : null;
}

function formatWhiteBalance(lightSource, whiteBalance) {
  const lightSources = {
    1: "DAYLIGHT",
    2: "FLUORESCENT",
    3: "TUNGSTEN",
    4: "FLASH",
    9: "FINE",
    10: "CLOUDY",
    11: "SHADE",
    12: "DAYLIGHT FLUORESCENT",
    13: "DAY WHITE FLUORESCENT",
    14: "COOL WHITE FLUORESCENT",
    15: "WHITE FLUORESCENT",
    16: "WARM WHITE FLUORESCENT",
    17: "STANDARD A",
    18: "STANDARD B",
    19: "STANDARD C",
    20: "D55",
    21: "D65",
    22: "D75",
    23: "D50",
    24: "ISO STUDIO TUNGSTEN",
    255: "OTHER"
  };
  if (lightSource !== null && lightSources[Math.round(lightSource)]) return `WB ${lightSources[Math.round(lightSource)]}`;
  if (whiteBalance !== null && Math.round(whiteBalance) === 0) return "WB AUTO";
  if (whiteBalance !== null && Math.round(whiteBalance) === 1) return "WB MANUAL";
  return null;
}

function readTextFile(file) {
  if (file.text) return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsText(file, "utf-8");
  });
}

async function handleLut(file) {
  if (!file) return;
  try {
    const content = await readTextFile(file);
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
      await renderImage(asset, canvas, safeRenderEdge(Number(els.maxEdge.value)), true);
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
    els.lutIntensity, els.watermarkEnabled, els.watermarkTitle, els.watermarkSubtitle,
    els.fontSize, els.watermarkOpacity, els.photoThemeEnabled, els.textColor, els.frameColor,
    els.maxEdge, els.jpegQuality
  ].forEach((input) => {
    input.addEventListener("input", renderPreview);
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

requestAnimationFrame(() => {
  try {
    setup();
  } catch (error) {
    setLog(`初始化失败：${error.message}`);
  }
});
