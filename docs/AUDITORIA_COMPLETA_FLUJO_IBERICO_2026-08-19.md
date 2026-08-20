# Auditoría completa de Ibérico

**Fecha:** 19 de agosto de 2026  
**Alcance:** funcionalidad, modelo de datos, flujo operativo, integración Epos Now, inventario, compras, recetas, costeo, finanzas, tareas, navegación, textos, estética, responsive y facilidad de uso.  
**Estado de esta entrega:** auditoría y plan de implementación. No se modificó la lógica ni la interfaz como resultado de este documento.

## 1. Resumen ejecutivo

Ibérico tiene una base técnica útil y una identidad visual consistente, pero todavía está organizado como un back-office administrativo general. El negocio, en cambio, opera como un ciclo muy concreto de fin de semana:

1. Se abre la operación el viernes.
2. Se venden productos en Epos Now.
3. Al final de cada día se revisan ventas por producto y método de pago.
4. Se confirma el corte humano porque Epos registra el pago, pero no determina por sí solo el efectivo físico ni resuelve cuentas que quedan abiertas.
5. Se ingresan compras mediante tickets o fotografías.
6. Las compras entran como lotes con costo propio.
7. Las recetas convierten las ventas en consumo teórico.
8. El consumo se valora con FIFO.
9. Se compara consumo teórico contra inventario físico.
10. Las diferencias se convierten en merma, error de captura, compra faltante o incidencia operativa.
11. El domingo se cierra la semana.
12. El inventario final de esa semana abre la siguiente.

La aplicación actualmente cubre partes importantes de este ciclo, pero no lo presenta ni lo ejecuta de punta a punta. Las mayores brechas son:

- las compras no conservan todavía toda la información necesaria para FIFO;
- no existe un libro de consumo que conecte venta, receta, lote y costo;
- las importaciones de Epos se guardan, pero la conciliación diaria visible en Finanzas puede quedar separada del registro formal de conciliaciones;
- se siguen mostrando los siete días aunque la operación real ocurre viernes, sábado y domingo;
- la pantalla de Tareas quedó observada en estado `Cargando…` durante la auditoría;
- la navegación mezcla operación diaria, administración, patrimonio, marketing y funciones experimentales;
- algunos documentos del proyecto describen FIFO y pilotos que no se reflejan completamente en el esquema o en las rutas actuales;
- la rentabilidad todavía no es una utilidad operativa real: parte de la lógica usa variación de saldos de efectivo como “utilidad”.

### Veredicto

**Ibérico todavía no debe considerarse una implementación completa del sistema operativo del bar.** Sí debe considerarse una buena base para un piloto real de fin de semana, siempre que primero se ordene el flujo de cierre diario, se elimine el ruido de los días sin operación y se haga explícita la diferencia entre:

- dato importado;
- dato revisado;
- dato confirmado;
- dato ajustado por una persona;
- dato que ya tuvo efecto financiero o de inventario.

La prioridad no es construir más módulos. Es convertir la aplicación en una operación semanal guiada, con una sola ruta clara y trazable.

## 2. Fuente de verdad operativa

### 2.1 Flujo real de Ibérico

| Momento | Actividad real | Fuente | Confirmación humana | Resultado esperado |
|---|---|---|---|---|
| Lunes–jueves | No hay ventas regulares del bar | Ninguna o actividad administrativa | No aplica | No crear falsos cortes en cero |
| Viernes | Venta, comandas, cobro y cierre del día | Epos Now + Banorte + observación del responsable | Sí | Corte diario confirmado |
| Sábado | Venta, comandas, cobro y cierre del día | Epos Now + Banorte + observación del responsable | Sí | Corte diario confirmado |
| Domingo | Venta, comandas, cobro y cierre de la semana | Epos Now + Banorte + observación del responsable | Sí | Corte diario y cierre semanal |
| Durante el fin de semana | Compras urgentes o reposición | Ticket/foto + proveedor | Sí | Compra revisada y lote FIFO |
| Al cierre semanal | Inventario físico por zona | Conteo físico | Sí | Snapshot de cierre |
| Apertura siguiente | Copiar cierre anterior como apertura | Snapshot anterior | Automática, con posibilidad de revisión | Inventario inicial de la nueva semana |

