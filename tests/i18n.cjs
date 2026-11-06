const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

let language = 'en';
let legacyLocale = 'zh-cn';
let appVersion = '1.14.4';
let languageCalls = 0;
const api = {
  requireApiVersion: minimum => minimum.split('.').reduce((comparison, part, index) =>
    comparison || Number(appVersion.split('.')[index] || 0) - Number(part), 0) >= 0,
  getLanguage: () => { languageCalls++; return language; },
  moment: { locale: () => legacyLocale },
  Plugin: class {}, ItemView: class {}, Modal: class {}, Notice: class {}, Setting: class {},
  PluginSettingTab: class {},
};
const sandbox = { module: { exports: {} }, require: name => {
  assert.equal(name, 'obsidian'); return api;
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
  + '\nmodule.exports.i18n = {t, uiLanguage, formatDate, weekdayLabels, monthHeading, weekHeading, dayLabel, categoryLabel, CATEGORIES, timeRange, dayTimeRange, validateEventRange, renderSchedules, ScheduleSettingTab, dateKey};', sandbox);
const i = sandbox.module.exports.i18n;
const Plugin = sandbox.module.exports.default;
const date = new Date(2026, 9, 27);
const event = { id: 'unchanged', title: '中文标题 {time} $&', date: '2026-10-27', endDate: '2026-10-28',
  startTime: '', endTime: '', completed: false, location: '会议室', participants: ['小王', '小李'], tags: ['项目'], notes: '- [ ] 中文备注', category: 'meeting' };
const original = JSON.stringify(event);

assert.equal(i.uiLanguage(), 'en', 'Obsidian language takes precedence over the Moment locale');
assert.equal(i.t('createEvent'), 'New event');
assert.equal(i.categoryLabel(event), 'Meeting');
assert.equal(i.CATEGORIES[0].label, 'Work');
assert.deepEqual(Array.from(i.weekdayLabels()), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
assert.equal(i.monthHeading(date), 'October 2026');
assert.match(i.weekHeading(date, new Date(2026, 10, 2)), /Oct 27.*Nov 2/);
assert.match(i.dayLabel(date), /Tuesday/);
assert.equal(i.dayTimeRange(event, event.date), 'All day · Multi-day');
assert.equal(i.t('copyTitle', { title: event.title }), event.title + ' (copy)', 'User text is never treated as a template or replacement pattern');
assert.equal(i.t('moreEvents', { count: 2 }), '+2 more');
assert.throws(() => i.validateEventRange({ ...event, endDate: '2026-10-26' }), /end date/);
const english = i.renderSchedules([{ event, date: event.date }]);
assert.match(english, /## Schedule/);
assert.match(english, /Location: 会议室/);
assert.match(english, /Participants: 小王, 小李/);
assert.match(english, /- \[ \] 中文备注/);
assert.equal(english.includes('<!-- obsidian-schedule-manager:start -->'), true);
const plugin = new Plugin();
assert.equal(plugin.settings.dailyNotesFolder, '日记', 'Display language does not change the legacy default path');
const tab = new i.ScheduleSettingTab({}, plugin);
assert.deepEqual(Array.from(tab.getSettingDefinitions(), item => item.heading), ['Schedule', 'Daily notes']);

language = 'zh';
assert.equal(i.t('createEvent'), '新建日程');
assert.equal(i.CATEGORIES[0].label, '工作', 'Category labels are not cached at module initialization');
assert.equal(i.categoryLabel(event), '会议');
assert.match(i.monthHeading(date), /2026年10月/);
assert.match(i.dayLabel(date), /星期二/);
assert.deepEqual(Array.from(i.weekdayLabels()), ['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
assert.equal(i.dayTimeRange(event, event.date), '全天 · 跨天');
assert.throws(() => i.validateEventRange({ ...event, endDate: '2026-10-26' }), /结束日期/);
assert.deepEqual(Array.from(tab.getSettingDefinitions(), item => item.heading), ['日程管理', '日记联动']);
assert.match(i.renderSchedules([{ event, date: event.date }]), /## 日程/);
for (const variant of ['zh-CN', 'zh-cn', 'zh_TW', 'zh-TW']) {
  language = variant; assert.equal(i.t('createEvent'), '新建日程');
}
for (const fallback of ['en', 'en-GB', 'fr', 'ja', 'de', '']) {
  language = fallback; assert.equal(i.t('createEvent'), 'New event', fallback + ' uses English fallback');
}
appVersion = '1.8.7'; language = 'en'; legacyLocale = 'zh-cn';
assert.equal(i.t('today'), 'Today', 'The new API is used starting at its introduction version');
const callsBeforeLegacy = languageCalls;
api.getLanguage = () => { throw new Error('The new API must never run on an older host'); };
for (const version of ['1.7.2', '1.8.6']) {
  appVersion = version;
  legacyLocale = 'zh-cn'; assert.equal(i.t('today'), '今天', version + ' uses the host Moment locale');
  legacyLocale = 'en'; assert.equal(i.t('today'), 'Today');
  legacyLocale = 'fr'; assert.equal(i.t('today'), 'Today');
}
assert.equal(languageCalls, callsBeforeLegacy, 'Older versions never invoke getLanguage even when it is present');
delete api.getLanguage;
appVersion = '1.7.2'; legacyLocale = 'zh-cn';
assert.equal(i.t('today'), '今天', 'Older hosts without the new export still load and translate');
assert.equal(i.dateKey(date), '2026-10-27', 'Storage dates are independent of display language');
assert.equal(JSON.stringify(event), original, 'Formatting never translates or mutates user content');
console.log('PASS: Obsidian language, English fallback, Chinese variants, pre-1.8.7 compatibility, localized dates/categories/settings/validation/diary blocks, safe interpolation and unchanged user data.');
