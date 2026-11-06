# Cantidades de apertura y cierre — 6 de noviembre de 2026

## Causa y corrección

Un conteo conciliado guarda `cantidad_base` como `qty_captura` con factor 1.
La pantalla multiplicaba esa cantidad por el factor actual del catálogo. Así,
440 g de Pepino se mostraban como 440 kg. No era evidencia de 440 kg físicos.
Además, recuperar la apertura o cierre de otra semana sólo recuperaba su hora:
las cantidades seguían siendo las del inventario actual.

- Cada saldo se interpreta con **su propio factor histórico**.
- Una sola función decide unidad visible, precarga, esperado y envío.
- Graneles por lote se cuentan en kg o litros; presentaciones fijas conservan
  fracciones de envase; unidades discretas se cuentan por pieza. Productos de
  peso variable se pesan directamente. Descripciones ambiguas como «2 piezas»
  no se usan para deducir el peso de una pieza: se pide la unidad base.
- La equivalencia aparece junto al producto. No cambia el catálogo ni las
  presentaciones registradas por compra.
- La recuperación consulta las líneas del conteo oficial seleccionado. Los
  huecos del histórico quedan vacíos, nunca se convierten en cero.
- El cliente envía la cantidad base explícita. El servidor conserva precisión
  y snapshots inmutables, incluidos los guardados parciales por zona.
- `/inventario/current` entrega `cantidad_base` y un conjunto coherente de
  cantidad de captura, factor y etiqueta; mantiene `qty_captura × factor`.
- El detalle de snapshot está autenticado, restringido a administrador y al
  negocio del token. Fallar su recuperación impide guardar datos incompletos.

## Verificación

- 197 pruebas automatizadas y comprobación de tipos; compilación de producción.
- Copia restaurada de producción: 10,975 líneas históricas, 106 productos activos,
  212 saldos actuales por zona. Conversión de ida y vuelta sin cambiar cantidades.
- Navegador: 3,344 campos contrastados, apertura/cierre de semanas 74 y 75,
  Local/Bodega, móvil/escritorio, temas claro/oscuro. Sin errores de JavaScript
  ni desbordamiento horizontal. Cuatro envíos interceptados, sin escribir al servidor.
- En la copia local se guardaron realmente ambas zonas (212 líneas): 0.44 kg
  quedó almacenado como 440 g con factor 1; la primera versión de 106 líneas
  permaneció inmutable al continuar con la segunda zona.
- Pasaron las integraciones de cronología, ciclo semanal y trazabilidad del cierre.
- Auditoría reproducible de sólo lectura sobre copia local:
  `DATABASE_URL=... npx tsx server/scripts/verificar-unidades-conteo.ts`.

No se corrigen cantidades físicas por inferencia, no se reescriben conteos
históricos, no se modifican costos FIFO, compras, ventas, arqueos ni cierres financieros.
