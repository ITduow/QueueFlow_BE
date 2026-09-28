import { UserRole } from '@prisma/client';

export type BusinessMemberRole = Extract<UserRole, 'STAFF' | 'MANAGER'>;

export interface BusinessAccess {
  businessId: string;
  isAdmin: boolean;
  isOwner: boolean;
  membershipRole: BusinessMemberRole | null;
}
