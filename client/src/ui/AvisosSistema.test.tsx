import{describe,it,expect}from'vitest';
import{renderToStaticMarkup}from'react-dom/server';
import{AvisosSistema,separarAvisos}from'./AvisosSistema';
const mensaje='Mineral: faltante en 2 cierres distintos de los últimos cuatro. Causa: merma.';
describe('avisos actuales e históricos sin borrar evidencia',()=>{
 it('no repite el mismo mensaje operativo',()=>expect(separarAvisos(['Compra pendiente','Compra pendiente']).operativos).toEqual(['Compra pendiente']));
 it('usa estado estructurado, no supone que merma significa pendiente',()=>{const s=separarAvisos([mensaje],[{mensaje,estado:'documentada'}]);expect(s.operativos).toEqual([]);expect(s.pendientes).toEqual([]);expect(s.documentados).toHaveLength(1);});
 it('mantiene compatibilidad con un servidor sin campo de patrones',()=>expect(separarAvisos([mensaje]).pendientes).toHaveLength(1));
 it('no descarta advertencias no reconocidas',()=>expect(separarAvisos(['Advertencia nueva'],[]).operativos).toEqual(['Advertencia nueva']));
 it('históricos plegados conservan el detalle y contador',()=>{const html=renderToStaticMarkup(<AvisosSistema advertencias={[mensaje]} patrones={[{mensaje,estado:'por_explicar'}]}/>);expect(html).toContain('Patrones históricos por explicar · 1');expect(html).toContain(mensaje);expect(html).not.toContain(' open=');});
});