### 2.2 Particularidades del cobro

Epos Now registra la venta y el método seleccionado. La terminal de tarjeta es externa y el sistema no conoce directamente cuánto efectivo físico existe. Por eso el dato de Epos debe tratarse como **evidencia del corte**, no como verdad financiera irrevocable.

Una cuenta puede permanecer abierta y cerrarse otro día. El sistema necesita distinguir al menos:

- venta registrada por Epos en el día original;
- cuenta abierta al cierre;
- cuenta cerrada posteriormente;
- diferencia detectada;
- ajuste confirmado por el responsable;
- fecha en que el ajuste tuvo efecto contable.

### 2.3 Principio de operación

La interfaz debe seguir esta secuencia visible:

```text
Importar → Revisar → Explicar excepciones → Confirmar → Aplicar a finanzas/inventario
```

Hoy algunas pantallas permiten importar o capturar valores, pero no siempre muestran el estado completo de esa secuencia.

## 3. Inventario de la aplicación actual

| Área | Qué existe | Encaje con el flujo real | Decisión recomendada |
|---|---|---:|---|
| Inicio | Lanzador de módulos y saludo | Bajo | Convertirlo en “Hoy” / Operating Brief |
| Inventario | Conteo físico, inventario actual y lista de compras | Medio | Mantener conteo; separar compras reales de sugerencias |
| Tareas | Checklists diarios y gestión | Bajo mientras permanezca cargando | Corregir antes del piloto; limitar a días operativos |
| Finanzas | Semana, captura diaria, movimientos y cuadre | Medio | Convertir en Cierre diario y Cierre semanal |
| Patrimonio | Tendencia, pasivos y snapshots | Medio como análisis | Sacarlo de la operación diaria |
| Configuración | Catálogo, inventario, recetas, finanzas y tareas | Medio como administración | Ordenar por dominio y estado |
| Marketing | Cola de contenido y respuestas | Bajo para el piloto | Mover a laboratorio/segunda navegación |
| Silvia | Asistente flotante | Complementario | Ocultar durante cierres o convertir en ayuda contextual |
| Epos Now | Estado, preview, sincronización e importaciones | Alto como base | Conectar oficialmente con conciliación diaria |
| Recetas y costeo | Recetas versionadas y costo estático | Medio | Preparar enlace con consumo FIFO |
| Compras | Movimientos de compra básicos | Bajo | Construir captura de ticket y lotes |

## 4. Auditoría pantalla por pantalla

## 4.1 Inicio

### Observación

La pantalla inicial muestra “Buenas noches” y tarjetas hacia Inventario, Tareas, Finanzas, Patrimonio y Configuración. Es visualmente ordenada y coherente con la marca, pero se comporta como un menú de aplicaciones.

### Lo que falta para el flujo actual

Al abrir Ibérico, el usuario debería saber en segundos:

- si hoy es un día operativo;
- si hay un cierre pendiente;
- si Epos fue consultado;
- qué métodos de pago están pendientes de confirmación;
- si existen cuentas abiertas;
- si hay tickets de compra pendientes;
- si existe un conteo físico pendiente;
- cuál es el siguiente paso.

Nada de eso es actualmente el foco de Inicio.

### Recomendación

Reconvertir Inicio en **Hoy**:

1. Estado del día: `Sin operación`, `Operación abierta`, `Corte pendiente`, `Corte confirmado` o `Cierre bloqueado por excepción`.
2. Botón primario: `Importar corte de Epos`.
3. Resumen: ventas, transacciones, unidades y métodos de pago.
4. Excepciones: cuentas abiertas, diferencias, descuentos, productos sin receta.
5. Acción siguiente.
6. Estado de la semana y del inventario.

