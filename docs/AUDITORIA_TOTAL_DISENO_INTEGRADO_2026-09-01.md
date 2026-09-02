# Auditoría total y diseño integrado de Ibérico

**Fecha:** 1 de septiembre de 2026  
**Alcance:** producción, arquitectura, datos, operación semanal y experiencia de uso.  
**Conclusión:** el sistema funciona como conjunto de piezas, pero todavía no se siente como una operación integrada. La corrección no es añadir más módulos: es poner un único ciclo semanal por encima de los módulos existentes.

## 1. Diagnóstico ejecutivo

El modelo de datos tiene buenas bases: ventas Epos, compras, lotes FIFO,
recetas, inventario físico, caja, arqueos, cierres y patrimonio están separados
y son auditables. El problema aparece en la interfaz y en el flujo:

- el usuario debe decidir en qué módulo registrar cada cosa;
- una misma semana aparece en Cierre, Entradas, Inventario y Patrimonio;
- los detalles técnicos (FIFO, lotes, factores, unidades base y snapshots) están
  demasiado cerca de la captura diaria;
- el sistema no tiene una fase operativa explícita y por eso no sabe cuál es la
  siguiente acción correcta;
- el lunes real de Ibérico (cerrar la semana anterior y hacer compras) no es el
  flujo principal que presenta Inicio.

La experiencia correcta debe ser **Semana actual**, con cuatro momentos:

```text
Preparar semana → Comprar/recibir → Operar viernes-domingo → Cerrar y decidir
```

Los módulos actuales deben quedar como capacidades internas de ese ciclo, no
como el mapa mental que el operador tiene que aprender.

## 2. Operación real contra operación del sistema

| Momento real | Lo que hace Ibérico | Cómo se hace hoy | Problema |
|---|---|---|---|
| Lunes | Terminar cierre anterior, revisar caja/utilidad y abrir semana | Elegir semana en Cierre, revisar varias pestañas, ir a Inventario y regresar | No existe una tarea guiada de preparación; el usuario navega por módulos |
| Lunes–jueves | Compras generales: Costco, Bodegas Alianza/Alameda y La Comer | Entradas con selector de semana, tickets, pendientes, lotes y FIFO | Demasiada estructura interna; no hay una bandeja única de entradas de esta semana |
| Viernes–domingo | Ventas, caja, gastos y compras extraordinarias | Día dentro de Cierre, sincronización Epos manual y entradas en otra pantalla | La operación diaria queda separada de compras y de incidencias |
| Domingo noche/lunes | Conteo físico, corte total, utilidad y faltantes de caja | Inventario → elegir tipo → guardar; Cierre → Cuadre → Resumen → cerrar | El cierre exige cambiar de pantalla y entender qué snapshot es oficial |

## 3. Estado productivo auditado

| Área | Estado observado | Lectura operativa |
|---|---:|---|
| Productos | 100 (99 activos) | Catálogo manejable, pero 17 activos no tienen unidad por zona |
| Tiendas/proveedores | 9 | Sólo 3 son compras generales; las demás deben ser compras extraordinarias o catálogo avanzado |
| Categorías de inventario | 7 | Útiles para ordenar el conteo, no deben parecer módulos |
| Zonas | 2 | Local y Bodega; deben formar parte del mismo conteo físico |
| Unidades producto-zona | 164 | 17 productos activos quedan fuera del conteo guiado |
| Snapshots de inventario | 44 | 24 no están ligados a una semana; son historial, no pasos operativos |
| Semanas | 59 | Hay periodos históricos irregulares; la numeración actual ya se normaliza, pero el historial debe marcarse como legado |
| Compras | 22 confirmadas, 0 pendientes | El flujo base funciona, pero todos los tickets aparecen como registros técnicos |
| Lotes / consumos FIFO | 280 / 2,052 | Ledger trazable; no debe ser la pantalla de trabajo diario |
| Ventas Epos | 331, todas costeadas | 104 no tienen `epos_product_id`; dependen de coincidencia por nombre |
| Menú / recetas | 72 / 73 validadas | 23 productos de menú no tienen ID Epos; la asociación es frágil |
| Movimientos financieros | 1,094 | Demasiados para presentarlos como una lista de operación; requieren agrupación por entrada/día |
| Checklists | 2 configurados | El módulo existe, pero no está conectado en la navegación ni en una ruta de App |

## 4. Hallazgos prioritarios

### P0 — El ciclo semanal no es la unidad principal

`semanas` sólo tiene `abierta/cerrada`. No existen estados como preparación,
operación, cierre pendiente o lista para decidir. Además, crear una semana es
una acción administrativa manual. El sistema puede permitir que el usuario
salte entre periodos sin una señal clara de qué debe hacer hoy.

**Corrección:** crear una vista agregadora de la semana actual y un estado
derivado con bloqueadores y siguiente acción. El cierre debe encadenar
automáticamente la apertura siguiente, manteniendo los mismos snapshots y
movimientos existentes.

### P0 — El lunes está mal priorizado

Inicio etiqueta lunes–jueves como “Sin operación del bar” y sugiere “Revisar
inventario”. Para Ibérico, esos días sí son operativos administrativamente:
se cierra la semana anterior y se hacen las compras generales.

