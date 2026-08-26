# Auditoría integral y plan de evolución — Ibérico / NOD3

**Fecha:** 26 de agosto de 2026  
**Alcance:** operación de Ibérico, integración Epos Now, compras y tickets, FIFO, inventario físico, recetas/costeo, cierre, navegación y experiencia de uso.  
**Fuente:** implementación actual, documentación del repositorio, pruebas automatizadas y lectura de producción. No se inventan existencias ni resultados.

## 1. Conclusión ejecutiva

Ibérico ya tiene los componentes técnicos necesarios para una primera operación integrada: ventas Epos, pagos diarios, compras, lotes FIFO, recetas, inventario físico, gastos, cierre y patrimonio. Sin embargo, la experiencia todavía se percibe como módulos acumulados. El problema principal ya no es añadir tablas o pantallas; es hacer que una persona pueda seguir un solo ciclo sin duplicar datos:

> **Abrir semana → operar cada día → registrar ventas, compras y gastos → consumir FIFO → contar físicamente → explicar diferencias → cerrar → abrir la siguiente semana.**

La prioridad de producto debe ser la confiabilidad de ese ciclo. Cualquier cifra que no pueda explicarse por una fuente, una conversión, una compra, una receta o un conteo debe permanecer como excepción.

## 2. Estado actual verificado

### Fortalezas

- Epos Now ya puede leerse en modo de solo lectura y devuelve ventas por producto, día y método de pago.
- El libro FIFO es continuo: los lotes abiertos cruzan semanas y no deben recrearse en cada cierre.
- Las recetas y el catálogo trabajan con unidad base; el inventario puede capturarse en presentación mediante factores.
- Las compras confirmadas crean lotes FIFO y movimientos asociados.
- El inventario de cierre puede encadenarse como apertura de la semana siguiente.
- Las correcciones de inventario generan snapshot nuevo, ajuste auditable y lote/consumo FIFO cuando corresponde.
- Las reversiones se conservan como historial y el costo activo puede separarse de ese historial.
- El cierre ya puede distinguir costo disponible, costo aplicado y excepción real.
- La aplicación conserva fuentes, fechas, usuario y trazabilidad para auditoría.

### Riesgos actuales

- El flujo de compras y movimientos todavía se entiende como dos lugares distintos aunque deben ser una sola entrada operativa.
- La captura de tickets exige conocer conceptos internos (unidad base, contenido de compra, factor, costo unitario), lo que es demasiado para un colaborador.
- En móvil hay demasiados campos visibles y no se explica qué significa “cantidad base convertida”.
- La navegación usa nombres ambiguos: “Despacho” se interpreta como entregas, aunque muestra salidas; “Cierre y caja”, “Compras”, “Registro único” y “Movimientos” se solapan.
- Hay selectores de semana con formatos históricos mezclados. Debe usarse siempre `Semana X (AAAA-MM-DD → AAAA-MM-DD)`.
- El logo y el encabezado no están homogenizados en todas las vistas; Operación tiene jerarquía e iconografía inconsistente.
- Algunos resúmenes repiten ventas, compras y FIFO en más de una pantalla.
- El sistema debe impedir que una vista presente cifras dependientes como si fueran una conciliación independiente.

### Semana 64: hallazgos de datos

La lectura de producción mostró que las principales diferencias no se solucionan creando compras ficticias:

| Producto | Diferencia observada | Clasificación correcta | Acción segura |
|---|---:|---|---|
| Papel de baño | +3 rollos equivalentes | Conversión de presentación | Normalizar captura a 2 paquetes × 3 rollos; no cambia valor físico |
| Uvas | +400 g equivalentes | Conversión/representación pendiente | Mantener el equivalente; confirmar si fue un paquete de 400 g |
| Jamón serrano | +2,080 g | Compra faltante o conteo | No crear lote sin ticket/fecha; revisar paquete de 250 g vs 170 g |
| Harina | +8,400 g | Compra faltante o conteo | No crear lote sin evidencia |
| Corona | +27 piezas | Compra faltante o conteo | No crear lote sin evidencia |
| Modelo | +24 piezas | Compra faltante o conteo | No crear lote sin evidencia |
| Campari | +517.07 ml | Compra faltante o conteo | No crear lote sin evidencia |

Después de corregir la clasificación por factores, las conversiones falsas de Absolut, queso amarillo, limón y toalla dejaron de reportarse como conversiones y pasaron a posible merma/ajuste. El saldo de W64 sigue requiriendo evidencia independiente: no debe presentarse como una prueba de que FIFO “cuadra” sólo porque el total monetario se aproxima.

