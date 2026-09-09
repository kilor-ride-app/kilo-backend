// Deliberately tiny UA sniffer — enough to label a session row in the
// "active devices" list ("Chrome on Windows", "Safari on iPhone"). Not a
// full UA-parsing library; we don't ship one just for this.

export interface DeviceDescription {
  deviceLabel: string;
  browser: string;
  os: string;
  deviceType: 'DESKTOP' | 'MOBILE' | 'TABLET' | 'UNKNOWN';
}

export function describeUserAgent(ua?: string | null): DeviceDescription {
  if (!ua) {
    return {
      deviceLabel: 'Unknown device',
      browser: 'Unknown',
      os: 'Unknown',
      deviceType: 'UNKNOWN',
    };
  }

  const os = /Windows NT/i.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Android/i.test(ua)
        ? 'Android'
        : /Mac OS X/i.test(ua)
          ? 'macOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Unknown';

  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/i.test(ua)
      ? 'Opera'
      : /Chrome\//i.test(ua) && !/Chromium/i.test(ua)
        ? 'Chrome'
        : /Firefox\//i.test(ua)
          ? 'Firefox'
          : /Version\/.*Safari/i.test(ua)
            ? 'Safari'
            : /okhttp|Dart|Flutter|KiloApp/i.test(ua)
              ? 'Kilo mobile app'
              : 'Unknown';

  const deviceType: DeviceDescription['deviceType'] = /iPad|Tablet/i.test(ua)
    ? 'TABLET'
    : /Mobi|iPhone|Android.*Mobile/i.test(ua)
      ? 'MOBILE'
      : os === 'Windows' || os === 'macOS' || os === 'Linux'
        ? 'DESKTOP'
        : 'UNKNOWN';

  return { deviceLabel: `${browser} on ${os}`, browser, os, deviceType };
}
