// Small, locally drawn interface symbols. Labels remain on the owning controls.
const paths = {
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
  check: 'M4 12l5 5 11-11',
  back: 'M19 12H5M10 7l-5 5 5 5',
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
