import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { isValidObjectId } from 'mongoose';
import { AUTH_COOKIE_NAME, parseCookies } from '../utils/cookie';
import { verifyJwt } from '../utils/jwt';
import { userRepository } from '../repositories/user.repository';
import type { AuthUser } from '../types/auth';

let io: Server | null = null;
let onIngestSocketConnected: ((socket: Socket) => void) | null = null;

const toAuthUser = (user: any): AuthUser | null => {
  const role = user?.role;
  if (!role) return null;

  return {
    id: String(user._id),
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    role: {
      id: String(role._id),
      code: role.code,
      name: role.name,
      level: role.level,
    },
    organization: user.organization ? String(user.organization._id ?? user.organization) : null,
    department: user.department ? String(user.department._id ?? user.department) : null,
    status: user.status,
  };
};

async function authenticateSocketUser(socket: Socket): Promise<AuthUser> {
  const token = parseCookies(socket.handshake.headers.cookie)[AUTH_COOKIE_NAME];
  const payload = token ? verifyJwt(token) : null;

  if (!payload || !isValidObjectId(payload.id)) {
    throw new Error('Authentication required.');
  }

  const user = await userRepository.findAuthById(payload.id);
  const authUser = user && user.status === 'ACTIVE' ? toAuthUser(user) : null;
  if (!authUser) throw new Error('Active user required.');

  return authUser;
}

export function initializeIngestSocket(server: HttpServer): Server {
  io = new Server(server, {
    path: '/api/socket.io',
    cors: {
      origin: true,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocketUser(socket);
      socket.data.user = user;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('Socket authentication failed.'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser;
    socket.join(`user:${user.id}`);
    if (user.organization) socket.join(`organization:${user.organization}`);
    if (user.role.code === 'ADMIN') {
      socket.join('admin:ingest');
      onIngestSocketConnected?.(socket);
    }
  });

  return io;
}

export function emitIngestCronEvent(event: string, payload: unknown): void {
  io?.to('admin:ingest').emit(event, payload);
}

export function emitUserNotification(recipientId: string, payload: unknown): void {
  io?.to(`user:${recipientId}`).emit('notification:new', payload);
}

export function emitUserNotificationChanged(recipientId: string): void {
  io?.to(`user:${recipientId}`).emit('notification:changed');
}

export function emitWorkDeclarationChanged(organizationId: string, payload: unknown): void {
  io?.to(`organization:${organizationId}`).emit('work-declaration:changed', payload);
}

export function setIngestSocketConnectionHandler(handler: (socket: Socket) => void): void {
  onIngestSocketConnected = handler;
}
