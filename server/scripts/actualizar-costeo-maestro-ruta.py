from copy import copy
from pathlib import Path
from openpyxl import load_workbook
from openpyxl.workbook.properties import CalcProperties
import re

SRC = Path('/Users/arturohernandez/Desktop/Negocios/Ibérico/04_FINANZAS/Modelos/Activo/IBERICO_MENU_COSTEO_MAESTRO_CANONICO_2026-09-04.xlsx')
OUT = SRC.with_name('IBERICO_MENU_COSTEO_MAESTRO_CORREGIDO_2026-09-09.xlsx')
wb = load_workbook(SRC)

# Costos unitarios vigentes del catálogo de producción (MXN por unidad base).
cost = {
    '400 Conejos 700 ml': 590/700, 'Madrileña': 72/700, 'Limón': 30/14,
    'Jugo de Piña': 58/1900, 'Jugo de Mango': 58/1900, 'Sprite': 48/2000,
    'Agua Mineral': 27/2000, 'Fanta Roja': 21/2000, 'Volt': 13.5/400,
    'Arriero': 160/1000, 'Hacienda de Tepa': 213/700, 'Viuda de Sánchez': 100/1000,
    'Jagger': 558/700, 'Bacardi': 255/750, 'Corona': 19, 'Michemix': 89/1000,
    'Frutos rojos': 254/1810, 'Piña': 40/1000, 'Calahua': 49/700,
}

OZ_ML = 29.5735
BAR_RE = re.compile(r'absolut|aperol|bacardi|baileys|campari|ginebra|gibsons|jagger|hacienda|mezcal|conejos|madrileña|licor|vermouth|viuda|arriero|tequila|dobel|1800|jim beam|prosecco|vino tinto|tinto california|calahua|crema de coco|carnation|lechera|saborizante|concentrado de horchata', re.I)
def as_oz(name, qty, unit):
    if unit == 'ml' and BAR_RE.search(str(name)):
        raw = float(qty) / OZ_ML
        n = round(raw * 2) / 2
        if abs(raw - n) <= 0.04:
            return n, 'oz'
    return qty, unit

def rows_for(ws, product):
    return [r for r in range(3, ws.max_row+1) if ws.cell(r,1).value == product]

def blank_row(ws, r):
    for c in range(1, 13): ws.cell(r,c).value = None

ws = wb['03_Recetas']
# Remove ingredients and replace beverages where the previous master was wrong.
for r in rows_for(ws, 'Mezcalita Piña') + rows_for(ws, 'Mezcalita Mango'):
    if ws.cell(r,3).value == 'Squirt': blank_row(ws, r)
for r in rows_for(ws, 'Perla Negra'):
    if ws.cell(r,3).value == 'Volt':
        ws.cell(r,3).value = 'Sprite'; ws.cell(r,6).value = cost['Sprite']; ws.cell(r,7).value = cost['Sprite']; ws.cell(r,8).value = round(200*cost['Sprite'],4); ws.cell(r,9).value = round(200*cost['Sprite'],4); ws.cell(r,10).value = 0; ws.cell(r,12).value = 'Corrección de ruta: Volt se sustituye por Sprite.'

# Las medidas de bar se muestran en oz; los costos siguen calculándose en ml base.
for r in range(3, ws.max_row + 1):
    ingredient, qty, unit = ws.cell(r,3).value, ws.cell(r,4).value, ws.cell(r,5).value
    if ingredient and isinstance(qty, (int, float)):
        out_qty, out_unit = as_oz(ingredient, qty, unit)
        if out_unit == 'oz' and unit != 'oz':
            ws.cell(r,4).value, ws.cell(r,5).value = out_qty, out_unit
            source_unit = ws.cell(r,6).value or ws.cell(r,7).value or 0
            current_unit = ws.cell(r,7).value or source_unit
            ws.cell(r,8).value = round(out_qty * OZ_ML * source_unit, 4)
            ws.cell(r,9).value = round(out_qty * OZ_ML * current_unit, 4)

desired = {
    'Piña Colada': [('Bacardi',59.15,'ml','2 oz Bacardi')],
    'Paloma Chica': [('Hacienda de Tepa',59.15,'ml',''),('Limón',2,'pieza',''),('Agua Mineral',200,'ml','Squirt sustituido por Agua Mineral.')],
    'Paloma Grande': [('Hacienda de Tepa',118.29,'ml',''),('Limón',4,'pieza',''),('Agua Mineral',400,'ml','Squirt sustituido por Agua Mineral.')],
    'Vampiro Chico': [('Hacienda de Tepa',59.15,'ml',''),('Viuda de Sánchez',29.57,'ml',''),('Squirt',200,'ml','Valentina pendiente de cantidad.')],
    'Vampiro Grande': [('Hacienda de Tepa',59.15,'ml',''),('Viuda de Sánchez',29.57,'ml',''),('Squirt',200,'ml','Valentina pendiente de cantidad.')],
    'Cubanito Chico': [('Arriero',59.15,'ml',''),('Agua Mineral',50,'ml',''),('Volt',150,'ml',''),('Fanta Roja',25,'ml',''),('Frutos rojos',0,'g','Decoración; cantidad pendiente, no costeada.')],
    'Cubanito Grande': [('Arriero',118.30,'ml','Doble de Cubanito Chico'),('Agua Mineral',100,'ml','Doble de Cubanito Chico'),('Volt',300,'ml','Doble de Cubanito Chico'),('Fanta Roja',50,'ml','Doble de Cubanito Chico'),('Frutos rojos',0,'g','Decoración; cantidad pendiente, no costeada.')],
    'Michelada Chica': [('Corona',1,'pieza',''),('Michemix',60,'ml','Clamato y 1/2 limón pendientes de cantidad/producto.')],
    'Limonada Ibérica': [('Limón',2,'pieza',''),('Madrileña',29.57,'ml',''),('Sprite',150,'ml',''),('Frutos rojos',20,'g',''),('Agua Mineral',100,'ml','Agua natural sustituida por Agua Mineral.')],
    'Limonada': [('Limón',2,'pieza',''),('Madrileña',29.57,'ml',''),('Sprite',200,'ml',''),('Agua Mineral',100,'ml','Agua natural sustituida por Agua Mineral.')],
    'Piñada': [('Jugo de Piña',200,'ml',''),('Calahua',118.29,'ml',''),('Piña',60,'g','Hielo: 2 cucharadas, no costeado.')],
}

