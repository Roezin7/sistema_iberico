from copy import copy
from pathlib import Path
from openpyxl import load_workbook
from openpyxl.workbook.properties import CalcProperties

SRC = Path('/Users/arturohernandez/Desktop/Negocios/Ibérico/04_FINANZAS/Modelos/Activo/IBERICO_MENU_COSTEO_MAESTRO_CORREGIDO_2026-09-09.xlsx')
OUT = SRC.with_name('IBERICO_MENU_COSTEO_MAESTRO_CORREGIDO_2026-09-12.xlsx')
wb = load_workbook(SRC)

# Cantidades operativas definitivas. En las palomas se conserva el volumen total
# de mezclador y se divide en partes iguales entre Squirt y Sprite.
recipes = {
    'Perla Negra': [('Jagger', 2, 'oz'), ('Volt', 200, 'ml'), ('Sprite', 200, 'ml')],
    'Paloma Chica': [('Hacienda de Tepa', 2, 'oz'), ('Limón', 2, 'pieza'), ('Squirt', 100, 'ml'), ('Sprite', 100, 'ml')],
    'Paloma Grande': [('Hacienda de Tepa', 4, 'oz'), ('Limón', 4, 'pieza'), ('Squirt', 200, 'ml'), ('Sprite', 200, 'ml')],
    'Paloma Grande Dobel': [('Tequila Dobel', 4, 'oz'), ('Limón', 4, 'pieza'), ('Squirt', 200, 'ml'), ('Sprite', 200, 'ml')],
    'Vampiro Chico': [('Hacienda de Tepa', 2, 'oz'), ('Viuda de Sánchez', 1, 'oz'), ('Squirt', 200, 'ml'), ('Limón', 0.5, 'pieza')],
    'Vampiro Grande': [('Hacienda de Tepa', 4, 'oz'), ('Viuda de Sánchez', 1, 'oz'), ('Squirt', 200, 'ml'), ('Limón', 1, 'pieza')],
    'Limonada': [('Limón', 2, 'pieza'), ('Madrileña', 1, 'oz'), ('Sprite', 100, 'ml'), ('Agua Mineral', 200, 'ml')],
    'Piñada': [('Jugo de Piña', 200, 'ml'), ('Calahua', 4, 'oz'), ('Piña', 60, 'g'), ('Madrileña', 1, 'oz')],
    'Coco Spritz': [('Absolut 750 ml', 2, 'oz'), ('Aperol', 1, 'oz'), ('Madrileña', 1, 'oz'), ('Calahua', 90, 'ml'), ('Limón', 0.5, 'pieza')],
}

notes = {
    'Perla Negra': 'Volt y Sprite, 200 ml de cada uno.',
    'Paloma Chica': 'Squirt y Sprite en partes iguales; 200 ml totales.',
    'Paloma Grande': 'Squirt y Sprite en partes iguales; 400 ml totales.',
    'Paloma Grande Dobel': 'Squirt y Sprite en partes iguales; 400 ml totales.',
    'Vampiro Chico': 'Se agrega 1/2 pieza de Limón.',
    'Vampiro Grande': 'Tequila Hacienda de Tepa a 4 oz y 1 pieza de Limón.',
    'Limonada': '100 ml Sprite y 200 ml Agua Mineral.',
    'Piñada': 'Se agrega 1 oz de endulzante (Madrileña).',
    'Coco Spritz': 'Aperol ajustado a 1 oz.',
}

ws = wb['03_Recetas']
headers = [ws.cell(2, c).value for c in range(1, 13)]

# Tomamos el costo unitario vigente ya utilizado por el maestro para cada insumo.
unit_cost = {}
source_cost = {}
for r in range(3, ws.max_row + 1):
    ingredient = ws.cell(r, 3).value
    if ingredient and ingredient not in unit_cost:
        if isinstance(ws.cell(r, 7).value, (int, float)) and ws.cell(r, 7).value:
            unit_cost[ingredient] = float(ws.cell(r, 7).value)
        if isinstance(ws.cell(r, 6).value, (int, float)) and ws.cell(r, 6).value:
            source_cost[ingredient] = float(ws.cell(r, 6).value)

# Costos por unidad base para ingredientes que todavía no aparecen en el maestro.
unit_cost.update({
    'Volt': unit_cost.get('Volt', 13.5 / 400),
    'Sprite': unit_cost.get('Sprite', 48 / 2000),
    'Squirt': unit_cost.get('Squirt', 31 / 2000),
    'Aperol': unit_cost.get('Aperol', 255 / 700),
    'Madrileña': unit_cost.get('Madrileña', 72 / 700),
    'Limón': unit_cost.get('Limón', 30 / 14),
    'Hacienda de Tepa': unit_cost.get('Hacienda de Tepa', 213 / 700),
    'Viuda de Sánchez': unit_cost.get('Viuda de Sánchez', 100 / 1000),
    'Jagger': unit_cost.get('Jagger', 558 / 700),
    'Tequila Dobel': unit_cost.get('Tequila Dobel', 807 / 700),
    'Absolut 750 ml': unit_cost.get('Absolut 750 ml', 375 / 750),
    'Calahua': unit_cost.get('Calahua', 49 / 700),
    'Jugo de Piña': unit_cost.get('Jugo de Piña', 58 / 1900),
    'Piña': unit_cost.get('Piña', 40 / 1000),
})
for k, v in unit_cost.items():
    source_cost.setdefault(k, v)

