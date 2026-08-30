import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { JwtPayload } from '../../common/types/jwt-payload.interface';

// Sockets authenticate the same way the JWT_ACCESS_SECRET already gates
// every REST endpoint — reusing the token, not inventing a parallel scheme.
export function authenticateSocket(client: Socket, jwt: JwtService): JwtPayload | null {
  const token =
    (client.handshake.auth?.token as string | undefined) ??
    client.handshake.headers.authorization?.replace(/^Bearer /, '');
  if (!token) {
    return null;
  }
  try {
    return jwt.verify<JwtPayload>(token);
  } catch {
    return null;
  }
}
