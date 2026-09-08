import { consumirVentasEpos } from './server/dist/inventario/consumo-epos.js';
import { prisma } from './server/dist/db.js';
const result = await consumirVentasEpos({ negocioId: 1n, from: '2026-08-31T06:00:00Z', to: '2026-09-07T06:00:00Z', confirmar: true, modo: 'normal' });
console.log(JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
await prisma.$disconnect();
