const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

class Setting {
  constructor(container) { this.container = container; container.rows.push(this); }
  setName(value) { this.name = value; return this; }
  setDesc(value) { this.desc = value; return this; }
  setHeading() { this.heading = true; return this; }
  addDropdown(build) { return this.control(build); }
  addToggle(build) { return this.control(build); }
  addText(build) { return this.control(build); }
  addButton(build) { return this.control(build); }
  control(build) {
    const control = {
      addOption() { return this; },
      setValue(value) { this.value = value; return this; },
      setPlaceholder() { return this; },
      setButtonText() { return this; },
      setDisabled(value) { this.disabled = value; return this; },
      onChange(callback) { this.change = callback; return this; },
      onClick(callback) { this.click = callback; return this; },
    };
    build(control); this.component = control; return this;
  }
}
const api = {
  getLanguage: () => 'zh',
  Plugin: class {}, ItemView: class {}, Modal: class {}, Notice: class {}, Setting,
  PluginSettingTab: class {
    constructor(app) {
      this.app = app;
      this.containerEl = { rows: [], empty() { this.rows.length = 0; } };
    }
  },
};
const sandbox = { module: { exports: {} }, require: name => {
  assert.equal(name, 'obsidian'); return api;
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
  + '\nmodule.exports.ScheduleSettingTab = ScheduleSettingTab;', sandbox);
const Plugin = sandbox.module.exports.default;
const Tab = sandbox.module.exports.ScheduleSettingTab;
const snapshot = value => JSON.parse(JSON.stringify(value));
const event = { id: 'legacy', title: '原有日程', date: '2026-11-06', startTime: '', endTime: '', notes: '- [ ] 原始备注', location: '', completed: false };

(async () => {
  const plugin = new Plugin();
  const writes = [];
  plugin.saveData = async value => writes.push(snapshot(value));
  plugin.refreshViews = () => {};
  plugin.loadData = async () => null;
  await plugin.loadSettings(); await plugin.loadDataStore();
  assert.equal(plugin.settings.dailyNotesEnabled, true);
  assert.equal(plugin.data.events.length, 0);
  plugin.loadData = async () => ({ events: [event], dailyNotePaths: ['日记/旧日程.md', 42], dateFormat: 'short', dailyNotesEnabled: false, dailyNotesUseCore: false, dailyNotesFolder: '', dailyNotesFormat: 'YYYY/MM/DD' });
  await plugin.loadSettings(); await plugin.loadDataStore();
  assert.equal(plugin.settings.dateFormat, 'short');
  assert.equal(plugin.settings.dailyNotesEnabled, false);
  assert.equal(plugin.settings.dailyNotesFolder, '', 'Vault-root folders remain supported');
  assert.deepEqual(snapshot(plugin.data.events), [event], 'Legacy data does not require new optional fields');
  assert.deepEqual(snapshot(plugin.data.dailyNotePaths), ['日记/旧日程.md']);
  assert.equal('events' in plugin.settings, false, 'Settings do not retain untyped event arrays');
  const previous = snapshot(plugin.data);
  for (const invalid of [{ events: {} }, { events: [null] }, { events: [{ ...event, notes: 42 }] }]) {
    plugin.loadData = async () => invalid;
    await assert.rejects(plugin.loadDataStore(), /未修改/);
    assert.deepEqual(snapshot(plugin.data), previous, 'Invalid data cannot replace the visible schedules');
  }
  assert.equal(writes.length, 0, 'Loading or rejecting data never overwrites storage');
  plugin.loadData = async () => ({ dateFormat: 42, dailyNotesEnabled: 'false', dailyNotesFolder: false });
  await plugin.loadSettings();
  assert.equal(plugin.settings.dateFormat, 'long');
  assert.equal(plugin.settings.dailyNotesEnabled, true);
  assert.equal(plugin.settings.dailyNotesFolder, '日记');
  const isolated = new Plugin(); isolated.settings.dailyNotesEnabled = false;
  assert.equal(new Plugin().settings.dailyNotesEnabled, true, 'Instances do not mutate shared defaults');

  let syncs = 0;
  plugin.synchronizeDailyNotes = async () => { syncs++; return true; };
  const tab = new Tab({}, plugin);
  const definitions = tab.getSettingDefinitions();
  assert.deepEqual(snapshot(definitions.map(section => section.heading)), ['日程管理', '日记联动']);
  assert.equal(definitions.flatMap(section => section.items).length, 6);
  assert.equal(tab.containerEl.rows.length, 0, 'Search indexing does not create UI controls');
  tab.display();
  assert.equal(tab.containerEl.rows.filter(row => row.heading).length, 2, 'Legacy settings use native headings');
  const row = name => tab.containerEl.rows.find(item => item.name === name);
  await row('日期显示').component.change('short');
  assert.equal(plugin.settings.dateFormat, 'short');
  await row('自动同步到日记').component.change(false);
  await row('自动同步到日记').component.change(true);
  assert.equal(syncs, 1, 'Enabling diary sync triggers synchronization');
  await row('使用 Obsidian 日记配置').component.change(false);
  await row('日记目录').component.change('我的日记');
  await row('日记日期格式').component.change('YYYY/MM/DD');
  assert.equal(writes.at(-1).dailyNotesFolder, '我的日记');
  assert.deepEqual(writes.at(-1).events, [event], 'Setting changes preserve schedules');
  const sync = row('同步已有日程').component;
  await sync.click(); assert.equal(sync.disabled, false);
  plugin.synchronizeDailyNotes = async () => { throw new Error('simulated failure'); };
  await assert.rejects(sync.click(), /simulated failure/);
  assert.equal(sync.disabled, false, 'The sync button recovers after a rejected operation');
  console.log('PASS: typed storage loading, legacy events, invalid-data preservation, isolated defaults, searchable setting definitions, native headings and settings persistence.');
})().catch(error => { console.error(error); process.exitCode = 1; });
