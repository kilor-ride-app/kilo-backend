import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';
const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export interface ResolvedPlace {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
}

export interface PlaceSuggestion {
  description: string;
  placeId: string;
}

export interface DistanceResult {
  distanceKm: number;
  durationMinutes: number;
}

@Injectable()
export class GoogleMapsService {
  private readonly apiKey?: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GOOGLE_MAPS_API_KEY') || undefined;
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  // `near` biases (doesn't restrict) results toward the user's position.
  async autocomplete(
    query: string,
    near?: { lat: number; lng: number },
  ): Promise<PlaceSuggestion[]> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Address autocomplete is not configured');
    }

    const bias = near ? `&location=${near.lat},${near.lng}&radius=50000` : '';
    const url = `${PLACES_BASE}/autocomplete/json?input=${encodeURIComponent(query)}${bias}&key=${this.apiKey}`;
    const response = await fetch(url);
    const json = await response.json();
    if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
      throw new BadGatewayException(`Google Places request failed: ${json.status}`);
    }

    return (json.predictions ?? []).map((p: { description: string; place_id: string }) => ({
      description: p.description,
      placeId: p.place_id,
    }));
  }

  // A picked autocomplete suggestion → coordinates, which booking needs.
  async placeDetails(placeId: string): Promise<ResolvedPlace> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Place lookup is not configured');
    }
    const url =
      `${PLACES_BASE}/details/json?place_id=${encodeURIComponent(placeId)}` +
      `&fields=place_id,formatted_address,geometry&key=${this.apiKey}`;
    const json = await (await fetch(url)).json();
    if (json.status !== 'OK' || !json.result?.geometry) {
      throw new BadGatewayException(`Google Place Details request failed: ${json.status}`);
    }
    return {
      placeId: json.result.place_id,
      address: json.result.formatted_address,
      lat: json.result.geometry.location.lat,
      lng: json.result.geometry.location.lng,
    };
  }

  // "Use current location": GPS coordinates → a human-readable address.
  // null when Google has nothing for that point.
  async reverseGeocode(lat: number, lng: number): Promise<ResolvedPlace | null> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Reverse geocoding is not configured');
    }
    const url = `${GEOCODE_URL}?latlng=${lat},${lng}&key=${this.apiKey}`;
    const json = await (await fetch(url)).json();
    if (json.status === 'ZERO_RESULTS') {
      return null;
    }
    const top = json.results?.[0];
    if (json.status !== 'OK' || !top) {
      throw new BadGatewayException(`Google Geocoding request failed: ${json.status}`);
    }
    return { placeId: top.place_id, address: top.formatted_address, lat, lng };
  }

  // Throws on failure (including "not configured") — callers that have a
  // reasonable fallback (fare estimation) catch this and degrade; callers
  // that don't (this has no other caller yet) should let it surface.
  async distanceMatrix(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
  ): Promise<DistanceResult> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Distance Matrix is not configured');
    }

    const url =
      `${DISTANCE_MATRIX_URL}?origins=${originLat},${originLng}&destinations=${destLat},${destLng}` +
      `&key=${this.apiKey}`;
    const response = await fetch(url);
    const json = await response.json();
    const element = json.rows?.[0]?.elements?.[0];
    if (json.status !== 'OK' || !element || element.status !== 'OK') {
      throw new BadGatewayException(
        `Google Distance Matrix request failed: ${element?.status ?? json.status}`,
      );
    }

    return {
      distanceKm: element.distance.value / 1000,
      durationMinutes: Math.ceil(element.duration.value / 60),
    };
  }
}
