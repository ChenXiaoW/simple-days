const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const moment = require('moment');
let language = 'zh';
const api = {
  requireApiVersion: () => true, getLanguage: () => language, moment,
  normalizePath: value => value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, ''),
  Plugin: class {}, ItemView: class {}, Modal: class {}, PluginSettingTab: class {}, Notice: class {}, Setting: class {},
};
const sandbox = { module: { exports: {} }, require: name => { assert.equal(name, 'obsidian'); return api; } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.testing = {parseDailySchedules,planDailyImport,renderSchedules,eventDates};', sandbox);
const Plugin = sandbox.module.exports.default;
const {parseDailySchedules: parse, planDailyImport: plan, renderSchedules: render, eventDates} = sandbox.module.exports.testing;
const copy = value => JSON.parse(JSON.stringify(value));
const draft = (extra = {}) => ({id:'old',title:'项目复盘',date:'2026-11-09',startTime:'09:00',endTime:'10:00',
  location:'会议室 A',notes:'### 准备\n\n- [ ] 一级待办\n  - [x] 子项\n\n```md\n- [ ] 代码内文本\n```\n\n<!-- 保留 -->',
  completed:true,category:'meeting',tags:['项目','重要'],participants:['小王','小李'],...extra});
const block = event => render(eventDates(event).map(date => ({event,date})));
const file = (text, date = '2026-11-09', name = `日记/${date}.md`) => parse(text, name, date);
const markers = text => `<!-- obsidian-schedule-manager:start -->\n## 日程\n\n${text}\n<!-- obsidian-schedule-manager:end -->`;

(async () => {
  for (const lang of ['zh','en']) {
    language = lang;
    for (const event of [draft(), draft({startTime:'',endTime:'',title:'全天 09:00 内容'}),
      draft({startTime:'',endTime:'18:00'}), draft({startTime:'09:00',endTime:''}),
      draft({endDate:'2026-11-11',startTime:'22:00',endTime:'02:00'}),
      draft({endDate:'2026-11-11',startTime:'',endTime:''}),
      draft({endDate:'2026-11-10',startTime:'22:00',endTime:'00:00'})]) {
      const original = JSON.stringify(event);
      const text = block(event).replace(/\n/g,'\r\n');
      // Parse Chinese files under an English UI and vice versa.
      language = lang === 'en' ? 'zh' : 'en';
      const parsed = file(`- [ ] 普通待办\r\n${text}\r\n其他日记正文`);
      assert.equal(parsed.issues.length,0, JSON.stringify(parsed.issues));
      const merged = plan(parsed.candidates,[]);
      assert.equal(merged.additions.length,1,'Multi-day copies merge into one event');
      const restored = merged.additions[0].event;
      for (const key of ['title','date','startTime','endTime','location','notes','completed','tags','participants']) {
        assert.deepEqual(copy(restored[key]),copy(event[key]), `${lang}: ${key}`);
      }
      assert.equal(restored.category,'work','Legacy diaries have no category');
      assert.equal(restored.endDate || restored.date,event.endDate || event.date);
      assert.equal(JSON.stringify(event),original);
      assert.equal(plan(parsed.candidates,[{...restored,id:'new'}]).additions.length,0,'Repeated imports do not duplicate events');
      language = lang;
    }
  }
  language = 'zh';
  assert.equal(file('- [ ] 09:00 普通待办').candidates.length,0);
  assert.equal(file('```md\n'+block(draft())+'\n```').candidates.length,0,'Examples in fenced code are ignored');
  assert.equal(file(markers('- [ ] 09:00 无日期'),'').issues.length,1);
  assert.equal(file(markers('### 2026-02-30\n- [ ] 全天 无效')).issues.length,1);
  assert.equal(file(markers('- [ ] 25:00 无效')).issues.length,1);
  assert.equal(file(markers('- [ ] 10:00 – 09:00 无效')).issues.length,1);
  assert.equal(file(markers('- [ ] 全天 · 跨天 无起止')).issues.length,1);
  assert.equal(file(block(draft({endDate:'2026-11-10'})),'2026-11-15').issues.length,0,'Explicit grouped dates take precedence');
  assert.equal(file(render([{event:draft({endDate:'2026-11-10'}),date:'2026-11-09'}]),'2026-11-15').issues.length,1);
  assert.equal(file(block(draft())+'\n'+block(draft())).issues.length,1,'Ambiguous duplicate blocks are rejected');
  assert.equal(file(block(draft()).replace('<!-- obsidian-schedule-manager:end -->','')).issues.length,1);
  const first = file(block(draft())).candidates[0];
  const conflict = {...first,path:'备份/2026-11-09.md',event:{...first.event,notes:'不同备注'}};
  assert.equal(plan([first,conflict],[]).additions.length,0,'Conflicting copies are not chosen arbitrarily');
  assert.equal(plan([first,conflict],[]).issues.length,2);
  assert.equal(plan([first],[draft({notes:'本地有修改'})]).issues.length,1,'Existing content is preserved on conflict');

  const contents = new Map([
    ['日记/2026/11/09.md',block(draft())],
    ['其他目录/2026-11-10.md',block(draft({date:'2026-11-10',title:'手机同步内容'}))],
    ['日记/2026-11.md',block(draft({endDate:'2026-11-11'}))],
    ['普通待办.md','- [ ] 09:00 普通待办'],
    ['缺少日期.md',markers('- [ ] 全天 缺少日期')],
    ['打不开.md','read failure'],
  ]);
  const plugin = new Plugin();
  let reads = 0, saves = 0, refreshes = 0;
  plugin.app = {vault:{configDir:'.obsidian',adapter:{exists:async()=>true,read:async()=>JSON.stringify({folder:'日记',format:'YYYY/MM/DD'})},
    getMarkdownFiles:()=>[...contents.keys()].map(path=>({path})),
    read:async file=>{reads++;if(file.path==='打不开.md')throw new Error('read failed');return contents.get(file.path);},
    process:async()=>assert.fail('Import never rewrites diary files'),
  }};
  plugin.refreshViews = () => refreshes++;
  plugin.saveData = async()=>{saves++;};
  const progress = [];
  const scan = await plugin.scanDailyNotes((done,total)=>progress.push([done,total]));
  assert.equal(scan.files,6);assert.equal(scan.blocks,4);assert.equal(scan.issues.length,2);
  assert.equal(reads,6);assert.equal(saves,0);assert.equal(refreshes,0,'Scanning is read-only');
  assert.equal(scan.candidates[0].event.date,'2026-11-09','Custom nested format resolves full date');
  assert.deepEqual(progress.at(-1),[6,6]);
  const importable = plan(scan.candidates,[]);
  assert.equal(importable.additions.length,3);
  const before = copy([...contents]);
  const existing = draft({id:'keep',date:'2026-11-08',title:'已有日程'});
  plugin.data = {events:[existing],dailyNotePaths:['原路径.md']};
  // A failed write leaves the visible data available for a retry.
  plugin.saveData = async()=>{throw new Error('storage full');};
  await assert.rejects(plugin.importDailySchedules(importable.additions),/storage full/);
  assert.deepEqual(copy(plugin.data.events),[existing]);assert.equal(refreshes,0);
  const snapshots=[];
  plugin.saveData=async value=>{snapshots.push(copy(value));};
  const restored=await plugin.importDailySchedules(importable.additions);
  assert.equal(restored.additions.length,3);assert.equal(plugin.data.events.length,4);
  assert.equal(plugin.data.events[1].completed,true);assert.equal(refreshes,1);
  assert.deepEqual(copy(plugin.data.events[0]),existing);
  assert.deepEqual(copy(plugin.data.dailyNotePaths),['原路径.md']);
  assert.equal(new Set(plugin.data.events.map(event=>event.id)).size,4);
  assert.equal(snapshots.length,1,'One batch commit for all restored schedules');
  await plugin.importDailySchedules(importable.additions);
  assert.equal(snapshots.length,1,'No write for an entirely duplicate import');
  assert.deepEqual(copy([...contents]),before);
  // Two confirmations queued together must still import each event only once.
  const fresh = new Plugin();fresh.refreshViews=()=>{};fresh.saveData=async()=>{};
  await Promise.all([fresh.importDailySchedules(importable.additions),fresh.importDailySchedules(importable.additions)]);
  assert.equal(fresh.data.events.length,3);
  // A manual diary sync cannot write the pre-recovery event list during an in-flight save.
  const concurrent = new Plugin();concurrent.refreshViews=()=>{};
  let releaseSave, beganSave;
  const saving=new Promise(resolve=>{beganSave=resolve;});
  const hold=new Promise(resolve=>{releaseSave=resolve;});
  let saveCount=0,syncCount=0;
  concurrent.saveData=async()=>{if(++saveCount===1){beganSave();await hold;}};
  concurrent.dailyNotes={sync:async events=>{
    syncCount++;assert.equal(events.length,3,'Later sync sees recovered events');return {paths:[],errors:[]};
  }};
  const importing=concurrent.importDailySchedules(importable.additions);
  await saving;
  const syncing=concurrent.synchronizeDailyNotes();
  await Promise.resolve();assert.equal(syncCount,0);
  releaseSave();await importing;assert.equal(await syncing,true);assert.equal(syncCount,1);
  // Partial filename formats never invent a day based on the current date.
  plugin.app.vault.adapter.read=async()=>JSON.stringify({folder:'日记',format:'YYYY-MM'});
  contents.clear();contents.set('日记/2026-11.md',markers('- [ ] 全天 缺少日期'));
  const partial=await plugin.scanDailyNotes();assert.equal(partial.candidates.length,0);assert.equal(partial.issues.length,1);
  console.log('Daily-note import verified: bilingual legacy files, Markdown, dates, ranges, deduplication, conflicts, scans, atomic saves and queued imports.');
})().catch(error=>{console.error(error);process.exitCode=1;});
