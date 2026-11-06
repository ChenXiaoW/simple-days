import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
} from "obsidian";
import { DailyNotesService, type DailyNoteSettings } from "./daily-notes";
import { ScheduleView, VIEW_TYPE_SCHEDULE } from "./schedule-view";
import { OverviewView, VIEW_TYPE_OVERVIEW } from "./overview-view";
import { shiftedDates, validateEventRange, type Category } from "./calendar";


export interface ScheduleEvent {
  id: string;
  title: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  notes: string;
  location: string;
  completed: boolean;
  category?: Category;
  tags?: string[];
  participants?: string[];
}

interface ScheduleData {
  events: ScheduleEvent[];
  dailyNotePaths: string[];
}

export type ScheduleDraft = Omit<ScheduleEvent, "id" | "completed">;

interface ScheduleSettings extends DailyNoteSettings {
  dateFormat: "short" | "long";
}

const DEFAULT_SETTINGS: ScheduleSettings = {
  dateFormat: "long",
  dailyNotesEnabled: true,
  dailyNotesUseCore: true,
  dailyNotesFolder: "日记",
  dailyNotesFormat: "YYYY-MM-DD",
};

export default class ScheduleManagerPlugin extends Plugin {
  settings: ScheduleSettings = DEFAULT_SETTINGS;
  data: ScheduleData = { events: [], dailyNotePaths: [] };
  private openingTab: Promise<WorkspaceLeaf> | null = null;
  private dailyNotes: DailyNotesService | null = null;
  private syncQueue: Promise<unknown> = Promise.resolve();
  private mutationQueue: Promise<unknown> = Promise.resolve();

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadDataStore();

    this.registerView(VIEW_TYPE_SCHEDULE, (leaf) => new ScheduleView(leaf, this));
    this.registerView(VIEW_TYPE_OVERVIEW, (leaf) => new OverviewView(leaf, this));
    this.addCommand({ id: "open-schedule-overview", name: "在侧边栏打开日程概览", callback: () => { void this.openOverview(); } });

