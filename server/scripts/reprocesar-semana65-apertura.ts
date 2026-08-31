import { consumirVentasEpos } from '../src/inventario/consumo-epos.js';
import { prisma } from '../src/db.js';

async function main() {
  const resultado = await consumirVentasEpos({
    negocioId: 1n,
    from: '2026-08-24T00:00:00-06:00',
    to: '2026-08-31T00:00:00-06:00',
    confirmar: true,
    modo: 'normal',
  });
  console.log(JSON.stringify(resultado, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
