/**
 * Copyright 2020 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as WebCodecs from '../util/web-codecs';

/**
 * Compare two objects, returning a boolean indicating if
 * they have the same properties and strictly equal values.
 */
export function shallowEqual(one: any, two: any) {
  for (const i in one) if (one[i] !== two[i]) return false;
  for (const i in two) if (!(i in one)) return false;
  return true;
}

/** Replace the contents of a canvas with the given data */
export function drawDataToCanvas(canvas: HTMLCanvasElement, data: ImageData) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Canvas not initialized');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(data, 0, 0);
}

/**
 * Encode some image data in a given format using the browser's encoders
 *
 * @param {ImageData} data
 * @param {string} type A mime type, eg image/jpeg.
 * @param {number} [quality] Between 0-1.
 */
export async function canvasEncode(
  data: ImageData,
  type: string,
  quality?: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Canvas not initialized');
  ctx.putImageData(data, 0, 0);

  let blob: Blob | null;

  if ('toBlob' in canvas) {
    blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, type, quality),
    );
  } else {
    // Welcome to Edge.
    // TypeScript thinks `canvas` is 'never', so it needs casting.
    const dataUrl = (canvas as HTMLCanvasElement).toDataURL(type, quality);
    const result = /data:([^;]+);base64,(.*)$/.exec(dataUrl);

    if (!result) throw Error('Data URL reading failed');

    const outputType = result[1];
    const binaryStr = atob(result[2]);
    const data = new Uint8Array(binaryStr.length);

    for (let i = 0; i < data.length; i += 1) {
      data[i] = binaryStr.charCodeAt(i);
    }

    blob = new Blob([data], { type: outputType });
  }

  if (!blob) throw Error('Encoding failed');
  return blob;
}

async function decodeImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(Error('Image loading error'));
  });

  if (img.decode) {
    // Nice off-thread way supported in Safari/Chrome.
    // Safari throws on decode if the source is SVG.
    // https://bugs.webkit.org/show_bug.cgi?id=188347
    await img.decode().catch(() => null);
  }

  // Always await loaded, as we may have bailed due to the Safari bug above.
  await loaded;
  return img;
}

/** Caches results from canDecodeImageType */
const canDecodeCache = new Map<string, Promise<boolean>>();

/**
 * Tests whether the browser supports a particular image mime type.
 *
 * @param type Mimetype
 * @example await canDecodeImageType('image/avif')
 */
export function canDecodeImageType(type: string): Promise<boolean> {
  if (!canDecodeCache.has(type)) {
    const resultPromise = (async () => {
      const picture = document.createElement('picture');
      const img = document.createElement('img');
      const source = document.createElement('source');
      source.srcset = 'data:,x';
      source.type = type;
      picture.append(source, img);

      // Wait a single microtick just for the `img.currentSrc` to get populated.
      await 0;
      // At this point `img.currentSrc` will contain "data:,x" if format is supported and ""
      // otherwise.
      return !!img.currentSrc;
    })();

    canDecodeCache.set(type, resultPromise);
  }

  return canDecodeCache.get(type)!;
}

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Response(blob).arrayBuffer();
}

export function blobToText(blob: Blob): Promise<string> {
  return new Response(blob).text();
}

const magicNumberMapInput = [
  [/^%PDF-/, 'application/pdf'],
  [/^GIF87a/, 'image/gif'],
  [/^GIF89a/, 'image/gif'],
  [/^\x89PNG\x0D\x0A\x1A\x0A/, 'image/png'],
  [/^\xFF\xD8\xFF/, 'image/jpeg'],
  [/^BM/, 'image/bmp'],
  [/^I I/, 'image/tiff'],
  [/^II*/, 'image/tiff'],
  [/^MM\x00*/, 'image/tiff'],
  [/^RIFF....WEBPVP8[LX ]/, 'image/webp'],
  [/^\xF4\xFF\x6F/, 'image/webp2'],
  [/^\x00\x00\x00 ftypavif\x00\x00\x00\x00/, 'image/avif'],
  [/^\xff\x0a/, 'image/jxl'],
  [/^\x00\x00\x00\x0cJXL \x0d\x0a\x87\x0a/, 'image/jxl'],
] as const;

