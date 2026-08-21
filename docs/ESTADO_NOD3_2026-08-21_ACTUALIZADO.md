# Estado operativo de NOD3

Fecha de actualización: 21 de agosto de 2026

## Resumen ejecutivo

NOD3 se está operando como un método y una memoria de aprendizaje, no como otra
aplicación que deba crecer por funcionalidades. Los tres activos tienen funciones
distintas:

| Activo | Función | Estado |
| --- | --- | --- |
| BPM | Deployment operativo real de abastecimiento y distribución | En construcción y validación con el cliente |
| Ibérico | Laboratorio operativo real de ventas, compras, inventario y rentabilidad | Fase 0, piloto real en curso |
| NOD3 | Método, evidencia, conocimiento y arquitectura extraíble | Fase de descubrimiento y documentación |

La regla vigente es: primero operar, medir y documentar; después convertir los
patrones repetidos en producto.

## Fase actual de NOD3

NOD3 se encuentra en **Fase 0: demostrar una operación repetible basada en evidencia**.

Todavía no corresponde avanzar por calendario a identidad comercial, escalamiento o
una nueva expansión de la plataforma. El hito que desbloquea la siguiente fase es
demostrar que el método puede gobernar semanas reales sin duplicar datos, inventar
costos ni perder decisiones importantes.

## Ibérico

### Estado funcional

Ibérico ya cuenta con los componentes necesarios para el piloto:

- ventas Epos en modo lectura y sincronización idempotente;
- ventas por producto, día y método de pago;
- conciliación diaria con cuentas abiertas como excepción;
- semanas con apertura y cierre de inventario;
- captura física de inventario;
- recetas vigentes y consumo FIFO por lote;
- captura móvil de tickets con foto;
- revisión humana de líneas de compra;
- clasificación de líneas como inventario, gasto o pendiente;
- confirmación que crea lotes FIFO y movimientos financieros;
- excepciones visibles para ventas sin mapeo, receta o inventario suficiente.

### Cambio más reciente en Compras

La vista de Compras ahora tiene un selector semanal. Al cambiar de semana se
actualizan conjuntamente:

- tickets capturados dentro del periodo;
- detalle de proveedor, folio, estado, origen de pago y líneas;
- lotes FIFO recibidos durante la semana;
- métricas de tickets, compras, lotes y valor recibido.

El libro FIFO está colapsado por defecto y limitado visualmente a bloques de 50
lotes. Esto sólo cambia la presentación; no elimina ni modifica lotes.

### Semana operativa

- Semana histórica de prueba: 63, del 10 al 16 de agosto.
- Semana activa: 64, del 17 al 23 de agosto.
- La semana activa debe seguir aislada de reconstrucciones históricas.
- El cierre del domingo debe producir el inventario final y la apertura de la semana
  siguiente.

### Cuello de botella actual

El problema ya no es añadir otra pantalla. Es cerrar una semana real con trazabilidad
completa:

```text
Epos → conciliación diaria → tickets → lotes FIFO → consumo por receta
→ inventario físico → merma/excepciones → margen real
```

El margen no debe declararse definitivo mientras existan productos vendidos sin
asociación estable a menú, receta e inventario, o mientras falte el inventario físico
de cierre.

## BPM

BPM sigue siendo el deployment operativo real de abastecimiento y distribución.
La operación ya reveló principios importantes para NOD3:

- pedidos recibidos como fotografías y transcritos manualmente;
- rutas fijas por día y separadas por operación;
- compras, producción, despacho y billing como ciclos relacionados;
- diferencias notificadas por los managers, no por recepción formal;
- necesidad de distinguir producto, presentación, ruta y evidencia.

Las modificaciones logísticas pendientes de aprobación deben mantenerse separadas del
desarrollo de Ibérico. El conocimiento de BPM sí debe seguir documentándose como
patrón reutilizable, pero no toda excepción de BPM debe convertirse inmediatamente en
una función de NOD3.

## Activos de conocimiento que ya existen

