import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {run,makeDocument,compileLexicon,locateQuote} from '../site/engine.js';
import {generateWritingGuidance,locateWritingQuote} from '../site/writing-guidance.js';
const resources={prompts:JSON.parse(fs.readFileSync(new URL('../site/writing-resources/prompts.json',import.meta.url))),adapters:JSON.parse(fs.readFileSync(new URL('../site/writing-resources/adapters.json',import.meta.url)))};
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(url,'utf8'))});
const doc=makeDocument('模型可能适用于部分样本，尚未验证其他地区。本文将进行深入的分析。结果误差为3%。','引用定位回归',true);
const item=quote=>({quote,problem:'表达需要复核',instruction:'核对是否有重复铺垫，仅在确有重复时压缩。',acceptance:'原有信息和限定保持完整。',priority:'medium'});
const response=issues=>({profile:'中文学术文体，目标期刊未指定',issues,preserve:['保留可能和未验证范围。'],plan:['先保护数据和限定，再复核段落表达。'],evidenceNeeded:[]});
test('mixed located and unlocated quotes must not abort the detection at 60 percent',async()=>{
 let calls=0;const steps=[];
 const result=await run({docs:[doc],lex:compileLexicon(JSON.parse(fs.readFileSync(new URL('../site/lexicon.json',import.meta.url)))),opt:{only:'none',polish:true},client:{async chatMessagesJSON(){calls++;return response([item('本文将进行深入的分析'),item('此段是模型概括但并非逐字原文')]);}},progress:(done,total)=>steps.push([done,total])});
 assert.match(result.prompts[0],/本文将进行深入的分析/);
 assert.match(result.prompts[0],/未定位/);
 assert.doesNotMatch(result.prompts[0],/此段是模型概括但并非逐字原文/);
 assert.deepEqual(steps.at(-1),[2,2]);assert.equal(calls,1);
});
test('minimal unlocated quote still produces explicitly limited guidance',async()=>{
 const result=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>response([item('此段是模型概括但并非逐字原文')])},resources,{locateQuote});
 assert.match(result,/未定位/);assert.match(result,/最终交付与验收/);
 assert.doesNotMatch(result,/本次未定位到需要修改的具体问题/);
});

test('format-only differences locate the exact original span',()=>{
 for(const [text,quote] of [
  ['本文将进行深入的分析。','本文 将进行 深入的分析'],
  ['本文 将进行\n深入的分析。','本文将进行深入的分析'],
  ['Full width value is 100.','Ｆｕｌｌ ｗｉｄｔｈ ｖａｌｕｅ ｉｓ １００.'],
  ['前缀😀Ｆｕｌｌ　ｗｉｄｔｈ　１００．后缀','Full width 100.']
 ]){const found=locateWritingQuote(text,quote,locateQuote);assert.ok(found);assert.ok(text.includes(found));}
});
test('numeric changes, mathematical meaning and paraphrases are not accepted',()=>{
 for(const [text,quote] of [
  ['模型误差为3%，参数为x+y。','模型误差为30%'],
  ['Parameter x+y gives a result.','Parameter x-y gives a result.'],
  ['Area is 10 m² in the record.','Area is 10 m2 in the record.'],
  ['本文深入研究模型约束，结果尚不明确。','本文证明模型有效'],
  ['首先讨论方法。然后讨论误差。','首先讨论方法……然后讨论误差']
 ])assert.equal(locateWritingQuote(text,quote,locateQuote),null);
});
test('rejected quote metadata is returned with other selected checks and guidance',async()=>{
 const steps=[];
 const result=await run({docs:[doc],lex:compileLexicon(JSON.parse(fs.readFileSync(new URL('../site/lexicon.json',import.meta.url)))),opt:{only:'def',polish:true},client:{chatMessagesJSON:async()=>response([item('本文 将进行 深入的分析'),item('不存在的概括语句')])},progress:(a,b)=>steps.push([a,b])});
 assert.equal(result.writing[0].verified,1);assert.equal(result.writing[0].rejected,1);assert.equal(result.writing[0].formatMatched,1);
 assert.ok(result.dfn[0]);assert.match(result.prompts[0],/同次其他检查/);assert.match(result.prompts[0],/未定位/);assert.deepEqual(steps.at(-1),[3,3]);
});