# Add corrected recipe lines that were absent from the analytical recipe tab.
existing = {(ws.cell(r,1).value, ws.cell(r,3).value) for r in range(3, ws.max_row+1) if ws.cell(r,1).value}
template = ws.max_row
for menu, lines in desired.items():
    for ingredient, qty, unit, note in lines:
        if qty == 0 or (menu, ingredient) in existing: continue
        template += 1
        for c in range(1,13):
            ws.cell(template,c)._style = copy(ws.cell(189,c)._style)
        unit_cost = cost.get(ingredient, 0)
        out_qty, out_unit = as_oz(ingredient, qty, unit)
        line_cost = round((out_qty * OZ_ML if out_unit == 'oz' else out_qty) * unit_cost, 4)
        values = [menu, menu, ingredient, out_qty, out_unit, unit_cost, unit_cost, line_cost, line_cost, 0, 'COSTEO_CORREGIDO', f'Ruta corregida 2026-09-09. {note}'.strip()]
        for c,v in enumerate(values,1): ws.cell(template,c).value = v
        existing.add((menu, ingredient))
if ws.tables:
    next(iter(ws.tables.values())).ref = f'A2:L{ws.max_row}'

# Mark affected menu rows as corrected while preserving formulas and prices.
for sheet_name in ('01_Menu','02_Costeo','25_Margenes_Menu'):
    sh = wb[sheet_name]
    for r in range(1, sh.max_row+1):
        name = sh.cell(r,3 if sheet_name == '01_Menu' else 1).value
        if name in desired or name in ('Mezcalita Piña','Mezcalita Mango','Perla Negra'):
            if sheet_name == '01_Menu': sh.cell(r,7).value = 'RECETA_CORREGIDA_2026-09-09'
            elif sheet_name == '02_Costeo': sh.cell(r,7).value = 'COSTEO_CORREGIDO_2026-09-09'
            else: sh.cell(r,8).value = 'COSTEO_CORREGIDO_2026-09-09'

# Refresh the production export tab so the workbook agrees with the DB recipes.
prod = wb['29_Recetas_Produccion']
for r in range(5, prod.max_row+1):
    menu, pid = prod.cell(r,1).value, prod.cell(r,4).value
    if menu and isinstance(prod.cell(r,6).value, (int, float)):
        out_qty, out_unit = as_oz(prod.cell(r,5).value, prod.cell(r,6).value, prod.cell(r,7).value)
        prod.cell(r,6).value, prod.cell(r,7).value = out_qty, out_unit
    if menu in ('Mezcalita Piña','Mezcalita Mango') and pid == 25: blank_row(prod, r)
    if menu == 'Perla Negra' and pid == 29: prod.cell(r,4).value = 24; prod.cell(r,5).value = 'Sprite'
    if menu in ('Paloma Chica','Paloma Grande') and pid == 25: prod.cell(r,4).value = 27; prod.cell(r,5).value = 'Agua Mineral'
    if menu in ('Limonada','Limonada Ibérica') and pid == 82: prod.cell(r,4).value = 27; prod.cell(r,5).value = 'Agua Mineral'
prod_row = prod.max_row + 1
for menu, pid, name, qty, unit in [
    ('Piña Colada',7,'Bacardi',59.15,'ml'),
    ('Cubanito Grande',27,'Agua Mineral',100,'ml'),('Cubanito Grande',29,'Volt',300,'ml'),('Cubanito Grande',80,'Fanta Roja',50,'ml')]:
    values = [menu, next((prod.cell(r,2).value for r in range(5,prod.max_row+1) if prod.cell(r,1).value == menu), None), 2, pid, name, qty, unit]
    for c,v in enumerate(values,1): prod.cell(prod_row,c).value = v
    prod_row += 1

control = wb['00_Control']
control['A1'] = 'IBÉRICO · COSTEO MAESTRO DEL MENÚ · RECETAS CORREGIDAS'
control['A20'] = 'Actualización 2026-09-09: ruta de bebidas manuscrita aplicada. Las notas sin cantidad permanecen fuera del FIFO.'
wb.calculation = CalcProperties(calcMode='auto', fullCalcOnLoad=True, forceFullCalc=True)
wb.save(OUT)
print(OUT)