**Corrección:** separar “operación de venta” de “operación de preparación”. El
estado del lunes debe mostrar: `Cierre anterior pendiente`, `Compras generales`
o `Semana lista`, según la evidencia real.

### P0 — La captura diaria está partida

En Cierre se sincroniza Epos y se confirma el día; las compras extraordinarias y
los gastos se registran en Entradas o Movimientos. Esto obliga a recordar dónde
va cada cosa y favorece dobles registros.

**Corrección:** una tarjeta por día con tres acciones: `Ventas y pagos`,
`Entradas/gastos` y `Cerrar día`. Un ticket confirmado crea automáticamente su
movimiento y lote; el operador no ve dos acciones distintas.

### P0 — El cierre requiere demasiadas decisiones técnicas

Para cerrar se debe entender tipo de snapshot, semana, FIFO, conciliación,
arqueo y pestañas. Un cierre físico es una sola operación de negocio, aunque en
la base se conserven varios registros.

**Corrección:** asistente de cierre en cuatro pasos: ventas/pagos → entradas y
gastos → conteo físico → resultado y confirmación. Los snapshots, ajustes,
conciliaciones y patrimonio se generan detrás de ese botón.

### P1 — Catálogos incompletos causan excepciones antes de la operación

17 productos activos no tienen unidad de captura por zona, 4 no tienen
categoría, 23 productos de menú no tienen ID Epos y 104 ventas históricas
dependen del nombre para mapearse.

**Corrección:** tablero de preparación de datos con bloqueadores explícitos:
“17 productos no se pueden contar guiados”, “23 productos no están vinculados a
Epos”. No permitir que un producto quede activo en una operación sin decidir si
se cuenta, se compra y se costea.

### P1 — Demasiadas capas visibles de inventario

El sistema conserva correctamente snapshots, líneas físicas, lotes, consumos,
ajustes y conciliaciones, pero la interfaz los presenta como si fueran
inventarios distintos. Los 24 snapshots sin semana deben permanecer como
historial legado, no como opciones de trabajo.

**Corrección:** mostrar sólo `Conteo físico`, `Diferencias` y `Historial`.
“Apertura”, “cierre”, “ajuste”, snapshot y lote se muestran en un detalle de
auditoría, no en la captura normal.

### P1 — El modo sin conexión es demasiado amplio para finanzas

La cola offline puede guardar cualquier mutación, incluyendo confirmar compras,
registrar pagos, cerrar semana o ajustes. Una acción financiera atrasada puede
reproducirse cuando ya cambió el contexto.

**Corrección:** mantener offline para conteos y borradores; exigir conexión y
confirmación fresca para cierre, arqueos, confirmación de tickets y movimientos
financieros sensibles. Todas las mutaciones críticas deben tener clave
idempotente visible.

### P1 — Hay módulos funcionalmente desconectados

Tareas tiene servicio y pantalla, pero no tiene ruta en `App.tsx` ni entrada en
la navegación. Marketing tiene ruta, pero no es parte del ciclo operativo.
Costos del menú y Recetas viven en lugares diferentes aunque responden a la
misma pregunta: “¿qué vender y con qué margen?”. Patrimonio se repite dentro de
Cierre.

**Corrección:** integrar checklist dentro de la tarjeta diaria; agrupar recetas,
precios y margen en `Menú y rentabilidad`; consultar patrimonio desde `Cierre` o
`Decisiones`; mantener Marketing como área secundaria fuera del flujo de caja.

### P2 — La evidencia técnica no tiene pruebas de flujo completo

Hay 113 pruebas de lógica y el build es correcto, pero no hay una prueba de
navegador/API que recorra: compra → lote → venta → consumo → conteo → cierre →
apertura siguiente.

**Corrección:** añadir un escenario E2E con datos de prueba y una auditoría de
regresión para zona horaria, duplicación de tickets, reintentos offline y
reapertura.

## 5. Arquitectura de experiencia propuesta

### Navegación principal para el operador

1. **Semana actual** — estado, siguiente acción y progreso.
2. **Entradas** — cualquier compra, ticket, gasto o entrada extraordinaria.
3. **Inventario** — conteo físico, faltantes y diferencias.
4. **Decisiones** — utilidad, margen, rotación, compras recomendadas y acciones.

Para administración, un menú secundario:

- **Menú y rentabilidad** — recetas, precios, costo y margen.
- **Historial y auditoría** — Epos, lotes, snapshots, movimientos y ajustes.
- **Configuración** — productos, presentaciones, zonas, proveedores, usuarios y
  reglas.

El backend puede conservar todos los módulos actuales. La simplificación es de
experiencia y de orquestación, no de pérdida de trazabilidad.

### Pantalla “Semana actual”

```text
Semana 66 · Preparación · 31 ago → 6 sep

[Cierre anterior ✓] [Compras 3/3] [Operación 0/3] [Cierre físico pendiente]

Siguiente acción: Registrar compras generales
[Registrar entrada]                         [Ver diferencias]

Compras de la semana   Ventas acumuladas   Caja pendiente   Inventario físico
       $—                    $—                —               $35,264.47

Lun  Preparación   Mar  Compras   Mié  Compras   Jue  Preparación
Vie  Operación     Sáb  Operación Domingo Cerrar día
```

