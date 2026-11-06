const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const compiled = fs.readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
const api = {
  Plugin: class {},
  ItemView: class {
    constructor(leaf) { this.leaf = leaf; }
    async setState() {}
  },
  PluginSettingTab: class {}, Modal: class {}, Setting: class {}, Notice: class {},
};
const sandbox = { module: { exports: {} }, require: name => {
  assert.equal(name, 'obsidian'); return api;
} };
vm.runInNewContext(compiled + '\nmodule.exports.ScheduleView = ScheduleView;', sandbox);
const Plugin = sandbox.module.exports.default;
const View = sandbox.module.exports.ScheduleView;

function setup({ sidebar = false, main = false, fail = null } = {}) {
  const leaves = [];
  const plugin = new Plugin();
  const note = { region: 'main', note: '原有笔记', detached: false };
  const calls = [];
  const makeLeaf = region => {
    const leaf = {
      region, detached: false,
      getViewState() { return { state: this.view.getState() }; },
      async setViewState({ state }) {
        if (fail === 'create') throw new Error('cannot create tab');
        if (!this.view) this.view = new View(this, plugin);
        this.view.render = () => {};
        await this.view.setState(state, {});
      },
      detach() { this.detached = true; calls.push('detach-' + region); },
    };
    leaf.view = new View(leaf, plugin);
    leaf.view.render = () => {};
    leaves.push(leaf);
    return leaf;
  };
  const source = sidebar ? makeLeaf('sidebar') : null;
  const tab = main ? makeLeaf('main') : null;
  const workspace = {
    getLeavesOfType() { return leaves.filter(leaf => !leaf.detached); },
    iterateRootLeaves(callback) { [note, ...leaves.filter(leaf => leaf.region === 'main' && !leaf.detached)].forEach(callback); },
    getLeaf(location) { assert.equal(location, 'tab'); calls.push('create-tab'); return makeLeaf('main'); },
    async revealLeaf(leaf) {
      if (fail === 'reveal') throw new Error('cannot reveal tab');
      this.active = leaf; calls.push('reveal-' + leaf.region);
    },
  };
  plugin.app = { workspace };
  return { plugin, workspace, leaves, note, calls, source, tab };
}

(async () => {
  const fresh = setup();
  await Promise.all([fresh.plugin.activateView(), fresh.plugin.activateView(), fresh.plugin.activateView()]);
  assert.equal(fresh.leaves.length, 1, 'Concurrent opens create one tab');
  assert.equal(fresh.workspace.active.region, 'main');
  assert.equal(fresh.note.note, '原有笔记');
  assert.equal(fresh.note.detached, false, 'Current note stays open');
  await fresh.plugin.activateView();
  assert.equal(fresh.leaves.length, 1, 'Repeated opening reuses the tab');

  const migrated = setup({ sidebar: true });
  const fields = {
    title: '尚未保存的日程', date: '2026-10-18', startTime: '14:00',
    endTime: '15:00', location: '会议室 B', notes: '尚未保存的备注',
  };
  await migrated.source.view.setState({ date: '2026-10-18', viewMode: 'week', editorVisible: true, editingId: 'event-1' }, {});
  migrated.source.view.editor = { snapshot: () => fields, snapshotId: 'event-1' };
  await migrated.plugin.activateView();
  const state = migrated.workspace.active.view.getState();
  assert.equal(state.date, '2026-10-18');
  assert.equal(state.viewMode, 'week');
  assert.equal(state.editorVisible, true);
  assert.equal(state.editingId, 'event-1');
  assert.equal(JSON.stringify(state.draft), JSON.stringify(fields), 'Unsaved form survives migration');
  assert.equal(migrated.source.detached, true);
  assert.deepEqual(migrated.calls, ['create-tab', 'reveal-main', 'detach-sidebar']);

  const reuse = setup({ sidebar: true, main: true });
  await reuse.source.view.setState({ date: '2026-12-31', viewMode: 'month' }, {});
  await reuse.plugin.activateView(false, reuse.source);
  assert.equal(reuse.workspace.active, reuse.tab);
  assert.equal(reuse.tab.view.getState().date, '2026-12-31');
  assert.equal(reuse.source.detached, true);
  assert.equal(reuse.calls.includes('create-tab'), false);

  const existing = setup({ main: true });
  let editorOpened = false;
  existing.tab.view.openEditor = () => { editorOpened = true; };
  await existing.plugin.activateView(true);
  assert.equal(editorOpened, true, 'New-event command opens editor in the main tab');

  for (const failure of ['create', 'reveal']) {
    const broken = setup({ sidebar: true, fail: failure });
    await assert.rejects(() => broken.plugin.activateView());
    assert.equal(broken.source.detached, false, 'Failed migration preserves the source');
    assert.equal(broken.leaves[1].detached, true, 'Failed replacement is cleaned up');
  }
  console.log('PASS: opens in main tab, keeps note open, reuses existing tab, concurrent opening, sidebar migration, selection and unsaved draft preservation, editor command, failure cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
