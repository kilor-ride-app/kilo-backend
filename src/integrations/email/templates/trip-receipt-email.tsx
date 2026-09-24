import { Column, Row, Section, Text } from '@react-email/components';
import { brand } from './brand';
import { EmailLayout } from './email-layout';

export interface TripReceiptLine {
  label: string;
  value: string;
  emphasis?: boolean;
}

interface TripReceiptEmailProps {
  riderFirstName: string;
  reference: string; // ride publicId, e.g. TRP-7K3M9QX2
  pickupAddress: string;
  dropoffAddress: string;
  completedAt: string;
  lines: TripReceiptLine[]; // fare breakdown, already formatted
}

export function TripReceiptEmail({
  riderFirstName,
  reference,
  pickupAddress,
  dropoffAddress,
  completedAt,
  lines,
}: TripReceiptEmailProps) {
  const total = lines.find((l) => l.emphasis);
  return (
    <EmailLayout previewText={`Your ${brand.name} trip receipt${total ? ` — ${total.value}` : ''}`}>
      <Text style={{ fontSize: 16, color: brand.textColor, margin: '0 0 8px' }}>
        Thanks for riding with {brand.name}, {riderFirstName}.
      </Text>
      <Text style={{ fontSize: 14, color: brand.mutedColor, margin: '0 0 16px' }}>
        {completedAt} · Ref {reference}
      </Text>
      <Text style={{ fontSize: 14, color: brand.textColor, margin: '0 0 4px' }}>
        From: {pickupAddress}
      </Text>
      <Text style={{ fontSize: 14, color: brand.textColor, margin: '0 0 16px' }}>
        To: {dropoffAddress}
      </Text>
      <Section
        style={{
          backgroundColor: brand.backgroundColor,
          borderRadius: 8,
          padding: '12px 16px',
          margin: '0 0 16px',
        }}
      >
        {lines.map((line) => (
          <Row key={line.label}>
            <Column>
              <Text
                style={{
                  fontSize: 14,
                  color: brand.textColor,
                  fontWeight: line.emphasis ? 700 : 400,
                  margin: '4px 0',
                }}
              >
                {line.label}
              </Text>
            </Column>
            <Column align="right">
              <Text
                style={{
                  fontSize: 14,
                  color: brand.textColor,
                  fontWeight: line.emphasis ? 700 : 400,
                  margin: '4px 0',
                }}
              >
                {line.value}
              </Text>
            </Column>
          </Row>
        ))}
      </Section>
      <Text style={{ fontSize: 13, color: brand.mutedColor, margin: 0 }}>
        Something wrong with this trip? Reply from Help &amp; Support in the app and quote the
        reference above.
      </Text>
    </EmailLayout>
  );
}