La pantalla nunca debe pedir al usuario que elija snapshot, lote o fuente FIFO
para continuar. Sólo debe mostrar el bloqueo y llevarlo a resolverlo.

### Flujo de Entradas

Una única puerta para Costco, Bodegas, La Comer, Farmacia, Frutería y cualquier
otro proveedor:

1. Foto o captura simple: proveedor, fecha, forma de pago.
2. Líneas: producto, cantidad comprada, presentación e importe.
3. Confirmación: “entra al inventario”, “gasto operativo” o “pendiente de
   revisar”.
4. Resultado: ticket, movimiento y lote FIFO vinculados automáticamente.

Unidad base, contenido, rendimiento, factor y costo por unidad base quedan en
“Ver detalle”. El operador debe leer frases como `2 botellas × 700 ml = 1,400
ml`, no campos de base de datos.

### Flujo de Inventario

- `Conteo físico de esta semana` como acción principal.
- Local y Bodega como zonas del mismo formulario.
- Filtro por categoría y búsqueda rápida, pero sin elegir entre apertura,
  cierre, operativo y ajuste en la ruta normal.
- El sistema determina el tipo según la fase y permite “Corrección documentada”
  sólo desde Auditoría.
- Después de guardar: diferencia FIFO por producto, causa sugerida y acción
  (“confirmar compra”, “revisar receta”, “investigar merma”).

### Flujo de Cierre

Un asistente único con validaciones visibles:

1. **Ventas y pagos:** Epos, efectivo, tarjeta, propinas y cuentas abiertas.
2. **Entradas y egresos:** tickets pendientes, gastos, sueldos y compras pagadas.
3. **Inventario físico:** conteo completo y factores válidos.
4. **Resultado:** flujo de caja, utilidad operativa, patrimonio físico y
   diferencias FIFO; confirmar cierre.

Al confirmar, el sistema crea la evidencia técnica actual, bloquea la semana,
abre la siguiente y deja una lista de decisiones. Reabrir debe ser una acción
administrativa excepcional, no parte del uso normal.

## 6. Modelo de integración sin duplicar datos

Se recomienda añadir una capa de orquestación, no otra contabilidad:

```text
Semana / fase actual
  ├─ Entradas (purchases + purchase_capture_lines + movimientos + lotes)
  ├─ Operación diaria (Epos + conciliación + gastos)
  ├─ Inventario físico (inventory_snapshot + inventory_lines)
  ├─ Auditoría FIFO (lots + consumptions + adjustments + reconciliations)
  └─ Resultado (caja + utilidad + patrimonio + decisión)
```

La capa puede empezar como un servicio `resumenOperativoSemana()` y un estado
derivado; no necesita una segunda tabla de inventario. Si se agrega una tabla,
debe ser sólo un `workflow`/estado de tareas, nunca saldos paralelos.

## 7. Plan de implementación

### P0 — Convertir la semana en el producto principal

1. Crear el estado derivado de fase y bloqueadores.
2. Rehacer Inicio como `Semana actual` con la siguiente acción real del lunes,
   compras generales, operación diaria y cierre.
3. Unificar compras, gastos y movimientos en Entradas.
4. Convertir el cierre en asistente de cuatro pasos.
5. Integrar el conteo físico y el cierre sin navegar entre pantallas.
6. Corregir la ruta/navegación de Tareas o integrarla en el día.

**Aceptación:** un usuario puede trabajar una semana completa siguiendo sólo
Semana actual → Entradas → día → cierre, sin conocer FIFO ni snapshots.

### P1 — Completar datos maestros y proteger acciones críticas

1. Resolver los 17 productos sin zona y 4 sin categoría.
2. Resolver los 23 productos de menú sin ID Epos.
3. Separar compras recurrentes de proveedores extraordinarios en la interfaz.
4. Limitar offline a acciones seguras.
5. Mover lotes, snapshots, Epos crudo y movimientos a Historial/Auditoría.

### P2 — Mando de decisiones

1. Comparativos semanales de ventas, food cost, margen, rotación y cobertura.
2. Cola de incidencias con responsable, fecha y acción.
3. Alertas de costo creciente, baja rotación y diferencias recurrentes.
4. Prueba E2E del ciclo completo y reporte de salud del sistema.

## 8. Criterio de éxito

Ibérico se sentirá integrado cuando:

- la pantalla principal siempre diga qué toca hacer hoy;
- una compra se capture una sola vez y produzca todos sus efectos;
- el operador nunca elija entre inventario físico y FIFO para decidir existencia;
- el conteo de cierre sea una sola operación visible;
- el cierre explique caja, utilidad, patrimonio y diferencias sin mezclar cifras;
- los detalles técnicos estén disponibles para auditar, pero no estorben para
  operar;
- cada semana termine con una decisión concreta, no sólo con un reporte.

**No se modificaron datos de producción durante esta auditoría.**