## 3. Objetivo operativo que debe guiar el producto

El objetivo no es “medir FIFO”. Es:

> **Determinar qué parte del margen se explica por ventas y costo real, y qué parte se pierde por merma, conteo, conversión, compra faltante, receta o captura.**

La métrica superior semanal será:

`% de semanas con ventas reconciliadas + pagos reconciliados + compras con lote + inventario físico independiente + diferencias clasificadas + una acción operativa ejecutada`.

## 4. Auditoría funcional por flujo

### A. Apertura de semana

**Debe ocurrir:** seleccionar semana, usar el cierre físico anterior como apertura, materializar únicamente los saldos FIFO que no existan, mostrar valor y criterio de costo.

**Problemas:** el usuario puede no distinguir apertura, cierre y conteo operativo; los formatos de unidad no siempre son evidentes.

**Cambio requerido:** una tarjeta de “Estado de semana” con apertura, cierre, estado y fuente; bloquear la apertura si no existe snapshot anterior, salvo una acción explícita de inicialización.

### B. Operación diaria

**Debe ocurrir:** sólo viernes, sábado y domingo; sincronizar ventas/pagos Epos; registrar gastos y compras del día; asociar cada entrada a FIFO si es inventario; cerrar con caja, tarjeta, propinas y observaciones.

**Problemas:** días sin ventas generan ruido; compras extra aparecen separadas de gastos; no se ve el detalle de productos vendidos junto al costo aplicado.

**Cambio requerido:** flujo “Día” único: ventas Epos → entradas/gastos → incidencias → cierre diario. Lunes–jueves sólo aparecen si existe una operación real o un registro administrativo.

### C. Compras y tickets

**Debe ocurrir:** fotografiar ticket, extraer líneas, confirmar producto/presentación/importe/fecha/pago, clasificar inventario o gasto, guardar una sola vez, crear movimiento y lote FIFO.

**Problemas:** la pantalla expone la estructura interna; confirmar ticket y confirmar movimiento pueden parecer acciones diferentes; editar una línea no siempre es obvio.

**Cambio requerido:** “Nueva entrada” como única puerta. La persona sólo confirma: producto, cantidad comprada, presentación, precio, proveedor, fecha y forma de pago. El sistema calcula cantidad base y costo por unidad base; los campos técnicos quedan en “Ver detalle”.

### D. Ventas y consumo FIFO

**Debe ocurrir:** Epos aporta productos, cantidad, importe y forma de pago; cada receta consume ingredientes; cada consumo toma lotes FIFO activos; el costo aparece en la misma vista.

**Problemas:** productos Epos sin mapeo y recetas incompletas se mezclan con faltantes de inventario; una excepción repetida por cada línea de venta dificulta ver la causa raíz.

**Cambio requerido:** agrupar excepciones por causa/producto y mostrar: costo disponible, costo aplicado, cantidad sin costo y causa. No volver a pedir recetas ya validadas.

### E. Inventario físico

**Debe ocurrir:** elegir explícitamente apertura, cierre o conteo operativo; capturar en unidad visible (“6 rollos”, “2 paquetes”, “5 kg = 70 limones”); guardar snapshot inmutable.

**Problemas:** el formulario puede aceptar “kg” cuando el catálogo consume “g”; el usuario no ve rendimiento/factor antes de guardar.

**Cambio requerido:** cada línea debe mostrar unidad de captura, unidad base, factor, equivalente calculado y costo estimado. Si el usuario escribe 5 kg de limón, mostrar inmediatamente `5 kg × 14 piezas/kg = 70 piezas` y validar la presentación.

### F. Cierre y conciliación

**Debe ocurrir:** ventas netas, pagos, propinas, comisión, compras, costo FIFO activo, inventario inicial/final, diferencia física y resultado operativo.

**Problemas:** algunos valores se leen como flujo de caja y otros como resultado contable; el cierre puede parecer correcto aunque ventas y costo provengan de fuentes dependientes.

**Cambio requerido:** dos vistas explícitas:

1. **Caja de la semana:** cobros, pagos, propinas, gastos y compras pagadas.
2. **Resultado operativo:** ventas netas − costo FIFO activo − gastos operativos − comisiones.

Debajo, una conciliación independiente: `FIFO esperado vs inventario físico`, con diferencia por producto y tipo de incidencia.

## 5. Matriz de integración objetivo

