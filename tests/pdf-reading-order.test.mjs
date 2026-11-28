import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfToText} from '../site/pdftext.js';
const item=(str,x,y,width=220,height=10)=>({str,width,height,transform:[height,0,0,height,x,y]});
const fake=pages=>({getDocument:()=>({promise:Promise.resolve({numPages:pages.length,getPage:async n=>({getTextContent:async()=>({items:pages[n-1]}),getViewport:()=>({width:600}),cleanup(){}})}),async destroy(){}})});
test('full-width abstract then two columns follows column order',async()=>{
 const items=[item('标题及摘要：覆盖整页宽度，先阅读这一部分。',50,800,500)];
 for(let i=0;i<6;i++)items.push(item('左栏第'+i+'行的连续正文内容',50,700-i*20),item('右栏第'+i+'行的连续正文内容',330,700-i*20));
 const text=await pdfToText(fake([items]),new Uint8Array());
 assert.ok(text.indexOf('标题及摘要')<text.indexOf('左栏第0行'));
 assert.ok(text.indexOf('左栏第5行')<text.indexOf('右栏第0行'));
 assert.doesNotMatch(text,/左栏第0[^\n]*右栏/);
});
test('right-column references do not precede lower left-column sections',async()=>{
 const items=[];
 for(let i=0;i<8;i++)items.push(item(i===4?'6 研究展望':'左栏连续正文内容'+i,50,700-i*30),item(i===1?'参考文献':'右栏参考条目内容'+i,330,700-i*30));
 const text=await pdfToText(fake([items]),new Uint8Array());
 assert.ok(text.indexOf('6 研究展望')<text.indexOf('参考文献'));
});
test('single-column prose and full-width lines keep their order',async()=>{
 const items=[item('第一段完整的单栏正文覆盖页面中央',50,700,490),item('第二段完整的单栏正文覆盖页面中央',50,680,490)];
 assert.equal(await pdfToText(fake([items]),new Uint8Array()),items.map(x=>x.str).join('\n'));
});

test('superscript citation belongs to its body line rather than the previous column',async()=>{
 const items=[];
 for(let i=0;i<6;i++)items.push(item(i===5?'WHO与UNEP报告':'左栏正文内容'+i,50,700-i*20),item(i===0?'和一篇新闻报道':'右栏正文内容'+i,330,700-i*20));
 items.find(x=>x.str==='和一篇新闻报道').width=80;
 items.push(item('[1-5]',412,705,20,6),item('。后续说明',434,700,110));
 const text=await pdfToText(fake([items]),new Uint8Array());
 assert.match(text,/和一篇新闻报道\s*\[1-5\]\s*。后续说明/);
 assert.doesNotMatch(text,/WHO与UNEP报告\s*\[1-5\]/);
});
