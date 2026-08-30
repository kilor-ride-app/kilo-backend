import { Button, Text } from '@react-email/components';
import { brand } from './brand';
import { EmailLayout } from './email-layout';

interface StaffInviteEmailProps {
  roles: string[];
  acceptUrl: string;
  expiresInDays: number;
}

export function StaffInviteEmail({ roles, acceptUrl, expiresInDays }: StaffInviteEmailProps) {
  const roleText = roles.length > 0 ? roles.join(', ') : 'staff';
  return (
    <EmailLayout previewText={`You've been invited to join the ${brand.name} admin team`}>
      <Text style={{ fontSize: 16, color: brand.textColor, margin: '0 0 20px' }}>
        You&apos;ve been invited to join the {brand.name} admin team as: <strong>{roleText}</strong>
        .
      </Text>
      <Button
        href={acceptUrl}
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
        Accept invite
      </Button>
      <Text style={{ fontSize: 14, color: brand.mutedColor, margin: '24px 0 0' }}>
        This link expires in {expiresInDays} days. If you weren&apos;t expecting this invite, you
        can ignore this email.
      </Text>
    </EmailLayout>
  );
}
