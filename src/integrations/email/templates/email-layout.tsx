import { Body, Container, Head, Hr, Html, Preview, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import { brand } from './brand';

interface EmailLayoutProps {
  previewText: string;
  children: ReactNode;
}

// Shared chrome (wordmark header, footer) every account email wraps its
// content in — keeps every template visually consistent without repeating
// the boilerplate.
export function EmailLayout({ previewText, children }: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body
        style={{
          backgroundColor: brand.backgroundColor,
          fontFamily: brand.fontFamily,
          margin: 0,
          padding: '32px 0',
        }}
      >
        <Container
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 8,
            padding: '32px 40px',
            maxWidth: 480,
            border: `1px solid ${brand.borderColor}`,
          }}
        >
          <Text
            style={{ fontSize: 20, fontWeight: 700, color: brand.primaryColor, margin: '0 0 24px' }}
          >
            {brand.name}
          </Text>
          {children}
          <Hr style={{ borderColor: brand.borderColor, margin: '32px 0 16px' }} />
          <Text style={{ fontSize: 12, color: brand.mutedColor, margin: 0 }}>
            {brand.name} — mobility, logistics &amp; energy. You&apos;re receiving this because
            it&apos;s tied to an action on your {brand.name} account.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
