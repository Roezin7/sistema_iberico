# Ibérico — Matriz de costeo del piloto histórico

**Periodo de ventas:** 10–16 de agosto de 2026  
**Fuente de ventas:** Epos Now / Bookkeeping  
**Ventas:** $9,786  
**Unidades:** 126  
**Transacciones:** 30  
**Estado:** revisión previa a importación en `productos_menu` y `recetas`

## Reglas de costeo

1. Las cantidades exactas confirmadas por Arturo son la fuente de verdad de la receta.
2. Los precios de venta oficiales son los del menú; Epos sólo aporta ventas históricas.
3. El costo de cada ingrediente se toma del lote FIFO, no de un promedio.
4. El inventario inicial conserva el costo que ya tenía.
5. El recetario de cocina sirve para operación, pero no sustituye una cantidad exacta de costeo.
6. Las cervezas son productos directos: una venta descuenta una pieza.
7. Epos no devolvió `product_id`; el primer vínculo se hará por nombre exacto y se conservará como alias.

## Catálogo de inventario confirmado

| ID | Producto | Unidad de receta | Presentación declarada |
|---:|---|---|---|
| 3 | Vino tinto | ml | botella |
| 14 | Ginebra Gibsons | ml | 700 ml |
| 15 | Hacienda de Tepa | ml | 700 ml |
| 16 | Tinto California | ml | 1 L |
| 22 | Jagger | ml | 700 ml |
| 24 | Sprite | ml | compra por lote |
| 25 | Squirt | ml | 2 L |
| 33 | Tonica | ml | compra por lote |
| 37 | Modelo | pieza | pieza |
| 39 | Stella | pieza | pieza |
| 40 | Ultra | pieza | pieza |
| 41 | Frutos rojos | g | congelado |
| 50 | Romero | pieza | rama útil |
| 54 | Fresas | g | congeladas |
| 61 | Nieve | g | compra por lote |
| 62 | Papas a la francesa | g | caja |
| 67 | Tocino | g | compra por lote |
| 70 | Ketchup | g | compra por lote |
| 81 | Limón | pieza | 14 piezas/kg aprox. |
| 84 | Pepino | g | compra por lote |
| 92 | Piña | g | 0.25 pieza = 60 g |
| 14 | Ginebra Gibsons | ml | 700 ml |
| nuevo | Viuda de Sánchez | ml | 1 L · $100 |
| nuevo | Michemix | ml | 1 L · $89 |
| 23 | Madrileña | ml | Se usa también como jarabe de maíz/endulzante |

## Ventas y recetas del piloto

Las cantidades indicadas son por unidad vendida. Las cantidades entre paréntesis son las unidades vendidas en Epos.

