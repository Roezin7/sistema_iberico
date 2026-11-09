export type TabAbasto = 'conteo' | 'actual' | 'compras';

export function tabAbasto(search: string): TabAbasto {
  const requested = new URLSearchParams(search).get('tab');
  return requested === 'actual' || requested === 'compras' ? requested : 'conteo';
}

export function rutaTabAbasto(search: string, tab: TabAbasto): string {
  const params = new URLSearchParams(search);
  params.set('tab', tab);
  return `/inventario?${params.toString()}`;
}
