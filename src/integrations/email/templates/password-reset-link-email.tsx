import { Button, Text } from '@react-email/components';
import { accent, brand } from './brand';
import { EmailLayout } from './email-layout';

interface PasswordResetLinkEmailProps {
  resetUrl: string;
  expiresInMinutes: number;
}

export function PasswordResetLinkEmail({ resetUrl, expiresInMinutes }: PasswordResetLinkEmailProps) {
  return (
    <EmailLayout previewText={`Reset your ${brand.name} password`}>
      <Text style={{ fontSize: 16, color: brand.textColor, margin: '0 0 20px' }}>
        We received a request to reset your {brand.name} password. Click below to choose a new one.
      </Text>
      <Button
        href={resetUrl}
        style={{
          backgroundColor: accent.red,
          color: '#FFFFFF',
          borderRadius: 6,
          padding: '12px 24px',
          fontSize: 14,
          fontWeight: 600,
          textDecoration: 'none',
          display: 'inline-block',
        }}
      >
        Reset password
      </Button>
      <Text style={{ fontSize: 14, color: brand.mutedColor, margin: '24px 0 0' }}>
        This link expires in {expiresInMinutes} minutes. If you didn&apos;t request a password
        reset, you can safely ignore this email — your password won&apos;t change.
      </Text>
    </EmailLayout>
  );
}