Las tarjetas de módulos deben pasar a una sección secundaria llamada `Administración` o `Análisis`.

## 4.2 Inventario

### Fortalezas

- La pantalla de conteo físico tiene una acción clara de guardar.
- Existe separación por zonas y categorías.
- Se conserva un último conteo.
- La cadena apertura/cierre semanal está documentada.
- La acción fija de `Limpiar` / `Guardar conteo` es adecuada para uso operativo.

### Problemas funcionales

1. `Actual` es ambiguo: puede significar último conteo, existencia calculada o inventario disponible.
2. `Compras` se usa para una lista sugerida, pero el flujo real necesita una sección distinta para compras efectivamente realizadas.
3. `Borrador IA` no es una prioridad para el piloto y compite visualmente con el conteo.
4. No existe captura de ticket o fotografía.
5. No existe revisión de líneas de compra por proveedor, fecha, cantidad, presentación y costo.
6. No existe lote FIFO visible.
7. El valor histórico del inventario se calcula con el `unit_cost` actual del catálogo, no con el costo del lote vigente en la fecha del snapshot.
8. No existe consumo de inventario derivado de una venta de Epos y una receta.
9. No existe una pantalla de diferencias que explique qué parte es merma, captura, rendimiento o compra faltante.

### Recomendación de orden

```text
Inventario
  Apertura de semana
  Conteo físico
  Compras recibidas
  Lotes FIFO
  Consumo teórico
  Diferencias y merma
  Cierre de semana
```

`Borrador IA` debe quedar oculto en la navegación principal hasta que el flujo básico funcione de forma estable.

## 4.3 Tareas

### Evidencia observada

Durante la revisión en navegador, `/tareas` permaneció en `Cargando…` después de esperar. No se debe asumir todavía la causa exacta, pero sí tratarlo como bloqueo de experiencia.

### Riesgo operativo

Un usuario no puede saber si:

- no hay tareas;
- la API está lenta;
- la instancia diaria no se creó;
- el endpoint falló;
- la sesión perdió autorización.

### Recomendación

La vista debe tener estados explícitos:

- `Cargando tareas…` con timeout;
- `No hay tareas para este día`;
- `No es día operativo`;
- `No se pudieron cargar las tareas` con reintento;
- `Tareas pendientes`;
- `Tareas completadas`.

Además, no debe crear instancias para lunes–jueves si no existe operación del bar. Las tareas de cocina, apertura y cierre deben aplicarse solamente a viernes, sábado y domingo, salvo que exista una tarea administrativa explícita.

## 4.4 Finanzas

### Fortalezas

- Existe selector semanal.
- Existen vistas por día, resumen, movimientos y cuadre.
- Se puede capturar efectivo, tarjeta, propina, gastos y sueldos.
- Se puede consultar Epos y mostrar métodos adicionales.
- Existe cierre semanal e inventario de apertura/cierre.

### Problemas funcionales

1. Se muestran los siete días aunque no todos tengan operación.
2. El usuario debe interpretar que `Consultar Epos` es una acción de importación, no sólo una consulta.
3. La pantalla rellena efectivo y tarjeta, pero la conciliación formal diaria puede quedar en otra tabla (`conciliaciones_diarias`).
4. No se presenta claramente la transición `importado → revisado → confirmado`.
5. No se diferencia de forma suficiente el dato bruto de Epos, el ajuste humano y el dato que ya alimentó movimientos financieros.
6. Las cuentas abiertas o cerradas tardíamente no tienen una experiencia de seguimiento completa.
7. `Otros mov.` es un texto poco claro para el usuario operativo.
8. La lógica de “ventas” como efectivo + tarjeta + propina no siempre representa exactamente ventas brutas, ventas netas, descuentos y cuentas pendientes.
9. La lógica de resumen semanal usa variación de saldos como “utilidad” en ciertos escenarios. Eso no debe presentarse como rentabilidad real.
10. El cierre semanal puede estar correcto para la cadena de snapshots, pero no tiene todavía el costo FIFO real de los productos vendidos.

