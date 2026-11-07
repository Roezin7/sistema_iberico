import type { RequestHandler } from 'express';

// El límite de bytes no basta: miles de elementos inválidos pueden multiplicar
// los errores de validación. Recorremos iterativamente antes de llamar a Zod.
export function jsonDemasiadoComplejo(body: unknown): boolean {
  const pendientes: { valor: unknown; nivel: number }[] = [{ valor: body, nivel: 0 }];
  let nodos = 0;
  while (pendientes.length) {
    const { valor, nivel } = pendientes.pop()!;
    if (++nodos > 20_000 || nivel > 20) return true;
    if (valor == null || typeof valor !== 'object') continue;
    const valores = Array.isArray(valor) ? valor : Object.values(valor);
    if (valores.length > 1000 || pendientes.length + valores.length > 20_000) return true;
    for (const item of valores) pendientes.push({ valor: item, nivel: nivel + 1 });
  }
  return false;
}

export const limitarComplejidadJson: RequestHandler = (req, res, next) => {
  if (jsonDemasiadoComplejo(req.body)) {
    res.status(413).json({ error: 'La solicitud contiene demasiados elementos o niveles. Divide la captura en grupos más pequeños.' });
    return;
  }
  next();
};
