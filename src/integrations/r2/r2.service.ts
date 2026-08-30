import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

// R2 is S3-compatible — same AWS SDK v3 client as real S3, just a
// different endpoint (plan.md Section 3). Objects are never public;
// every read goes through a short-lived signed URL (Section 7).
@Injectable()
export class R2Service {
  private readonly client?: S3Client;
  private readonly bucket?: string;

  constructor(config: ConfigService) {
    const accountId = config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY');
    this.bucket = config.get<string>('R2_BUCKET_NAME') || undefined;

    if (accountId && accessKeyId && secretAccessKey && this.bucket) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  get isConfigured(): boolean {
    return !!this.client && !!this.bucket;
  }

  async uploadObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException('Object storage is not configured');
    }
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getSignedReadUrl(
    key: string,
    expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS,
  ): Promise<string> {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException('Object storage is not configured');
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