| Fuente | Registro único | Salida que consume | Control requerido |
|---|---|---|---|
| Epos Now | Ventas y pagos diarios | Consumo de recetas, margen, cierre | Ventana horaria, idempotencia y método de pago |
| Foto/ticket | Entrada de compra | Movimiento, lote FIFO, gasto/pago | OCR sugerido, confirmación humana y hash |
| Receta validada | Producto terminado | Consumo teórico por ingrediente | Versionado; no re-pedir confirmación |
| Lote FIFO | Existencia valuada | Costo de ventas, inventario disponible | FIFO activo; reversiones sólo históricas |
| Snapshot físico | Apertura/cierre | Conciliación y siguiente semana | Tipo obligatorio y factor visible |
| Gasto operativo | Egreso diario | Caja y resultado operativo | Evitar duplicarlo como compra |
| Corrección | Ajuste auditable | Nuevo snapshot y ajuste FIFO | Motivo, usuario, fecha y clave idempotente |
| Excepción | Cola de revisión | Acción operativa | Agrupación por causa y resolución explícita |

## 6. Auditoría de UX, visualización y contenido

### Navegación propuesta

1. **Inicio** — estado de semana, cuello de botella y siguiente acción.
2. **Operación** — sólo viernes–domingo; una tarjeta por día con ventas, entradas y cierre.
3. **Entradas** — tickets, compras de inventario y gastos en un mismo flujo.
4. **Inventario** — apertura, cierre, conteo y ajustes.
5. **Ventas** — productos vendidos, pagos, propinas y costo FIFO.
6. **Cierre** — caja, resultado operativo y conciliación física.
7. **Costeo del menú** — recetas, costo FIFO vigente y margen por producto.
8. **Incidencias** — excepciones agrupadas y acciones.
9. **Historial** — tickets, lotes, movimientos y auditoría.
10. **Configuración** — productos, presentaciones, factores, recetas y reglas.

“Registro único” puede conservarse como concepto interno, pero para el usuario debe llamarse **Entradas**. “Despacho” debe reservarse para entregas; si la vista son ventas enviadas, llamarla **Salidas**.

### Qué eliminar, fusionar u ocultar

- Fusionar compras y movimientos extra en **Entradas**; un ticket de inventario genera automáticamente su movimiento y lote.
- Fusionar Dashboard/Resumen/Command Center en **Inicio**.
- Ocultar borradores IA, Laboratorio y Tareas mientras no formen parte del flujo real.
- Mantener Historial y Auditoría como consulta, no como otra forma de capturar.
- Quitar textos tutoriales repetidos; dejar una frase de ayuda contextual y un enlace “¿Cómo se calcula?”.
- Colapsar por defecto el detalle FIFO, excepciones y soporte; mostrar primero totales accionables.
- Mantener el logo, iconos, color de estado y espaciado en un único componente de encabezado.

### Formulario de entradas simplificado

**Paso 1 — Ticket:** foto, fecha, proveedor, método de pago.  
**Paso 2 — Líneas:** producto sugerido, cantidad de compra, presentación, importe.  
**Paso 3 — Confirmar:** resumen de inventario que entra, gasto, lote FIFO y total.  
**Avanzado:** unidad base, contenido, rendimiento, factor y notas.

Mensajes breves:

- “Entra al inventario: 5 botellas × 700 ml = 3,500 ml”.
- “Costo FIFO: $0.29 por ml”.
- “No se creó lote: falta asociar producto”.
- “Guardado. El ticket y el movimiento están vinculados”.

## 7. Métricas necesarias para tomar decisiones

### Rentabilidad

- ventas netas por día y semana;
- costo FIFO activo por producto y categoría;
- margen bruto y food cost;
- gastos operativos y resultado operativo;
- comisión de terminal;
- propinas separadas de ventas.

### Control operativo

- ventas por producto y unidades;
- rotación y días de cobertura;
- compras por proveedor y categoría;
- compras faltantes/no clasificadas;
- tiempo desde ticket hasta lote;
- pagos Epos vs corte diario;
- porcentaje de días cerrados.

### Pérdida y calidad de datos

- diferencia física en unidades base y pesos;
- valor de diferencia al costo FIFO;
- merma confirmada vs posible merma;
- errores de conversión;
- recetas sin ingrediente/mapeo;
- excepciones por causa raíz;
- porcentaje de cifras independientes.

### Decisión

Cada cierre debe terminar con una acción: ajustar porción, revisar proveedor, corregir captura, investigar merma, modificar compra o mantener la operación. Una métrica sin acción no debe ocupar el resumen principal.

## 8. Plan de implementación por etapas

### P0 — Confiabilidad y simplicidad (siguiente bloque)

