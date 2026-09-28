import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { BusinessesService } from '../businesses/businesses.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { RedisCacheService } from '../redis/redis-cache.service';
import { RedisKeyFactory } from '../redis/redis-key.factory';

export const serviceSelect = {
  id: true,
  businessId: true,
  name: true,
  description: true,
  durationMinutes: true,
  price: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ServiceSelect;

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
    private readonly cache?: RedisCacheService,
  ) {}

  async create(businessId: string, actor: AuthenticatedUser, dto: CreateServiceDto) {
    await this.businessesService.assertManagerAccess(businessId, actor);
    try {
      const created = await this.prisma.service.create({
        data: {
          businessId,
          name: dto.name.trim(),
          description: dto.description?.trim(),
          durationMinutes: dto.durationMinutes,
          price: dto.price,
        },
        select: serviceSelect,
      });
      await this.cache?.delete(RedisKeyFactory.businessServices(businessId));
      return created;
    } catch (error: unknown) {
      if (this.isConstraintViolation(error)) {
        throw new BadRequestException({
          code: 'SERVICE_INVALID_DATA',
          message: 'Service data violates a database constraint.',
        });
      }
      throw error;
    }
  }

  async listPublic(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, status: true },
    });
    if (!business || business.status !== 'ACTIVE')
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    const cacheKey = RedisKeyFactory.businessServices(businessId);
    const cached =
      await this.cache?.get<Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>[]>(cacheKey);
    if (cached) return cached;
    const services = await this.prisma.service.findMany({
      where: { businessId, isActive: true },
      select: serviceSelect,
      orderBy: { name: 'asc' },
    });
    await this.cache?.set(cacheKey, services);
    return services;
  }

  async getPublicById(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      select: { ...serviceSelect, business: { select: { status: true } } },
    });
    if (!service || !service.isActive || service.business.status !== 'ACTIVE')
      throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: 'Service not found.' });
    return {
      id: service.id,
      businessId: service.businessId,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      price: service.price,
      isActive: service.isActive,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    };
  }

  async update(id: string, actor: AuthenticatedUser, dto: UpdateServiceDto) {
    const existing = await this.prisma.service.findUnique({
      where: { id },
      select: { id: true, businessId: true },
    });
    if (!existing)
      throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: 'Service not found.' });
    await this.businessesService.assertManagerAccess(existing.businessId, actor);
    if (Object.keys(dto).length === 0)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'At least one service field is required.',
      });
    const updated = await this.prisma.service.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() } : {}),
        ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: serviceSelect,
    });
    await this.cache?.delete(RedisKeyFactory.businessServices(existing.businessId));
    return updated;
  }

  async deactivate(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.prisma.service.findUnique({
      where: { id },
      select: { id: true, businessId: true },
    });
    if (!existing)
      throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: 'Service not found.' });
    await this.businessesService.assertManagerAccess(existing.businessId, actor);
    await this.prisma.service.update({ where: { id }, data: { isActive: false } });
    await this.cache?.delete(RedisKeyFactory.businessServices(existing.businessId));
  }

  private isConstraintViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004';
  }
}
