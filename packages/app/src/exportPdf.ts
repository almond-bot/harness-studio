export async function downloadPdf(svg: string, widthPx: number, heightPx: number, name: string) {
  const [{ jsPDF }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  // SVG px (96/in) -> PDF pt (72/in)
  const ptW = (widthPx * 72) / 96;
  const ptH = (heightPx * 72) / 96;
  const doc = new jsPDF({
    unit: "pt",
    format: [ptW, ptH],
    orientation: ptW >= ptH ? "landscape" : "portrait",
  });
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-99999px";
  holder.innerHTML = svg;
  document.body.appendChild(holder);
  try {
    const element = holder.querySelector("svg")!;
    await doc.svg(element, { x: 0, y: 0, width: ptW, height: ptH });
    doc.save(`${name}.pdf`);
  } finally {
    holder.remove();
  }
}

export function downloadSvg(svg: string, name: string) {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

export function printSheet(svg: string, widthPx: number, heightPx: number) {
  const widthIn = widthPx / 96;
  const heightIn = heightPx / 96;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!doctype html>
<html>
<head>
<title>print</title>
<style>
  @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
  html, body { margin: 0; padding: 0; }
  svg { display: block; width: ${widthIn}in; height: ${heightIn}in; }
</style>
</head>
<body>${svg}</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}