| Producto Epos | Cantidad | Receta para costeo | Estado |
|---|---:|---|---|
| Copa de la Casa (1) | 1 | Vino tinto 177.44 ml (copa de 6 oz) | Lista para validar contra la medida real de copa |
| Papas a la francesa (1) | 1 | Papas 150 g; Ketchup 40 g | Confirmada |
| Vampiro Grande (1) | 1 | Viuda de Sánchez 29.57 ml; Hacienda de Tepa 59.15 ml; Squirt 200 ml | Receta confirmada; falta alta de Viuda |
| Cuba/Shot Jagger (1) | 1 | Jagger 59.15 ml | Confirmada |
| Paloma Grande (1) | 1 | Limón 4 piezas; Hacienda de Tepa 118.29 ml; Squirt 400 ml | Confirmada |
| Cuba de Hacienda de Tepa (1) | 1 | Hacienda de Tepa 59.15 ml; Squirt 250 ml | Confirmada |
| Michelob Ultra (1) | 1 | Ultra 1 pieza | Producto directo |
| Piñada (2) | 2 | Calahua 118.29 ml; Piña 60 g; Jugo de piña 200 ml | Confirmada sin alcohol |
| Limonada (2) | 2 | Limón 2 piezas; Madrileña 29.57 ml; Sprite 200 ml; agua/hielo de servicio | Cantidad de agua no afecta materialmente el costo; documentar como servicio |
| Papas Ibéricas (2) | 2 | Papas 150 g; Tocino 40 g; Queso amarillo 50 g | Confirmada |
| Michelada Chica (2) | 2 | Michemix 60 ml; Corona o Victoria 1 pieza | Receta confirmada; se conserva Corona como referencia y Victoria como alternativa |
| Mezcalita Piña (2) | 2 | 400 Conejos 59.15 ml; Madrileña 29.57 ml; Limón 1.5 piezas; Jugo de piña 100 ml; Squirt 60 ml | Confirmada |
| Pizza Ibérica (2) | 2 | Harina 160 g; agua 100 g; Prego 50 g; Mozzarella 40 g; Jamón serrano 30 g; balsámico 30 ml | Confirmada |
| Raspberry Spritz (2) | 2 | Aperol 60 ml; Prosecco 90 ml; agua mineral 30 ml; frutos rojos 20 g | Confirmada desde costeo |
| Carajillo (2) | 2 | Café espresso 5 g de grano para 30 ml preparados; Licor 43 59.15 ml | Confirmada; 5 g es la base de costo del espresso |
| Montado Ibérico (2) | 2 | Pan 30 g; Jamón serrano 10 g; queso crema 5 g; mermelada de tocino 15 g; perejil 1 pieza | Confirmada |
| Montado Castellano (2) | 2 | Pan 30 g; Salchichón 7 g; Chorizo 7 g; Manchego 7 g | Confirmada |
| Coco Spritz (3) | 3 | Aperol 60 ml; vodka 60 ml; Calahua 90 ml; jarabe de maíz 30 ml; limón 15 ml | Confirmada; falta alta de jarabe de maíz |
| Pizza Castellana (3) | 3 | Harina 160 g; agua 100 g; Prego 50 g; Salchichón 25 g; Chorizo 25 g; Mozzarella 40 g | Confirmada |
| Mojito Tinto (3) | 3 | Bacardi 60 ml; limón 1.5 piezas; Madrileña 29.57 ml; hierbabuena 3 g; Sprite 180 ml; Tinto California 20 ml | Confirmada |
| Piña Colada (3) | 3 | Calahua 118.29 ml; Piña 60 g; Jugo de piña 200 ml; hielo | Confirmada |
| Pizza Margarita (3) | 3 | Harina 160 g; agua 100 g; Prego 50 g; Mozzarella 40 g | Confirmada |
| Limonada Ibérica (3) | 3 | Limón 2 piezas; Madrileña 29.57 ml; Sprite 150 ml; frutos rojos 20 g; agua/hielo de servicio | Confirmada |
| Tequila Sunrise (3) | 3 | Hacienda de Tepa 59.15 ml; limón 1 pieza; jugo de naranja 160 ml; agua mineral 130 ml; Aperol 29.57 ml | Confirmada |
| Mezcalita Tamarindo (3) | 3 | 400 Conejos 59.15 ml; Madrileña 29.57 ml; limón 1.5 piezas; saborizante tamarindo 29.57 ml; Squirt 150 ml | Confirmada |
| Gin Tonic Verde (4) | 4 | Pepino 30 g; limón 0.5 pieza; Gibsons 59.15 ml; Tónica 110 ml; Sprite 100 ml; romero 1 rama | Confirmada |
| Ronchata (4) | 4 | Bacardi 59.15 ml; Carnation 59.15 ml; Lechera 29.57 ml; concentrado de horchata 29.57 ml; agua 100 ml | Confirmada |
| Tinto de Verano (4) | 4 | Tinto California 177.44 ml; limón 0.5 pieza; Sprite 120 ml | Confirmada |
| Stella Artois (4) | 4 | Stella 1 pieza | Producto directo |
| Margarita de Fresa (4) | 4 | Hacienda de Tepa 59.15 ml; limón 3 piezas; Madrileña 29.57 ml; Fanta roja 150 ml; fresas 20 g | Confirmada |
| Mojito Clásico (5) | 5 | Bacardi 60 ml; limón 1.5 piezas; Madrileña 29.57 ml; hierbabuena 3 g; Sprite 200 ml | Confirmada |
| Gin Tonic Rosa (5) | 5 | Frutos rojos 20 g; Gibsons 59.15 ml; Tónica 110 ml; Sprite 100 ml; Tinto California 20 ml; romero 1 rama | Confirmada; igual a Rojo según la receta recibida |
| Pizza Catalana (5) | 5 | Harina 160 g; agua 100 g; Prego 50 g; Mozzarella 40 g; mermelada de tocino 40 g; Salchichón 20 g; Chorizo 20 g | Confirmada |
| Modelo (5) | 5 | Modelo 1 pieza | Producto directo |
| Gin Tonic Rojo (6) | 6 | Frutos rojos 20 g; Gibsons 59.15 ml; Tónica 110 ml; Sprite 100 ml; Tinto California 20 ml; romero 1 rama | Confirmada |
| Negroni Ibérico (6) | 6 | Frutos rojos 20 g; Gibsons 29.57 ml; Campari 29.57 ml; Vermouth 14.79 ml; limón 0.5 pieza; Sprite 150 ml | Confirmada |
| Paloma Chica (6) | 6 | Limón 2 piezas; Hacienda de Tepa 59.15 ml; Squirt 200 ml | Confirmada |
| Affogato (7) | 7 | Nieve 100 g; café espresso 5 g de grano para 30 ml preparados | Confirmada |
| Cubanito Grande (10) | 10 | Arriero 118.29 ml | Confirmada |

