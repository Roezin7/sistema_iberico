import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { authRouter } from '../auth/routes.js';
import { catalogoRouter } from '../catalogo/routes.js';
import { inventarioRouter } from '../inventario/routes.js';
import { finanzasRouter } from '../finanzas/routes.js';
import { patrimonioRouter } from '../patrimonio/routes.js';
import { tareasRouter } from '../tareas/routes.js';
import { silviaRouter } from '../silvia/routes.js';

export const apiRouter = Router();

apiRouter.get('/health', asyncHandler(async (_req, res) => {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  res.status(db ? 200 : 503).json({ ok: db, servicio: 'sistema-iberico', db, ts: new Date().toISOString() });
}));

apiRouter.use('/auth', authRouter); // Fase 1
apiRouter.use('/catalogo', catalogoRouter); // Fase 2
apiRouter.use('/inventario', inventarioRouter); // Fase 2
apiRouter.use('/finanzas', finanzasRouter); // Fase 3
apiRouter.use('/patrimonio', patrimonioRouter); // Fase 4
apiRouter.use('/tareas', tareasRouter); // Fase 5
apiRouter.use('/silvia', silviaRouter); // Silvia (coach IA)
