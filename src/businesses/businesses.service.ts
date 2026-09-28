import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, BusinessStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AddBusinessMemberDto } from './dto/add-business-member.dto';
import { CreateBusinessDto } from './dto/create-business.dto';
import { ListBusinessesQueryDto } from './dto/list-businesses-query.dto';
import { UpdateBusinessMemberDto } from './dto/update-business-member.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { RedisCacheService } from '../redis/redis-cache.service';
import { RedisKeyFactory } from '../redis/redis-key.factory';
import { BusinessAccess, BusinessMemberRole } from './types/business-access.type';

export const businessSelect = {
  id: true,
  ownerId: true,
  name: true,
  slug: true,
  description: true,
  phone: true,
  email: true,
  address: true,
  city: true,
  latitude: true,
  longitude: true,
  logoUrl: true,
  coverUrl: true,
  timezone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BusinessSelect;

const memberSelect = {
  id: true,
  businessId: true,
  userId: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      avatarUrl: true,
      role: true,
      isActive: true,
    },
  },
} satisfies Prisma.BusinessMemberSelect;

@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache?: RedisCacheService,
  ) {}

  async create(ownerId: string, dto: CreateBusinessDto) {
    const slug = this.slugify(dto.slug ?? dto.name);
    try {
      return await this.prisma.business.create({
        data: {
          ownerId,
          name: dto.name.trim(),
          slug,
          description: dto.description?.trim(),
          phone: dto.phone?.trim(),
          email: dto.email?.trim().toLowerCase(),
          address: dto.address?.trim(),
          city: dto.city?.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
          logoUrl: dto.logoUrl,
          timezone: dto.timezone ?? 'Asia/Ho_Chi_Minh',
          status: BusinessStatus.PENDING,
        },
        select: businessSelect,
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'BUSINESS_SLUG_ALREADY_EXISTS',
          message: 'Business slug already exists.',
        });
      }
      throw error;
    }
  }

  async listPublic(query: ListBusinessesQueryDto) {
    if (query.status !== undefined && query.status !== BusinessStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'BUSINESS_STATUS_NOT_PUBLIC',
        message: 'Only active businesses are publicly visible.',
      });
    }
    const where: Prisma.BusinessWhereInput = {
      status: BusinessStatus.ACTIVE,
      ...(query.city ? { city: { equals: query.city.trim(), mode: 'insensitive' } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search.trim(), mode: 'insensitive' } },
              { description: { contains: query.search.trim(), mode: 'insensitive' } },
              { city: { contains: query.search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.business.findMany({
        where,
        select: businessSelect,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.business.count({ where }),
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

  async getPublicBySlug(slug: string) {
    const cacheKey = RedisKeyFactory.businessBySlug(slug);
    const cached =
      await this.cache?.get<Prisma.BusinessGetPayload<{ select: typeof businessSelect }>>(cacheKey);
    if (cached) return cached;
    const business = await this.prisma.business.findFirst({
      where: { slug, status: BusinessStatus.ACTIVE },
      select: businessSelect,
    });
    if (!business)
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    await this.cache?.set(cacheKey, business);
    return business;
  }

  async update(id: string, actor: AuthenticatedUser, dto: UpdateBusinessDto) {
    const previous = await this.prisma.business.findUnique({
      where: { id },
      select: { slug: true },
    });
    if (!previous)
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    const access = await this.getAccess(id, actor);
    this.assertCanManage(access);
    if (Object.keys(dto).length === 0)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'At least one business field is required.',
      });
    if (dto.status !== undefined && !access.isAdmin) {
      throw new ForbiddenException({
        code: 'BUSINESS_ACCESS_DENIED',
        message: 'Only an admin can change business status.',
      });
    }
    try {
      const updated = await this.prisma.business.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.slug !== undefined ? { slug: this.slugify(dto.slug) } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone?.trim() } : {}),
          ...(dto.email !== undefined ? { email: dto.email?.trim().toLowerCase() } : {}),
          ...(dto.address !== undefined ? { address: dto.address?.trim() } : {}),
          ...(dto.city !== undefined ? { city: dto.city?.trim() } : {}),
          ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
          ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
          ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
          ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
        select: businessSelect,
      });
      await this.invalidatePublicCache(id, previous.slug, updated.slug);
      return updated;
    } catch (error: unknown) {
      if (this.isUniqueViolation(error))
        throw new ConflictException({
          code: 'BUSINESS_SLUG_ALREADY_EXISTS',
          message: 'Business slug already exists.',
        });
      throw error;
    }
  }

  async suspend(id: string, actor: AuthenticatedUser): Promise<void> {
    const previous = await this.prisma.business.findUnique({
      where: { id },
      select: { slug: true },
    });
    if (!previous)
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    const access = await this.getAccess(id, actor);
    if (!access.isAdmin && !access.isOwner)
      throw new ForbiddenException({
        code: 'BUSINESS_ACCESS_DENIED',
        message: 'Business owner or admin access is required.',
      });
    await this.prisma.business.update({
      where: { id },
      data: { status: BusinessStatus.SUSPENDED },
    });
    await this.invalidatePublicCache(id, previous.slug, previous.slug);
  }

  async listMembers(businessId: string, actor: AuthenticatedUser) {
    const access = await this.getAccess(businessId, actor);
    this.assertCanRead(access);
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    });
    if (!business)
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    return this.prisma.businessMember.findMany({
      where: { businessId },
      select: memberSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMember(businessId: string, actor: AuthenticatedUser, dto: AddBusinessMemberDto) {
    const access = await this.getAccess(businessId, actor);
    this.assertCanManageMembers(access);
    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target || !target.isActive)
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Active user not found.' });
    if (
      (target.role !== UserRole.STAFF && target.role !== UserRole.MANAGER) ||
      target.role !== dto.role
    ) {
      throw new BadRequestException({
        code: 'BUSINESS_INVALID_MEMBER_ROLE',
        message: 'Member role must match an active STAFF or MANAGER user.',
      });
    }
    try {
      return await this.prisma.businessMember.create({
        data: { businessId, userId: dto.userId, role: dto.role },
        select: memberSelect,
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error))
        throw new ConflictException({
          code: 'BUSINESS_MEMBER_ALREADY_EXISTS',
          message: 'User is already a member of this business.',
        });
      throw error;
    }
  }

  async updateMember(
    businessId: string,
    memberId: string,
    actor: AuthenticatedUser,
    dto: UpdateBusinessMemberDto,
  ) {
    const access = await this.getAccess(businessId, actor);
    this.assertCanManageMembers(access);
    const member = await this.prisma.businessMember.findUnique({
      where: { id: memberId },
      select: { id: true, businessId: true, role: true },
    });
    if (!member || member.businessId !== businessId)
      throw new NotFoundException({
        code: 'BUSINESS_MEMBER_NOT_FOUND',
        message: 'Business member not found.',
      });
    if (!access.isAdmin && !access.isOwner && dto.role !== undefined)
      throw new ForbiddenException({
        code: 'BUSINESS_ACCESS_DENIED',
        message: 'Only the owner or admin can change member roles.',
      });
    return this.prisma.businessMember.update({
      where: { id: memberId },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: memberSelect,
    });
  }

  async removeMember(
    businessId: string,
    memberId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const access = await this.getAccess(businessId, actor);
    this.assertCanManageMembers(access);
    const member = await this.prisma.businessMember.findUnique({
      where: { id: memberId },
      select: { id: true, businessId: true, role: true },
    });
    if (!member || member.businessId !== businessId)
      throw new NotFoundException({
        code: 'BUSINESS_MEMBER_NOT_FOUND',
        message: 'Business member not found.',
      });
    if (!access.isAdmin && !access.isOwner && member.role !== UserRole.STAFF)
      throw new ForbiddenException({
        code: 'BUSINESS_ACCESS_DENIED',
        message: 'Managers cannot remove managers.',
      });
    await this.prisma.businessMember.delete({ where: { id: memberId } });
  }

  async getAccess(businessId: string, actor: AuthenticatedUser): Promise<BusinessAccess> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, ownerId: true },
    });
    if (!business)
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    if (actor.role === UserRole.ADMIN)
      return {
        businessId,
        isAdmin: true,
        isOwner: actor.id === business.ownerId,
        membershipRole: null,
      };
    const membership = await this.prisma.businessMember.findUnique({
      where: { uq_business_member: { businessId, userId: actor.id } },
      select: { role: true, isActive: true },
    });
    return {
      businessId,
      isAdmin: false,
      isOwner: actor.id === business.ownerId,
      membershipRole: membership?.isActive ? (membership.role as BusinessMemberRole) : null,
    };
  }

  private assertCanManage(access: BusinessAccess): void {
    if (!access.isAdmin && !access.isOwner && access.membershipRole !== UserRole.MANAGER)
      throw new ForbiddenException({
        code: 'BUSINESS_ACCESS_DENIED',
        message: 'Business manager access is required.',
      });
  }

  async assertManagerAccess(businessId: string, actor: AuthenticatedUser): Promise<BusinessAccess> {
    const access = await this.getAccess(businessId, actor);
    this.assertCanManage(access);
    return access;
  }

  private assertCanRead(access: BusinessAccess): void {
    if (!access.isAdmin && !access.isOwner && !access.membershipRole) {
      throw new ForbiddenException({
        code: 'BUSINESS_ACCESS_DENIED',
        message: 'Business membership is required.',
      });
    }
  }

  private assertCanManageMembers(access: BusinessAccess): void {
    if (!access.isAdmin && !access.isOwner && access.membershipRole !== UserRole.MANAGER)
      throw new ForbiddenException({
        code: 'BUSINESS_ACCESS_DENIED',
        message: 'Business member management access is required.',
      });
  }

  private slugify(value: string): string {
    const slug = value
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A valid business slug could not be generated.',
      });
    return slug.slice(0, 200);
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private invalidatePublicCache(id: string, ...slugs: string[]): Promise<void> {
    if (!this.cache) return Promise.resolve();
    return this.cache.delete(
      RedisKeyFactory.businessById(id),
      ...slugs.map((slug) => RedisKeyFactory.businessBySlug(slug)),
    );
  }
}
