import { NotificationType } from '@prisma/client';

export interface NotificationJobPayload {
  eventId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, string | number | boolean | null>;
}
