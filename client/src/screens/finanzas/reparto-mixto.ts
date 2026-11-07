/** Un corte mixto se reparte por importes, nunca se asigna íntegro por defecto. */
export function repartoMixto(total: number, efectivo: string, tarjeta: string) {
  const cash = Number(efectivo), card = Number(tarjeta);
  return efectivo.trim() && tarjeta.trim() && Number.isFinite(cash) && Number.isFinite(card) && cash >= 0 && card >= 0 && Math.abs(cash + card - total) <= .010001
    ? { efectivo: cash, tarjeta: card } : null;
}
