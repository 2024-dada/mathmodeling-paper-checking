export function buildWritingContext(doc) {
  const source = doc.sourceText || doc.text;
  const lines=source.split(/\r?\n|\f/).map(s=>s.trim()).filter(s=>s&&!/^\d+$/.test(s));
  const refAt=lines.findIndex(s=>/^(参考文献|References|Bibliography)$/i.test(s));
  const body=refAt<0?lines:lines.slice(0,refAt),sections=[];
  for(const line of body) {
    const m=line.match(/^(\d+(?:\.\d+)*)\s+(.{1,60})$/);
    if(m&&!/[。；;!?！？]$/.test(m[2]))sections.push({id:m[1],title:m[2]});
  }
  const references=[];
  if(refAt>=0)for(const line of lines.slice(refAt+1)) {
    const m=line.match(/^\[(\d+)\]\s*(.*)/);
    if(m)references.push({id:m[1],text:m[2]});
    else if(references.length)references.at(-1).text+='\n'+line;
  }
  for(const ref of references) {
    const flat=ref.text.replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu,'$1').replace(/\s+/g,' ');
    ref.type=flat.match(/\[(J|N)(?:\/[A-Z]+)?\]/i)?.[1].toUpperCase()||'';
    ref.present={year:/\b(?:19|20)\d{2}\b/.test(flat),source:/\[(?:J|N|M|R|D|EB)(?:\/[A-Z]+)?\][.．。]?\s*[^,，]+[,，]\s*(?:19|20)\d{2}/i.test(flat),
      pages:/\d+\s*(?:\(\d+\))?\s*:\s*\d+(?:[-–]\d+)?/.test(flat),date:/\b\d{4}-\d{1,2}-\d{1,2}\b/.test(flat),
      doi:/\b10\.\d{4,9}\//.test(flat),url:/https?:\/\//.test(flat)};
    ref.basicFieldsPresent=ref.present.year&&ref.present.source&&(ref.type==='J'?ref.present.pages:ref.type==='N'?ref.present.date:false);
  }
  const abstract=source.match(/(?:摘要|Abstract)\s*[:：]([\s\S]*?)(?:关键词|Keywords?)\s*[:：]/i)?.[1].trim()||'';
  return {source,sourceFormat:doc.sourceFormat||'text',hasFullSource:!!doc.sourceText,sections,references,abstract,
    extraction:doc.extraction||null,visualVerified:false,
    limits:'章节和文献索引只描述输入中实际存在的文字，不证明外部文献真实或引文支持论断；未对PDF原稿、图表或排版作视觉核验。'};
}
const missing=/(?:缺少|缺失|缺|遗漏|未见|没有|不存在|未提供|未给出|不完整|截断|补全|补齐|是否存在)/;
const visual=/(?:PDF|OCR|双栏|提取).{0,20}(?:错位|顺序|截断|插入|空格|排版)|标题.{0,15}(?:插入|隔断)|(?:恢复|移动).{0,15}(?:标题|引言).{0,12}(?:位置|顺序)|(?:标题|引言).{0,12}(?:恢复|移动).{0,12}位置/;
function sectionId(s) {
  if(/^\d/.test(s))return s;
  const digits={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  if(s==='十')return '10';if(s.includes('十')){const [a,b]=s.split('十');return String((digits[a]||1)*10+(digits[b]||0));}
  return String(digits[s]||s);
}
export function guidanceDisposition(text,context,category='language') {
  const ids=[];
  for(const m of text.matchAll(/(?:缺少|缺失|缺|遗漏|未见|没有|不存在|是否存在)\s*(?:了|的)?\s*第?\s*(\d+(?:\.\d+)*|[一二三四五六七八九十]{1,3})\s*[节章]/g))ids.push(sectionId(m[1]));
  for(const m of text.matchAll(/第\s*(\d+(?:\.\d+)*|[一二三四五六七八九十]{1,3})\s*[节章].{0,6}(?:缺失|缺少|不存在|是否存在)/g))ids.push(sectionId(m[1]));
  if(ids.some(id=>context.sections.some(s=>s.id===id)))return 'contradiction';
  if((category==='reference'||/参考文献|文献条目|题名|刊名|报纸名/.test(text))&&missing.test(text)) {
    const cited=[...text.matchAll(/\[(\d+)\]/g)].map(m=>m[1]);
    const refs=context.references.filter(r=>cited.includes(r.id));
    if(/补全|补齐|题名.{0,8}截断/.test(text)&&refs.length&&refs.every(r=>r.basicFieldsPresent))return 'contradiction';
    const studyContext=/采样|受试|人群|实验条件|暴露时期/.test(text);
    const fields=[['year','年份|年'],['source','来源|刊名|报纸名'],['pages','卷期|页码'],['date','日期'],['doi','DOI']];
    for(const [field,words] of fields) {
      if(studyContext&&["year","date","source"].includes(field))continue;
      const explicit=new RegExp('(?:缺少|缺失|缺|未提供|未给出).{0,12}(?:'+words+')|(?:'+words+').{0,5}(?:缺失|不完整)','i');
      if(explicit.test(text)&&refs.length&&refs.every(r=>r.present[field]))return 'contradiction';
    }
  }
  if(context.sourceFormat==='pdf'&&(category==='extraction'||visual.test(text)))return 'visual';
  if(!context.hasFullSource&&['structure','reference'].includes(category))return 'source';
  return 'accepted';
}

export function checkAbbreviationIssue(item,context) {
  if(!/摘要/.test(item.problem)||!/全称|缩写/.test(item.problem)||!/(?:缺少|未给|未提供|未出现|未定义|没有)/.test(item.problem))return {item};
  const compact=s=>s.replace(/\s+/g,'');
  const source=compact(context.source),abstract=compact(context.abstract);
  if(!Array.isArray(item.terms)||!item.terms.length)return {review:true};
  const terms=item.terms;
  if(!terms.every(t=>t&&typeof t.abbreviation==='string'&&/^[A-Za-z][A-Za-z0-9-]{1,15}$/.test(t.abbreviation)&&typeof t.fullName==='string'&&t.fullName.trim()&&source.includes(compact(t.fullName))&&abstract.includes(t.abbreviation)))return {review:true};
  const prior=terms.every(t=>abstract.indexOf(compact(t.fullName))>=0&&abstract.indexOf(compact(t.fullName))<abstract.indexOf(t.abbreviation));
  if(!prior)return {review:true};
  const unbound=terms.filter(t=>!abstract.includes(compact(t.fullName)+'（'+t.abbreviation+'）')&&!abstract.includes(compact(t.fullName)+'('+t.abbreviation+')'));
  if(!unbound.length)return {contradiction:true};
  return {item:{...item,problem:'摘要前文已有相关全称；应核对全称与缩写是否在首次介绍时明确对应，不能称为全文未给全称。',
    instruction:'在摘要已有全称处核对并标注以下对应关系：'+unbound.map(t=>t.fullName+'（'+t.abbreviation+'）').join('、')+'。仅在对应关系确认且目标格式需要时标注；后续沿用缩写，不重复增加全称或改写科学内容。',
    acceptance:'摘要已有全称与缩写对应清楚，无重复展开；正文定义和物质、术语含义保持一致。'}};
}

export function checkCitationStyleIssue(item,context) {
  if(!/不统一|不一致/.test(item.problem)||!/引用|引文|页码/.test(item.problem))return false;
  const id=(item.quote+' '+item.problem).match(/\[(\d+)[:：]\s*\d/)?.[1];
  if(!id)return false;
  const body=context.source.split(/\n\s*(?:参考文献|References|Bibliography)\s*\n/i)[0];
  return body.includes('['+id+']')&&new RegExp('\\['+id+'[:：]\\s*\\d').test(body);
}
