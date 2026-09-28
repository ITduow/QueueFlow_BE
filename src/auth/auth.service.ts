import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { SignOptions } from 'jsonwebtoken';
import { PasswordService } from './password.service';
import { AccessTokenPayload, RefreshTokenPayload } from './interfaces/jwt-payload.interface';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthUser, PublicUser, UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';

interface RequestMetadata {
  userAgent: string | null;
  ipAddress: string | null;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    const email = this.normalizeEmail(dto.email);
    const passwordHash = await this.passwordService.hash(dto.password);
    try {
      return await this.usersService.createCustomer({
        email,
        passwordHash,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim(),
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'AUTH_EMAIL_ALREADY_EXISTS',
          message: 'An account with this email already exists.',
        });
      }
      throw error;
    }
  }

  async login(
    dto: LoginDto,
    metadata: RequestMetadata,
  ): Promise<{ accessToken: string; user: PublicUser; refreshToken: string }> {
    const user = await this.usersService.findByEmail(this.normalizeEmail(dto.email));
    if (
      !user?.passwordHash ||
      !(await this.passwordService.verify(user.passwordHash, dto.password))
    ) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }
    if (!user.isActive) {
      throw new ForbiddenException({ code: 'AUTH_USER_DISABLED', message: 'User is disabled.' });
    }

    const tokens = await this.issueTokenPair(user, metadata);
    return {
      accessToken: tokens.accessToken,
      user: this.toPublicUser(user),
      refreshToken: tokens.refreshToken,
    };
  }

  async refresh(
    rawToken: string | undefined,
    metadata: RequestMetadata,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    if (!rawToken) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_TOKEN_MISSING',
        message: 'Refresh token is required.',
      });
    }

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch (error: unknown) {
      const code =
        error instanceof Error && error.name === 'TokenExpiredError'
          ? 'AUTH_REFRESH_TOKEN_EXPIRED'
          : 'AUTH_REFRESH_TOKEN_INVALID';
      throw new UnauthorizedException({ code, message: 'Refresh token is invalid.' });
    }

    const stored = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!stored || stored.userId !== payload.sub) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_TOKEN_INVALID',
        message: 'Refresh token is invalid.',
      });
    }
    if (stored.revokedAt) {
      await this.revokeAllSessions(stored.userId);
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_TOKEN_REUSED',
        message: 'Refresh token has already been used.',
      });
    }
    if (stored.expiresAt <= new Date()) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_TOKEN_EXPIRED',
        message: 'Refresh token is expired.',
      });
    }
    if (!(await this.passwordService.verify(stored.tokenHash, rawToken))) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_TOKEN_INVALID',
        message: 'Refresh token is invalid.',
      });
    }

    const user = await this.usersService.findAuthById(stored.userId);
    if (!user || !user.isActive) {
      throw new ForbiddenException({ code: 'AUTH_USER_DISABLED', message: 'User is disabled.' });
    }

    const next = await this.prepareTokenPair(user, metadata);
    const replaced = await this.prisma.$transaction(async (transaction) => {
      const update = await transaction.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (update.count !== 1) return false;
      await transaction.refreshToken.create({ data: next.refreshRecord });
      return true;
    });
    if (!replaced) {
      await this.revokeAllSessions(stored.userId);
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_TOKEN_REUSED',
        message: 'Refresh token has already been used.',
      });
    }
    return { accessToken: next.accessToken, refreshToken: next.refreshToken };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        ignoreExpiration: true,
      });
      await this.prisma.refreshToken.updateMany({
        where: { id: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Logout is intentionally idempotent for missing, malformed, or expired cookies.
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.revokeAllSessions(userId);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        code: 'AUTH_UNAUTHORIZED',
        message: 'User is not available.',
      });
    }
    return user;
  }

  private async issueTokenPair(user: AuthUser, metadata: RequestMetadata): Promise<TokenPair> {
    const pair = await this.prepareTokenPair(user, metadata);
    await this.prisma.refreshToken.create({ data: pair.refreshRecord });
    return { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
  }

  private async prepareTokenPair(
    user: AuthUser,
    metadata: RequestMetadata,
  ): Promise<TokenPair & { refreshRecord: Prisma.RefreshTokenCreateInput }> {
    const refreshId = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, jti: refreshId } satisfies RefreshTokenPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow<string>(
          'JWT_REFRESH_EXPIRES_IN',
        ) as SignOptions['expiresIn'],
      },
    );
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role } satisfies AccessTokenPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow<string>(
          'JWT_ACCESS_EXPIRES_IN',
        ) as SignOptions['expiresIn'],
      },
    );
    const expiresAt = new Date(
      Date.now() +
        this.durationToMilliseconds(this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN')),
    );
    return {
      accessToken,
      refreshToken,
      refreshRecord: {
        id: refreshId,
        user: { connect: { id: user.id } },
        tokenHash: await this.passwordService.hash(refreshToken),
        expiresAt,
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
      },
    };
  }

  private revokeAllSessions(userId: string): Promise<{ count: number }> {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private toPublicUser(user: AuthUser): PublicUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private durationToMilliseconds(duration: string): number {
    const match = /^(\d+)([smhdw])$/.exec(duration);
    if (!match) throw new Error('Invalid token duration configuration');
    const units: Record<string, number> = {
      s: 1000,
      m: 60000,
      h: 3600000,
      d: 86400000,
      w: 604800000,
    };
    return Number(match[1]) * units[match[2]];
  }
}
