import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../auth/middleware.js';
import { inventarioActual, listaComprasDesdeInventario } from '../inventario/service.js';
import { semanaActual, saludOperativa, resumen, resumenDiario } from '../finanzas/service.js';
import { diaDeTareas } from '../tareas/service.js';
import { listarConciliacionesDiarias } from '../epos/reconciliation.js';

export const operacionRouter = Router();
operacionRouter.use(requireAuth);

function hoyMexico() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Estado agregado para la pantalla Operación.
 * Las lecturas pesadas se comparten dentro del mismo request y la lista de
 * compras se deriva del inventario ya calculado.
 */
operacionRouter.get('/resumen', asyncHandler(async (req, res) => {
  const negocioId = req.auth!.negocioId;
  const fecha = hoyMexico();
  const semana = await semanaActual(negocioId);
  if (!semana || req.auth!.rol !== 'admin') {
    const [inventario, tareas] = await Promise.all([inventarioActual(negocioId, { vista: 'fisica' }), diaDeTareas(negocioId, fecha)]);
    res.json({ semana, salud: null, resumen: null, dias: [], conciliaciones: [], inventario, compras: listaComprasDesdeInventario(inventario), tareas });
    return;
  }
  const [salud, resumenSemana, dias, conciliaciones, inventario, tareas] = await Promise.all([
    saludOperativa(negocioId),
    resumen(negocioId, BigInt(semana.id)),
    resumenDiario(negocioId, BigInt(semana.id)),
    listarConciliacionesDiarias(negocioId, BigInt(semana.id)),
    inventarioActual(negocioId, { vista: 'fisica' }),
    diaDeTareas(negocioId, fecha),
  ]);
  res.json({ semana, salud, resumen: resumenSemana, dias: dias.dias, conciliaciones, inventario, compras: listaComprasDesdeInventario(inventario), tareas });
}));