1. Normalizar formato de semanas y estado de apertura/cierre.
2. Rediseñar formulario de entradas para ocultar campos técnicos y mostrar conversiones.
3. Unificar compras y movimientos con idempotencia y vínculo visible.
4. Agrupar excepciones por producto/causa y separar costo disponible, aplicado y excepción.
5. Mostrar ventas Epos, pagos y propinas junto al cierre diario.
6. Homogenizar navbar, logo, iconos, títulos y estados vacíos.
7. Añadir guardas: no duplicar ticket, compra, gasto, lote ni sincronización Epos.

**Aceptación:** un colaborador puede fotografiar un ticket, confirmar sus líneas y producir una entrada + gasto/lote sin conocer FIFO; el cierre muestra cifras independientes y una cola de excepciones comprensible.

### P1 — Operación integrada en vivo

1. Sincronización Epos diaria programada y botón de vista previa antes de importar.
2. Importación idempotente por transacción Epos y ventana temporal.
3. Costeo FIFO en vivo al confirmar cada compra y cada venta.
4. Inventario físico guiado por presentación y conversión.
5. Propagación automática del costo vigente a Costeo del menú, sin sobrescribir versiones históricas.
6. Pantalla de productos vendidos y costo por día.
7. Edición segura de tickets (fecha, proveedor, pago y líneas) con recalculo de lote/movimiento.

**Aceptación:** una semana puede operarse sin Excel paralelo; toda venta mapeada tiene costo o una excepción agrupada y explicada.

### P2 — Mando operativo y decisiones

1. Inicio orientado a cuello de botella y acción recomendada.
2. Tendencias de margen, merma, rotación y compras por proveedor.
3. Roles para captura de tickets, revisión y aprobación.
4. Alertas de inventario anormal, costo creciente, baja rotación y diferencias recurrentes.
5. Comparación entre semanas y seguimiento de acciones tomadas.

**Aceptación:** el sistema produce una decisión semanal defendible, no sólo un reporte histórico.

## 9. Tratamiento de conversiones y compras de mayor valor

### Se puede resolver ahora sin inventar

- Papel de baño: conservar 6 rollos físicos y normalizar la representación a 2 paquetes de 3. Es una corrección de unidad, no una compra.
- Uvas: conservar 400 g equivalentes y pedir únicamente confirmación de que la captura fue un paquete de 400 g.
- Factores de apertura/cierre: conservar el valor base y no volver a clasificar como conversión cuando el factor no cambió.

### No se debe crear automáticamente

Jamón serrano, harina, Corona, Modelo y Campari muestran excedentes importantes, pero la base revisada no contiene un ticket de W64 que los respalde. Hay lotes históricos cancelados para algunos productos; reactivarlos sin fecha y comprobante rompería el objetivo de una conciliación independiente. Deben permanecer como **compra faltante/conteo pendiente** hasta adjuntar el ticket o confirmar formalmente que eran existencias iniciales.

## 10. Protocolo de la próxima semana

1. Abrir W65 únicamente con el snapshot final corregido de W64.
2. Antes de vender, verificar que los lotes abiertos existan y que su unidad base coincida con la receta.
3. Cada día viernes–domingo: sincronizar Epos, confirmar pagos/propinas, registrar tickets y gastos, y cerrar el día.
4. No corregir una diferencia en silencio: crear ajuste con motivo y evidencia.
5. Al cierre: comparar FIFO activo con inventario físico, clasificar diferencias y elegir una acción.
6. Sólo después de revisar la cola, cerrar la semana y encadenar la apertura siguiente.

## 11. Criterio de éxito de la evolución

Ibérico/NOD3 estará funcionando como mando operativo integrado cuando:

- una sola captura de ticket actualice gasto, compra, lote FIFO e historial;
- las ventas de Epos y pagos diarios sean reconciliables sin doble captura;
- el inventario inicial y final estén definidos por snapshot y unidad base;
- el costo de ventas use sólo FIFO activo;
- las diferencias físicas sean independientes, valorizadas y clasificadas;
- los costos del menú se actualicen con trazabilidad;
- el cierre muestre caja, resultado operativo y patrimonio sin mezclarlos;
- cada semana produzca una decisión concreta para mejorar margen, merma o rotación.

**Decisión recomendada:** no ampliar el alcance funcional hasta terminar P0 y operar una semana completa con el flujo simplificado. Las compras de mayor valor sin evidencia deben seguir en cola; la integridad de los datos vale más que hacer que el total “cuadre” artificialmente.
