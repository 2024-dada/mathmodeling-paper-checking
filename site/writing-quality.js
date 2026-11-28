export function extractTermDefinitions(source) {
  const definitions=[];
  const pattern=/(?:^|[\n。；！？])\s*([\p{Script=Han}][\p{Script=Han}A-Za-z0-9·-]{1,28})[（(]([^（）()]{1,180})[）)]/gu;
  for(const m of source.matchAll(pattern)) {
    if(/^(?:本文|本研究|我们|研究者|结果|采用|涉及|包括|讨论|指出|表明)/.test(m[1]))continue;
    const pair=m[2].trim().match(/^([\s\S]+?)[,，;；]\s*([A-Za-z][A-Za-z0-9-]{1,15})$/);
    if(!pair||!/[A-Za-z]{3}/.test(pair[1]))continue;
    definitions.push({chineseName:m[1],englishName:pair[1].replace(/\s+/g,' ').trim(),abbreviation:pair[2]});
  }
  return definitions;
}
export function preferChineseTerms(terms,context,scope) {
  const han=(scope.match(/\p{Script=Han}/gu)||[]).length,latin=(scope.match(/[A-Za-z]+/g)||[]).length;
  if(han<=latin)return terms;
  const compact=s=>s.replace(/\s+/g,'').toLowerCase();
  return terms.map(t=>{
    if(!t||typeof t.fullName!=='string')return t;
    const definition=context.termDefinitions.find(d=>d.abbreviation===t.abbreviation&&(compact(d.englishName)===compact(t.fullName)||compact(d.chineseName)===compact(t.fullName)));
    if(definition)return {...t,fullName:definition.chineseName};
    return t;
  });
}
export function normalizeLanguageIssue(item) {
  const parallel=/并列|名词(?:性)?短语|主谓结构/.test(item.problem)&&/形式|层级|结构|不齐|一致/.test(item.problem);
  const concreteMeaning=item.impact==='meaning'&&typeof item.effect==='string'&&item.effect.trim().length>=8&&!/不流畅|不顺畅|不整齐|不平行|结构断裂/.test(item.effect);
  if(!parallel||concreteMeaning)return item;
  return {...item,necessity:'optional',
    problem:'这些并列项采用了不同的表达形式，可视上下文选择是否调整以便阅读；不能仅据形式差异断定原句有错。',
    instruction:'仅在确有可读性收益时考虑以下方案，原句通顺时可以保留：'+item.instruction,
    acceptance:'允许保留原句；如选择调整，需保留并列各项信息、范围与证据强度。'+item.acceptance};
}
export function isExternalEvidenceRequest(text) {
  return /回查|(?:查阅|核对|查证|核实).{0,18}(?:原文|原始文献|原始记录|所引文献|引用来源)|(?:所指|具体含义|技术解释).{0,15}(?:核对|核实|确认|说明)|(?:核对|核实|确认).{0,15}(?:所指|具体含义|技术解释)/.test(text);
}
export function isFormatPreference(text) {
  if(/单位换算|数值错误|量纲|结果不一致|数据缺失|证据不足/.test(text))return false;
  return /目标期刊|投稿期刊|学校.{0,8}(?:格式|规范)|期刊.{0,8}(?:格式|规范|要求)|格式规范|摘要是否必须|单位写法/.test(text);
}
