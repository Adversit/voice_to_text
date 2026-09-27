const paths = {
  workspace: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17.5h7m-3.5-3.5v7"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7m2-4v5l3 2"/>',
  activity: '<path d="M2 12h4l3-8 6 16 3-8h4"/>',
  pause: '<path d="M8 5v14m8-14v14" stroke-width="3"/>',
  settings: '<path d="m10 3-.7 2.1-2 .9-2-.5-2 3.5 1.5 1.6v2.8L3.3 15l2 3.5 2-.5 2 .9.7 2.1h4l.7-2.1 2-.9 2 .5 2-3.5-1.5-1.6v-2.8L20.7 9l-2-3.5-2 .5-2-.9L14 3h-4Z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 1h18"/>',
  minus: '<path d="M6 12h12"/>', square: '<rect x="6" y="6" width="12" height="12" rx="1"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  mic: '<rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', arrowUp: '<path d="M6 18 18 6M6 6h12v12"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  alert: '<path d="m10.2 4.5-8 14A1.7 1.7 0 0 0 3.7 21h16.6a1.7 1.7 0 0 0 1.5-2.5l-8-14a2 2 0 0 0-3.6 0Z"/><path d="M12 9v5m0 3v.1"/>',
  play: '<path d="m8 4 13 8-13 8V4Z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  refresh: '<path d="M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5m-4 9a8 8 0 0 0 14 2l3-3m0 5v-5h-5"/>',
  memory: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M6 17v3m4-3v3m4-3v3m4-3v3M7 9v4m5-4v4m5-4v4"/>',
  disk: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 14h18m-5 3h.1m2.9 0h.1"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-5 0h10"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 .5-10A7 7 0 0 1 21 11a3.5 3.5 0 0 1-1.5 7H7Z"/>',
  wave: '<path d="M3 10v4m4-7v10m5-14v18m5-15v12m4-9v6"/>',
  text: '<path d="M4 4h16M12 4v16m-5 0h10M4 4v4m16-4v4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  file: '<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.1m3.9 0h.1m3.9 0h.1m3.9 0h.1M6 13h.1m3.9 0h.1m3.9 0h.1m3.9 0h.1M8 16h8"/>',
};
export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
}
