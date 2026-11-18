import{writeFile}from'node:fs/promises';
import{prisma as db}from'../src/db.js';
import{erroresMedidas,errorFactorZona}from'../src/lib/validar-medidas.js';
try{const datos=await db.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
 const ps=await tx.products.findMany({where:{negocio_id:1n,active:true},include:{product_zone_units:true},orderBy:{name:'asc'}});
 const resultados=ps.map(p=>({id:Number(p.id),producto:p.name,base:p.unidad_base,unidad_compra:p.unidad_compra,contenido:Number(p.contenido_compra),modo:p.presentacion_modo,minimo:Number(p.base_qty),zonas:p.product_zone_units.map(z=>({zona:Number(z.zona_id),unidad:z.unidad_captura,factor:Number(z.factor)})),errores:[...erroresMedidas(p),...p.product_zone_units.flatMap(z=>{const e=errorFactorZona(p,z.unidad_captura,Number(z.factor));return e?[e]:[]}),...(!p.product_zone_units.length?['Sin zona de conteo']:[])]}));
 return{productos:resultados.length,conversiones:resultados.reduce((s,p)=>s+p.zonas.length,0),errores:resultados.filter(p=>p.errores.length),detalle:resultados};
},{timeout:60000});const path=process.argv[2];if(path)await writeFile(path,JSON.stringify(datos,null,2));console.log(JSON.stringify({solo_lectura:true,productos:datos.productos,conversiones:datos.conversiones,errores:datos.errores}));if(datos.errores.length)process.exitCode=2;
}finally{await db.$disconnect()}
