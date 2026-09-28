export class RealtimeRoomFactory {
  static user(userId: string): string {
    return `user:${userId}`;
  }

  static business(businessId: string): string {
    return `business:${businessId}`;
  }

  static queue(queueId: string): string {
    return `queue:${queueId}`;
  }
}
