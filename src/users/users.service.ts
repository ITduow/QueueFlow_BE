import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PasswordHasher } from './types/password-hasher.interface';

export const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

const authUserSelect = { ...publicUserSelect, passwordHash: true } satisfies Prisma.UserSelect;
export type AuthUser = Prisma.UserGetPayload<{ select: typeof authUserSelect }>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({ where: { email }, select: authUserSelect });
  }

  findById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  }

  async getProfile(id: string): Promise<PublicUser> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    return user;
  }

  rejectEmptyProfileUpdate(): never {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'At least one profile field is required.',
    });
  }

  findAuthById(id: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({ where: { id }, select: authUserSelect });
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<PublicUser> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
          ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl || null } : {}),
        },
        select: publicUserSelect,
      });
    } catch (error: unknown) {
      if (this.isNotFound(error))
        throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
      throw error;
    }
  }

  async changePassword(
    id: string,
    dto: ChangePasswordDto,
    passwordHasher: PasswordHasher,
  ): Promise<void> {
    const user = await this.findAuthById(id);
    if (!user)
      throw new UnauthorizedException({
        code: 'AUTH_UNAUTHORIZED',
        message: 'User is not available.',
      });
    if (!user.passwordHash) {
      throw new BadRequestException({
        code: 'USER_PASSWORD_NOT_CONFIGURED',
        message: 'Password is not configured.',
      });
    }
    if (!(await passwordHasher.verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException({
        code: 'USER_CURRENT_PASSWORD_INVALID',
        message: 'Current password is invalid.',
      });
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException({
        code: 'USER_NEW_PASSWORD_SAME_AS_CURRENT',
        message: 'New password must differ from the current password.',
      });
    }
    const passwordHash = await passwordHasher.hash(dto.newPassword);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({ where: { id }, data: { passwordHash } });
      await transaction.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async listUsersForAdmin(query: ListUsersQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search.trim(), mode: 'insensitive' } },
              { fullName: { contains: query.search.trim(), mode: 'insensitive' } },
              { phone: { contains: query.search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: publicUserSelect,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getUserForAdmin(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...publicUserSelect,
        _count: { select: { ownedBusinesses: true, memberships: true, appointments: true } },
      },
    });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    return user;
  }

  async setUserActiveStatus(
    targetId: string,
    isActive: boolean,
    adminId: string,
  ): Promise<PublicUser> {
    if (targetId === adminId && !isActive) {
      throw new BadRequestException({
        code: 'USER_CANNOT_DISABLE_SELF',
        message: 'You cannot disable your own account.',
      });
    }
    return this.prisma.$transaction(async (transaction) => {
      const target = await transaction.user.findUnique({
        where: { id: targetId },
        select: { ...publicUserSelect },
      });
      if (!target)
        throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
      if (!isActive && target.role === UserRole.ADMIN && target.isActive) {
        const activeAdmins = await transaction.user.count({
          where: { role: UserRole.ADMIN, isActive: true },
        });
        if (activeAdmins <= 1) {
          throw new ConflictException({
            code: 'USER_LAST_ADMIN_CANNOT_BE_DISABLED',
            message: 'The last active admin cannot be disabled.',
          });
        }
      }
      const updated = await transaction.user.update({
        where: { id: targetId },
        data: { isActive },
        select: publicUserSelect,
      });
      if (!isActive) {
        await transaction.refreshToken.updateMany({
          where: { userId: targetId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return updated;
    });
  }

  createCustomer(data: {
    email: string;
    passwordHash: string;
    fullName: string;
    phone?: string;
  }): Promise<PublicUser> {
    return this.prisma.user.create({
      data: { ...data, role: UserRole.CUSTOMER },
      select: publicUserSelect,
    });
  }

  private isNotFound(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
  }
}