### Recomendación de nombres

- `Finanzas` → `Cierre y caja` en la operación diaria.
- `Por día` → `Cortes diarios`.
- `Resumen` → `Resumen semanal`.
- `Otros mov.` → `Movimientos`.
- `Cuadre` → `Cuadre de la semana`.
- `Consultar Epos` → `Importar corte de Epos`.
- `Guardar día` → `Confirmar corte` cuando el usuario acepta el resultado.

### Flujo objetivo

```text
Seleccionar viernes/sábado/domingo
  ↓
Importar Epos
  ↓
Ver ventas por producto y método
  ↓
Ver cuentas abiertas y excepciones
  ↓
Revisar contra efectivo/tarjeta real
  ↓
Confirmar corte
  ↓
Crear movimiento financiero y evidencia
```

## 4.5 Patrimonio

### Uso correcto

Patrimonio es útil para revisión semanal o mensual. La pantalla muestra tendencia, bancos, efectivo, inventario y pasivos de manera visualmente clara.

### Problemas

- No debe competir con el cierre diario.
- Si el inventario se valora con costo catalogado actual y no con lotes históricos, la tendencia puede ser engañosa.
- El usuario puede leer el “valor” como rentabilidad, aunque son conceptos diferentes.
- Pasivos y cuentas por pagar deben mostrar fuente, fecha, proveedor y estado, no sólo un total.

### Recomendación

Mantenerlo como `Análisis → Patrimonio`, con una nota visible:

> Patrimonio no es utilidad. Incluye existencias, saldos y obligaciones al corte.

## 4.6 Configuración

### Observación

Es una pantalla muy amplia con General, Inventario, Recetas y costeo, Finanzas y Tareas. Como administración está bien que concentre controles, pero actualmente mezcla:

- parámetros del sistema;
- datos maestros;
- recetas;
- costos;
- tareas;
- reglas financieras.

### Riesgo

Un cambio de catálogo puede confundirse con una decisión operativa. Además, no siempre queda visible si un producto es:

- confirmado;
- pendiente;
- sin presentación;
- sin costo;
- sin receta;
- sustituido;
- descontinuado.

### Recomendación

Separar visualmente:

1. `Datos maestros`: productos, presentaciones, proveedores, unidades.
2. `Recetas`: ingredientes, cantidades, versiones y vigencia.
3. `Costos`: costos por lote y conversión.
4. `Reglas`: días operativos, pagos, cierre, inventario.
5. `Usuarios y seguridad`.

## 4.7 Marketing

Marketing no pertenece al ciclo operativo del bar. Su existencia puede mantenerse, pero no debe ocupar el mismo nivel que Inventario, Cierre y Tareas.

Recomendación: moverlo a `Laboratorio` o a una sección secundaria. No debe aparecer en la navegación principal del usuario que está cerrando caja o capturando inventario.

## 4.8 Silvia

Silvia puede ser útil como ayuda, pero el globo flotante permanente produce tres riesgos:

- hace que el sistema parezca un chatbot en lugar de un sistema operativo;
- distrae durante el cierre;
- puede sugerir que una respuesta conversacional tiene autoridad sobre el registro oficial.

Recomendación: mantenerla como ayuda contextual opcional y ocultarla durante `Confirmar corte`, `Cerrar semana` y `Registrar inventario`.

## 5. Auditoría del modelo de datos y lógica

## 5.1 Lo que está bien encaminado

