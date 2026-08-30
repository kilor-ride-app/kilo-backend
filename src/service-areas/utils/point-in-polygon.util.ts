// Standard ray-casting algorithm. Outer ring only — holes aren't a
// requirement for MVP service-area polygons. Coordinates are GeoJSON order:
// [lng, lat], not [lat, lng].
export function isPointInPolygon(point: [number, number], ringCoordinates: number[][][]): boolean {
  const [lng, lat] = point;
  const ring = ringCoordinates[0];
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}
