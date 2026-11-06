import { t, errorMessage } from "./i18n";
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
import { CATEGORIES, shiftedDates, validateEventRange, type Category } from "./calendar";


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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function storedData(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (!isRecord(value)) throw new Error(t("invalidStore"));
  return value;
}

function isScheduleEvent(value: unknown): value is ScheduleEvent {
  if (!isRecord(value)) return false;
  return ["id", "title", "date", "startTime", "endTime", "notes", "location"].every(key => typeof value[key] === "string")
    && typeof value.completed === "boolean"
    && (value.endDate === undefined || typeof value.endDate === "string")
    && (value.category === undefined || CATEGORIES.some(category => category.id === value.category))
    && ["tags", "participants"].every(key => {
      const items: unknown = value[key];
      return items === undefined || (Array.isArray(items) && items.every((item: unknown) => typeof item === "string"));
    });
}

export default class ScheduleManagerPlugin extends Plugin {
  settings: ScheduleSettings = { ...DEFAULT_SETTINGS };
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
    this.addCommand({ id: "open-schedule-overview", name: t("openOverviewSidebar"), callback: () => { void this.openOverview(); } });

    this.addRibbonIcon("calendar-days", t("openSchedule"), () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-schedule-manager",
      name: t("openSchedule"),
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "create-schedule",
      name: t("createEvent"),
      callback: () => void this.activateView(true),
    });

    this.addCommand({
      id: "open-month-in-tab",
      name: t("openMonthTab"),
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
      name: t("syncCommand"),
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
      if (!right) { new Notice(t("sidebarUnavailable")); return; }
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
    const value: unknown = await this.loadData();
    const raw = storedData(value);
    this.settings = {
      dateFormat: raw.dateFormat === "short" ? "short" : DEFAULT_SETTINGS.dateFormat,
      dailyNotesEnabled: typeof raw.dailyNotesEnabled === "boolean" ? raw.dailyNotesEnabled : DEFAULT_SETTINGS.dailyNotesEnabled,
      dailyNotesUseCore: typeof raw.dailyNotesUseCore === "boolean" ? raw.dailyNotesUseCore : DEFAULT_SETTINGS.dailyNotesUseCore,
      dailyNotesFolder: typeof raw.dailyNotesFolder === "string" ? raw.dailyNotesFolder : DEFAULT_SETTINGS.dailyNotesFolder,
      dailyNotesFormat: typeof raw.dailyNotesFormat === "string" ? raw.dailyNotesFormat : DEFAULT_SETTINGS.dailyNotesFormat,
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveDataStore();
    this.refreshViews();
  }

  async loadDataStore(): Promise<void> {
    const value: unknown = await this.loadData();
    const raw = storedData(value);
    if (raw.events !== undefined && !Array.isArray(raw.events)) {
      throw new Error(t("invalidEventList"));
    }
    const events: unknown[] = Array.isArray(raw.events) ? raw.events : [];
    if (!events.every(isScheduleEvent)) {
      throw new Error(t("unreadableEvents"));
    }
    const paths: unknown[] = Array.isArray(raw.dailyNotePaths) ? raw.dailyNotePaths : [];
    this.data = {
      events,
      dailyNotePaths: paths.filter((path): path is string => typeof path === "string"),
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
      if (notify) new Notice(t("enableSyncFirst"));
      return false;
    }
    const task = this.syncQueue.then(async () => {
      if (!this.settings.dailyNotesEnabled) return false;
      const result = await this.getDailyNotes().sync(this.data.events, this.settings, this.data.dailyNotePaths);
      this.data.dailyNotePaths = result.paths;
      await this.saveDataStore();
      if (result.errors.length) throw new Error(result.errors[0]);
      if (notify) new Notice(t("syncSuccess", { count: result.paths.length }));
      return true;
    });
    this.syncQueue = task.catch(() => undefined);
    try { return await task; }
    catch (error) {
      new Notice(t("syncFailed", { error: errorMessage(error) }), 10000);
      return false;
    }
  }

  async openDailyNote(date: string): Promise<void> {
    if (this.settings.dailyNotesEnabled) await this.synchronizeDailyNotes();
    try { await this.getDailyNotes().open(date, this.settings); }
    catch (error) {
      new Notice(t("openDailyFailed", { error: errorMessage(error) }), 10000);
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
      if (!current) throw new Error(t("eventMissing"));
      if (current.notes !== previous) throw new Error(t("notesConflict"));
      return events.map(event => event.id === id ? { ...event, notes } : event);
    });
  }

  async moveEvent(id: string, from: string, to: string): Promise<void> {
    await this.changeEvents(events => {
      if (!events.some(event => event.id === id)) throw new Error(t("eventMissingRefresh"));
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

interface ScheduleSettingSection {
  type: "group";
  heading: string;
  items: { name: string; desc: string; render: (setting: Setting) => void }[];
}

class ScheduleSettingTab extends PluginSettingTab {
  plugin: ScheduleManagerPlugin;

  constructor(app: App, plugin: ScheduleManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): ScheduleSettingSection[] {
    return [{
      type: "group",
      heading: t("scheduleTitle"),
      items: [{
        name: t("dateDisplay"),
        desc: t("dateDisplayDesc"),
        render: setting => {
          setting.addDropdown(dropdown => dropdown
            .addOption("long", t("dateLong"))
            .addOption("short", t("dateShort"))
            .setValue(this.plugin.settings.dateFormat)
            .onChange(async value => {
              this.plugin.settings.dateFormat = value === "short" ? "short" : "long";
              await this.plugin.saveSettings();
            }));
        },
      }],
    }, {
      type: "group",
      heading: t("dailyIntegration"),
      items: [{
        name: t("autoSync"),
        desc: t("autoSyncDesc"),
        render: setting => {
          setting.addToggle(toggle => toggle.setValue(this.plugin.settings.dailyNotesEnabled).onChange(async enabled => {
            this.plugin.settings.dailyNotesEnabled = enabled;
            await this.plugin.saveSettings();
            if (enabled) await this.plugin.synchronizeDailyNotes(true);
          }));
        },
      }, {
        name: t("useCore"),
        desc: t("useCoreDesc"),
        render: setting => {
          setting.addToggle(toggle => toggle.setValue(this.plugin.settings.dailyNotesUseCore).onChange(async enabled => {
            this.plugin.settings.dailyNotesUseCore = enabled;
            await this.plugin.saveSettings();
          }));
        },
      }, {
        name: t("dailyFolder"),
        desc: t("dailyFolderDesc"),
        render: setting => {
          setting.addText(text => text.setPlaceholder(t("dailyFolderPlaceholder")).setValue(this.plugin.settings.dailyNotesFolder).onChange(async value => {
            this.plugin.settings.dailyNotesFolder = value;
            await this.plugin.saveSettings();
          }));
        },
      }, {
        name: t("dailyFormat"),
        desc: t("dailyFormatDesc"),
        render: setting => {
          setting.addText(text => text.setPlaceholder("YYYY-MM-DD").setValue(this.plugin.settings.dailyNotesFormat).onChange(async value => {
            this.plugin.settings.dailyNotesFormat = value;
            await this.plugin.saveSettings();
          }));
        },
      }, {
        name: t("syncExisting"),
        desc: t("syncExistingDesc"),
        render: setting => {
          setting.addButton(button => button.setButtonText(t("syncNow")).onClick(async () => {
            button.setDisabled(true);
            try { await this.plugin.synchronizeDailyNotes(true); }
            finally { button.setDisabled(false); }
          }));
        },
      }],
    }];
  }

  // Obsidian before 1.13 uses this fallback; newer versions render and index the definitions above.
  display(): void {
    this.containerEl.empty();
    for (const section of this.getSettingDefinitions()) {
      new Setting(this.containerEl).setName(section.heading).setHeading();
      for (const definition of section.items) {
        const setting = new Setting(this.containerEl).setName(definition.name).setDesc(definition.desc);
        definition.render(setting);
      }
    }
  }
}
