const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const clone = value => JSON.parse(JSON.stringify(value));
const notices = [];
const domListeners = new Map();
const workspaceListeners = new Map();
let poll;
const document = { visibilityState: 'visible' };
const window = { setInterval(callback, delay) { assert.equal(delay, 15000); poll = callback; return 1; } };
class MockPlugin {
  constructor() { this.cleanups = []; this.commands = []; }
  registerView() {}
  addRibbonIcon() {}
  addSettingTab() {}
  addCommand(command) { this.commands.push(command); }
  registerDomEvent(target, name, callback) {
    domListeners.set(name, callback); this.cleanups.push(() => domListeners.delete(name));
  }
  registerEvent(ref) { this.cleanups.push(ref.off); }
  registerInterval() { this.cleanups.push(() => { poll = null; }); }
}
const api = {
  getLanguage: () => 'en', requireApiVersion: () => true, Platform: { isMobile: true },
  Plugin: MockPlugin, PluginSettingTab: class {}, ItemView: class {}, Modal: class {},
  Setting: class {}, Notice: class { constructor(message) { notices.push(message); } },
};
const sandbox = { module: { exports: {} }, document, window, require: name => {
  assert.equal(name, 'obsidian'); return api;
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8'), sandbox);
const Plugin = sandbox.module.exports.default;
const event = (id, title) => ({ id, title, date:'2026-11-09', startTime:'09:00', endTime:'10:00',
  notes:'- [ ] phone task\n- [x] completed task', location:'', completed:false });
const first = { events: [event('old','Old event')], dailyNotesEnabled:false, dailyNotesFolder:'Journal', dailyNotePaths:[] };
const remote = { ...first, events:[event('remote','Pulled from desktop')], dailyNotesFolder:'Shared diary', dateFormat:'short' };
const tick = async () => { await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
(async () => {
  let disk = clone(first), reads = 0;
  const writes = [];
  const plugin = new Plugin();
  plugin.app = { workspace: {
    on(name, callback) { workspaceListeners.set(name, callback); return {off:()=>workspaceListeners.delete(name)}; },
    onLayoutReady(callback) { callback(); },
    getLeavesOfType(type) { return type === 'schedule-manager-view' ? [{}] : []; },
  } };
  plugin.loadData = async () => { reads++; return clone(disk); };
  plugin.saveData = async value => { writes.push(clone(value)); disk = clone(value); };
  let refreshes = 0;
  plugin.refreshViews = () => { refreshes++; };
  await plugin.onload();
  assert.equal(reads,1,'Startup loads settings and schedules from a single snapshot');
  assert.equal(plugin.data.events[0].id,'old');
  assert.ok(poll,'Android registers a foreground fallback for sync tools without config events');
  disk = clone(remote);
  await plugin.onExternalSettingsChange();
  assert.equal(plugin.data.events[0].title,'Pulled from desktop');
  assert.equal(plugin.data.events[0].notes,remote.events[0].notes,'Markdown tasks arrive unchanged');
  assert.equal(plugin.settings.dailyNotesFolder,'Shared diary');
  assert.equal(plugin.settings.dateFormat,'short');
  assert.equal(refreshes,1);
  assert.equal(writes.length,0,'Loading remote data never writes it back or triggers daily-note synchronization');
  await plugin.onExternalSettingsChange();
  assert.equal(refreshes,1,'Duplicate notifications do not rebuild views or disrupt editing');

  const original = clone({settings:plugin.settings,data:plugin.data});
  for(const invalid of [null,{}, {events:{}}, { ...remote, dailyNotesFolder:'Do not apply',events:[{...remote.events[0],notes:42}]}]) {
    disk = invalid;
    assert.equal(await plugin.reloadFromDisk(),false);
    assert.deepEqual(clone({settings:plugin.settings,data:plugin.data}),original,'Partial or invalid pulls cannot apply half a snapshot');
  }
  disk = clone(remote); assert.equal(await plugin.reloadFromDisk(),true,'A completed pull recovers');
  assert.equal(writes.length,0,'Invalid data never overwrites disk');
  disk = {...remote,events:[]}; await plugin.onExternalSettingsChange();
  assert.equal(plugin.data.events.length,0,'An explicit empty remote list represents real deletions');
  disk = clone(remote); await plugin.onExternalSettingsChange();

  const pendingRead = deferred(), started = deferred();
  const normalLoad=plugin.loadData;
  plugin.loadData=async()=>{started.resolve(); await pendingRead.promise;return clone(disk);};
  const a=plugin.reloadFromDisk(), b=plugin.reloadFromDisk();
  await started.promise;
  const mutation=plugin.updateEvent('remote',{title:'Edited after pull'});
  pendingRead.resolve(); await Promise.all([a,b,mutation]);
  assert.equal(plugin.data.events[0].title,'Edited after pull','Local mutations queued during reload apply to the loaded data');
  assert.equal(writes.at(-1).events[0].id,'remote');
  plugin.loadData=normalLoad;
  const syncGate=deferred(); plugin.syncQueue=syncGate.promise;
  const beforeSyncRead=reads;
  const waiting=plugin.reloadFromDisk(); await tick();
  assert.equal(reads,beforeSyncRead,'Reload waits for earlier diary persistence');
  syncGate.resolve(); await waiting;

  disk={...remote,events:[event('focus','Returning from sync app')]};
  domListeners.get('focus')(); await tick();
  assert.equal(plugin.data.events[0].id,'focus');
  disk={...remote,events:[event('resume','Android resumed')]};
  domListeners.get('visibilitychange')(); await tick();
  assert.equal(plugin.data.events[0].id,'resume');
  disk={...remote,events:[event('poll','Pull while calendar stays open')]};
  poll(); await tick();
  assert.equal(plugin.data.events[0].id,'poll');
  document.visibilityState='hidden';
  const hiddenReads=reads; poll(); domListeners.get('visibilitychange')(); await tick();
  assert.equal(reads,hiddenReads,'Background Android does not poll');
  document.visibilityState='visible';
  disk={...remote,events:[event('leaf','Reopened calendar')]};
  workspaceListeners.get('active-leaf-change')(); await tick();
  assert.equal(plugin.data.events[0].id,'leaf');
  disk={...remote,events:[event('command','Manual refresh')]};
  plugin.commands.find(command=>command.id==='reload-schedule-data').callback(); await tick();
  assert.equal(plugin.data.events[0].id,'command');
  assert.ok(notices.at(-1).includes('Reloaded schedules: 1'));
  assert.equal(writes.length,1,'All automatic refresh entry points remain read-only');
  plugin.cleanups.forEach(cleanup=>cleanup());
  assert.equal(poll,null); assert.equal(domListeners.size,0); assert.equal(workspaceListeners.size,0);
  console.log('PASS: external sync reloads schedules/settings/Markdown tasks atomically, no write-back, invalid/partial pull protection, remote deletions, queued edits/sync, duplicate notifications, Android focus/resume/poll, manual refresh and cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