- Operating Brief de Ibérico.
- Runbook de la semana 64.
- Reconstrucción histórica de la semana 63.
- Matriz de costeo y recetas.
- Documentación del ciclo semanal de inventario.
- Roadmap de integración Epos → menú → receta → FIFO.
- Auditoría completa del flujo operativo de Ibérico.

Estos documentos son la memoria operativa actual. Las decisiones nuevas deben añadir
fecha, evidencia, responsable y criterio de cierre.

## Próximos pasos operativos

### Hoy y durante la semana 64

1. Seleccionar la semana 64 en Compras y verificar que la apertura sea la correcta.
2. Sincronizar Epos una sola vez por día.
3. Revisar productos, descuentos, métodos de pago y cuentas abiertas.
4. Confirmar la conciliación diaria sólo después de la revisión humana.
5. Capturar cada ticket con foto, líneas, presentación, proveedor y origen de pago.
6. Confirmar únicamente líneas que puedan convertirse en inventario o gasto con
   evidencia suficiente.
7. Revisar las excepciones FIFO antes de hablar de margen.

### Cierre del domingo

1. Confirmar el último corte Epos.
2. Capturar el inventario físico final.
3. Clasificar diferencias como merma, receta, rendimiento, compra faltante o error.
4. Separar margen bruto de utilidad operativa.
5. Congelar el snapshot final y usarlo como apertura de la semana 65.
6. Elaborar una revisión semanal con datos, fricciones y decisiones.

## Criterio de avance de Ibérico

Ibérico puede pasar de Fase 0 a la siguiente fase cuando complete dos semanas reales
consecutivas con:

- sincronización Epos sin duplicados;
- conciliaciones diarias confirmadas;
- tickets con evidencia y presentación;
- todas las ventas mapeadas o exceptuadas explícitamente;
- lotes FIFO y consumos trazables;
- inventario final encadenado a la apertura siguiente;
- gastos y sueldos sin duplicidad;
- margen bruto y utilidad operativa separados.

## Qué debe convertirse en NOD3

Sólo después de observar repetición suficiente:

- el ciclo diario de conciliación;
- la captura y aprobación de tickets;
- la resolución de excepciones;
- el cierre de inventario y apertura siguiente;
- la revisión semanal de rentabilidad.

El resto permanece como documentación, no como backlog de software.

## Riesgos abiertos

- El selector semanal de Compras filtra los datos ya cargados en la aplicación; si el
  volumen crece, deberá migrarse a consultas server-side por rango.
- La asociación estable Epos → menú → receta todavía debe verificarse con una semana
  completa.
- Los costos de preparados internos y rendimientos siguen requiriendo evidencia real.
- La captura de tickets todavía necesita demostrar que empleados pueden usarla sin
  duplicar compras ni clasificar líneas incorrectamente.
- La semana activa no debe contaminarse con ajustes de la semana histórica.

## Decisión vigente

Durante esta etapa, NOD3 no se optimiza para tener más módulos. Se optimiza para que
BPM e Ibérico produzcan evidencia empresarial comparable, decisiones mejores y patrones
que realmente merezcan convertirse en software.

## Corrección de datos de Compras — 21 de agosto de 2026

Se eliminaron de producción cuatro registros históricos incorrectamente fechados en la
semana 64. Eran los IDs 1–4, con fecha 20 de agosto, sin proveedor, sin folio, sin total,
fuente manual, costo cero y sin líneas de captura, lotes FIFO ni movimientos financieros.

La eliminación fue transaccional y validó todas esas condiciones antes de ejecutarse.
Los cuatro tickets reales de la semana permanecen intactos:

- Bodegas Alianza — `PILOTO-2026-08-20-BOD-01` — $952.99;
- La Comer — `PILOTO-2026-08-20-LC-02` — $32.10;
- La Comer — `PILOTO-2026-08-20-LC-01` — $1,282.10;
- Compra local — `PILOTO-2026-08-20-LOCAL-01` — $28.60.

No se modificaron lotes ni movimientos financieros asociados a los tickets reales.
