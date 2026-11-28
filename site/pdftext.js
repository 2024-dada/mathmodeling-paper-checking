function makeRows(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
    let row = rows.find(r => Math.abs(r.y-y) < Math.max(2,h*0.45));
    if (!row) { row={y,h,items:[]}; rows.push(row); }
    row.items.push({x,w:it.width,s:it.str});
  }
  rows.sort((a,b)=>b.y-a.y);
  rows.forEach(r=>r.items.sort((a,b)=>a.x-b.x));
  return rows;
}
function lineText(items,h) {
  let line='',end=null;
  for(const it of items) {
    if(end!==null) {
      const gap=it.x-end;
      if(gap>h*1.5)line+='   ';
      else if(gap>h*0.12&&!/\s$/.test(line)&&!/^\s/.test(it.s))line+=' ';
    }
    line+=it.s;end=it.x+it.w;
  }
  return line;
}
// 多行共享的中部留白才视为栏间距；单个段落的缩进或词间空白不能触发分栏。
function columnDivider(rows,width) {
  const gaps=[];
  for(const row of rows) {
    const a=row.items;
    for(let i=1;i<a.length;i++) {
      const left=a[i-1].x+a[i-1].w,right=a[i].x;
      if(right-left<row.h*1.2||left<width*0.3||right>width*0.7)continue;
      if(left-a[0].x<width*0.2||a.at(-1).x+a.at(-1).w-right<width*0.2)continue;
      gaps.push({left,right,y:row.y});
    }
  }
  let best=null;
  for(const gap of gaps) {
    const x=(gap.left+gap.right)/2;
    const support=new Set(gaps.filter(g=>g.left<=x&&g.right>=x).map(g=>g.y)).size;
    if(!best||support>best.support||(support===best.support&&Math.abs(x-width/2)<Math.abs(best.x-width/2)))best={x,support};
  }
  return best?.support>=4?best.x:null;
}
export function extractPageText(items,width) {
  const rows=makeRows(items),divider=columnDivider(rows,width);
  if(divider===null)return {text:rows.map(r=>lineText(r.items,r.h)).join('\n'),columns:1};
  const lines=[];let left=[],right=[];
  const flush=()=>{lines.push(...left,...right);left=[];right=[];};
  for(const row of rows) {
    if(row.items.some(it=>it.x<divider&&it.x+it.w>divider)) {
      flush();lines.push(lineText(row.items,row.h));continue;
    }
    const l=row.items.filter(it=>it.x<divider),r=row.items.filter(it=>it.x>=divider);
    if(l.length)left.push(lineText(l,row.h));
    if(r.length)right.push(lineText(r,row.h));
  }
  flush();return {text:lines.join('\n'),columns:2};
}
export async function pdfToText(pdfjs,data,onLayout=()=>{}) {
  const task=pdfjs.getDocument({data,isEvalSupported:false});
  try {
    const doc=await task.promise,pages=[],layout=[];
    for(let p=1;p<=doc.numPages;p++) {
      const page=await doc.getPage(p),tc=await page.getTextContent();
      const width=page.getViewport({scale:1}).width;
      const out=extractPageText(tc.items,width);
      pages.push(out.text);layout.push({page:p,columns:out.columns});page.cleanup();
    }
    onLayout({format:'pdf',readingOrder:'column-aware',pages:layout,visualVerified:false});
    return pages.join('\n\f\n');
  } finally {await task.destroy();}
}
