import test from 'node:test';import assert from 'node:assert/strict';
import {generateWritingGuidance} from '../site/writing-guidance.js';import {locateQuote} from '../site/engine.js';
const source='摘要：本文讨论聚合物甲的性质及证据。相关资料涉及PAA的用途。\n关键词：综述\n1 引言\n聚合物甲（Polymer Alpha，PAA）是一种用于说明术语的材料。\n资料涉及组织作用、酶活性改变及运输受到干扰。沉降可能构成来源[1]。\n参考文献\n[1] 某某. 来源研究[J]. 环境研究, 2020, 3(1): 1-5.';
const doc={name:'克制润色回归',text:source,sourceText:source,sourceFormat:'pdf'};
const item=(quote,problem,instruction)=>({quote,problem,instruction,acceptance:'保留原意和证据强度。',priority:'medium',necessity:'required'});
const response=(issues,evidenceNeeded=[])=>({profile:'中文叙述性综述',issues,preserve:['保留科学含义。'],plan:['按依据改善表达。'],evidenceNeeded});
test('Chinese abstract binds an existing Chinese name instead of adding the English full name',async()=>{
 const a={...item('相关资料涉及PAA的用途','摘要首次出现缩写未绑定全称。','请绑定全称。'),terms:[{abbreviation:'PAA',fullName:'Polymer Alpha'}]};
 let calls=0;const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>{calls++;return response([a]);}},{},{locateQuote});
 assert.match(out,/聚合物甲（PAA）/);assert.doesNotMatch(out,/Polymer Alpha（PAA）/);assert.equal(calls,1);
});
test('parallel form difference alone cannot become a mandatory grammar failure',async()=>{
 let meta;const a=item('酶活性改变','并列项为名词短语和主谓结构，并列层级不一致，阅读时结构断裂。','将三项统一为名词短语。');
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>response([a])},{},{locateQuote,onValidation:x=>meta=x});
 assert.equal(meta.required,0);assert.equal(meta.optional,1);assert.doesNotMatch(out,/阅读时结构断裂/);assert.match(out,/可选表达优化/);
});
test('source-dependent interpretation does not introduce unsupported technical alternatives',async()=>{
 const a={...item('沉降可能构成来源','沉降可能是机制Q或过程Z，存在歧义。','回查文献[1]原文，确认具体所指后再改。'),necessity:'verify'};
 let meta;const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>response([a],['机制Q还是过程Z的具体所指需回查原文。'])},{},{locateQuote,onValidation:x=>meta=x});
 assert.equal(meta.verified,0);assert.ok(meta.needsContentReview>=1);assert.doesNotMatch(out,/机制Q|过程Z/);assert.match(out,/确认之前保留原词/);
});
test('unspecified formatting is optional and never a prerequisite for text editing',async()=>{
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>response([],['目标期刊的格式、摘要缩写和单位写法尚未提供，需要确认后才能润色。','请确认学校格式规范，再决定是否继续。'])},{},{locateQuote});
 assert.match(out,/可选格式/);assert.match(out,/不阻碍|不影响/);assert.doesNotMatch(out,/需要确认后才能润色|再决定是否继续/);
});
test('actual numerical evidence questions remain distinguishable from formatting preferences',async()=>{
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>response([],['两列单位换算不一致，需核对原始数据的数值和量纲。'])},{},{locateQuote});
 assert.match(out,/单位换算不一致/);
});

test('English abstracts keep existing English terminology',async()=>{
 const english={name:'English abstract',text:'Abstract: This study discusses Polymer Alpha and PAA.\nKeywords: review\n1 Introduction\nPolymer Alpha (PAA) is defined here.',sourceText:'Abstract: This study discusses Polymer Alpha and PAA.\nKeywords: review\n1 Introduction\nPolymer Alpha (PAA) is defined here.'};
 const a={...item('PAA','摘要首次使用缩写未绑定全称。','按需绑定。'),terms:[{abbreviation:'PAA',fullName:'Polymer Alpha'}]};
 const out=await generateWritingGuidance(english,{chatMessagesJSON:async()=>response([a])},{},{locateQuote});
 assert.match(out,/Polymer Alpha（PAA）/);
});
test('explicit meaning effects are not downgraded merely because parallelism is mentioned',async()=>{
 let meta;const a={...item('资料涉及组织作用','并列项目出现含义不清，比较对象错误。','核对比较对象。'),impact:'meaning',effect:'两种不同对象被理解为同一种对象，影响结论的适用范围。'};
 await generateWritingGuidance(doc,{chatMessagesJSON:async()=>response([a])},{},{locateQuote,onValidation:x=>meta=x});assert.equal(meta.required,1);
});
test('format-only issues are separate from unresolved source evidence',async()=>{
 let meta;const a={...item('PAA','目标期刊摘要格式未确认。','请确认学校格式规范后再润色。'),necessity:'verify'};
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>response([a])},{},{locateQuote,onValidation:x=>meta=x});
 assert.equal(meta.formatPreferences,1);assert.equal(meta.verified,0);assert.match(out,/可选格式/);assert.doesNotMatch(out,/请确认学校格式规范后再润色/);
});
