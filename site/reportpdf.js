// 将浏览器绘制的报告分页封装成 PDF，中文沿用本机字体。
export function jpegPagesToPdf(pages) {
  const enc = new TextEncoder(), chunks = [], offsets = [0];
  let length = 0;
  const add = value => { const data = typeof value === "string" ? enc.encode(value) : value; chunks.push(data); length += data.length; };
  const object = (id, body) => { offsets[id] = length; add(`${id} 0 obj\n`); body(); add("\nendobj\n"); };
  add("%PDF-1.4\n%papersim\n");
  object(1, () => add("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => add(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`));
  pages.forEach((page, i) => {
    const id = 3 + i * 3;
    object(id, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Report ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`));
    object(id + 1, () => { add(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`); add(page.bytes); add("\nendstream"); });
    const content = "q\n595.28 0 0 841.89 0 0 cm\n/Report Do\nQ\n";
    object(id + 2, () => add(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`));
  });
  const xref = length, count = 3 + pages.length * 3;
  add(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) add(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

export async function reportPdf(blocks, onPage = () => {}) {
  await document.fonts.ready;
  const width = 794, height = 1123, margin = 56, bottom = height - 70, pages = [];
  let canvas, ctx, y;
  const font = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
  function begin() {
    canvas = document.createElement("canvas"); canvas.width = width * 2; canvas.height = height * 2;
    ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器无法创建 PDF 绘图画布");
    ctx.scale(2, 2); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#173147"; ctx.font = `bold 15px ${font}`; ctx.fillText("papersim / 论文自查报告", margin, 36);
    ctx.fillStyle = "#8bdae4"; ctx.fillRect(margin, 47, width - margin * 2, 2); y = 82;
  }
  async function finish() {
    ctx.fillStyle = "#62758a"; ctx.font = `11px ${font}`;
    ctx.fillText(`papersim · 第 ${pages.length + 1} 页`, margin, height - 32);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .94));
    if (!blob) throw new Error("浏览器生成 PDF 页面失败");
    pages.push({ width: canvas.width, height: canvas.height, bytes: new Uint8Array(await blob.arrayBuffer()) });
    onPage(pages.length); await new Promise(resolve => setTimeout(resolve, 0));
  }
  begin();
  for (const block of blocks) {
    const heading = block.heading, size = heading ? 19 : 13, lineHeight = heading ? 30 : 22;
    if (heading) { if (y + lineHeight * 2 > bottom) { await finish(); begin(); } y += 12; }
    const applyFont = () => { ctx.font = `${heading ? "bold " : ""}${size}px ${font}`; ctx.fillStyle = heading ? "#173147" : "#243549"; };
    applyFont();
    for (const paragraph of String(block.text ?? "").replace(/\r/g, "").split("\n")) {
      let line = "";
      const draw = async () => {
        if (y + lineHeight > bottom) { await finish(); begin(); applyFont(); }
        ctx.fillText(line, margin, y); y += lineHeight; line = "";
      };
      for (const char of paragraph.replace(/\t/g, "    ")) {
        if (ctx.measureText(line + char).width > width - margin * 2 && line) await draw();
        line += char;
      }
      await draw();
    }
    y += heading ? 6 : 8;
  }
  await finish();
  return jpegPagesToPdf(pages);
}
