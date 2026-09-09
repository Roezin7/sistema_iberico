import { prisma } from '../dist/db.js';

const names = ['Mezcalita Piña','Mezcalita Mango','Cubanito Chico','Cubanito Grande','Michelada Chica','Limonada Ibérica','Limonada','Piñada','Piña Colada','Perla Negra','Paloma Chica','Paloma Grande','Vampiro Chico','Vampiro Grande'];
const menus = await prisma.productos_menu.findMany({where:{negocio_id:1n,nombre:{in:names}},include:{recetas:{where:{estado:'validada'},orderBy:{version:'desc'},take:1,include:{lineas:true}}},orderBy:{nombre:'asc'}});
const ids=[...new Set(menus.flatMap(m=>m.recetas[0]?.lineas.map(l=>l.product_id)??[]))];
const products=await prisma.products.findMany({where:{id:{in:ids}}}); const pm=new Map(products.map(p=>[p.id.toString(),p]));
for(const m of menus){const r=m.recetas[0]; console.log('\n'+m.nombre+' | epos='+m.epos_product_id+' | receta='+r?.id+' v'+r?.version+' vig='+r?.vigente_desde); for(const l of r?.lineas??[]) console.log('  '+pm.get(l.product_id.toString())?.name+' = '+l.cantidad+' '+l.unidad+(l.nota?' ['+l.nota+']':''));}
console.log('\nPRODUCTS SEARCH'); const all=await prisma.products.findMany({where:{negocio_id:1n,OR:[{name:{contains:'clamato',mode:'insensitive'}},{name:{contains:'valentina',mode:'insensitive'}},{name:{contains:'hielo',mode:'insensitive'}},{name:{contains:'frutos rojos',mode:'insensitive'}},{name:{contains:'sprite',mode:'insensitive'}},{name:{contains:'agua mineral',mode:'insensitive'}},{name:{contains:'volt',mode:'insensitive'}},{name:{contains:'bacardi',mode:'insensitive'}}]},select:{id:true,name:true,unidad_base:true,unit_cost:true}}); console.log(all);
await prisma.$disconnect();
