import { describe, expect, it } from 'vitest';
import { costoVisibleMenu } from './presentacion-costos.js';
describe('costo que realmente muestra el menú', () => {
  const p = { precio_venta: 100, costo_fifo_actual: null, costo_fifo_referencia: 40, costo_receta: 10 };
  it('los promedios usan la referencia de $40 que muestra la tarjeta, no $10 de catálogo', () => expect(costoVisibleMenu(p)).toMatchObject({ fuente:'fifo_referencia',costo:40,margen:60,foodCost:40 }));
  it('prefiere FIFO disponible', () => expect(costoVisibleMenu({...p,costo_fifo_actual:30})).toMatchObject({fuente:'fifo_actual',costo:30,margen:70,foodCost:30}));
  it('un costo desconocido no es cero', () => expect(costoVisibleMenu({...p,costo_fifo_referencia:null,costo_receta:null})).toMatchObject({fuente:'pendiente',costo:null,margen:null,foodCost:null}));
  it('no divide entre un precio de venta cero', () => expect(costoVisibleMenu({...p,precio_venta:0}).foodCost).toBeNull());
});
