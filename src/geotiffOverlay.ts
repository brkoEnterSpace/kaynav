import { fromArrayBuffer } from 'geotiff';

export type GeoTiffOverlay = {
  imageUrl: string;
  bounds: [[number, number], [number, number]];
  width: number;
  height: number;
};

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function getScaleFactor(values: ArrayLike<number>): number {
  let max = 0;

  const step = Math.max(1, Math.floor(values.length / 50000));

  for (let i = 0; i < values.length; i += step) {
    const value = Number(values[i]);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }

  if (max <= 255) return 1;
  return 255 / max;
}

function findSingleBandMinMax(values: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;

  const step = Math.max(1, Math.floor(values.length / 100000));

  for (let i = 0; i < values.length; i += step) {
    const value = Number(values[i]);

    if (!Number.isFinite(value)) continue;

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return { min: 0, max: 255 };
  }

  return { min, max };
}

function validateWgs84Bounds(bbox: number[]): void {
  const [west, south, east, north] = bbox;

  const looksLikeLonLat =
    west >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    west < east &&
    south < north;

  if (!looksLikeLonLat) {
    throw new Error(
      'GeoTIFF bounds do not look like EPSG:4326 lon/lat. Export the overlay GeoTIFF from QGIS as EPSG:4326 / WGS 84.'
    );
  }
}

export async function readGeoTiffAsImageOverlay(file: Blob): Promise<GeoTiffOverlay> {
  const buffer = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox();

  validateWgs84Bounds(bbox);

  const [west, south, east, north] = bbox;

  const samplesPerPixel = image.getSamplesPerPixel();
  const raster = (await image.readRasters({ interleave: true })) as ArrayLike<number>;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not create canvas context.');
  }

  const imageData = ctx.createImageData(width, height);
  const output = imageData.data;
  const pixelCount = width * height;

  if (samplesPerPixel === 1) {
    const { min, max } = findSingleBandMinMax(raster);
    const range = max - min || 1;

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
      const value = Number(raster[pixelIndex]);
      const gray = clampByte(((value - min) / range) * 255);

      const outIndex = pixelIndex * 4;
      output[outIndex] = gray;
      output[outIndex + 1] = gray;
      output[outIndex + 2] = gray;
      output[outIndex + 3] = 255;
    }
  } else {
    const scale = getScaleFactor(raster);

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
      const inIndex = pixelIndex * samplesPerPixel;
      const outIndex = pixelIndex * 4;

      output[outIndex] = clampByte(Number(raster[inIndex]) * scale);
      output[outIndex + 1] = clampByte(Number(raster[inIndex + 1]) * scale);
      output[outIndex + 2] = clampByte(Number(raster[inIndex + 2]) * scale);

      if (samplesPerPixel >= 4) {
        output[outIndex + 3] = clampByte(Number(raster[inIndex + 3]) * scale);
      } else {
        output[outIndex + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return {
    imageUrl: canvas.toDataURL('image/png'),
    bounds: [
      [south, west],
      [north, east]
    ],
    width,
    height
  };
}