## Incidencias de catálogo, no de receta

Estas incidencias no requieren volver a discutir la receta; requieren completar el catálogo antes de importar:

1. **Viuda de Sánchez:** dar de alta como producto de 1 L con costo de compra de $100.
2. **Michemix:** dar de alta como producto de 1 L con costo de compra de $89.
3. **Jarabe de maíz:** no crear producto separado; usar Madrileña, ID 23.
4. **Michelada Chica:** Corona y Victoria son alternativas; no deben descontarse ambas.
5. **Copa de la Casa:** usar 177.44 ml como estándar de costeo hasta que se mida la copa real.
6. **Epos `product_id`:** todos llegaron nulos; el vínculo se conserva por nombre exacto.
7. **Gin Rojo/Rosa:** se mantienen iguales porque así quedó confirmado en la receta recibida.

## Consumo derivado ya verificable

Sólo para los productos Vampiro, cubas y palomas vendidos en el periodo:

- Hacienda de Tepa: 591.50 ml.
- Viuda de Sánchez: 29.57 ml.
- Jagger: 59.15 ml.
- Squirt: 2,050 ml.
- Limón: 16 piezas.

## Puerta de importación

Antes de crear las versiones en la base:

- dar de alta Viuda de Sánchez y Michemix;
- usar Madrileña como sustituto de jarabe de maíz;
- registrar Corona como referencia de Michelada y Victoria como alternativa;
- confirmar que la copa estándar de vino sea de 6 oz;
- agregar contenido de compra y unidad base por ingrediente antes de importar las recetas;
- importar las recetas como versión 1 con estado `validada`;
- dejar el costo calculado dinámicamente desde lotes FIFO.

## Requisito técnico antes de cargar recetas

El modelo actual no debe multiplicar directamente `cantidad de receta × costo de presentación`.
Antes de importar, cada insumo debe tener:

- unidad base: `g`, `ml` o `pieza`;
- contenido de la compra: por ejemplo, 700 ml, 1 L, 2 kg o 1 pieza;
- rendimiento útil;
- costo por unidad base derivado del lote FIFO.

Ejemplo: una botella de Hacienda de Tepa de 700 ml no puede costear 59.15 ml usando el precio completo de la botella. Primero debe convertir el lote a costo por ml.
