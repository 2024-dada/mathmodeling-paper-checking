import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {generateWritingGuidance} from '../site/writing-guidance.js';import {buildWritingContext,guidanceDisposition} from '../site/writing-context.js';
import {makeDocument,locateQuote} from '../site/engine.js';
const raw='摘要：本文讨论邻苯二甲酸酯、双酚A和多溴联苯醚的来源。所选资料分别涉及PAEs、BPA和PBDEs。\n关键词：综述\n1 引言\n本文为叙述性综述。资料选取以用户提供的论文为基础。\n5 防控\n有关管理的讨论。\n6 研究展望\n后续研究仍需验证。\n7 结论\n总结。\n参考文献\n[4] 某某. 污染状况及健康危害研究\n进展[J]. 环境研究, 2018, 35(11): 1018-1022. DOI: 10.1234/example.\n[5] 某某. 废物处置报道[N]. 环境报, 2021-09-27(019).';
const doc={...makeDocument(raw,'通用综述'),sourceText:raw,sourceFormat:'pdf',extraction:{format:'pdf',readingOrder:'column-aware',visualVerified:false}};
const resources={prompts:[],adapters:[]};
const issue=(quote,problem,category='language')=>({quote,problem,category,instruction:'按照该问题核对并调整。',acceptance:'保持信息准确。',priority:'medium'});
const result=issues=>({profile:'中文叙述性综述',issues,preserve:['保留事实和限定。'],plan:['先检查语言表达。','缺少第6节，应补写第6节。','补齐参考文献[4][5]缺少的刊名和日期。'],evidenceNeeded:['需补参考文献[4][5]缺少的年份和来源。']});
test('guidance sees full source, abstract, section inventory and complete references',async()=>{
 await generateWritingGuidance(doc,{async chatMessagesJSON(messages){const p=JSON.parse(messages[1].content);assert.ok(p.paper.text.includes('6 研究展望'));assert.ok(p.paper.text.includes('2018, 35(11)'));assert.ok(p.context.sections.some(s=>s.id==='6'));assert.equal(p.context.references.length,2);assert.match(p.context.abstract,/邻苯二甲酸酯/);return result([]);}},resources,{locateQuote});
});
test('existing section and present reference fields contradict missing-content claims in all output sections',async()=>{
 let meta;
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>result([issue('7 结论','缺少第6节，编号不连续。','structure'),issue('[4] 某某. 污染状况及健康危害研究','参考文献[4][5]缺少年份和来源，题名截断。','reference'),issue('用户提供的论文','正式论文保留了对话过程称呼。')])},resources,{locateQuote,onValidation:x=>meta=x});
 assert.equal(meta.verified,1);assert.ok(meta.contextRejected>=2);assert.match(out,/用户提供的论文/);assert.doesNotMatch(out,/缺少第6节，应补写/);assert.doesNotMatch(out,/补齐参考文献\[4\]\[5\]缺少/);assert.doesNotMatch(out,/需补参考文献\[4\]\[5\]缺少/);
});
test('PDF layout claims remain unconfirmed and never become manuscript editing commands',async()=>{
 const data=result([issue('1 引言','标题插入正文，可能是PDF提取造成的段落错位。','extraction')]);data.plan=['把1引言恢复到原稿正确位置。'];
 let meta;const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>data},resources,{locateQuote,onValidation:x=>meta=x});
 assert.equal(meta.verified,0);assert.equal(meta.needsVisualReview,1);assert.match(out,/需查看原稿/);assert.doesNotMatch(out,/把1引言恢复到原稿正确位置/);
});

test('old missing-reference requests cannot leak back through plan or evidence fields',async()=>{
 const data=result([]);data.plan=['请作者补全[4][5]等条目。'];data.evidenceNeeded=['参考文献[4][5]的题名、刊名、年份及日期需作者补全。'];
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>data},resources,{locateQuote});
 assert.doesNotMatch(out,/请作者补全\[4\]\[5\]|需作者补全/);
});
test('abbreviation absence requires term evidence, not just a short acronym quote',async()=>{
 const data=result([issue('PAEs、BPA和PBDEs','摘要首次出现缩写未给中文全称。')]);
 let meta;const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>data},resources,{locateQuote,onValidation:x=>meta=x});
 assert.equal(meta.verified,0);assert.equal(meta.needsContentReview,1);assert.doesNotMatch(out,/问题与理由：摘要首次出现缩写未给中文全称/);assert.match(out,/已有全称/);
});
test('when full names already exist, suggest binding abbreviations rather than repeating names',async()=>{
 const data=result([{...issue('PAEs、BPA和PBDEs','摘要首次出现缩写未给中文全称。'),terms:[{abbreviation:'PAEs',fullName:'邻苯二甲酸酯'},{abbreviation:'BPA',fullName:'双酚A'},{abbreviation:'PBDEs',fullName:'多溴联苯醚'}]}]);
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>data},resources,{locateQuote});
 assert.doesNotMatch(out,/问题与理由：摘要首次出现缩写未给中文全称/);assert.match(out,/已有全称处/);assert.match(out,/不重复/);
});

test('a genuinely missing reference year is not hidden by the context check',()=>{
 const incomplete=raw.replace('2018, 35(11): 1018-1022.','35(11): 1018-1022.');
 const context=buildWritingContext({...doc,sourceText:incomplete});
 assert.equal(guidanceDisposition('参考文献[4]缺少年份，请按真实来源核对。',context,'reference'),'accepted');
});
test('study sampling year is distinct from a reference publication year',()=>{
 const context=buildWritingContext(doc);
 assert.equal(guidanceDisposition('参考文献[4]未给出采样年份，需核对研究报告。',context,'reference'),'accepted');
});
