const MAX_XML = 16 * 1024 * 1024;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";

export async function docxXml(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (bytes.length < 22 || bytes.length > 64 * 1024 * 1024) throw new Error("DOCX 无效或超过 64 MB，请精简文档后重试");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error("无法读取 DOCX 压缩目录，文件可能损坏或已加密");
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) throw new Error("DOCX 压缩目录损坏");
    const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
    const compressed = view.getUint32(pos + 20, true), expanded = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true), extra = view.getUint16(pos + 30, true), comment = view.getUint16(pos + 32, true);
    const next = pos + 46 + nameLength + extra + comment;
    if (next > end) throw new Error("DOCX 目录长度无效");
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    if (name === "word/document.xml") {
      if (flags & 1) throw new Error("暂不支持加密 DOCX，请先在 Word 或 WPS 中解除密码");
      if (expanded > MAX_XML) throw new Error("DOCX 正文过大，请拆分文档后重试");
      const local = view.getUint32(pos + 42, true);
      if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error("DOCX 正文位置无效");
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      if (start + compressed > bytes.length) throw new Error("DOCX 正文数据不完整");
      let data = bytes.subarray(start, start + compressed);
      if (method === 8) {
        let inflate;
        try { inflate = new DecompressionStream("deflate-raw"); }
        catch { throw new Error("此浏览器不支持 DOCX 解压，请更新 Chrome / Edge，或将文件另存为 TXT / PDF"); }
        const reader = new Blob([data]).stream().pipeThrough(inflate).getReader(), chunks = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.length;
            if (size > MAX_XML) { await reader.cancel(); throw new Error("DOCX 解压后的正文超过 16 MB"); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        data = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      } else if (method !== 0) throw new Error("暂不支持此 DOCX 压缩方式，请用 Word / WPS 重新另存为 DOCX");
      if (data.length !== expanded) throw new Error("DOCX 正文长度校验失败");
      const encoding = data[0] === 255 && data[1] === 254 ? "utf-16le" : data[0] === 254 && data[1] === 255 ? "utf-16be" : "utf-8";
      return new TextDecoder(encoding, { fatal: true }).decode(data);
    }
    pos = next;
  }
  throw new Error("未找到 Word 正文，请确认文件是真正的 .docx，而非改名的 .doc");
}

export async function docxToText(buffer) {
  const xml = await docxXml(buffer);
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  if (dom.getElementsByTagName("parsererror").length) throw new Error("DOCX 正文 XML 损坏");
  const body = dom.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("DOCX 缺少正文");
  function text(node) {
    if (node.nodeType !== 1) return "";
    if (node.namespaceURI === W && node.localName === "del") return "";
    if ((node.namespaceURI === W || node.namespaceURI === M) && node.localName === "t") return node.textContent;
    if (node.namespaceURI === W && node.localName === "tab") return "\t";
    if (node.namespaceURI === W && ["br", "cr"].includes(node.localName)) return "\n";
    const content = [...node.children].map(text).join("");
    return node.namespaceURI === W && node.localName === "p" ? content + "\n" : content;
  }
  const result = text(body).trim();
  if (!result) throw new Error("DOCX 中没有可提取的正文；图片和扫描内容请先进行 OCR");
  return result;
}
