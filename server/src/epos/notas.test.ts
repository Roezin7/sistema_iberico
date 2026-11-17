import{describe,it,expect}from'vitest';import{esNotaAdministrativaEpos}from'./notas.js';
const raw={ProductId:4098286,Product:'Nota',TotalSales:0,NetSales:0,CostPrice:0,DiscountValue:0,Category:'',Barcode:'',Notes:'Jerry'};
const nota={epos_product_id:4098286,producto_nombre:'Nota',cantidad:1,venta_bruta:0,venta_neta:0,raw_json:JSON.stringify(raw)};
describe('comentario administrativo Epos, no cortesía',()=>{
 it('reconoce sólo el SKU y evidencia administrativa verificados',()=>expect(esNotaAdministrativaEpos(nota)).toBe(true));
 it.each([{epos_product_id:123},{producto_nombre:'Gomitas'},{venta_bruta:35},{venta_neta:10},{cantidad:0},{cantidad:-1},{raw_json:'{'},{raw_json:null}])('no oculta venta/producto distinto %j',delta=>expect(esNotaAdministrativaEpos({...nota,...delta})).toBe(false));
 it.each([{Notes:''},{CostPrice:10},{TotalSales:35},{Category:'Comida'},{Barcode:'123'},{DiscountValue:35}])('rechaza metadatos de artículo real %j',delta=>expect(esNotaAdministrativaEpos({...nota,raw_json:JSON.stringify({...raw,...delta})})).toBe(false));
});
