import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';
const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

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

  async autocomplete(query: string): Promise<PlaceSuggestion[]> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Address autocomplete is not configured');
    }

    const url = `${PLACES_BASE}/autocomplete/json?input=${encodeURIComponent(query)}&key=${this.apiKey}`;
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
