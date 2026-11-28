import test from 'node:test';import assert from 'node:assert/strict';
import {buildWritingContext,calendarDatesIn,forcedDefinitionDeletion} from '../site/writing-context.js';
import {generateWritingGuidance} from '../site/writing-guidance.js';import {locateQuote} from '../site/engine.js';
const text='摘要：本文讨论化合物甲。甲物质缩写为ABC。\n关键词：综述\n1 引言\n本文讨论化合物甲及其来源，随后使用ABC。\n3.1 物质说明\n化合物甲（Example Compound，ABC）用于说明术语。\n参考文献\n[2] 某组织. 研究报告[R/OL]. 2013[2026-11-16]. https://example.invalid/report.';
const doc={name:'日期与定义回归',text,sourceText:text,sourceFormat:'pdf'};
const now=new Date('2026-11-29T04:00:00Z'),timeZone='Asia/Kuala_Lumpur';
const issue=(quote,problem,instruction)=>({quote,problem,instruction,acceptance:'依据真实材料核对。',priority:'medium',necessity:'required'});
const result=issues=>({profile:'中文叙述性综述',issues,preserve:['保留原文事实。'],plan:['执行有依据的润色。'],evidenceNeeded:['作者需核对实际访问日期，确认2026-11-16是否为笔误。','摘要绑定后正文定义不重复，应删除后文重复括注。']});
test('request carries the current local calendar date and an explicit non-future access-date comparison',async()=>{
 await generateWritingGuidance(doc,{async chatMessagesJSON(m){const p=JSON.parse(m[1].content);assert.equal(p.context.clock.date,'2026-11-29');assert.equal(p.context.clock.timeZone,timeZone);assert.equal(p.context.accessDateChecks[0].relation,'past');return result([]);}},{},{locateQuote,now,timeZone});
});
test('past access date cannot be called future or leak back into correction requests',async()=>{
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>result([issue('2013[2026-11-16].','该访问日期晚于当前可核验日期，属于未来日期，疑似录入错误。','请更正访问日期。')])},{},{locateQuote,now,timeZone});
 assert.doesNotMatch(out,/问题与理由：该访问日期晚于/);assert.doesNotMatch(out,/确认2026-11-16是否为笔误/);assert.match(out,/2026-11-29/);
});
test('a genuinely future access date remains a verification question, never an automatic replacement',async()=>{
 const early=new Date('2026-11-01T00:00:00Z');
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>result([issue('2013[2026-11-16].','访问日期是未来日期，需要核对。','请核对实际访问日期。')])},{},{locateQuote,now:early,timeZone});
 assert.match(out,/需核对依据|需核对实际访问日期/);
});
test('an introduction abbreviation suggestion cannot force removal of later full definitions',async()=>{
 const abbreviation={...issue('随后使用ABC','引言使用未解释缩写，后文才给全称。','在引言绑定后，后文应改为仅使用缩写，删除重复括注。'),terms:[{abbreviation:'ABC',fullName:'化合物甲'}]};
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>result([abbreviation])},{},{locateQuote,now,timeZone});
 assert.doesNotMatch(out,/修改指令：在引言绑定后，后文应改为仅使用缩写/);assert.doesNotMatch(out,/摘要绑定后正文定义不重复，应删除/);assert.match(out,/可选表达优化/);assert.match(out,/保留后文|后文.*保留/);
});

test('local calendar comparison respects timezone midnight, today and leap-day validity',()=>{
 const context=buildWritingContext({...doc,sourceText:text.replace('2026-11-16','2026-11-29')},{now:new Date('2026-11-28T16:30:00Z'),timeZone});
 assert.equal(context.clock.date,'2026-11-29');assert.equal(context.accessDateChecks[0].relation,'today');
 assert.equal(calendarDatesIn('2024-02-29')[0].valid,true);assert.equal(calendarDatesIn('2026-02-29')[0].valid,false);
});
test('an existing first-use binding containing an English full name is not mistaken for missing definition',async()=>{
 const bound=text.replace('本文讨论化合物甲及其来源，随后使用ABC。','本文讨论化合物甲（Example Compound，ABC）及其来源。');
 let meta;const abbreviation={...issue('ABC','引言首次出现缩写未定义。','在引言重新定义。'),terms:[{abbreviation:'ABC',fullName:'化合物甲'}]};
 await generateWritingGuidance({...doc,sourceText:bound,text:bound},{chatMessagesJSON:async()=>result([abbreviation])},{},{locateQuote,now,timeZone,onValidation:x=>meta=x});
 assert.equal(meta.verified,0);assert.equal(meta.contextRejected,1);
});

test('definition protection is not mistaken for a deletion command',()=>{
 assert.equal(forcedDefinitionDeletion('保留正文定义，不得删除后文英文全称。'),false);
 assert.equal(forcedDefinitionDeletion('不要求正文不重复定义。'),false);
 assert.equal(forcedDefinitionDeletion('保留信息，但后文应改为仅使用缩写，删除重复括注。'),true);
});
