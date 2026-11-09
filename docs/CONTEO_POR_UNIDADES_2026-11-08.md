# Conteo por unidades y ventas posteriores a la captura — 8 de noviembre

## Entrega

- Apertura, cierre y ajuste manual se capturan en **unidades y fracciones**, con el tamaño visible en cada selector: botella de 600 ml, envase de 680 g, frasco de 227 g, etc.
- Se consultan presentaciones de compras y tamaños de envases documentados. Los alcoholes de presentación exacta conservan su referencia confirmada. No se convierte todo mezclador a una botella universal.
- “Otro tamaño” permite separar, por ejemplo, 2 botellas de 600 ml y media de 2 L: el total real es 2,200 ml. Se puede definir un tamaño manual cuando no está documentado.
- Un producto a granel o de peso variable tiene una unidad de referencia explícita, editable; no se inventa un peso uniforme por pieza. Los tamaños métricos son contenido de la unidad, no la cantidad que se pide contar.
- El desglose de los nuevos conteos se conserva en el campo opcional `inventory_lines.presentaciones_json`, junto a la cantidad base y el corte. La continuación entre zonas conserva el desglose anterior. Los registros históricos no se reinterpretan ni se reescriben.
- El servidor verifica que la suma de unidades × tamaño coincida con la cantidad base, y que las unidades base sean compatibles. No guarda un desglose incompleto o contradictorio.

## Revisión del cierre real

El usuario confirmó que capturó **kg y litros reales**, no número de envases.
El cierre oficial 117 tiene 214 líneas: 107 productos activos en dos zonas, sin productos omitidos.
Local y Bodega quedaron al 8 de noviembre a las 20:16 de México. Las cantidades se mantienen
intactas; sólo se convierte la vista a unidades equivalentes. Por ejemplo, los 1,360 g de
Prego en Bodega se muestran como 2 envases de 680 g.

## Importación del domingo

La consulta de Epos devolvió 25 líneas por $2,395, con última venta a las 19:11:46 de México,
antes del corte de las 20:16. Se actualizó la importación 38:

- 20 líneas nuevas y 5 ya registradas omitidas sin duplicar.
- $2,050 efectivo y $345 tarjeta según Epos, sin confirmar automáticamente Caja/Banco.
- 18 líneas recién costeadas, 2 con excepción y las restantes ya costeadas.
- Comparación exacta antes/después: mismas cantidades por producto/zona, mismo cierre 117,
  mismas horas, mismos movimientos financieros y conciliaciones. Las ventas anteriores al
  conteo no vuelven a restarse del físico.

No se cerró financieramente la semana ni se inventaron faltantes, compras o conteos.

## Verificaciones

- 288 pruebas automatizadas, typecheck y build de producción.
- Seis verificaciones integrales: cronología de zonas, ciclo FIFO, trazabilidad, integridad
  de aplicación, decimales y conteo por presentaciones. La nueva regresión comprueba que una
  venta capturada tarde pero ocurrida antes del físico no descuenta; una venta posterior sí
  descuenta una vez, y el desglose/horas de ambas zonas se conserva.
- QA visual: 424 campos revisados en dos zonas y móvil/escritorio; equivalencia con las
  cantidades del cierre guardado, sin desbordes ni errores JavaScript. Guardados simulados
  de tamaños mezclados validan el payload sin escribir sobre producción.

La migración sólo añade una columna opcional; no cambia cantidades, factores ni fechas.
