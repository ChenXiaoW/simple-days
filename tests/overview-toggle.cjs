const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let language = 'zh';
const notices = [];
class Element {
  constructor(){this.attributes={};this.classes=new Set();}
  setAttribute(key,value){this.attributes[key]=value;}
  toggleClass(key,on){if(on)this.classes.add(key);else this.classes.delete(key);}
  addClass(...keys){keys.forEach(key=>this.classes.add(key));}
  empty(){}
}
const api={Plugin:class{},PluginSettingTab:class{},Modal:class{},Setting:class{},
  getLanguage:()=>language,requireApiVersion:()=>true,Notice:class{constructor(text){notices.push(text);}},
  ItemView:class{
    constructor(leaf){this.leaf=leaf;this.contentEl=new Element();this.actions=[];}
    addAction(icon,title,callback){const element=new Element();element.callback=callback;this.actions.push({icon,title,element});return element;}
    async setState(){}
  },
};
const sandbox={module:{exports:{}},require:()=>api};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8')+
  '\nmodule.exports.testing={ScheduleView,OverviewView};',sandbox);
const Plugin=sandbox.module.exports.default;
const {ScheduleView,OverviewView}=sandbox.module.exports.testing;
ScheduleView.prototype.render=function(){};OverviewView.prototype.render=function(){};
function setup(){
  const plugin=new Plugin(),leaves=[],creates=[];
  const makeLeaf=(type,region)=>{
    const leaf={type,region,detached:false,
      getViewState(){return {type:this.type,state:this.view.getState()};},
      async setViewState(state){
        if(workspace.failCreate)throw new Error('Cannot open overview');
        this.type=state.type;this.view=new OverviewView(this,plugin);await this.view.onOpen();
      },
      detach(){this.detached=true;plugin.refreshOverviewActions();},
    };
    if(type==='schedule-manager-view')leaf.view=new ScheduleView(leaf,plugin);
    else leaf.view={getViewType:()=>type};
    leaves.push(leaf);return leaf;
  };
  const workspace={
    getLeavesOfType:type=>leaves.filter(leaf=>leaf.type===type&&!leaf.detached),
    iterateRootLeaves:callback=>leaves.filter(leaf=>leaf.region==='main'&&!leaf.detached).forEach(callback),
    getRightLeaf(split){assert.equal(split,false,'Add a tab in the existing right dock group');creates.push(split);return this.unavailable?null:makeLeaf('empty','right');},
    async revealLeaf(leaf){this.revealed=leaf;},
  };
  plugin.app={workspace};plugin.saveData=async()=>assert.fail('A sidebar toggle must not save schedule data');
  const main=makeLeaf('schedule-manager-view','main'),sibling=makeLeaf('outline','right');
  main.view.selectedDate=new Date(2026,10,12);
  return {plugin,workspace,leaves,creates,main,sibling};
}
(async()=>{
  const app=setup();await app.main.view.onOpen();
  const action=app.main.view.actions.find(item=>item.icon==='panel-right').element;
  assert.equal(action.attributes['aria-label'],'打开日程概览');assert.equal(action.attributes['aria-pressed'],'false');
  action.callback();await app.plugin.overviewQueue;
  assert.equal(app.plugin.isOverviewOpen(),true);assert.equal(action.attributes['aria-label'],'关闭日程概览');
  assert.equal(action.attributes['aria-pressed'],'true');assert.equal(action.classes.has('is-active'),true);
  const first=app.workspace.revealed;
  assert.equal(first.view.selectedDate.getDate(),12);
  assert.equal(app.sibling.detached,false);assert.equal(app.sibling.type,'outline');
  await Promise.all([app.plugin.openOverview(),app.plugin.openOverview()]);
  assert.equal(app.creates.length,1,'Repeated open commands reuse the widget and do not close it');
  action.callback();await app.plugin.overviewQueue;
  assert.equal(first.detached,true);assert.equal(app.plugin.isOverviewOpen(),false);
  assert.equal(action.attributes['aria-pressed'],'false');assert.equal(action.attributes['aria-label'],'打开日程概览');
  assert.equal(app.sibling.detached,false);assert.equal(app.main.detached,false);
  await app.plugin.toggleOverview();assert.equal(app.plugin.isOverviewOpen(),true);
  // Closing the sidebar tab outside the header toggle must refresh its next action.
  app.workspace.revealed.detach();assert.equal(action.attributes['aria-label'],'打开日程概览');
  await Promise.all(Array.from({length:8},()=>app.plugin.toggleOverview()));
  assert.equal(app.plugin.isOverviewOpen(),false,'Rapid toggles are applied in order without duplicate panes');
  assert.equal(app.leaves.filter(leaf=>leaf.type==='schedule-manager-overview'&&!leaf.detached).length,0);
  app.workspace.failCreate=true;
  await assert.rejects(app.plugin.toggleOverview(),/Cannot open/);
  assert.equal(app.leaves.filter(leaf=>leaf.type==='empty'&&!leaf.detached).length,0,'Failed opening removes its unused tab');
  app.workspace.failCreate=false;
  await app.plugin.toggleOverview();assert.equal(app.plugin.isOverviewOpen(),true,'Failure does not block later toggles');
  language='en';app.plugin.refreshOverviewActions();assert.equal(action.attributes['aria-label'],'Close schedule overview');
  await app.plugin.toggleOverview();assert.equal(action.attributes['aria-label'],'Open schedule overview');
  app.workspace.unavailable=true;
  await app.plugin.toggleOverview();assert.equal(app.plugin.isOverviewOpen(),false);
  assert.match(notices.at(-1),/sidebar/);
  console.log('PASS: calendar header opens/closes the overview, synchronizes labels/pressed state, preserves other tabs/data, reuses command opens, serializes rapid toggles and recovers after failed opens.');
})().catch(error=>{console.error(error);process.exitCode=1;});
