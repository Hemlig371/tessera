// Small, locally drawn interface symbols. Labels remain on the owning controls.
const paths = {
  flag: 'M5 21V4l6-1 7 3v9l-7-3-6 1',
  checklist: 'M9 5h12M9 12h12M9 19h12M3 5h2M3 12h2M3 19h2',
  attachment: 'M8 13l7-7a4 4 0 0 1 6 6L11 22a6 6 0 0 1-8-8L14 3',
  calendar: 'M3 6h18v15H3zM7 3v5M17 3v5M3 11h18',
  property: 'M3 4h9l9 9-8 8-10-10zM8 8h.01',
  document: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 15h5',
  dining: 'M4 3v6c0 3 6 3 6 0V3M7 3v18M17 3c-3 3-4 9 0 10h2V3h-2zM19 12v9',
  task: 'M4 4h16v16H4zM7 12l3 3 7-7',
  layers: 'M2 8l10-5 10 5-10 5zM3 12l9 5 9-5M3 16l9 5 9-5',
  wallet: 'M4 6l13-3v4M3 7h18v13H3zM15 12h6v4h-6z',
  picture: 'M3 4h18v16H3zM4 17l5-5 4 3 3-5 5 6M8 8h.1',
  contacts: 'M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0M4 21v-2c0-6 16-6 16 0v2M18 5q5 3 1 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  libraries: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  collection: 'M5 3h14v18H5zM9 3v18M12 8h4M12 12h4',
  search: 'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  inbox: 'M3 13l3-9h12l3 9v7H3zM3 13h5l2 3h4l2-3h5',
  capture: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  tools: 'M5 4v6M5 14v6M12 4v11M12 19v1M19 4v1M19 9v11M2 10h6M9 15h6M16 9h6',
  archive: 'M3 4h18v5H3zM5 9v12h14V9M9 13h6M12 13v5M10 16l2 2 2-2',
  settings: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z',
  appearance: 'M12 3a9 9 0 1 0 0 18V3zM12 3a9 9 0 0 1 0 18M16 7l2 2M16 12h5M16 17l2-2',
  arrow: 'M5 12h14M14 7l5 5-5 5',
  chevron: 'M9 5l7 7-7 7',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2',
  edit: 'M4 20l4-.8L19 8a2 2 0 0 0-3-3L5 16zM14 7l3 3',
  more: 'M12 5v.01M12 12v.01M12 19v.01',
  filter: 'M4 7h16M7 12h10M10 17h4',
  check: 'M4 12l5 5 11-11',
  back: 'M19 12H5M10 7l-5 5 5 5',
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

const glyphs: Record<string, keyof typeof paths> = {
  '🍴':'dining', '☑':'task', '▱':'layers', '✎':'document',
  '▣':'wallet', '▧':'picture', '♧':'contacts', '⊞':'libraries',
};
export function LibraryGlyph({symbol}: {symbol?: string}) {
  if (!symbol || symbol === '◇') return <Icon name="collection"/>;
  const name = glyphs[symbol];
  return name ? <Icon name={name}/> : <span aria-hidden="true">{symbol}</span>;
}
