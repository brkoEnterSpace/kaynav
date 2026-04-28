import { fromArrayBuffer } from 'geotiff';

export type DepthRaster = {
  width: number;
  height: number;
  west: number;
  south: number;
  east: number;
  north: number;
  values: ArrayLike<number>;
  noData: number | null;
};

function isLonLatBounds(bbox: number[]): boolean {
  const [west, south, east, north] = bbox;

  return (
    west >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    west < east &&
    south < north
  );
}

function readNoDataValue(image: unknown): number | null {
  const maybeImage = image as {
    getGDALNoData?: () => number | string | null | undefined;
  };

  const rawNoData = maybeImage.getGDALNoData?.();

  if (rawNoData === null || rawNoData === undefined || rawNoData === '') {
    return null;
  }

  const numericNoData = Number(rawNoData);

  return Number.isFinite(numericNoData) ? numericNoData : null;
}

export async function readDepthRaster(file: File): Promise<DepthRaster> {
  const buffer = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox();

  if (!isLonLatBounds(bbox)) {
    throw new Error(
      'Depth GeoTIFF must be exported as EPSG:4326 / WGS 84 for this version.'
    );
  }

  const [west, south, east, north] = bbox;

  const values = (await image.readRasters({
    samples: [0],
    interleave: true
  })) as unknown as ArrayLike<number>;

  return {
    width,
    height,
    west,
    south,
    east,
    north,
    values,
    noData: readNoDataValue(image)
  };
}

export function sampleDepthMeters(
  raster: DepthRaster,
  lat: number,
  lon: number
): number | null {
  if (
    lon < raster.west ||
    lon > raster.east ||
    lat < raster.south ||
    lat > raster.north
  ) {
    return null;
  }

  const xRatio = (lon - raster.west) / (raster.east - raster.west);
  const yRatio = (raster.north - lat) / (raster.north - raster.south);

  const x = Math.floor(xRatio * raster.width);
  const y = Math.floor(yRatio * raster.height);

  if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) {
    return null;
  }

  const index = y * raster.width + x;
  const value = Number(raster.values[index]);

  if (!Number.isFinite(value)) {
    return null;
  }

  if (raster.noData !== null && Math.abs(value - raster.noData) < 0.000001) {
    return null;
  }

  return Math.abs(value);
}