- Separación de negocios y datos por negocio.
- Autenticación y roles.
- Versionado de recetas.
- Semanas con apertura y cierre.
- Snapshots de inventario.
- Importación idempotente de datos de Epos.
- Evidencia de importación y ventas normalizadas.
- Registro de conciliación diaria con cuentas abiertas y excepciones.
- Pruebas unitarias para finanzas, inventario, patrimonio, recetas y Epos.
- Migración reciente para las importaciones de Epos.
- Manejo de errores de concurrencia en instancias de tareas.

## 5.2 Brechas críticas

### A. Compras insuficientes para FIFO

Las líneas de compra actuales contienen principalmente producto y cantidad. Para un costo real se necesita conservar:

- proveedor;
- fecha de compra;
- fecha de recepción;
- número de ticket o factura;
- imagen u original del ticket;
- cantidad comprada;
- presentación;
- unidad base;
- precio total;
- descuentos e impuestos;
- costo unitario convertido;
- lote;
- cantidad recibida;
- cantidad disponible;
- estado de revisión;
- usuario que confirmó.

### B. No existe libro de lotes y consumo

Para que una venta descuente inventario se necesita un registro explícito:

```text
Venta Epos
  → producto de menú
  → receta vigente
  → ingredientes y cantidades
  → lotes FIFO consumidos
  → costo de venta
  → inventario restante
```

Sin ese libro no hay forma auditable de explicar el costo de una semana.

### C. Costeo estático

La lógica actual de recetas calcula con `unit_cost` del catálogo y conversiones generales. Eso sirve como estimación, pero no como costo FIFO histórico. La documentación que habla de un piloto FIFO debe alinearse con la implementación real o marcarse como diseño pendiente.

### D. Valuación histórica

El valor de snapshots históricos se apoya en costos actuales del catálogo. Eso puede cambiar el valor de una semana ya cerrada cuando cambia el precio de un producto. El costo histórico debe quedar congelado en el snapshot o en los lotes consumidos.

### E. Productos de Epos sin mapeo

En la prueba observada, las ventas por producto se recibieron con `product_id: null`. El nombre permite revisar manualmente, pero no permite todavía una relación robusta con la receta. Se necesita una tabla de correspondencia:

| Nombre Epos | Producto menú | Receta | Estado |
|---|---|---|---|
| Nombre exacto del POS | ID interno | Versión vigente | Confirmado / pendiente |

Los productos sin correspondencia deben aparecer como excepción antes de cerrar la semana.

### F. Conciliación duplicada

La ruta de Epos puede guardar importación y la pantalla de Finanzas puede guardar movimientos diarios, mientras que `conciliaciones_diarias` conserva otra versión. Debe existir una sola entidad oficial de confirmación y las demás deben ser evidencia o proyección.

### G. Utilidad versus flujo de efectivo

La variación de saldos puede ser útil para control de caja, pero no equivale a:

```text
Ventas netas
− costo de ventas FIFO
− merma
− gastos operativos
− nómina
− impuestos y comisiones
= utilidad operativa estimada
```

La interfaz debe dejar de llamar “utilidad” a un saldo si no contiene esa metodología.

### H. Cuentas abiertas y cierres tardíos

La conciliación necesita versionar o ajustar un día sin duplicar ventas. Una cuenta cerrada el sábado que pertenece operativamente al viernes debe mostrar:

- fecha de apertura;
- fecha de cierre;
- fecha de reconocimiento financiero;
- razón;
- usuario;
- impacto del ajuste.

## 6. Auditoría visual, estética y de facilidad de uso

## 6.1 Fortalezas visuales

- Sistema de color consistente en oscuro y claro.
- Verde reservado para acciones y estados positivos.
- Tarjetas y bordes coherentes.
- Tipografía legible en escritorio.
- Estados activos visibles.
- `focus-visible` y controles con affordance razonable.
- Buena intención responsive.
- Acción fija de guardar en Inventario.
- Marca visual de NODO / Ibérico coherente.

## 6.2 Problemas visuales y de orden

