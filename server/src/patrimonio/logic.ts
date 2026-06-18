// Patrimonio neto = (banco + efectivo + inventario) − pasivos. Spec §5.3.

export function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function patrimonioNeto(
  totalBanco: number,
  totalEfectivo: number,
  totalInventario: number,
  totalPasivos: number,
): number {
  return redondear(totalBanco + totalEfectivo + totalInventario - totalPasivos);
}
