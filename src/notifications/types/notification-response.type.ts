import { NotificationType } from '@prisma/client';

export interface NotificationResponse {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  data: unknown;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}
