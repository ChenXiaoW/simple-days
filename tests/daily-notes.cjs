const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const moment = require('moment');

class TFile { constructor(path) { this.path = path; } }
class TFolder { constructor(path) { this.path = path; } }
const notices = [];
let language = 'zh';
const api = {
  getLanguage: () => language,
  TFile, TFolder, moment,
  normalizePath: value => value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, ''),
  Plugin: class {}, ItemView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {},
  Notice: class { constructor(message) { notices.push(message); } },
};
const sandbox = { module: { exports: {} }, require: name => {
  assert.equal(name, 'obsidian'); return api;
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'), sandbox);
const Plugin = sandbox.module.exports.default;

function setup({ core = null, template = null, settings = {} } = {}) {
  const files = new Map();
  const contents = new Map();
  const writes = [];
  const failWrites = new Set();
  const noteTabs = [];
  let beforeProcess = null;
  let createRace = null;
  const vault = {
    configDir: '.obsidian',
    adapter: {
      async exists(name) { return name === '.obsidian/daily-notes.json' && core !== null; },
      async read() { return JSON.stringify(core); },
    },
    getAbstractFileByPath(name) { return files.get(name) || null; },
    async createFolder(name) {
      if (files.has(name)) throw new Error('Folder exists');
      const folder = new TFolder(name); files.set(name, folder); return folder;
    },
    async create(name, text) {
      if (failWrites.has(name)) throw new Error('Simulated write failure');
      if (createRace) { const race = createRace; createRace = null; race(name); }
      if (files.has(name)) throw new Error('File exists');
      const file = new TFile(name); files.set(name, file); contents.set(name, text); writes.push(name); return file;
    },
    async read(file) { return contents.get(file.path); },
    async cachedRead(file) { return contents.get(file.path); },
    async process(file, change) {
      if (failWrites.has(file.path)) throw new Error('Simulated write failure');
      if (beforeProcess) { const callback = beforeProcess; beforeProcess = null; callback(file.path); }
      contents.set(file.path, change(contents.get(file.path))); writes.push(file.path);
    },
  };
  const workspace = {
    getLeavesOfType(type) { return type === 'markdown' ? noteTabs : []; },
    getLeaf(location) {
      assert.equal(location, 'tab');
      return { async openFile(file) {
        const leaf = { getViewState() { return { state: { file: file.path } }; } };
        noteTabs.push(leaf); workspace.active = leaf;
      } };
    },
    async revealLeaf(leaf) { workspace.active = leaf; },
  };
  const plugin = new Plugin();
  plugin.app = { vault, workspace };
  plugin.settings = { ...plugin.settings, ...settings };
  const snapshots = [];
  plugin.saveData = async data => { snapshots.push(JSON.parse(JSON.stringify(data))); };
  function seed(name, text) {
    const file = new TFile(name); files.set(name, file); contents.set(name, text); return file;
  }
  if (template) seed(template.path, template.content);
  return {
    plugin, files, contents, writes, failWrites, workspace, noteTabs, snapshots, seed,
    text(name) { assert.ok(contents.has(name), 'Missing note: ' + name); return contents.get(name); },
    beforeProcess(callback) { beforeProcess = callback; },
    race(callback) { createRace = callback; },
  };
}

const draft = (date = '2026-10-27', title = '产品评审', startTime = '10:00') => ({
  date, title, startTime, endTime: '11:00', location: '会议室 A', notes: '准备演示\n补充材料',
});
const tasks = content => (content.match(/^- \[[ x]\]/gm) || []).length;
const start = '<!-- obsidian-schedule-manager:start -->';
const end = '<!-- obsidian-schedule-manager:end -->';

(async () => {
  const diary = setup({
    core: { folder: 'Journal', format: 'YYYY/MM/YYYY-MM-DD', template: 'Templates/Daily' },
    template: { path: 'Templates/Daily.md', content: '# {{date:YYYY-MM-DD}}\n\n我的日记正文\n创建于 {{time:HH:mm}}\n' },
  });
  const event = await diary.plugin.addEvent({ ...draft(), tags: ['重要', '产品'], participants: ['李明', '陈欣'], category: 'meeting' });
  const note = 'Journal/2026/10/2026-10-27.md';
  assert.match(diary.text(note), /# 2026-10-27/);
  assert.match(diary.text(note), /创建于 \d{2}:\d{2}/);
  assert.match(diary.text(note), /- \[ \] 10:00 – 11:00 产品评审/);
  assert.match(diary.text(note), /地点：会议室 A/);
  assert.match(diary.text(note), /参与人：李明、陈欣/);
  assert.match(diary.text(note), /标签：#重要 #产品/);
  assert.match(diary.text(note), /  - 备注：\n\n    准备演示\n    补充材料/);
  const writesBefore = diary.writes.length;
  await diary.plugin.synchronizeDailyNotes();
  await diary.plugin.synchronizeDailyNotes();
  assert.equal(tasks(diary.text(note)), 1, 'Repeated sync must not duplicate tasks');
  assert.equal(diary.writes.length, writesBefore, 'Unchanged notes are not rewritten');
  diary.contents.set(note, '---\ntags: 日记\n---\n' + diary.text(note) + '\n## 私人记录\n我的补充内容\n');
  await diary.plugin.updateEvent(event.id, { title: '修改后的评审', completed: true });
  assert.match(diary.text(note), /- \[x\].*修改后的评审/);
  assert.ok(diary.text(note).startsWith('---\ntags: 日记\n---\n'));
  assert.ok(diary.text(note).endsWith('## 私人记录\n我的补充内容\n'));
  await diary.plugin.updateEvent(event.id, { date: '2026-10-28' });
  assert.equal(diary.text(note).includes(start), false, 'Moved event is removed from old note');
  assert.ok(diary.files.has(note), 'Old note is retained');
  const movedNote = 'Journal/2026/10/2026-10-28.md';
  assert.match(diary.text(movedNote), /# 2026-10-28/);
  assert.match(diary.text(movedNote), /修改后的评审/);
  await diary.plugin.removeEvent(event.id);
  assert.equal(diary.text(movedNote).includes(start), false);
  assert.ok(diary.files.has(movedNote), 'Deleting last task must not delete the diary');

  const shared = setup({ settings: { dailyNotesUseCore: false } });
  const first = await shared.plugin.addEvent({ ...draft('2026-10-27', '晚间日程', '18:00'), endTime: '19:00' });
  await shared.plugin.addEvent({ ...draft('2026-10-27', '全天日程', ''), endTime: '' });
  const third = await shared.plugin.addEvent(draft('2026-10-27', '上午日程', '09:00'));
  const sharedPath = '日记/2026-10-27.md';
  assert.equal(tasks(shared.text(sharedPath)), 3);
  assert.ok(shared.text(sharedPath).indexOf('全天日程') < shared.text(sharedPath).indexOf('上午日程'));
  await shared.plugin.removeEvent(first.id);
  assert.equal(tasks(shared.text(sharedPath)), 2);
  await shared.plugin.updateEvent(third.id, { notes: end + '\n别的备注' });
  assert.equal(shared.text(sharedPath).split(end).length, 2, 'Note text cannot inject block boundaries');
  assert.equal(await shared.plugin.synchronizeDailyNotes(), true);

  const markdown = setup({ settings: { dailyNotesUseCore: false } });
  const source = '## 会前准备\n\n- [ ] 阅读 **方案**\n- [x] 查看 [[项目资料]]\n\n```js\nconst value = 1;\n  console.log(value);\n```\n\n| 事项 | 负责人 |\n| --- | --- |\n| 评审 | 张三 |';
  const markdownEvent = await markdown.plugin.addEvent({ ...draft(), notes: source });
  assert.equal(markdownEvent.notes, source, 'Store Markdown source without converting it to HTML');
  const markdownText = markdown.text(sharedPath);
  assert.ok(markdownText.includes('  - 备注：\n\n' + source.split('\n').map(line => line ? '    ' + line : '').join('\n') + '\n'));
  assert.equal(tasks(markdownText), 1, 'Nested checklists are not additional schedule records');
  const whitespaceSource = '    indented code\n\nline with hard break  \nnext line  ';
  await markdown.plugin.updateEvent(markdownEvent.id, { notes: whitespaceSource });
  assert.equal(markdown.plugin.data.events[0].notes, whitespaceSource, 'Preserve indentation and Markdown hard breaks');

  const monthly = setup({ settings: { dailyNotesUseCore: false, dailyNotesFormat: 'YYYY-MM' } });
  await monthly.plugin.addEvent(draft('2026-10-27', '第一天'));
  await monthly.plugin.addEvent(draft('2026-10-28', '第二天'));
  assert.equal(tasks(monthly.text('日记/2026-10.md')), 2, 'Shared note paths keep both dates');
  assert.match(monthly.text('日记/2026-10.md'), /### 2026-10-27/);
  assert.match(monthly.text('日记/2026-10.md'), /### 2026-10-28/);

  const crlf = setup({ settings: { dailyNotesUseCore: false } });
  const prefix = '---\r\ntag: 日记\r\n---\r\n\r\n';
  const suffix = '\r\n\r\n## 手写内容\r\n保留原文\r\n';
  crlf.seed(sharedPath, prefix + start + '\r\n旧区块\r\n' + end + suffix);
  await crlf.plugin.addEvent(draft());
  const crlfText = crlf.text(sharedPath);
  assert.ok(crlfText.startsWith(prefix)); assert.ok(crlfText.endsWith(suffix));
  assert.equal(/(?<!\r)\n/.test(crlfText), false, 'CRLF is preserved');

  const concurrent = setup({ settings: { dailyNotesUseCore: false } });
  concurrent.seed(sharedPath, '已有日记\n');
  concurrent.beforeProcess(name => concurrent.contents.set(name, concurrent.text(name) + '同步期间写入的内容\n'));
  await concurrent.plugin.addEvent(draft());
  assert.match(concurrent.text(sharedPath), /同步期间写入的内容/);
  await Promise.all([concurrent.plugin.addEvent(draft('2026-10-27', '并发 A')), concurrent.plugin.addEvent(draft('2026-10-27', '并发 B'))]);
  assert.equal(tasks(concurrent.text(sharedPath)), 3);
  const racing = setup({ settings: { dailyNotesUseCore: false } });
  racing.race(name => racing.seed(name, '另一插件刚创建的日记\n'));
  await racing.plugin.addEvent(draft());
  assert.match(racing.text(sharedPath), /另一插件刚创建的日记/);
  assert.equal(tasks(racing.text(sharedPath)), 1);

  const malformed = setup({ settings: { dailyNotesUseCore: false } });
  const malformedText = '个人内容\n' + start + '\n未闭合的标记\n';
  malformed.seed(sharedPath, malformedText);
  await malformed.plugin.addEvent(draft());
  assert.equal(malformed.text(sharedPath), malformedText, 'Malformed blocks do not overwrite a note');
  assert.equal(malformed.plugin.data.events.length, 1, 'Sync failure does not lose schedule data');
  assert.equal(malformed.snapshots.at(-1).events.length, 1);
  assert.ok(notices.some(message => message.includes('同步未完成')));
  malformed.contents.set(sharedPath, '修复后的日记正文\n');
  assert.equal(await malformed.plugin.synchronizeDailyNotes(), true, 'Failed sync can be retried');
  assert.equal(tasks(malformed.text(sharedPath)), 1);

  const moveFailure = setup({ settings: { dailyNotesUseCore: false } });
  const moving = await moveFailure.plugin.addEvent(draft());
  const next = '日记/2026-10-28.md';
  moveFailure.failWrites.add(next);
  await moveFailure.plugin.updateEvent(moving.id, { date: '2026-10-28' });
  assert.equal(tasks(moveFailure.text(sharedPath)), 1, 'Keep old block until replacement succeeds');
  moveFailure.failWrites.clear();
  await moveFailure.plugin.synchronizeDailyNotes();
  assert.equal(tasks(moveFailure.text(sharedPath)), 0);
  assert.equal(tasks(moveFailure.text(next)), 1);
  moveFailure.plugin.settings.dailyNotesFolder = '新的日记目录';
  await moveFailure.plugin.synchronizeDailyNotes();
  assert.equal(tasks(moveFailure.text(next)), 0);
  assert.equal(tasks(moveFailure.text('新的日记目录/2026-10-28.md')), 1);

  for (const invalidFolder of ['../outside', 'C:/outside', '.obsidian']) {
    const invalid = setup({ settings: { dailyNotesUseCore: false, dailyNotesFolder: invalidFolder } });
    await invalid.plugin.addEvent(draft());
    assert.equal(invalid.contents.size, 0);
    assert.equal(invalid.plugin.data.events.length, 1);
  }
  const disabled = setup({ settings: { dailyNotesEnabled: false } });
  await disabled.plugin.addEvent(draft());
  assert.equal(disabled.contents.size, 0);
  await disabled.plugin.openDailyNote('2026-10-27');
  assert.equal(disabled.noteTabs.length, 1);
  assert.equal(tasks(disabled.text(sharedPath)), 0);
  await disabled.plugin.openDailyNote('2026-10-27');
  assert.equal(disabled.noteTabs.length, 1, 'Opening a diary reuses an existing tab');
  const configuredRoot = setup({ core: { format: 'YYYY-MM-DD' } });
  await configuredRoot.plugin.addEvent(draft());
  assert.ok(configuredRoot.files.has('2026-10-27.md'), 'Core daily-notes default is the vault root');

  const legacy = setup();
  legacy.plugin.loadData = async () => ({ dateFormat: 'long', events: [{ ...draft(), id: 'legacy', completed: false }] });
  await legacy.plugin.loadSettings(); await legacy.plugin.loadDataStore();
  assert.equal(legacy.plugin.settings.dailyNotesEnabled, true);
  assert.equal(await legacy.plugin.synchronizeDailyNotes(), true);
  assert.equal(tasks(legacy.text(sharedPath)), 1, 'Existing schedules sync after upgrade');
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.plugin.data.dailyNotePaths)), [sharedPath]);
  const multi = setup({ settings: { dailyNotesUseCore: false } });
  const overnight = await multi.plugin.addEvent({...draft('2026-10-31','跨天值班','22:00'),endDate:'2026-11-01',endTime:'02:00'});
  assert.match(multi.text('日记/2026-10-31.md'),/22:00 – 24:00 · 跨天/);
  assert.match(multi.text('日记/2026-11-01.md'),/00:00 – 02:00 · 跨天/);
  await multi.plugin.updateEvent(overnight.id,{completed:true});
  assert.match(multi.text('日记/2026-11-01.md'),/- \[x\]/);
  await multi.plugin.moveEvent(overnight.id,'2026-11-01','2026-11-03');
  assert.equal(multi.plugin.data.events[0].date,'2026-11-02');
  assert.equal(multi.plugin.data.events[0].endDate,'2026-11-03');
  assert.equal(tasks(multi.text('日记/2026-10-31.md')),0);
  assert.equal(tasks(multi.text('日记/2026-11-01.md')),0);
  assert.match(multi.text('日记/2026-11-02.md'),/22:00 – 24:00/);
  assert.match(multi.text('日记/2026-11-03.md'),/00:00 – 02:00/);
  await multi.plugin.removeEvent(overnight.id);
  assert.equal(tasks(multi.text('日记/2026-11-02.md')),0);
  assert.equal(tasks(multi.text('日记/2026-11-03.md')),0);
  const several = await multi.plugin.addEvent({...draft('2026-12-31','跨年休假',''),endDate:'2027-01-02',endTime:''});
  for(const date of ['2026-12-31','2027-01-01','2027-01-02']) assert.match(multi.text(`日记/${date}.md`),/全天 · 跨天/);
  await multi.plugin.updateEvent(several.id,{endDate:'2027-01-01'});
  assert.equal(tasks(multi.text('日记/2027-01-02.md')),0,'Shortened ranges clean up old notes');
  const sharedMulti=setup({settings:{dailyNotesUseCore:false,dailyNotesFormat:'YYYY-MM'}});
  await sharedMulti.plugin.addEvent({...draft('2026-10-28','三天安排',''),endDate:'2026-10-30',endTime:''});
  assert.equal(tasks(sharedMulti.text('日记/2026-10.md')),3,'Shared paths retain separate daily occurrences');
  await sharedMulti.plugin.synchronizeDailyNotes();
  assert.equal(tasks(sharedMulti.text('日记/2026-10.md')),3);
  const midnight=setup({settings:{dailyNotesUseCore:false}});
  await midnight.plugin.addEvent({...draft('2026-10-28','午夜截止','23:00'),endDate:'2026-10-29',endTime:'00:00'});
  assert.equal(midnight.files.has('日记/2026-10-29.md'),false);
  const failMove=setup({settings:{dailyNotesUseCore:false}});
  const stable=await failMove.plugin.addEvent(draft());
  const normalSave=failMove.plugin.saveData;
  failMove.plugin.saveData=async()=>{throw new Error('Disk unavailable');};
  await assert.rejects(()=>failMove.plugin.moveEvent(stable.id,'2026-10-27','2026-10-28'),/Disk unavailable/);
  assert.equal(failMove.plugin.data.events[0].date,'2026-10-27','A failed save retains the original date');
  assert.equal(failMove.files.has('日记/2026-10-28.md'),false);
  failMove.plugin.saveData=normalSave;
  await failMove.plugin.moveEvent(stable.id,'2026-10-27','2026-10-28');
  assert.equal(failMove.plugin.data.events[0].date,'2026-10-28','Failed mutations do not block retries');
  const translated = setup({ settings: { dailyNotesUseCore: false, dailyNotesFolder: '我的日记' } });
  const translatedPath = '我的日记/2026-10-27.md';
  translated.seed(translatedPath, '# 中文正文\n\n保留的手写内容\n');
  await translated.plugin.addEvent({ ...draft(), startTime: '', endTime: '', participants: ['小王', '小李'] });
  const savedEvents = JSON.stringify(translated.plugin.data.events);
  language = 'en';
  assert.equal(await translated.plugin.synchronizeDailyNotes(), true);
  assert.match(translated.text(translatedPath), /## Schedule/);
  assert.match(translated.text(translatedPath), /All day 产品评审/);
  assert.match(translated.text(translatedPath), /Participants: 小王, 小李/);
  assert.match(translated.text(translatedPath), /保留的手写内容/);
  assert.equal(translated.text(translatedPath).split(start).length, 2, 'Language switches replace the original managed block');
  assert.equal(JSON.stringify(translated.plugin.data.events), savedEvents, 'Language switches preserve all saved event fields');
  assert.deepEqual(Array.from(translated.plugin.data.dailyNotePaths), [translatedPath], 'Language switches keep the configured note path');
  const localizedWritesBefore = translated.writes.length;
  await translated.plugin.synchronizeDailyNotes();
  assert.equal(translated.writes.length, localizedWritesBefore, 'Localized synchronization remains idempotent');
  language = 'zh';
  await translated.plugin.synchronizeDailyNotes();
  assert.match(translated.text(translatedPath), /## 日程/);
  assert.equal(translated.text(translatedPath).includes('## Schedule'), false);
  assert.equal(translated.text(translatedPath).split(start).length, 2);
  console.log('PASS: switching diary language preserves note paths, user text, saved event fields, managed markers and sync idempotency.');
  console.log('PASS: daily note creation, core settings and templates, fallback path, CRUD and completion, date moves, shared paths, idempotency, existing content and CRLF preservation, concurrent edits, creation races, failures/retry, safe migration, disabled sync, tab reuse and legacy data.');
  console.log('PASS: cross-day note creation/completion/deletion, midnight boundary, moving from continuation day, shortening ranges, shared monthly notes and failed-save rollback/retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