### Navegación plana

Los siete destinos aparecen al mismo nivel:

```text
Inicio · Inventario · Tareas · Finanzas · Patrimonio · Configuración · Marketing
```

Eso obliga al usuario a recordar la arquitectura interna, en vez de seguir la operación.

### Móvil

Con viewport de 390 px, Finanzas reportó un `scrollWidth` aproximado de 691 px. Esto confirma overflow horizontal. La barra inferior de siete elementos queda demasiado comprimida y reduce la legibilidad.

Recomendación:

- máximo cuatro destinos primarios en móvil;
- `Más` para administración y análisis;
- evitar barras horizontales sin indicación;
- permitir que el selector de semana se apile;
- botones de al menos 44 px;
- no mostrar tabs que no tengan contenido en el estado actual.

### Lenguaje técnico o ambiguo

Textos a revisar:

| Texto actual | Problema | Alternativa |
|---|---|---|
| Finanzas | Demasiado amplio | Cierre y caja |
| Actual | No explica qué es | Existencia actual |
| Compras | Puede significar sugerencia o compra realizada | Lista de compra / Compras recibidas |
| Otros mov. | Abreviatura poco clara | Movimientos |
| Consultar Epos | Parece lectura sin efecto | Importar y revisar corte |
| Patrimonio | Correcto para administración, no para operación | Mantener sólo en Análisis |
| Borrador IA | Desvía la atención | Ocultar en piloto |
| Línea | No pertenece al flujo real de Ibérico | Eliminar si no tiene función |

### Estados vacíos

No basta con mostrar `0`. El sistema debe explicar:

- `No hay operación programada`;
- `Todavía no se importó Epos`;
- `Importado, pendiente de revisión`;
- `Confirmado`;
- `No hay compras recibidas`;
- `No existe inventario de apertura`;
- `Faltan recetas o correspondencias`.

### Carga indefinida

`Cargando…` sin timeout, mensaje o reintento es indistinguible de una aplicación rota. Cada pantalla debe tener estados de carga, vacío, error, reintento y éxito.

## 7. Arquitectura de navegación propuesta

No se implementa todavía en esta auditoría; es la propuesta para la siguiente etapa.

```text
HOY
  Cierre de hoy
  Excepciones

SEMANA
  Operación
  Compras recibidas
  Inventario
  Cierre semanal

ANÁLISIS
  Rentabilidad
  Merma
  Patrimonio

ADMINISTRACIÓN
  Catálogo
  Recetas y costeo
  Finanzas y reglas
  Usuarios

LABORATORIO
  Silvia
  Marketing
```

### Navegación mínima de operación

En escritorio, el rail puede mostrar:

1. Hoy
2. Operación
3. Compras
4. Inventario
5. Cierre

En móvil:

1. Hoy
2. Ventas
3. Inventario
4. Más

## 8. Flujo objetivo de una semana real

### Antes del viernes

- Confirmar que existe inventario de apertura.
- Confirmar recetas vigentes.
- Confirmar productos Epos mapeados.
- Revisar compras pendientes de recepción.
- Mostrar alertas de insumos sin costo o sin presentación.

### Viernes, sábado y domingo

Para cada día:

1. Abrir `Hoy`.
2. Importar ventas de Epos.
3. Revisar ventas por producto.
4. Revisar métodos de pago.
5. Revisar descuentos y cuentas abiertas.
6. Revisar productos sin receta.
7. Comparar efectivo/card con el cierre real.
8. Confirmar corte.
9. Registrar excepciones.

### Compras

1. Tomar foto del ticket.
2. Extraer líneas o capturarlas manualmente.
3. Confirmar proveedor, fecha y total.
4. Asociar cada línea a producto interno.
5. Convertir presentación a unidad base.
6. Crear lote FIFO.
7. Marcar como revisado.

### Domingo al cierre

