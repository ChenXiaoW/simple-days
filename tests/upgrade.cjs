const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const compiled = fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const notices = [];
class BasePlugin {
  registerView(type, factory) { this.app.workspace.factories.set(type, factory); }
  addCommand() {} addRibbonIcon() {} addSettingTab() {} registerDomEvent() {} registerEvent() {} registerInterval() {}
}
const api = {
  getLanguage:()=> 'zh',requireApiVersion:()=>true,Platform:{isMobile:true},Plugin:BasePlugin,
  PluginSettingTab:class{},Modal:class{},Setting:class{},Notice:class {constructor(text){notices.push(text);}},
  ItemView:class { constructor(leaf){this.leaf=leaf;} async setState(){} },
};
function loadGeneration() {
  const sandbox={module:{exports:{}},document:{visibilityState:'visible'},window:{setInterval:()=>1},require:name=>{assert.equal(name,'obsidian');return api;}};
  vm.runInNewContext(compiled+'\nmodule.exports.testing={ScheduleView,OverviewView};',sandbox);
  const result={Plugin:sandbox.module.exports.default,...sandbox.module.exports.testing};
  for (const View of [result.ScheduleView,result.OverviewView]) {
    View.prototype.onOpen=async function(){this.render();};
    View.prototype.onClose=async function(){this.closed=true;};
    View.prototype.render=function(){this.renderedEvents=clone(this.plugin.data.events);};
  }
  return result;
}
(async()=>{
  const old=loadGeneration(),next=loadGeneration();
  const event={id:'saved-in-066',title:'升级前已有日程',date:'2026-11-09',startTime:'09:00',endTime:'10:00',notes:'- [ ] 保留待办',location:'会议室',completed:false};
  const persisted={events:[event],dailyNotePaths:['我的日记/2026-11-09.md'],dailyNotesEnabled:false,dailyNotesFolder:'我的日记',dailyNotesUseCore:false,dateFormat:'short'};
  const oldPlugin=new old.Plugin();oldPlugin.data={events:[event],dailyNotePaths:persisted.dailyNotePaths};
  const leaves=[],calls=[],factories=new Map();
  const workspace={
    factories,on:()=>({}),onLayoutReady:callback=>callback(),
    getLeavesOfType:type=>leaves.filter(leaf=>leaf.type===type),
    iterateRootLeaves:callback=>leaves.filter(leaf=>leaf.region==='main').forEach(callback),
    async revealLeaf(leaf){this.activeLeaf=leaf;},
  };
  const leaf=(type,region)=>{
    const item={type,region,pinned:true,view:null,
      getViewState(){return {type:this.type,state:this.view.getState(),pinned:this.pinned};},
      async setViewState(state){
        calls.push({...state});
        if(this.type===state.type)return; // The host may retain same-type views on a hot update.
        await this.view.onClose?.();this.type=state.type;
        if(state.type==='empty')this.view={getViewType:()=> 'empty',getState:()=>({})};
        else {this.view=factories.get(state.type)(this);await this.view.onOpen();await this.view.setState(state.state,{});}
      },
    };
    item.view=type==='schedule-manager-view'?new old.ScheduleView(item,oldPlugin):new old.OverviewView(item,oldPlugin);
    leaves.push(item);return item;
  };
  const main=leaf('schedule-manager-view','main'),side=leaf('schedule-manager-overview','right');
  const draft={title:'尚未保存',date:'2026-11-09',startTime:'10:00',endTime:'11:00',location:'',notes:'保留草稿'};
  await main.view.setState({date:'2026-11-09',viewMode:'week',category:'client',zoom:125,editorVisible:true,draft,editingId:null},{});
  await side.view.setState({date:'2026-11-08'},{});
  const beforeState=clone(main.getViewState()),beforeSidebar=clone(side.getViewState());
  const plugin=new next.Plugin();plugin.app={workspace};
  let saves=0;plugin.loadData=async()=>clone(persisted);plugin.saveData=async()=>{saves++;};
  await plugin.onload();await plugin.restoreOpenViews();
  assert.ok(main.view instanceof next.ScheduleView);assert.ok(side.view instanceof next.OverviewView);
  assert.equal(main.view.plugin,plugin);assert.equal(side.view.plugin,plugin);
  assert.deepEqual(clone(main.getViewState()),beforeState,'Open mode, date, filter, zoom and editor draft survive reload');
  assert.deepEqual(clone(side.getViewState()),beforeSidebar,'Sidebar stays in the same leaf and on the same date');
  assert.deepEqual(clone(plugin.data.events),[event]);assert.equal(plugin.settings.dailyNotesFolder,'我的日记');
  assert.equal(saves,0,'Opening an older dataset does not rewrite it');
  assert.equal(calls.filter(state=>state.type==='empty').length,2);
  assert.ok(calls.every(state=>state.active===false),'Restoration does not steal focus');
  plugin.data.events=[{...event,title:'升级后的新日程'}];plugin.refreshViews();
  assert.equal(main.view.renderedEvents[0].title,'升级后的新日程');assert.equal(side.view.renderedEvents[0].title,'升级后的新日程');
  await Promise.all([plugin.restoreOpenViews(),plugin.restoreOpenViews()]);
  assert.equal(calls.length,4,'Already-current views are retained');
  assert.equal(notices.length,0);
  console.log('PASS: hot upgrade retains old datasets, rebinds retained calendar/sidebar views, preserves leaf positions/modes/dates/filters/drafts and refreshes using the new plugin instance.');
})().catch(error=>{console.error(error);process.exitCode=1;});
