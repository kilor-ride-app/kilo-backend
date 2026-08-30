import { Button, Text } from '@react-email/components';
import { brand } from './brand';
import { EmailLayout } from './email-layout';

interface GuarantorInviteEmailProps {
  driverName: string;
  submitUrl: string;
  expiresInDays: number;
}

export function GuarantorInviteEmail({
  driverName,
  submitUrl,
  expiresInDays,
}: GuarantorInviteEmailProps) {
  return (
    <EmailLayout previewText={`${driverName} has listed you as a guarantor on ${brand.name}`}>
      <Text style={{ fontSize: 16, color: brand.textColor, margin: '0 0 20px' }}>
        <strong>{driverName}</strong> has listed you as their guarantor on {brand.name}. To confirm,
        please fill in your details and upload a form of identification.
      </Text>
      <Button
        href={submitUrl}
        style={{
          backgroundColor: brand.primaryColor,
          color: '#FFFFFF',
          borderRadius: 6,
          padding: '12px 24px',
          fontSize: 14,
          fontWeight: 600,
          textDecoration: 'none',
          display: 'inline-block',
        }}
      >
        Complete guarantor form
      </Button>
      <Text style={{ fontSize: 14, color: brand.mutedColor, margin: '24px 0 0' }}>
        This link expires in {expiresInDays} days. If you weren&apos;t expecting this, you can
        ignore this email.
      </Text>
    </EmailLayout>
  );
}