1. Confirmar el corte del domingo.
2. Ver ventas semanales.
3. Ver costo FIFO de ventas.
4. Ver compras y lotes recibidos.
5. Capturar inventario físico por zona.
6. Ver diferencias y merma.
7. Confirmar cierre.
8. Crear automáticamente apertura de la siguiente semana.

## 9. Backlog priorizado

### P0 — Antes del siguiente piloto real

1. **Cierre diario oficial**
   - Integrar importación Epos, conciliación diaria y confirmación humana.
   - Evitar que Finanzas y `conciliaciones_diarias` tengan estados incompatibles.
   - Mostrar evidencia, usuario, timestamp y excepciones.

2. **Corregir Tareas**
   - Diagnosticar la carga indefinida.
   - Agregar estados de error/vacío/reintento.
   - Limitar tareas operativas a viernes–domingo.

3. **Convertir Inicio en Hoy**
   - Mostrar estado de día, corte pendiente, compras, inventario y siguiente acción.

4. **Eliminar ruido de días sin operación**
   - No crear cierres falsos para lunes–jueves.
   - Mostrar esos días sólo en un resumen colapsado o como `sin operación`.

5. **Mapear todos los productos de Epos**
   - Impedir cierre con productos sin producto interno o receta, salvo excepción confirmada.

6. **Compras mínimamente trazables**
   - Proveedor, ticket, fecha, línea, cantidad, presentación, precio y estado de revisión.

7. **Migraciones y despliegue**
   - Ejecutar migraciones de importaciones en el entorno correcto.
   - Verificar variables y roles de sólo lectura.
   - No exponer secretos en cliente ni en reportes.

### P1 — Después de una semana real

1. Lotes FIFO persistentes.
2. Consumo de lote por receta y venta.
3. Costeo histórico congelado.
4. Diferencia entre consumo teórico y físico.
5. Merma clasificada por causa.
6. Tickets con OCR opcional, siempre con revisión humana.
7. Cierre semanal con inventario final como apertura siguiente.
8. Responsive móvil de Finanzas e Inventario.
9. Estados y textos revisados en todas las pantallas.

### P2 — Cuando exista evidencia recurrente

1. Rentabilidad por producto, familia y día.
2. Ranking de productos por margen y volumen.
3. Proyección de compras.
4. Alertas de desviación de receta.
5. Ajustes por cuentas cerradas tarde.
6. Historial de cambios de precio y menú.
7. Revisión de gastos fijos contra margen.

### P3 — No prioritario ahora

- Marketing dentro de la navegación primaria.
- Más capacidades de Silvia.
- Borradores de IA para inventario.
- Reemplazo completo de Epos.
- Multi-negocio avanzado.
- Integraciones genéricas no utilizadas.
- Dashboards decorativos.

## 10. Criterios de aceptación del siguiente piloto

El piloto se considerará funcional si, en una semana viernes–domingo:

### Ventas

- Cada día operativo puede importar Epos una sola vez sin duplicar.
- Se muestran ventas por producto y método.
- El periodo y la zona horaria son claros.
- Los productos tienen correspondencia interna o excepción explícita.

### Cierre diario

- Se distingue importado, revisado y confirmado.
- Se registran cuentas abiertas.
- Un ajuste posterior no duplica ventas.
- El usuario ve exactamente qué cambiará al confirmar.

### Compras

- Una compra conserva proveedor, fecha, ticket y líneas.
- Los precios no se sustituyen por un promedio global.
- Cada línea puede convertirse en unidad base.

### Inventario

- La semana abre con el cierre anterior.
- El inventario final se congela.
- El valor histórico no cambia al modificar el precio actual.
- Las diferencias se explican.

### Costeo

- La venta se puede asociar a una receta vigente.
- El costo de venta usa lote FIFO cuando existe.
- Los faltantes quedan pendientes, no se inventan silenciosamente.

### Experiencia

