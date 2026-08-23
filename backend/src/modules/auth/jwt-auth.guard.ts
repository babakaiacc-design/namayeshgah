import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import { Request } from 'express';

import { AuthService, AuthenticatedUser } from './auth.service';

export const ALLOW_GUEST = 'allowGuest';

/**
 * Marks an endpoint as readable without an account.
 *
 * Section 33: guests browse, search and filter freely; only reminders and
 * favourites need an identity.
 */
export const AllowGuest = () => SetMetadata(ALLOW_GUEST, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowGuest = this.reflector.getAllAndOverride<boolean>(ALLOW_GUEST, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearer(request);

    if (!token) {
      if (allowGuest) return true;
      throw new UnauthorizedException('this endpoint requires an account');
    }

    // A guest endpoint still resolves a supplied token, so a signed-in client
    // gets personalised results without needing a separate route.
    try {
      request.user = await this.authService.verify(token);
    } catch (error) {
      if (allowGuest) return true;
      throw error;
    }

    return true;
  }
}

function extractBearer(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}

/** Injects the authenticated user, or undefined on a guest endpoint. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user,
);
