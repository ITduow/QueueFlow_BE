import { NotificationResponse } from '../types/notification-response.type';

export const notificationSelect = {
  id: true,
  type: true,
  title: true,
  message: true,
  data: true,
  isRead: true,
  createdAt: true,
  readAt: true,
} as const;

export function mapNotification(notification: NotificationResponse): NotificationResponse {
  return notification;
}