    this.addRibbonIcon("calendar-days", "打开日程管理", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-schedule-manager",
      name: "打开日程管理",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "create-schedule",
      name: "新建日程",
      callback: () => void this.activateView(true),
    });

    this.addCommand({
      id: "open-month-in-tab",
      name: "在标签页中打开月视图",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SCHEDULE)
          .find((item) => this.isMainLeaf(item));
        if (leaf?.view instanceof ScheduleView) {
          leaf.view.viewMode = "month";
          leaf.view.render();
        }
      },
    });

    this.addSettingTab(new ScheduleSettingTab(this.app, this));
    this.addCommand({
      id: "sync-daily-notes",
      name: "将已有日程同步到日记",
      callback: () => void this.synchronizeDailyNotes(true),
    });
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.dailyNotesEnabled && (this.data.events.length || this.data.dailyNotePaths.length)) {
        void this.synchronizeDailyNotes();
      }
    });
  }

  isMainLeaf(leaf: WorkspaceLeaf): boolean {
    let found = false;
    this.app.workspace.iterateRootLeaves((item) => {
      if (item === leaf) found = true;
    });
    return found;
  }

  refreshViews(): void {
    for (const type of [VIEW_TYPE_SCHEDULE, VIEW_TYPE_OVERVIEW]) {
      this.app.workspace.getLeavesOfType(type).forEach(leaf => {
        if (leaf.view instanceof ScheduleView || leaf.view instanceof OverviewView) leaf.view.render();
      });
    }
  }

  selectDate(date: Date): void {
    for (const type of [VIEW_TYPE_SCHEDULE, VIEW_TYPE_OVERVIEW]) {
      this.app.workspace.getLeavesOfType(type).forEach(leaf => {
        if (leaf.view instanceof ScheduleView) leaf.view.applySelectedDate(date);
        else if (leaf.view instanceof OverviewView) {
          leaf.view.selectedDate = new Date(date); leaf.view.render();
        }
      });
    }
  }

  async openOverview(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_OVERVIEW)[0];
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (!right) { new Notice("无法打开侧边栏，请重试"); return; }
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_OVERVIEW, active: true });
    }
    const calendar = this.app.workspace.getLeavesOfType(VIEW_TYPE_SCHEDULE).find(item => this.isMainLeaf(item));
    if (calendar?.view instanceof ScheduleView && leaf.view instanceof OverviewView) {
      leaf.view.selectedDate = new Date(calendar.view.selectedDate); leaf.view.render();
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async activateView(openEditor = false, sourceLeaf?: WorkspaceLeaf): Promise<void> {
    if (!this.openingTab) {
      this.openingTab = this.openScheduleTab(sourceLeaf).finally(() => {
        this.openingTab = null;
      });
    }
    const leaf = await this.openingTab;
    if (openEditor && leaf.view instanceof ScheduleView) {
      leaf.view.openEditor();
    }
  }

  private async openScheduleTab(sourceLeaf?: WorkspaceLeaf): Promise<WorkspaceLeaf> {
    const workspace = this.app.workspace;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_SCHEDULE);
    const mainLeaf = existing.find((leaf) => this.isMainLeaf(leaf));
    const source = sourceLeaf ?? (mainLeaf ? undefined : existing[0]);
    const leaf = mainLeaf ?? workspace.getLeaf("tab");

    try {
      if (!mainLeaf || (source && source !== leaf)) {
        const state = source?.view instanceof ScheduleView
          ? source.view.getState()
          : source?.getViewState().state;
        await leaf.setViewState({ type: VIEW_TYPE_SCHEDULE, active: true, state });
      }
      await workspace.revealLeaf(leaf);
    } catch (error) {
      if (!mainLeaf) leaf.detach();
      throw error;
    }

    // Keep the old view intact until its replacement is ready.
    if (source && source !== leaf) source.detach();
    return leaf;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveDataStore();
    this.refreshViews();
  }

  async loadDataStore(): Promise<void> {
    const raw = await this.loadData();
    this.data = {
      events: Array.isArray(raw?.events) ? raw.events : [],
      dailyNotePaths: Array.isArray(raw?.dailyNotePaths)
        ? raw.dailyNotePaths.filter((path: unknown) => typeof path === "string") : [],
    };
  }

  async saveDataStore(): Promise<void> {
    await this.saveData({ ...this.settings, ...this.data });
  }

  private getDailyNotes(): DailyNotesService {
    return this.dailyNotes ?? (this.dailyNotes = new DailyNotesService(this.app));
  }

  async synchronizeDailyNotes(notify = false): Promise<boolean> {
    if (!this.settings.dailyNotesEnabled) {
      if (notify) new Notice("请先在日程管理设置中启用“自动同步到日记”");
      return false;
    }
    const task = this.syncQueue.then(async () => {
      if (!this.settings.dailyNotesEnabled) return false;
      const result = await this.getDailyNotes().sync(this.data.events, this.settings, this.data.dailyNotePaths);
      this.data.dailyNotePaths = result.paths;
      await this.saveDataStore();
      if (result.errors.length) throw new Error(result.errors[0]);
      if (notify) new Notice(`已同步到 ${result.paths.length} 篇日记`);
      return true;
    });
    this.syncQueue = task.catch(() => undefined);
    try { return await task; }
    catch (error) {
      new Notice(`日程已保留，日记同步未完成：${error instanceof Error ? error.message : String(error)}。可在命令面板重试同步。`, 10000);
      return false;
    }
  }

  async openDailyNote(date: string): Promise<void> {
    if (this.settings.dailyNotesEnabled) await this.synchronizeDailyNotes();
    try { await this.getDailyNotes().open(date, this.settings); }
    catch (error) {
      new Notice(`无法打开日记：${error instanceof Error ? error.message : String(error)}`, 10000);
    }
  }

  async addEvent(event: Omit<ScheduleEvent, "id" | "completed">): Promise<ScheduleEvent> {
    validateEventRange(event);
    const created: ScheduleEvent = {
      ...event,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      completed: false,
    };
    await this.changeEvents(events => [...events, created]);
    return created;
  }

  async updateEvent(id: string, patch: Partial<ScheduleEvent>): Promise<void> {
    await this.changeEvents(events => events.map(event => {
      if (event.id !== id) return event;
      const updated = { ...event, ...patch, id };
      if (["date", "endDate", "startTime", "endTime"].some(key => Object.prototype.hasOwnProperty.call(patch, key))) validateEventRange(updated);
      return updated;
    }));
  }

  async removeEvent(id: string): Promise<void> {
    await this.changeEvents(events => events.filter(event => event.id !== id));
  }

  async updateEventNotes(id: string, previous: string, notes: string): Promise<void> {
    await this.changeEvents(events => {
      const current = events.find(event => event.id === id);
      if (!current) throw new Error("日程已删除，请重新打开后重试");
      if (current.notes !== previous) throw new Error("备注已被修改，请重新打开日程后重试");
      return events.map(event => event.id === id ? { ...event, notes } : event);
    });
  }

  async moveEvent(id: string, from: string, to: string): Promise<void> {
    await this.changeEvents(events => {
      if (!events.some(event => event.id === id)) throw new Error("日程已删除，请刷新后重试");
      return events.map(event => event.id === id ? { ...event, ...shiftedDates(event, from, to) } : event);
    });
  }

  private async changeEvents(change: (events: ScheduleEvent[]) => ScheduleEvent[]): Promise<void> {
    const task = this.mutationQueue.then(async () => {
      const events = change(this.data.events);
      // Commit the visible state only after storage succeeds; a failed drop can be retried safely.
      await this.saveData({ ...this.settings, ...this.data, events });
      this.data.events = events; this.refreshViews(); await this.synchronizeDailyNotes();
    });
    this.mutationQueue = task.catch(() => undefined);
    await task;
  }
}

