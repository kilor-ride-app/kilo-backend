import { Section, Text } from '@react-email/components';
import { brand } from './brand';
import { EmailLayout } from './email-layout';

interface VerificationCodeEmailProps {
  code: string;
  expiresInMinutes: number;
}

export function VerificationCodeEmail({ code, expiresInMinutes }: VerificationCodeEmailProps) {
  return (
    <EmailLayout previewText={`Your ${brand.name} verification code is ${code}`}>
      <Text style={{ fontSize: 16, color: brand.textColor, margin: '0 0 16px' }}>
        Use the code below to verify your email address.
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
        This code expires in {expiresInMinutes} minutes. If you didn&apos;t request this, you can
        safely ignore this email.
      </Text>
    </EmailLayout>
  );
}
