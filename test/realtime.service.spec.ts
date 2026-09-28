import { RealtimeEvents } from '../src/realtime/realtime-events';
import { RealtimeService } from '../src/realtime/realtime.service';

describe('RealtimeService', () => {
  it('emits a personal event and sanitized room events', () => {
    const emit = jest.fn();
    const server = { to: jest.fn().mockReturnValue({ emit }) };
    const service = new RealtimeService();
    service.attachServer(server as never);

    service.emitQueueMutation({
      event: RealtimeEvents.queueCalled,
      queueId: 'queue-id',
      businessId: 'business-id',
      userId: 'customer-id',
      payload: {
        queueId: 'queue-id',
        entryId: 'entry-id',
        queueNumber: 'A001',
        status: 'CALLED',
        customerEmail: 'private@example.com',
      },
    });

    expect(server.to).toHaveBeenCalledWith('user:customer-id');
    expect(server.to).toHaveBeenCalledWith('queue:queue-id');
    expect(server.to).toHaveBeenCalledWith('business:business-id');
    expect(
      emit.mock.calls.some((call) => JSON.stringify(call).includes('private@example.com')),
    ).toBe(false);
  });
});
