import { Section, Text } from '@react-email/components';
import { brand } from './brand';
import { EmailLayout } from './email-layout';

interface PasswordResetCodeEmailProps {
  code: string;
  expiresInMinutes: number;
}

export function PasswordResetCodeEmail({ code, expiresInMinutes }: PasswordResetCodeEmailProps) {
  return (
    <EmailLayout previewText={`Your ${brand.name} password reset code is ${code}`}>
      <Text style={{ fontSize: 16, color: brand.textColor, margin: '0 0 16px' }}>
        We received a request to reset your {brand.name} password. Use the code below to continue.
      </Text>
      <Section
        style={{
          backgroundColor: brand.backgroundColor,
          borderRadius: 8,
          padding: '20px 0',
          textAlign: 'center',
          margin: '0 0 16px',
        }}
      >
        <Text
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: 8,
            color: brand.primaryColor,
            margin: 0,
          }}
        >
          {code}
        </Text>
      </Section>
      <Text style={{ fontSize: 14, color: brand.mutedColor, margin: 0 }}>
        This code expires in {expiresInMinutes} minutes. If you didn&apos;t request a password reset,
        you can safely ignore this email — your password won&apos;t change.
      </Text>
    </EmailLayout>
  );
}
