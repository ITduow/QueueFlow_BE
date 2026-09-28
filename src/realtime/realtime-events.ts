export const RealtimeEvents = {
  queueJoined: 'queue:joined',
  queueUpdated: 'queue:updated',
  queueCalled: 'queue:called',
  queueServing: 'queue:serving',
  queueCompleted: 'queue:completed',
  queueSkipped: 'queue:skipped',
  queueCancelled: 'queue:cancelled',
  appointmentCreated: 'appointment:created',
  appointmentConfirmed: 'appointment:confirmed',
  appointmentCancelled: 'appointment:cancelled',
  notificationNew: 'notification:new',
} as const;

export type RealtimeEvent = (typeof RealtimeEvents)[keyof typeof RealtimeEvents];
