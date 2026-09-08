import { prisma } from './server/dist/db.js';
import { writeFileSync } from 'node:fs';
const p = await prisma.purchases.findUnique({ where: { id: 32n }, select: { foto_data: true, foto_mime: true, proveedor: true, fecha_recepcion: true, ocr_json: true } });
if (!p?.foto_data) throw new Error('Ticket 32 sin imagen');
const ext = p.foto_mime === 'image/jpeg' ? 'jpg' : 'png';
writeFileSync(`/tmp/ticket32.${ext}`, Buffer.from(p.foto_data, 'base64'));
console.log(JSON.stringify({ proveedor: p.proveedor, fecha: p.fecha_recepcion, mime: p.foto_mime, ocr: p.ocr_json, path: `/tmp/ticket32.${ext}` }));
await prisma.$disconnect();