- Lunes–jueves no generan ruido.
- Las pantallas tienen estados de carga, vacío y error.
- El flujo principal se puede completar desde Hoy.
- El móvil no tiene overflow horizontal.
- El usuario no necesita conocer el modelo de datos para cerrar un día.

## 11. Inconsistencias entre documentación y código

| Documento o afirmación | Evidencia actual | Conclusión |
|---|---|---|
| El piloto ya tiene FIFO y 130 lotes | El esquema actual no contiene lote/consumo FIFO equivalente | Marcar como diseño/piloto documental o implementar el modelo real |
| Costos ya vienen de FIFO | La función de recetas usa `products.unit_cost` | No presentar todavía como costo FIFO histórico |
| Compras pueden soportar costos exactos | Las líneas de compra no conservan proveedor, precio y ticket completos | Ampliar el dominio de compras |
| Epos importado alimenta evidencia | Sí, se persiste la importación | Correcto, pero falta exponer historial y confirmación en UI |
| El cierre representa utilidad | Parte de la lógica representa variación de caja | Cambiar nombre o separar flujo de efectivo de rentabilidad |
| La app es back-office general | El flujo real es bar de fin de semana | Reposicionar navegación y textos |

## 12. Auditoría técnica realizada

### Pruebas

La suite ejecutada fuera del límite temporal del entorno terminó correctamente:

- **5 archivos de prueba aprobados**;
- **66 pruebas aprobadas**;
- Finanzas, inventario, patrimonio, recetas y Epos cubiertos.

### Build

El build completo terminó correctamente para cliente y servidor. Se observó únicamente una advertencia de Vite relacionada con la importación dinámica y estática de `offline.ts`; no bloquea el build, pero conviene limpiarla después.

### Límites de la auditoría

- No se modificó producción.
- No se usaron credenciales de producción para alterar datos.
- La observación de Tareas demuestra un problema de experiencia, pero todavía requiere logs de endpoint para identificar la causa exacta.
- La auditoría visual se realizó sobre el entorno local autenticado.
- No se validó todavía una semana completa real con compras, Epos, recetas, FIFO y cierre porque ese flujo aún no existe de forma integral.

## 13. Decisión recomendada

No seguir agregando funciones aisladas. La siguiente etapa debe ser un sprint de alineación operacional en este orden:

1. **Cierre diario Epos + confirmación humana.**
2. **Hoy como centro de operación.**
3. **Tareas viernes–domingo y estados de carga confiables.**
4. **Compras trazables, aunque la foto todavía requiera captura manual.**
5. **Productos Epos mapeados a menú y recetas.**
6. **FIFO mínimo y libro de consumo.**
7. **Conteo final como apertura siguiente.**
8. **Rentabilidad y merma únicamente después de lo anterior.**

La regla para cualquier cambio posterior debe ser:

> Si una modificación no ayuda a importar, confirmar, costear, contar, cerrar o aprender de una semana real, no pertenece al siguiente sprint.

## 14. Resultado esperado después de aplicar la auditoría

Al abrir Ibérico un viernes, el usuario no debería preguntarse qué módulo usar. Debería ver:

```text
Hoy es viernes.
La operación está abierta.
El corte de Epos todavía no se ha importado.
La siguiente acción es importar y revisar.
Hay 0 excepciones.
El inventario de apertura está confirmado.
```

Al cerrar el domingo debería ver:

```text
Ventas confirmadas.
Métodos de pago revisados.
Cuentas abiertas explicadas.
Compras recibidas como lotes.
Consumo FIFO calculado.
Inventario físico capturado.
Diferencias clasificadas.
Semana cerrada.
La siguiente semana abre con este inventario.
```

Ese es el criterio que debe guiar la aplicación. La estética debe servir a ese proceso; la arquitectura debe conservarlo; y la inteligencia artificial sólo debe ayudar cuando exista evidencia suficiente y siempre después de la confirmación humana.
