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

export async function readDepthRaster(file: Blob): Promise<DepthRaster> {
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

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusM = 6371000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isNoDataValue(raster: DepthRaster, value: number): boolean {
  return raster.noData !== null && Math.abs(value - raster.noData) < 0.000001;
}

export type MaxDepthInRadiusResult = {
  depthM: number;
  lat: number;
  lon: number;
};

export function maxDepthInRadiusMeters(
  raster: DepthRaster,
  centerLat: number,
  centerLon: number,
  radiusMeters: number
): MaxDepthInRadiusResult | null {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon =
    Math.max(1, metersPerDegreeLat * Math.cos((centerLat * Math.PI) / 180));

  const latDelta = radiusMeters / metersPerDegreeLat;
  const lonDelta = radiusMeters / metersPerDegreeLon;

  const westBound = centerLon - lonDelta;
  const eastBound = centerLon + lonDelta;
  const southBound = centerLat - latDelta;
  const northBound = centerLat + latDelta;

  const xMin = Math.max(
    0,
    Math.floor(((westBound - raster.west) / (raster.east - raster.west)) * raster.width)
  );

  const xMax = Math.min(
    raster.width - 1,
    Math.ceil(((eastBound - raster.west) / (raster.east - raster.west)) * raster.width)
  );

  const yMin = Math.max(
    0,
    Math.floor(((raster.north - northBound) / (raster.north - raster.south)) * raster.height)
  );

  const yMax = Math.min(
    raster.height - 1,
    Math.ceil(((raster.north - southBound) / (raster.north - raster.south)) * raster.height)
  );

  if (xMin > xMax || yMin > yMax) {
    return null;
  }

  let best: MaxDepthInRadiusResult | null = null;

  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const lon =
        raster.west + ((x + 0.5) / raster.width) * (raster.east - raster.west);

      const lat =
        raster.north - ((y + 0.5) / raster.height) * (raster.north - raster.south);

      if (haversineMeters(centerLat, centerLon, lat, lon) > radiusMeters) {
        continue;
      }

      const index = y * raster.width + x;
      const rawValue = Number(raster.values[index]);

      if (!Number.isFinite(rawValue) || isNoDataValue(raster, rawValue)) {
        continue;
      }

      const depth = Math.abs(rawValue);

      if (best === null || depth > best.depthM) {
        best = {
          depthM: depth,
          lat,
          lon
        };
      }
    }
  }

  return best;
}
