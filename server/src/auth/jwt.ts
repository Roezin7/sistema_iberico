import jwt from 'jsonwebtoken';
import { env } from '../env.js';

export interface JwtPayload {
  sub: string; // usuario_id (string porque viene de BigInt)
  negocio_id: string;
  rol: 'admin' | 'empleado';
  nombre: string;
}

// Doce horas cubren una jornada completa sin dejar una sesión financiera
// válida durante semanas si se pierde la tablet. El usuario puede volver a
// iniciar sesión al siguiente turno.
const EXPIRA_EN = '12h';

export function firmarToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: EXPIRA_EN });
}

export function verificarToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
