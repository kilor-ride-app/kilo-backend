import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissionKeys: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissionKeys);
