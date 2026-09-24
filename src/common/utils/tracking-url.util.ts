import { ConfigService } from '@nestjs/config';

// Public share/tracking links (delivery receiver SMS, "Share ride"). The
// web page behind them lives in the frontend app; this just builds the URL.
export function trackingUrl(config: ConfigService, path: string): string {
  const base = (config.get<string>('TRACKING_BASE_URL') ?? 'http://localhost:5173/track').replace(
    /\/$/,
    '',
  );
  return `${base}/${path.replace(/^\//, '')}`;
}
