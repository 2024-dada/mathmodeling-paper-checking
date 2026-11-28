import test from 'node:test';import assert from 'node:assert/strict';
import {ACADEMIC_STYLE_RULES,issueNecessity} from '../site/writing-style.js';
import {generateWritingGuidance,writingSystemPrompt} from '../site/writing-guidance.js';
import {locateQuote} from '../site/engine.js';
const doc={name:'学术表达样例',text:'本文根据现有文献讨论暴露与效应[4]。某项结果见[4:1019]。中文话题句可以有合理的表达用途。',sourceText:'本文根据现有文献讨论暴露与效应[4]。某项结果见[4:1019]。中文话题句可以有合理的表达用途。'};
const item={quote:'中文话题句可以有合理的表达用途',problem:'可以考虑调整表达顺序以便阅读。',instruction:'仅在有助于当前上下文衔接时调整，通顺时保留。',acceptance:'信息和判断强度不变。',priority:'high'};
const fixture=issues=>({profile:'中文综述',issues,preserve:['保留文献转述性质。'],plan:['根据证据改善表达。'],evidenceNeeded:[]});
test('style guidance adapts to genre and cannot invent quantitative support',()=>{
 assert.equal(ACADEMIC_STYLE_RULES.length,12);assert.match(writingSystemPrompt(),/没有定量证据时保持定性表达/);assert.match(writingSystemPrompt(),/叙述性综述强调/);assert.match(writingSystemPrompt(),/不要把话题句/);assert.equal(issueNecessity(item),'optional');
});
test('style and necessity labels reach the handoff without implying every difference is an error',async()=>{
 let summary;const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>fixture([item])},{},{locateQuote,onValidation:x=>summary=x});
 assert.match(out,/学术表达目标与文体适配/);assert.match(out,/处理性质：可选表达优化/);assert.equal(summary.required,0);assert.equal(summary.optional,1);
});
test('explicit necessary corrections remain distinguishable from optional improvements',async()=>{
 const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>fixture([{...item,necessity:'required'}])},{},{locateQuote});
 assert.match(out,/处理性质：必要修正建议/);
});
test('general and pinpoint citations do not justify automatic removal of page locators',async()=>{
 const citation={...item,quote:'[4:1019]',problem:'同一文献既有[4]又有[4:1019]，引用格式不统一。',instruction:'全部改为[4]。',category:'reference'};
 let summary;const out=await generateWritingGuidance(doc,{chatMessagesJSON:async()=>fixture([citation])},{},{locateQuote,onValidation:x=>summary=x});
 assert.equal(summary.verified,0);assert.equal(summary.needsContentReview,1);assert.match(out,/保留已有定位信息/);assert.doesNotMatch(out,/全部改为\[4\]/);
});

test('empty scanned text is rejected before a paid model call',async()=>{
 let calls=0;
 await assert.rejects(generateWritingGuidance({name:'扫描样例',text:'',sourceText:'\n\f\n',sourceFormat:'pdf'},{chatMessagesJSON(){calls++;throw Error('unexpected');}},{},{locateQuote}),/扫描PDF请先OCR/);
 assert.equal(calls,0);
});
