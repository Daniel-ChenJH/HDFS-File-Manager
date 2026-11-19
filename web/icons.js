const paths = {
  more: "M5 12h.1 M12 12h.1 M19 12h.1",
  server: "M3 3h18v7H3z M3 14h18v7H3z M7 6.5h.1 M7 17.5h.1",
  computer: "M2 3h20v14H2z M8 21h8 M12 17v4",
  folder: "M2 5h5l2 2h13v13H2z",
  file: "M5 2h9l5 5v15H5z M14 2v6h5",
  pdf: "M5 2h9l5 5v15H5z M14 2v6h5 M8 18v-7h3a2 2 0 0 1 0 4H8",
  json: "M8 3H6v7l-3 2 3 2v7h2 M16 3h2v7l3 2-3 2v7h-2 M12 8v.1 M12 16v.1",
  image: "M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M15 7h.1",
  table: "M3 3h18v18H3z M3 9h18 M3 15h18 M10 3v18",
  archive: "M5 2h9l5 5v15H5z M14 2v6h5 M9 3v2h2v2H9v2h2v2H9v2h2v2H9v4h3v-4",
  database:
    "M3 6c0-5 18-5 18 0v12c0 5-18 5-18 0z M3 6c0 5 18 5 18 0 M3 12c0 5 18 5 18 0",
  code: "M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18",
  text: "M5 2h9l5 5v15H5z M14 2v6h5 M8 11h8 M8 15h8 M8 19h5",
  symlink:
    "M10 7l3-3a5 5 0 0 1 7 7l-3 3 M14 17l-3 3a5 5 0 0 1-7-7l3-3 M8 16l8-8",
  audio:
    "M10 17V5l10-2v12 M10 8l10-2 M10 17a3 3 0 1 1-3-3h3 M20 15a3 3 0 1 1-3-3h3",
  video: "M3 4h18v16H3z M10 8l6 4-6 4z",
  back: "M14 5l-7 7 7 7",
  forward: "M10 5l7 7-7 7",
  up: "M5 14l7-7 7 7",
  down: "M5 10l7 7 7-7",
  minus: "M5 12h14",
  wrap: "M3 5h18 M3 10h14a4 4 0 0 1 0 8h-6 M14 15l-3 3 3 3 M3 15h4",
  lines:
    "M10 5h10 M10 12h10 M10 19h10 M4 4l1-1v4 M4 11a1 1 0 1 1 2 1l-2 2h2 M4 17h2l-1 2a1 1 0 1 1-1 2",
  indent: "M4 5h16 M10 10h10 M10 15h10 M4 20h16 M4 10l3 2.5L4 15",
  nowrap: "M3 5h18 M3 11h18 M3 17h13 M18 14l3 3-3 3",
  refresh: "M20 8A8 8 0 1 0 20 16 M20 3v5h-5",
  settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  upload: "M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5",
  info: "M12 11v6 M12 7v.1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  plus: "M12 5v14 M5 12h14",
  search: "M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  close: "M6 6l12 12 M6 18L18 6",
  disconnect: "M12 2v10 M6 5a9 9 0 1 0 12 0",
  check: "M4 12l5 5L20 6",
  success: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M7 12l3 3 7-7",
  star: "m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z",
  go: "M4 12h16 M14 6l6 6-6 6",
  expand: "M14 3h7v7 M21 3l-9 9 M10 3H3v18h18v-7",
};
export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.6",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name] || paths.file);
  svg.append(path);
  return svg;
}