OZ_ML = 29.5735
def base_quantity(qty, unit):
    return float(qty) * OZ_ML if unit.lower() == 'oz' else float(qty)

def clear_row(r):
    for c in range(1, 13):
        ws.cell(r, c).value = None

def write_line(r, menu, ingredient, qty, unit):
    u = unit_cost[ingredient]
    s = source_cost.get(ingredient, u)
    line_source = round(base_quantity(qty, unit) * s, 4)
    line_current = round(base_quantity(qty, unit) * u, 4)
    vals = [menu, menu, ingredient, qty, unit, s, u, line_source, line_current,
            round(line_current - line_source, 4), 'COSTEO_CORREGIDO_2026-09-12',
            f'Ruta corregida 2026-09-12. {notes[menu]}']
    for c, value in enumerate(vals, 1):
        ws.cell(r, c).value = value

# Reutiliza las filas existentes de cada menú y elimina cualquier línea anterior.
rows_by_menu = {}
for r in range(3, ws.max_row + 1):
    menu = ws.cell(r, 1).value
    if menu in recipes:
        rows_by_menu.setdefault(menu, []).append(r)

for menu, lines in recipes.items():
    rows = rows_by_menu.get(menu, [])
    if not rows:
        rows = [ws.max_row + 1]
        rows_by_menu[menu] = rows
    for r in rows:
        clear_row(r)
    while len(rows) < len(lines):
        new_r = ws.max_row + 1
        template = rows[0]
        for c in range(1, 13):
            ws.cell(new_r, c)._style = copy(ws.cell(template, c)._style)
        rows.append(new_r)
    for r, line in zip(rows, lines):
        write_line(r, menu, *line)

# Agrega las recetas que no existían en la pestaña analítica.
for menu in ('Coco Spritz', 'Paloma Grande Dobel'):
    if menu not in rows_by_menu:
        continue

# Marca costeo y receta en las vistas resumen.
for r in range(1, wb['01_Menu'].max_row + 1):
    if wb['01_Menu'].cell(r, 3).value in recipes:
        wb['01_Menu'].cell(r, 7).value = 'RECETA_CORREGIDA_2026-09-12'
for r in range(1, wb['02_Costeo'].max_row + 1):
    if wb['02_Costeo'].cell(r, 1).value in recipes:
        wb['02_Costeo'].cell(r, 7).value = 'COSTEO_CORREGIDO_2026-09-12'
for r in range(1, wb['25_Margenes_Menu'].max_row + 1):
    if wb['25_Margenes_Menu'].cell(r, 1).value in recipes:
        wb['25_Margenes_Menu'].cell(r, 8).value = 'COSTEO_CORREGIDO_2026-09-12'

# Hoja de producción: misma receta y mismos IDs que la base operativa.
prod = wb['29_Recetas_Produccion']
prod_rows = {}
for r in range(5, prod.max_row + 1):
    menu = prod.cell(r, 1).value
    if menu in recipes:
        prod_rows.setdefault(menu, []).append(r)
product_id = {}
for r in range(5, prod.max_row + 1):
    if prod.cell(r, 5).value and prod.cell(r, 4).value is not None:
        product_id[str(prod.cell(r, 5).value)] = prod.cell(r, 4).value
product_id.update({'Volt': 29, 'Sprite': 24, 'Squirt': 25, 'Aperol': 11, 'Limón': 81,
                   'Madrileña': 23, 'Hacienda de Tepa': 15, 'Viuda de Sánchez': 96,
                   'Jagger': 22, 'Tequila Dobel': 18, 'Absolut 750 ml': 1,
                   'Calahua': 34, 'Jugo de Piña': 31, 'Piña': 92})
for menu, lines in recipes.items():
    rows = prod_rows.get(menu, [])
    if not rows:
        rows = [prod.max_row + 1]
        prod_rows[menu] = rows
    epos = next((prod.cell(r, 2).value for r in rows if prod.cell(r, 2).value is not None), None)
    # Versiones actuales de producción: la mayoría ya estaba en v3; Coco
    # Spritz y Paloma Grande Dobel estaban en v2.
    version = 3 if menu in ('Coco Spritz', 'Paloma Grande Dobel') else 4
    for r in rows:
        for c in range(1, 8):
            prod.cell(r, c).value = None
    while len(rows) < len(lines):
        new_r = prod.max_row + 1
        template = rows[0]
        for c in range(1, 8):
            prod.cell(new_r, c)._style = copy(prod.cell(template, c)._style)
        rows.append(new_r)
    for r, (ingredient, qty, unit) in zip(rows, lines):
        vals = [menu, epos, version, product_id[ingredient], ingredient, qty, unit]
        for c, value in enumerate(vals, 1):
            prod.cell(r, c).value = value

wb['00_Control']['A1'] = 'IBÉRICO · COSTEO MAESTRO DEL MENÚ · RECETAS CORREGIDAS'
wb['00_Control']['A20'] = 'Actualización 2026-09-12: correcciones de Perla Negra, Palomas, Vampiros, Limonada, Piñada y Coco Spritz aplicadas a costeo y producción.'
wb.calculation = CalcProperties(calcMode='auto', fullCalcOnLoad=True, forceFullCalc=True)
wb.save(OUT)
print(OUT)