export type ImageMimeTypes = typeof magicNumberMapInput[number][1];

const magicNumberToMimeType = new Map<RegExp, ImageMimeTypes>(
  magicNumberMapInput,
);

export async function sniffMimeType(blob: Blob): Promise<ImageMimeTypes | ''> {
  const firstChunk = await blobToArrayBuffer(blob.slice(0, 16));
  const firstChunkString = Array.from(new Uint8Array(firstChunk))
    .map((v) => String.fromCodePoint(v))
    .join('');
  for (const [detector, mimeType] of magicNumberToMimeType) {
    if (detector.test(firstChunkString)) {
      return mimeType;
    }
  }
  return '';
}

export async function blobToImg(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);

  try {
    return await decodeImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface DrawableToImageDataOptions {
  width?: number;
  height?: number;
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
}

function getWidth(
  drawable: ImageBitmap | HTMLImageElement | VideoFrame,
): number {
  if ('displayWidth' in drawable) {
    return drawable.displayWidth;
  }
  return drawable.width;
}

function getHeight(
  drawable: ImageBitmap | HTMLImageElement | VideoFrame,
): number {
  if ('displayHeight' in drawable) {
    return drawable.displayHeight;
  }
  return drawable.height;
}

export function drawableToImageData(
  drawable: ImageBitmap | HTMLImageElement | VideoFrame,
  opts: DrawableToImageDataOptions = {},
): ImageData {
  const {
    width = getWidth(drawable),
    height = getHeight(drawable),
    sx = 0,
    sy = 0,
    sw = getWidth(drawable),
    sh = getHeight(drawable),
  } = opts;

  // Make canvas same size as image
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // Draw image onto canvas
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');
  ctx.drawImage(drawable, sx, sy, sw, sh, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export async function builtinDecode(
  signal: AbortSignal,
  blob: Blob,
  mimeType: string,
): Promise<ImageData> {
  // If WebCodecs are supported, use that.
  if (await WebCodecs.isTypeSupported(mimeType)) {
    assertSignal(signal);
    try {
      return await abortable(signal, WebCodecs.decode(blob, mimeType));
    } catch (e) {}
  }
  assertSignal(signal);

  // Prefer createImageBitmap as it's the off-thread option for Firefox.
  const drawable = await abortable<HTMLImageElement | ImageBitmap>(
    signal,
    'createImageBitmap' in self ? createImageBitmap(blob) : blobToImg(blob),
  );
  return drawableToImageData(drawable);
}

export type BuiltinResizeMethod = 'pixelated' | 'low' | 'medium' | 'high';

export function builtinResize(
  data: ImageData,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  method: BuiltinResizeMethod,
): ImageData {
  const canvasSource = document.createElement('canvas');
  canvasSource.width = data.width;
  canvasSource.height = data.height;
  drawDataToCanvas(canvasSource, data);

  const canvasDest = document.createElement('canvas');
  canvasDest.width = dw;
  canvasDest.height = dh;
  const ctx = canvasDest.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');

  if (method === 'pixelated') {
    ctx.imageSmoothingEnabled = false;
  } else {
    ctx.imageSmoothingQuality = method;
  }

  ctx.drawImage(canvasSource, sx, sy, sw, sh, 0, 0, dw, dh);
  return ctx.getImageData(0, 0, dw, dh);
}

/**
 * @param field An HTMLInputElement, but the casting is done here to tidy up onChange.
 * @param defaultVal Value to return if 'field' doesn't exist.
 */
export function inputFieldValueAsNumber(
  field: any,
  defaultVal: number = 0,
): number {
  if (!field) return defaultVal;
  return Number(inputFieldValue(field));
}

/**
 * @param field An HTMLInputElement, but the casting is done here to tidy up onChange.
 * @param defaultVal Value to return if 'field' doesn't exist.
 */
export function inputFieldCheckedAsNumber(
  field: any,
  defaultVal: number = 0,
): number {
  if (!field) return defaultVal;
  return Number(inputFieldChecked(field));
}

/**
 * @param field An HTMLInputElement, but the casting is done here to tidy up onChange.
 * @param defaultVal Value to return if 'field' doesn't exist.
 */
export function inputFieldChecked(
  field: any,
  defaultVal: boolean = false,
): boolean {
  if (!field) return defaultVal;
  return (field as HTMLInputElement).checked;
}

/**
 * @param field An HTMLInputElement, but the casting is done here to tidy up onChange.
 * @param defaultVal Value to return if 'field' doesn't exist.
 */
export function inputFieldValue(field: any, defaultVal: string = ''): string {
  if (!field) return defaultVal;
  return (field as HTMLInputElement).value;
}

/**
 * Creates a promise that resolves when the user types the konami code.
 */
export function konami(): Promise<void> {
  return new Promise((resolve) => {
    // Keycodes for: ↑ ↑ ↓ ↓ ← → ← → B A
    const expectedPattern = '38384040373937396665';
    let rollingPattern = '';

    const listener = (event: KeyboardEvent) => {
      rollingPattern += event.keyCode;
      rollingPattern = rollingPattern.slice(-expectedPattern.length);
      if (rollingPattern === expectedPattern) {
        window.removeEventListener('keydown', listener);
        resolve();
      }
    };

    window.addEventListener('keydown', listener);
  });
}

interface TransitionOptions {
  from?: number;
  to?: number;
  duration?: number;
  easing?: string;
}

export async function transitionHeight(
  el: HTMLElement,
  opts: TransitionOptions,
): Promise<void> {
  const {
    from = el.getBoundingClientRect().height,
    to = el.getBoundingClientRect().height,
    duration = 1000,
    easing = 'ease-in-out',
  } = opts;

  if (from === to || duration === 0) {
    el.style.height = to + 'px';
    return;
  }

  el.style.height = from + 'px';
  // Force a style calc so the browser picks up the start value.
  getComputedStyle(el).transform;
  el.style.transition = `height ${duration}ms ${easing}`;
  el.style.height = to + 'px';

  return new Promise<void>((resolve) => {
    const listener = (event: Event) => {
      if (event.target !== el) return;
      el.style.transition = '';
      el.removeEventListener('transitionend', listener);
      el.removeEventListener('transitioncancel', listener);
      resolve();
    };

    el.addEventListener('transitionend', listener);
    el.addEventListener('transitioncancel', listener);
  });
}

/**
 * Simple event listener that prevents the default.
 */
export function preventDefault(event: Event) {
  event.preventDefault();
}

/**
 * Throw an abort error if a signal is aborted.
 */
export function assertSignal(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('AbortError', 'AbortError');
}

/**
 * Take a signal and promise, and returns a promise that rejects with an AbortError if the abort is
 * signalled, otherwise resolves with the promise.
 */
export async function abortable<T>(
  signal: AbortSignal,
  promise: Promise<T>,
): Promise<T> {
  assertSignal(signal);
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      signal.addEventListener('abort', () =>
        reject(new DOMException('AbortError', 'AbortError')),
      );
    }),
  ]);
}

/**
 * Test whether <canvas> can encode to a particular type.
 */
export async function canvasEncodeTest(mimeType: string): Promise<boolean> {
  try {
    const blob = await canvasEncode(new ImageData(1, 1), mimeType);
    // According to the spec, the blob should be null if the format isn't supported…
    if (!blob) return false;
    // …but Safari & Firefox fall back to PNG, so we need to check the mime type.
    return blob.type === mimeType;
  } catch (err) {
    return false;
  }
}
