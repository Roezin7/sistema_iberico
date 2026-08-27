# Estado de implementación · Ibérico · 26 de agosto de 2026

## Decisión operativa

Ibérico se opera como un ciclo semanal único: abrir la semana, registrar la
operación de viernes a domingo, recibir tickets y gastos, costear ventas con
FIFO en vivo, contar físicamente, explicar diferencias y cerrar. Las semanas
anteriores se consultan sin mezclarse con la semana abierta.

## Corte de verificación de producción · 26 de agosto de 2026

La revisión directa de la base de producción confirma que la estructura de
costeo está completa, pero el costo operativo todavía no está cerrado al 100%:

- 67/67 productos del menú tienen una receta vigente validada y costo de
  referencia.
- 63/67 tienen costo FIFO completo con lotes abiertos.
- Las 4 excepciones actuales son conocidas: la tabla de quesos requiere Uvas y
  Frutos secos; Ronchata, Mezcachata y Oro Blanco requieren Lechera y
  Concentrado de horchata. En los cuatro casos no hay saldo FIFO abierto, por
  lo que no se debe sustituir el costo con cero ni ocultar la excepción.
- 87/98 insumos tienen unidad base y presentación de compra completas; 11
  registros de catálogo aún requieren completar esos metadatos.
- Sólo 9/67 productos de menú tienen mapeo Epos persistido. Esto no invalida el
  costeo de recetas, pero sí impide una conciliación automática completa de
  ventas hasta mapear los productos que realmente se vendan.

El Excel de costeo entregado con este corte separa costo de referencia, costo
FIFO vigente, desglose por ingrediente, catálogo de presentaciones y controles.
Es una fotografía auditable: el FIFO seguirá cambiando en producción al entrar
o consumirse lotes.

## Lo que queda implementado

- Semana con etiqueta única: `Semana N (inicio → fin)` en Inicio, Entradas,
  Cierre e Inventario.
- Navegación orientada al flujo: Inicio, Entradas, Cierre, Inventario y
  administración; las rutas antiguas siguen funcionando.
- Entradas como fuente única para tickets y gastos: al confirmar un ticket se
  crea el lote FIFO y el movimiento financiero vinculado.
- Tickets, pendientes de revisión y lotes FIFO consultables por semana.
- Conversión de presentación visible antes de guardar (cajas, paquetes,
  botellas, kg, g, ml o piezas), usando el catálogo vigente.
- Prevención de duplicados por folio o hash de fotografía en el servidor.
- FIFO en vivo para ventas importadas de Epos, con reversiones sólo en
  auditoría y excepciones separadas del costo normal.
- Cierre con conciliación independiente FIFO contra inventario físico:
  apertura, compras, ajustes, consumo FIFO, existencia esperada, conteo final,
  diferencia, valor y clasificación de incidencia.
- Inventario con tipo explícito (apertura, cierre, conteo operativo o ajuste),
  historial y unidad de captura por zona.
- Cierre diario con ventas Epos, métodos de pago, propinas, gastos, sueldos y
  detalle de productos.
- Costos del menú ordenados por la carta, mostrando costo FIFO actual, último
  costo aplicado o costo base, margen y food cost.
- Lista de compras calculada como `mínimo configurado − existencia actual` en
  unidad base; el importe usa el costo por g/ml/pieza de la presentación y la
  vista muestra mínimo, existencia, faltante, unidad y presentación. Cuando el
  catálogo no tiene contenido o unidad base, se marca como pendiente en vez de
  multiplicar por error el precio completo del paquete.
- Asistente flotante oculto durante las capturas operativas para reducir ruido.

## Qué debe verificarse en operación

Estas comprobaciones requieren datos reales y no se deben simular:

1. Importar una venta Epos en vista previa y después sincronizarla una sola vez.
2. Confirmar un ticket de inventario y comprobar simultáneamente lote FIFO,
   movimiento financiero y consulta del ticket.
3. Capturar apertura y cierre usando la unidad que muestra el formulario.
4. Comparar consumo FIFO activo contra el conteo físico y resolver sólo las
   diferencias clasificadas como conversión, compra faltante, receta, captura
   o posible merma.
5. Cerrar la semana y comprobar que el cierre físico sea la apertura siguiente.

## P1/P2 pendiente de evidencia

- Completar el mapeo de todos los nombres Epos que aparezcan en una semana real.
- Ejecutar sincronización diaria al final de cada día operativo y revisar pagos
  mixtos, propinas y cuentas abiertas.
- Formalizar alertas y tendencias de decisión en Inicio después de varias
  semanas confiables.
- Definir roles adicionales cuando exista un segundo operador; mientras tanto
  el acceso permanece restringido al administrador.

## Plan operativo de esta semana

1. **Día operativo siguiente:** abrir la semana vigente y usar únicamente
   Entradas para tickets y gastos. Confirmar que cada ticket produzca un lote
   FIFO y un movimiento financiero, sin registrar el mismo gasto en otra vista.
2. **Durante viernes–sábado:** sincronizar Epos en vista previa y después una
   sola vez; revisar ventas por producto, métodos de pago, propinas y cuentas
   abiertas. Mapear sólo los productos vendidos que todavía no tengan Epos ID.
3. **Domingo:** capturar el inventario físico de cierre con la presentación y
   unidad que muestra el formulario. Ejecutar la conciliación independiente
   FIFO contra físico y clasificar cada diferencia como conversión, compra
   faltante, receta, captura o posible merma.
4. **Cierre de semana:** calcular costo de ventas FIFO activo, resultado
   operativo y diferencia física. No cerrar mientras una cifra dependa de otra
   o una excepción haya sido rellenada artificialmente.
5. **Apertura siguiente:** usar el inventario físico final validado como
   inventario inicial de la semana siguiente. Las cuatro excepciones del corte
   actual y los 11 insumos sin presentación completa pasan a una cola explícita
   de resolución, no a valores inventados.

## Decisión de alcance

El objetivo de esta semana no es añadir módulos: es demostrar un ciclo completo
con datos vivos —venta Epos → consumo FIFO → compra/ticket → inventario físico
→ diferencia explicada → decisión operativa—. Sólo se justificará nuevo
software si una fricción se repite y bloquea ese ciclo.

No se requiere una migración de base de datos para estas mejoras de flujo. No se
debe añadir funcionalidad nueva hasta observar un patrón repetido que no pueda
resolverse con el flujo existente.
