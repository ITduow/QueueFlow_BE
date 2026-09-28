import { Socket } from 'socket.io';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';

export interface RealtimeSocket extends Socket {
  data: { user: AuthenticatedUser };
}
