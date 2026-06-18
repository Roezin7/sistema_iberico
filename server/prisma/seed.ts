import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// PIN inicial para los usuarios admin sembrados. Cámbialo luego desde la app.
const PIN_INICIAL = process.env.SEED_ADMIN_PIN ?? '1234';

async function main() {
  // 1) Negocio Ibérico (ya creado por la migración; lo buscamos / aseguramos).
  let iberico = await prisma.negocios.findFirst({ where: { nombre: 'Ibérico' } });
  if (!iberico) {
    iberico = await prisma.negocios.create({ data: { nombre: 'Ibérico', tipo: 'bar' } });
  }
  console.log(`Negocio: ${iberico.nombre} (id ${iberico.id})`);

  // 2) Socios (idempotente por nombre dentro del negocio).
  for (const nombre of ['Arturo', 'Mauri']) {
    const existe = await prisma.socios.findFirst({
      where: { negocio_id: iberico.id, nombre },
    });
    if (!existe) {
      await prisma.socios.create({ data: { negocio_id: iberico.id, nombre } });
      console.log(`  + socio ${nombre}`);
    }
  }

  // 3) Usuarios admin (ambos socios administran). PIN hasheado.
  const pinHash = await bcrypt.hash(PIN_INICIAL, 10);
  for (const nombre of ['Arturo', 'Mauri']) {
    const existe = await prisma.usuarios.findFirst({
      where: { negocio_id: iberico.id, nombre },
    });
    if (!existe) {
      await prisma.usuarios.create({
        data: { negocio_id: iberico.id, nombre, rol: 'admin', pin_hash: pinHash },
      });
      console.log(`  + usuario admin ${nombre} (PIN inicial: ${PIN_INICIAL})`);
    }
  }

  // 4) Socios como registro (para referenciar en ubicaciones).
  const arturo = await prisma.socios.findFirst({ where: { negocio_id: iberico.id, nombre: 'Arturo' } });
  const mauri = await prisma.socios.findFirst({ where: { negocio_id: iberico.id, nombre: 'Mauri' } });

  // 5) Ubicaciones de fondos (Fase 3). Idempotente por nombre.
  const ubicaciones: { nombre: string; tipo: 'banco' | 'efectivo'; socio_id: bigint | null }[] = [
    { nombre: 'Banco', tipo: 'banco', socio_id: null },
    { nombre: 'Caja', tipo: 'efectivo', socio_id: null },
    { nombre: 'Caja Fuerte Arturo', tipo: 'efectivo', socio_id: arturo?.id ?? null },
    { nombre: 'Caja Fuerte Mauri', tipo: 'efectivo', socio_id: mauri?.id ?? null },
  ];
  for (const u of ubicaciones) {
    const existe = await prisma.ubicaciones_fondos.findFirst({
      where: { negocio_id: iberico.id, nombre: u.nombre },
    });
    if (!existe) {
      await prisma.ubicaciones_fondos.create({ data: { negocio_id: iberico.id, ...u } });
      console.log(`  + ubicación ${u.nombre}`);
    }
  }

  // 6) Categorías de gasto (Fase 3).
  for (const nombre of ['Insumos', 'Sueldos', 'Servicios', 'Mantenimiento', 'Renta', 'Otros']) {
    await prisma.categorias_gasto.upsert({
      where: { negocio_id_nombre: { negocio_id: iberico.id, nombre } },
      update: {},
      create: { negocio_id: iberico.id, nombre },
    });
  }
  console.log('  + categorías de gasto');

  // 7) Checklists de ejemplo (Fase 5). Solo si el negocio no tiene ninguno.
  const totalChecklists = await prisma.checklists.count({ where: { negocio_id: iberico.id } });
  if (totalChecklists === 0) {
    const apertura = await prisma.checklists.create({
      data: { negocio_id: iberico.id, nombre: 'Apertura', tipo: 'apertura' },
    });
    const aperturaItems = ['Encender luces y música', 'Revisar limpieza de barra y baños', 'Verificar hielo y cervezas frías', 'Abrir caja con fondo', 'Prender terminal de tarjetas'];
    await prisma.checklist_items.createMany({
      data: aperturaItems.map((texto, i) => ({ checklist_id: apertura.id, texto, orden: i + 1 })),
    });

    const cierre = await prisma.checklists.create({
      data: { negocio_id: iberico.id, nombre: 'Cierre', tipo: 'cierre' },
    });
    const cierreItems = ['Conteo de caja y arqueo', 'Guardar efectivo en caja fuerte', 'Limpiar barra y lavar vasos', 'Sacar basura', 'Apagar equipos y luces', 'Cerrar con llave'];
    await prisma.checklist_items.createMany({
      data: cierreItems.map((texto, i) => ({ checklist_id: cierre.id, texto, orden: i + 1 })),
    });
    console.log('  + checklists de apertura y cierre');
  }

  console.log('\n✅ Seed completo. Cambia el PIN inicial desde la app cuanto antes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
