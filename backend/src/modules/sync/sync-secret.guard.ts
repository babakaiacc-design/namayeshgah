import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Protects the internal sync endpoint.
 *
 * A shared secret rather than a user token, because the caller is the scheduled
 * GitHub Actions job, not a person. The comparison is timing safe: a naive
 * string compare leaks the secret one character at a time to anyone who can
 * measure response latency, and this endpoint triggers outbound crawling.
 */
@Injectable()
export class SyncSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('sync.secret') ?? '';

    // Refuse rather than accept everything when the secret was never set.
    if (!expected) {
      throw new UnauthorizedException('sync secret is not configured on this server');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-sync-secret'];
    const supplied = Array.isArray(provided) ? provided[0] : provided;

    if (!supplied || !safeEquals(supplied, expected)) {
      throw new UnauthorizedException('invalid sync secret');
    }

    return true;
  }
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal, so lengths are compared after a constant-time pass over
  // equal-length buffers.
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }

  return timingSafeEqual(left, right);
}
