const EARTH_RADIUS_KM = 6371;
// Straight-line distance always underestimates actual road distance —
// this multiplier is a common rough heuristic, not a real routing engine.
const ROAD_DISTANCE_FACTOR = 1.3;
const ASSUMED_AVERAGE_SPEED_KMH = 30;

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// Approximate fallback for when the Distance Matrix API isn't configured or
// fails — plan.md Section 11: "fall back to a cached/approximate estimate
// rather than failing the whole booking flow." Shared by RidesService and
// LogisticsService (multi-leg summation for multi-stop deliveries).
export function approximateRoadDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): { distanceKm: number; durationMinutes: number } {
  const straightLineKm = haversineDistanceKm(lat1, lng1, lat2, lng2);
  const distanceKm = straightLineKm * ROAD_DISTANCE_FACTOR;
  const durationMinutes = Math.ceil((distanceKm / ASSUMED_AVERAGE_SPEED_KMH) * 60);
  return { distanceKm, durationMinutes };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
