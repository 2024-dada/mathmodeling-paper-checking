// 用 pdf.js 抽取 PDF 文字，按行重建（同一行按 x 排序，行与行按 y 排序），效果接近 pdftotext -layout 的分行。
export async function pdfToText(pdfjs, data) {
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!("str" in it) || !it.str) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
      let row = rows.find(r => Math.abs(r.y - y) < Math.max(2, h * 0.45));
      if (!row) { row = { y, h, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines = rows.map(r => {
      r.items.sort((a, b) => a.x - b.x);
      let line = "", end = null;
      for (const it of r.items) {
        if (end !== null) {
          const gap = it.x - end;
          if (gap > r.h * 1.5) line += "   ";
          else if (gap > r.h * 0.12 && !/\s$/.test(line) && !/^\s/.test(it.s)) line += " ";
        }
        line += it.s; end = it.x + it.w;
      }
      return line;
    });
    pages.push(lines.join("\n"));
    page.cleanup();
  }
  await task.destroy();
  return pages.join("\n\f\n");
}
