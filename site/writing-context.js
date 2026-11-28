import { extractTermDefinitions, preferChineseTerms } from "./writing-quality.js?v=restraint5";

export function calendarDatesIn(text) {
  return [...text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)].map(m=>{
    const [y,month,day]=m.slice(1).map(Number),d=new Date(Date.UTC(y,month-1,day));
    return {raw:m[0],value:String(y).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'),
      valid:d.getUTCFullYear()===y&&d.getUTCMonth()===month-1&&d.getUTCDate()===day};
  });
}
function calendarClock(now,timeZone) {
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  const parts=Object.fromEntries(formatter.formatToParts(now).map(p=>[p.type,p.value]));
  return {date:parts.year+'-'+parts.month+'-'+parts.day,timeZone:formatter.resolvedOptions().timeZone,source:'浏览器本机时间，未联网校时'};
}
export function checkDateClaim(text,context) {
  const claim=text.replace(/(?:并非|不是|不属于|非)未来日期|不晚于(?:当前|今天|现在|今日)/g,'');
  if(!/未来日期|晚于(?:当前|今天|现在|今日|本日)|尚未到|日期.{0,8}在未来/.test(claim))return null;
  let dates=calendarDatesIn(text).filter(x=>x.valid).map(x=>x.value);
  if(!dates.length){const ids=[...text.matchAll(/\[(\d+)\]/g)].map(m=>m[1]);dates=context.accessDateChecks.filter(x=>ids.includes(x.referenceId)&&x.relation!=='invalid').map(x=>x.value);}
  if(!dates.length)return null;
  return dates.every(x=>x<=context.clock.date)?'contradiction':'future';
}
export function forcedDefinitionDeletion(text) {
  text=text.replace(/(?:不应|不要|不能|不得|不必|无需|禁止)\s*(?:强制|机械地?|一概)?\s*(?:删除|去掉|删去)(?:后文|正文|后续章节).{0,12}(?:定义|括注|英文全称)/g,'')
    .replace(/(?:不要求|不强制)(?:摘要和|摘要与)?(?:正文|后文).{0,12}不重复定义/g,'');
  return /(?:正文|后文|后续章节|3\.\d+).{0,30}(?:不重复定义|应改为仅使用缩写|删除重复括注)|(?:删除|去掉|删去)(?:后文|正文|后续章节).{0,12}(?:定义|括注|英文全称)/.test(text);
}

export function buildWritingContext(doc,{now=new Date(),timeZone}={}) {
  const source = doc.sourceText || doc.text;
  const clock=calendarClock(now,timeZone);
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
  const firstSection=body.findIndex(s=>/^\d{1,2}(?:\.\d+)*\s+\S|^[一二三四五六七八九十]+[、．.]\s*\S|^(?:引言|Introduction)$/i.test(s));
  const keywordLine=body.findIndex(s=>/^(?:关键词|Keywords?)\s*[:：]/i.test(s));
  const bodyText=(firstSection>=0?body.slice(firstSection):keywordLine>=0?body.slice(keywordLine+1):abstract?[]:body).join('\n');
  const accessDateChecks=[...source.matchAll(/[\[［]\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*[\]］]/g)].map(m=>{
    const date=calendarDatesIn(m[1])[0];
    return {...date,referenceId:references.find(r=>r.text.includes(m[1]))?.id||null,
      relation:!date.valid?'invalid':date.value<clock.date?'past':date.value===clock.date?'today':'future'};
  });
  return {source,bodyText,clock,accessDateChecks,termDefinitions:extractTermDefinitions(source),sourceFormat:doc.sourceFormat||'text',hasFullSource:!!doc.sourceText,sections,references,abstract,
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
  if(checkDateClaim(text,context)==='contradiction')return 'contradiction';
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
  if(!/全称|缩写/.test(item.problem)||!/(?:缺少|未给|未提供|未出现|未定义|没有|未解释|先用|首次|绑定|重复定义)/.test(item.problem))return {item};
  const compact=s=>s.replace(/\s+/g,'');
  const source=compact(context.source),isAbstract=/摘要/.test(item.problem),scope=compact(isAbstract?context.abstract:context.bodyText);
  if(!scope||!Array.isArray(item.terms)||!item.terms.length)return {review:true};
  const terms=preferChineseTerms(item.terms,context,scope);
  const chineseAbstract=isAbstract&&(scope.match(/\p{Script=Han}/gu)||[]).length>(scope.match(/[A-Za-z]+/g)||[]).length;
  if(chineseAbstract&&terms.some(t=>t&&typeof t.fullName==='string'&&!/\p{Script=Han}/u.test(t.fullName)))return {review:true};
  if(!terms.every(t=>t&&typeof t.abbreviation==='string'&&/^[A-Za-z][A-Za-z0-9-]{1,15}$/.test(t.abbreviation)&&typeof t.fullName==='string'&&t.fullName.trim()&&source.includes(compact(t.fullName))&&scope.includes(t.abbreviation)))return {review:true};
  const esc=s=>s.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
  const unbound=terms.filter(t=>{
    const binding=new RegExp(esc(compact(t.fullName))+'[（(][^（）()]{0,160}'+esc(t.abbreviation)+'[^（）()]{0,30}[）)]').exec(scope);
    const first=scope.indexOf(t.abbreviation);
    return !binding||binding.index>first||binding.index+binding[0].length<first+t.abbreviation.length;
  });
  if(!unbound.length)return {contradiction:true};
  const prior=unbound.some(t=>scope.indexOf(compact(t.fullName))>=0&&scope.indexOf(compact(t.fullName))<scope.indexOf(t.abbreviation));
  return {item:{...item,necessity:'optional',
    problem:(prior?'相关中文全称已在当前阅读范围中出现；':'需结合当前阅读范围核对术语对应；')+'首次介绍时明确全称与缩写的对应属于可选清晰度优化，不据此要求摘要与正文只定义一次。',
    instruction:'分别核对摘要与正文，仅在对应关系确认且确有阅读需要时，在已有全称处绑定缩写，或在尚未说明的缩写首次使用处补入本文已有的全称：'+unbound.map(t=>t.fullName+'（'+t.abbreviation+'）').join('、')+'。保留后文英文全称、物质说明和有信息的定义，不机械要求后文仅使用缩写，不增添未经证实的术语。',
    acceptance:'各阅读范围中术语对应清楚，不重复堆砌全称；摘要与正文可按需要分别定义，后文英文全称和必要说明保留，信息与引用关系不变。'}};
}

export function checkCitationStyleIssue(item,context) {
  if(!/不统一|不一致/.test(item.problem)||!/引用|引文|页码/.test(item.problem))return false;
  const id=(item.quote+' '+item.problem).match(/\[(\d+)[:：]\s*\d/)?.[1];
  if(!id)return false;
  const body=context.source.split(/\n\s*(?:参考文献|References|Bibliography)\s*\n/i)[0];
  return body.includes('['+id+']')&&new RegExp('\\['+id+'[:：]\\s*\\d').test(body);
}
