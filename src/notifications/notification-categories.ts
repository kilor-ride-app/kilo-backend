// Categories the mobile app's notification settings toggle ("Trips update",
// "Promotion & offer", "Account updates", "Tips & recommendations",
// "Product updates"). Preferences are stored per (category, channel) and
// default to enabled, so these keys are what PATCH /notifications/preferences
// should send. Older sends elsewhere use their own free-form categories.
export const NotificationCategory = {
  TRIPS: 'TRIPS',
  PROMOTIONS: 'PROMOTIONS',
  ACCOUNT: 'ACCOUNT',
  TIPS: 'TIPS',
  PRODUCT: 'PRODUCT',
} as const;

export type NotificationCategory = (typeof NotificationCategory)[keyof typeof NotificationCategory];
