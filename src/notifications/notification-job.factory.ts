import { randomUUID } from 'node:crypto';
import { NotificationType } from '@prisma/client';
import { NotificationJobPayload } from './types/notification-job-payload.type';

export class NotificationJobFactory {
  static queueJoined(
    userId: string,
    queueId: string,
    queueEntryId: string,
    queueNumber: string,
  ): NotificationJobPayload {
    return this.create(
      userId,
      NotificationType.QUEUE_JOINED,
      'Queue joined',
      `You joined the queue as ${queueNumber}.`,
      {
        queueId,
        queueEntryId,
        queueNumber,
      },
    );
  }

  static queueCalled(
    userId: string,
    queueId: string,
    queueEntryId: string,
    queueNumber: string,
  ): NotificationJobPayload {
    return this.create(
      userId,
      NotificationType.QUEUE_CALLED,
      'Your turn is ready',
      `Queue number ${queueNumber} has been called.`,
      {
        queueId,
        queueEntryId,
        queueNumber,
      },
    );
  }

  static bookingConfirmed(userId: string, appointmentId: string): NotificationJobPayload {
    return this.create(
      userId,
      NotificationType.BOOKING_CONFIRMED,
      'Appointment confirmed',
      'Your appointment has been confirmed.',
      { appointmentId },
    );
  }

  static bookingCancelled(userId: string, appointmentId: string): NotificationJobPayload {
    return this.create(
      userId,
      NotificationType.BOOKING_CANCELLED,
      'Appointment cancelled',
      'Your appointment has been cancelled.',
      { appointmentId },
    );
  }

  private static create(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    data: Record<string, string>,
  ): NotificationJobPayload {
    return { eventId: randomUUID(), userId, type, title, message, data };
  }
}
