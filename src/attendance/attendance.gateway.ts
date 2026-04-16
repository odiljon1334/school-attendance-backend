import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

export interface LiveAttendanceEvent {
  attendanceId: string;
  schoolId: string;
  personName: string;
  personType: 'STUDENT' | 'TEACHER' | 'DIRECTOR';
  className?: string;
  photo?: string; // compressed base64 from turnstile snapshot
  time: string;   // ISO timestamp
  isLate: boolean;
  action: 'CHECK_IN' | 'CHECK_OUT';
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class AttendanceGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AttendanceGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`[WS] connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[WS] disconnected: ${client.id}`);
  }

  /** Client sends { schoolId } to start receiving events for a school */
  @SubscribeMessage('join-school')
  handleJoinSchool(
    @MessageBody() schoolId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`school:${schoolId}`);
    this.logger.log(`[WS] ${client.id} joined school:${schoolId}`);
    return { ok: true };
  }

  @SubscribeMessage('leave-school')
  handleLeaveSchool(
    @MessageBody() schoolId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`school:${schoolId}`);
    return { ok: true };
  }

  /** Called by AttendanceService after a successful check-in */
  emit(event: LiveAttendanceEvent) {
    this.server.to(`school:${event.schoolId}`).emit(
      event.action === 'CHECK_IN' ? 'checkin' : 'checkout',
      event,
    );
  }
}
