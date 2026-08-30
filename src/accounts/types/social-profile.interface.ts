export interface SocialProfile {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
}
