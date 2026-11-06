const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const api = {
  getLanguage: () => 'zh',
  Plugin: class {}, ItemView: class {}, Modal: class {}, PluginSettingTab: class {},
  Setting: class {}, Notice: class {},
};
const sandbox = { module: { exports: {} }, require: name => {
  assert.equal(name, 'obsidian'); return api;
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
  + '\nmodule.exports.markdownTaskOffsets = markdownTaskOffsets;', sandbox);
const Plugin = sandbox.module.exports.default;
const offsets = sandbox.module.exports.markdownTaskOffsets;
const source = '标题\r\n- [ ] 重复内容\r\n- [x] 重复内容\r\n  - [ ] 子任务\r\n> 1. [X] 引用任务\r\n'
  + '```md\r\n- [ ] 代码示例\r\n```\r\n~~~text\r\n- [ ] 另一个示例\r\n~~~\r\n普通的 [ ] 文本\r\n+ [ ] 最后一项';
const positions = Array.from(offsets(source));
assert.equal(positions.length, 5, 'Fenced examples and prose are not tasks');
assert.deepEqual(positions.map(offset => source[offset]), [' ', 'x', ' ', 'X', ' ']);
const next = source.slice(0, positions[2]) + 'x' + source.slice(positions[2] + 1);
assert.equal(next.replace('- [x] 子任务', '- [ ] 子任务'), source, 'Only the selected duplicate/nested marker changes');
const nestedFence = '- ```\n  - [ ] example\n  ```\n- [ ] task';
assert.deepEqual(Array.from(offsets(nestedFence)), [nestedFence.lastIndexOf('[ ]') + 1]);

function setup() {
  const plugin = new Plugin();
  plugin.data = { events: [{ id: 'a', notes: '- [ ] 第一项\n- [ ] 第二项', completed: false, title: '原始标题' }], dailyNotePaths: [] };
  plugin.refreshViews = () => {};
  const stored = [];
  plugin.saveData = async data => stored.push(JSON.parse(JSON.stringify(data)));
  let syncs = 0;
  plugin.synchronizeDailyNotes = async () => { syncs++; return true; };
  return { plugin, stored, syncs: () => syncs };
}

(async () => {
  const { plugin, stored, syncs } = setup();
  const before = plugin.data.events[0].notes;
  const after = before.replace('[ ] 第一项', '[x] 第一项');
  await plugin.updateEventNotes('a', before, after);
  assert.equal(stored.at(-1).events[0].notes, after, 'Checkbox change persists');
  assert.equal(plugin.data.events[0].completed, false, 'Task completion does not complete the event');
  assert.equal(syncs(), 1, 'Checkbox change uses daily-note synchronization');
  await plugin.updateEventNotes('a', after, before);
  assert.equal(plugin.data.events[0].notes, before, 'Checkbox can be unchecked');
  const concurrent = plugin.updateEvent('a', { notes: '其他编辑的新备注', title: '新标题' });
  const stale = plugin.updateEventNotes('a', before, after);
  await concurrent;
  await assert.rejects(stale, /备注已被修改/);
  assert.equal(plugin.data.events[0].notes, '其他编辑的新备注', 'Stale modal cannot overwrite newer edits');
  await assert.rejects(plugin.updateEventNotes('missing', '', '- [x] task'), /日程已删除/);
  const failed = setup().plugin;
  failed.saveData = async () => { throw new Error('disk full'); };
  await assert.rejects(failed.updateEventNotes('a', before, after), /disk full/);
  assert.equal(failed.data.events[0].notes, before, 'Failed save preserves the stored task state');
  failed.saveData = async () => {};
  await failed.updateEventNotes('a', before, after);
  assert.equal(failed.data.events[0].notes, after, 'Failed save can be retried');
  console.log('PASS: task source mapping, duplicate labels, nested/quoted/ordered tasks, fenced examples, CRLF preservation, persistence, unchecking, daily sync, independent event state, stale edits and failed-save retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