class ScheduleSettingTab extends PluginSettingTab {
  plugin: ScheduleManagerPlugin;

  constructor(app: App, plugin: ScheduleManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "日程管理" });
    new Setting(containerEl)
      .setName("日期显示")
      .setDesc("选择日程标题中的日期格式")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("long", "长格式（周二，10月27日）")
          .addOption("short", "短格式（周二 10月27日）")
          .setValue(this.plugin.settings.dateFormat)
          .onChange(async (value) => {
            this.plugin.settings.dateFormat = value as ScheduleSettings["dateFormat"];
            await this.plugin.saveSettings();
            this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_SCHEDULE).forEach((leaf) => {
              if (leaf.view instanceof ScheduleView) leaf.view.render();
            });
          }),
      );
    containerEl.createEl("h3", { text: "日记联动" });
    new Setting(containerEl)
      .setName("自动同步到日记")
      .setDesc("新增、修改、完成和删除日程时，更新当天日记中的日程区块。日记正文保留；在日记中修改不会反向更新日历。")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.dailyNotesEnabled).onChange(async (enabled) => {
        this.plugin.settings.dailyNotesEnabled = enabled;
        await this.plugin.saveSettings();
        if (enabled) await this.plugin.synchronizeDailyNotes(true);
      }));
    new Setting(containerEl)
      .setName("使用 Obsidian 日记配置")
      .setDesc("读取核心“日记”插件的目录、日期格式和模板。未配置时使用下方目录和格式。")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.dailyNotesUseCore).onChange(async (enabled) => {
        this.plugin.settings.dailyNotesUseCore = enabled;
        await this.plugin.saveSettings();
        this.display();
      }));
    new Setting(containerEl)
      .setName("日记目录")
      .setDesc("备用或自定义的库内目录。默认为“日记”，留空表示库根目录。")
      .addText((text) => text.setPlaceholder("日记").setValue(this.plugin.settings.dailyNotesFolder).onChange(async (value) => {
        this.plugin.settings.dailyNotesFolder = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("日记日期格式")
      .setDesc("备用或自定义的文件名格式，例如 YYYY-MM-DD；修改配置后点击下方按钮补同步。")
      .addText((text) => text.setPlaceholder("YYYY-MM-DD").setValue(this.plugin.settings.dailyNotesFormat).onChange(async (value) => {
        this.plugin.settings.dailyNotesFormat = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("同步已有日程")
      .setDesc("补齐日记中的日程，并更新移动日期、删除日程或修改目录后留下的旧区块。")
      .addButton((button) => button.setButtonText("立即同步").onClick(async () => {
        button.setDisabled(true);
        try { await this.plugin.synchronizeDailyNotes(true); }
        finally { button.setDisabled(false); }
      }));
  }
}
