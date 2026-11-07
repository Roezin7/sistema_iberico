import type { RequestHandler } from 'express';
import { verificarToken, type JwtPayload } from './jwt.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { prisma } from '../db.js';

// Extiende Request con el usuario autenticado.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: JwtPayload & { negocioId: bigint; usuarioId: bigint };
    }
  }
}

/** Exige un JWT válido; adjunta req.auth con IDs ya convertidos a BigInt. */
export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Falta el token de autenticación');
  }
  let payload: JwtPayload;
  try {
    payload = verificarToken(header.slice(7));
    BigInt(payload.sub); BigInt(payload.negocio_id);
  } catch { throw new HttpError(401, 'Token inválido o expirado'); }
  const usuario = await prisma.usuarios.findUnique({ where: { id: BigInt(payload.sub) }, select: { id: true, negocio_id: true, activo: true, rol: true } });
  if (!usuario || !usuario.activo || usuario.negocio_id !== BigInt(payload.negocio_id) || usuario.rol !== payload.rol) {
    throw new HttpError(401, 'La sesión ya no está vigente. Inicia sesión de nuevo.');
  }
    req.auth = {
      ...payload,
      negocioId: BigInt(payload.negocio_id),
      usuarioId: BigInt(payload.sub),
    };
    next();
});

/** Exige uno de los roles dados. Usar SIEMPRE después de requireAuth. */
export const requireRole =
  (...roles: Array<'admin' | 'empleado'>): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, 'No autenticado');
    if (!roles.includes(req.auth.rol)) {
      throw new HttpError(403, 'No tienes permiso para esta sección');
    }
    next();
  };

/** Atajo: solo admin (finanzas, patrimonio, catálogo, usuarios). */
export const soloAdmin = requireRole('admin');
