/** Verificación de API con una copia local restaurada. Nunca acepta producción.
 * DATABASE_URL=postgresql://.../iberico_audit_... AUDIT_BASE=http://127.0.0.1:4317 AUDIT_PIN=... npx tsx server/scripts/verificar-flujo-compras.ts */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
const dbUrl = new URL(process.env.DATABASE_URL ?? '');
const base = new URL(process.env.AUDIT_BASE ?? 'http://127.0.0.1:4317');
assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname) && /audit|test/i.test(dbUrl.pathname), 'Sólo una base local de auditoría o pruebas');
assert(['localhost', '127.0.0.1'].includes(base.hostname), 'Sólo API local');
const prisma = new PrismaClient();
let token = '';
const request = async (path: string, method = 'GET', body?: unknown) => {
  const res = await fetch(new URL('/api' + path, base), { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
};
try {
  const login = await request('/auth/login', 'POST', { usuario_id: 1, pin: process.env.AUDIT_PIN });
  assert.equal(login.status, 200); token = login.body.token;
  const id = `AUDIT-${Date.now()}`;
  const linea = (size: number, qty: number, importe: number) => ({ product_id:27, tipo_linea:'inventario', descripcion_fuente:'Agua Mineral', cantidad_fuente:qty, unidad_fuente:'botella', unidad_compra:'botella', contenido_compra:size, cantidad_base:qty*size, importe });
  const invalid = await request('/inventario/compras/validar', 'POST', { total:50, lineas:[{...linea(600,2,50), contenido_compra:null}] });
  assert.equal(invalid.body.valida, false);
  assert(invalid.body.errores.some((e: any) => e.codigo === 'PRESENTACION_REQUERIDA'));
  const variable = await request('/inventario/compras/validar', 'POST', { total:0, lineas:[{ product_id:110, tipo_linea:'inventario', descripcion_fuente:'Chicharrón de habanero', cantidad_fuente:1, unidad_compra:'porción', contenido_compra:20, cantidad_base:20, importe:0 }] });
  assert.equal(variable.body.valida, true);
  const capture = await request('/inventario/compras/rapidas', 'POST', { fecha_recepcion:'2026-10-30', proveedor:'Auditoría local', ticket_ref:id, origen_pago_id:2, total:100, lineas:[linea(600,2,60),linea(1700,1,40)] });
  assert.equal(capture.status, 201, JSON.stringify(capture.body));
  const pid = capture.body.purchase_id;
  const confirmed = await request(`/inventario/compras/${pid}/confirmar`, 'POST', {});
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  let lots = await prisma.inventory_lots.findMany({where:{purchase_id:BigInt(pid)}});
  assert.equal(lots.length, 2);assert.deepEqual(lots.map(l=>Number(l.cantidad_inicial)).sort((a,b)=>a-b),[1200,1700]);
  assert.deepEqual(lots.map(l=>Number(l.costo_unitario)).sort((a,b)=>a-b),[0.023529,0.05]);
  assert.equal(await prisma.movimientos.count({where:{compra_id:BigInt(pid)}}),1);
  const observationsBefore = await prisma.product_presentation_variants.aggregate({where:{product_id:27n},_sum:{observaciones:true}});
  const twice = await request(`/inventario/compras/${pid}/confirmar`, 'POST', {}); assert.equal(twice.status,409);
  const edited = await request(`/inventario/compras/${pid}`, 'PATCH', { proveedor:'Auditoría editada', total:100, lineas:[linea(600,2,60),linea(1700,1,40)] });
  assert.equal(edited.status,200,JSON.stringify(edited.body));
  const observationsAfter = await prisma.product_presentation_variants.aggregate({where:{product_id:27n},_sum:{observaciones:true}});
  assert.deepEqual(observationsAfter._sum,observationsBefore._sum);
  lots=await prisma.inventory_lots.findMany({where:{purchase_id:BigInt(pid)}});assert.equal(lots.length,2);
  const badEdit = await request(`/inventario/compras/${pid}`, 'PATCH', { total:100,lineas:[{...linea(600,2,100),contenido_compra:null}] }); assert.equal(badEdit.status,400);
  const ledger = await prisma.movimientos.aggregate({where:{compra_id:BigInt(pid)},_sum:{monto:true}});assert.equal(Number(ledger._sum.monto),100);
  const foreign = await request(`/inventario/compras/${pid}`, 'PATCH', {total:100,lineas:[{...linea(600,2,100),product_id:999999}]});assert.equal(foreign.status,400);
  const before = (await request('/inventario/current?vista=fisica')).body;
  const unrelatedBefore = before.productos.find((p: any) => p.product_id === 1).existencia_actual_base;
  const local = await request('/inventario/snapshots','POST',{tipo:'ajuste',semana_id:74,contado_at:new Date(Date.now()-5000).toISOString(),motivo:'Verificación local de tamaños mezclados',unidad_conteo:'operativa',lineas:[{product_id:27,zona_id:1,qty_captura:1.2,cantidad_base:1200},{product_id:41,zona_id:1,qty_captura:0.45,cantidad_base:450}]});assert.equal(local.status,201,JSON.stringify(local.body));
  const peso=await prisma.inventory_lines.findUniqueOrThrow({where:{snapshot_id_product_id_zona_id:{snapshot_id:BigInt(local.body.snapshot_id),product_id:41n,zona_id:1n}}});assert.equal(Number(peso.qty_captura)*Number(peso.factor),450,'Peso explícito no pierde precisión por la presentación');
  const bodega = await request('/inventario/snapshots','POST',{tipo:'ajuste',semana_id:74,contado_at:new Date(Date.now()-3000).toISOString(),motivo:'Continuación de verificación local',unidad_conteo:'operativa',continuar_snapshot_id:local.body.snapshot_id,lineas:[{product_id:27,zona_id:2,qty_captura:1.7,cantidad_base:1700}]});assert.equal(bodega.status,201,JSON.stringify(bodega.body));
  const snapshot = await prisma.inventory_snapshot.findUniqueOrThrow({where:{id:BigInt(bodega.body.snapshot_id)}});
  const after = (await request('/inventario/current?vista=fisica')).body;
  assert.equal(after.productos.find((p: any) => p.product_id===27).existencia_actual_base,2900);
  assert.equal(after.productos.find((p: any) => p.product_id===1).existencia_actual_base,unrelatedBefore,'Un ajuste puntual conserva los demás productos');
  const imp=await prisma.epos_importaciones.findFirstOrThrow();
  for(const [name,offset] of [['antes',-6000],['después',1000]] as const){
    const fecha=new Date(new Date(bodega.body.contado_at).getTime()+offset);
    const sale=await prisma.epos_ventas.create({data:{negocio_id:1n,importacion_id:imp.id,clave:`${id}-${name}`,fecha,producto_nombre:'Agua Mineral QA',cantidad:1,venta_bruta:0,metodo_pago:'Cash',costeo_estado:'costeada',costo_fifo:1}});
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City'}).format(fecha);
    await prisma.inventory_consumptions.create({data:{negocio_id:1n,product_id:27n,lote_id:lots[0]!.id,epos_venta_id:sale.id,fecha:new Date(date+'T12:00:00Z'),cantidad:50,costo_unitario:0.02,costo_total:1,fuente:'venta_receta'}});
  }
  const late=(await request('/inventario/current?vista=fisica')).body;
  assert.equal(late.productos.find((p:any)=>p.product_id===27).existencia_actual_base,2850,'Sólo se descuenta la venta posterior al conteo');
  console.log(JSON.stringify({ok:true,compra_local:pid,checks:['presentación requerida','peso variable explícito','dos tamaños: dos lotes','costos reales por lote','un solo pago','confirmación idempotente','edición validada','variantes sin duplicar','producto inválido bloqueado','contenido real en conteo','continuación de zonas','ajuste puntual conserva otros productos','importación tardía respeta hora del conteo'],production_writes:0}));
} finally { await prisma.$disconnect(); }
