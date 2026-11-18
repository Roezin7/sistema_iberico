export function erroresMedidas(p:{unidad_base?:string|null;contenido_compra?:unknown;unidad_compra?:string|null;base_qty?:unknown;active?:boolean}) {
 if(p.active===false)return [];
 const e:string[]=[];
 if(!['g','ml','pieza'].includes(p.unidad_base??''))e.push('Selecciona unidad base: g, ml o pieza. No se infiere desde el nombre.');
 if(!(Number(p.contenido_compra)>0)&&Number(p.contenido_compra)!==Infinity)e.push('Indica el contenido positivo de la presentación en unidad base.');
 if(!Number.isFinite(Number(p.contenido_compra)))e.push('El contenido debe ser finito.');
 if(!p.unidad_compra?.trim())e.push('Indica cómo se cuenta: botella, bolsa, pieza u otra presentación explícita.');
 if(!(Number(p.base_qty)>=1))e.push('El mínimo es al menos una unidad de referencia.');
 return e;
}

export function errorFactorZona(p:{unidad_base:string|null;contenido_compra:unknown;unidad_compra:string|null;presentacion_modo:string},unidad:string,factor:number) {
 const u=unidad.trim().toLowerCase().split(/[\s(]/)[0]??'',b=p.unidad_base;
 if(!Number.isFinite(factor)||factor<=0)return 'El factor debe ser positivo y finito.';
 if((['kg','g'].includes(u)&&b==='ml')||(['l','litro','ml'].includes(u)&&b==='g'))return 'La medida de zona mezcla peso y volumen.';
 if((u===b&&factor!==1)||(u==='kg'&&b==='g'&&factor!==1000)||(['l','litro'].includes(u)&&b==='ml'&&factor!==1000))return 'La unidad métrica y su factor no coinciden: g/ml=1, kg/L=1000.';
 if(b==='pieza'&&['pieza','piezas','botella','lata','envase'].includes(u)&&factor!==1)return 'Una pieza/envase individual equivale a1pieza, no a sus ml o gramos.';
 if(b==='pieza'&&!['kg','g','l','ml'].includes(u)&&!Number.isInteger(factor))return 'El contenido de un paquete discreto debe indicar un número entero de piezas.';
 const compra=p.unidad_compra?.trim().toLowerCase().split(/[\s(]/)[0];
 if(b!=='pieza'&&p.presentacion_modo==='exacta'&&u===compra&&!['kg','g','l','ml','litro'].includes(u)&&factor!==Number(p.contenido_compra))return 'La presentación fija de la zona no coincide con el contenido confirmado del producto.';
 return null;
}
