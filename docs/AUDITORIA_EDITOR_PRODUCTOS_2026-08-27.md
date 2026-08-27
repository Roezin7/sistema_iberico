# Auditoría y rediseño — Editor de productos y recetas

**Fecha:** 27 de agosto de 2026  
**Alcance:** Configuración → productos, reglas de compra/FIFO, captura por zona y recetas.

## Hallazgos

1. La pantalla llamada **Inventario** reunía tres responsabilidades distintas: catálogo, presentación/costeo y forma de captura. El usuario tenía que abrir filas y recordar qué campo afectaba a cada proceso.
2. Tienda, mínimo, costo, contenido y rendimiento estaban mezclados en un formulario sin una vista previa de la conversión. Esto hacía fácil confundir “costo de presentación” con “costo por gramo/ml/pieza”.
3. La unidad de captura por zona era texto libre. Podían escribirse variantes (`pz`, `pieza`, `piezas`) difíciles de interpretar y comparar.
4. La lista no permitía filtrar por tienda o categoría y no daba una señal rápida de qué productos todavía carecían de conversión FIFO.
5. En recetas, el flujo de edición existía como “Nueva versión”, pero no era evidente que editar no modifica una semana histórica. Tampoco se sugería la unidad base al elegir un ingrediente.
6. Categorías y zonas ocupaban espacio de trabajo aunque se modifican con poca frecuencia.

## Decisiones aplicadas

- Se mantiene la misma API y el mismo modelo de datos; no se altera la lógica FIFO, recetas, compras ni inventario histórico.
- Configuración → **Inventario** ahora funciona como un editor maestro: filtros arriba, catálogo seleccionable a la izquierda y detalle del producto a la derecha.
- El detalle está dividido en tres bloques:
  - **Identidad:** nombre, tienda, categoría y estado.
  - **Compra y FIFO:** mínimo en presentaciones, presentación, contenido, costo de la presentación, unidad base y rendimiento.
  - **Cómo se cuenta:** unidad visible por zona y factor de conversión.
- Se muestra una vista previa de la relación (`1 botella = 700 ml`) y del costo base para que el operador valide antes de guardar.
- Presentaciones y unidades de captura se seleccionan de listas controladas. El factor continúa siendo explícito y conserva la semántica existente.
- Categorías y zonas quedan dentro de “Catálogos auxiliares” colapsado para reducir ruido.
- El alta de producto solicita desde el inicio los datos necesarios para que no nazca sin conversión.
- Recetas incorpora búsqueda, etiqueta clara de edición y selección automática de la unidad base del ingrediente. Editar siempre crea una nueva versión mediante el endpoint existente.

## Fuente única de verdad

| Dato | Se edita en | Lo consumen |
|---|---|---|
| Nombre, tienda, categoría, activo | Editor de productos | Inventario, compras, FIFO |
| Mínimo de compra | Editor de productos | Lista de compras |
| Presentación, contenido, unidad base, rendimiento | Editor de productos | Compras FIFO y costeo de recetas |
| Unidad/factor por zona | Editor de productos | Conteo físico |
| Cantidad por receta y estado/versionado | Editor de recetas | Consumo teórico y costo del menú |

Las pantallas de operación sólo consultan estos valores; no se duplican reglas ni conversiones en el frontend.

## Criterios de calidad para futuras altas

- Un producto comprado por presentación debe tener presentación, contenido y unidad base antes de usarse en FIFO.
- El mínimo siempre está en presentaciones de compra, nunca en ml/g ocultos.
- La captura física se expresa en piezas comerciales (`botellas`, `cajas`, `paquetes`, etc.); el servidor convierte a unidad base.
- `rendimiento útil` debe ser un valor entre 0.01 y 1.
- Cambiar costo o presentación no borra lotes existentes: sólo afecta nuevas entradas y el costeo vigente según las reglas del sistema.
- Cambiar una receta crea versión nueva; no se reescribe el historial.

## Flujo recomendado para una persona del equipo

1. Buscar el producto por nombre, tienda o categoría.
2. Seleccionarlo en el catálogo.
3. En **Compra y FIFO**, elegir presentación y completar contenido y costo del ticket.
4. Confirmar la conversión visible.
5. En **Cómo se cuenta**, elegir la unidad que verá el equipo y guardar el factor.
6. Guardar cambios.
7. Para una receta, ir a **Recetas y costeo**, buscar el producto, pulsar **Editar receta**, ajustar cantidades y guardar la nueva versión.

## Pendientes deliberadamente fuera de este cambio

- No se introducen alias ni sincronización con Epos en esta pantalla; ya existen endpoints separados y deben seguir siendo una tarea de matching controlado.
- No se cambia la estructura de lotes ni se recalculan compras históricas.
- No se habilita edición de recetas históricas: se conserva el versionado para proteger cierres.
