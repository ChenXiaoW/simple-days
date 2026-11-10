import { t, errorMessage } from "./i18n";
import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import type momentFactory from "moment";
import type { ScheduleEvent } from "./main";
import { eventDates, dayTimeRange, endDateOf, timeRange } from "./calendar";
import { BLOCK_START, BLOCK_END, parseDailySchedules, type DiaryScan } from "./daily-import";

export interface DailyNoteSettings {
  dailyNotesEnabled: boolean;
  dailyNotesUseCore: boolean;
  dailyNotesFolder: string;
  dailyNotesFormat: string;
}

interface DailyNoteConfig {
  folder: string;
  format: string;
  template: string;
}

export interface DailyNoteSyncResult {
  paths: string[];
  errors: string[];
  writtenPaths?: string[];
}

const createMoment = moment as unknown as typeof momentFactory;

function safeText(value: string): string {
  return value.replace(/<!--/g, "&lt;!--");
}

function singleLine(value: string): string {
  return safeText(value.replace(/[\r\n]+/g, " "));
}

interface DailyOccurrence { event: ScheduleEvent; date: string }
function renderSchedules(events: DailyOccurrence[]): string {
  if (events.length === 0) return "";
  const sorted = [...events].sort((a, b) =>
    a.date.localeCompare(b.date) || a.event.startTime.localeCompare(b.event.startTime) || a.event.title.localeCompare(b.event.title),
  );
  const multipleDates = new Set(events.map((event) => event.date)).size > 1;
  const lines = [BLOCK_START, `## ${t("dailyHeading")}`, ""];
  let previousDate = "";
  for (const occurrence of sorted) {
    const { event, date } = occurrence;
    if (multipleDates && date !== previousDate) {
      if (previousDate) lines.push("");
      lines.push(`### ${date}`, "");
    }
    previousDate = date;
    const time = dayTimeRange(event, date);
    lines.push(`- [${event.completed ? "x" : " "}] ${singleLine(time)} ${singleLine(event.title)}`);
    if (endDateOf(event) !== event.date) lines.push(`  - ${t("dailyRange", { value: singleLine(timeRange(event)) })}`);
    if (event.location) lines.push(`  - ${t("dailyLocation", { value: singleLine(event.location) })}`);
    if (event.participants?.length) lines.push(`  - ${t("dailyParticipants", { value: singleLine(event.participants.join(t("listSeparator"))) })}`);
    if (event.tags?.length) lines.push(`  - ${t("dailyTags", { value: singleLine(event.tags.map(tag => `#${tag}`).join(" ")) })}`);
    if (event.notes) {
      const notes = safeText(event.notes).replace(/\r\n?/g, "\n").split("\n");
      // Start a nested Markdown block so headings, lists and fenced code retain their structure.
      lines.push(`  - ${t("dailyNotes")}`, "", ...notes.map(line => line ? `    ${line}` : ""), "");
    }
  }
  lines.push(BLOCK_END);
  return lines.join("\n");
}

export function replaceScheduleBlock(content: string, block: string): string {
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const replacement = block.replace(/\n/g, newline);
  if (start === -1 && end === -1) {
    if (!block) return content;
    return content + (content ? content.endsWith("\n") ? newline : newline + newline : "") + replacement + newline;
  }
  if (start === -1 || end < start || content.indexOf(BLOCK_START, start + BLOCK_START.length) !== -1
    || content.indexOf(BLOCK_END, end + BLOCK_END.length) !== -1) {
    throw new Error(t("malformedBlock"));
  }
  return content.slice(0, start) + replacement + content.slice(end + BLOCK_END.length);
}

export class DailyNotesService {
  constructor(private app: App) {}

  private relativePath(path: string): string {
    const relative = path.trim().replace(/\\/g, "/");
    if (/^(?:\/|[a-zA-Z]:)/.test(relative) || relative.split("/").some((part) => part === "..")) {
      throw new Error(t("relativePathRequired"));
    }
    const normalized = normalizePath(relative);
    const configDir = normalizePath(this.app.vault.configDir);
    if (normalized === configDir || normalized.startsWith(`${configDir}/`)) {
      throw new Error(t("configPathForbidden"));
    }
    return normalized;
  }

  private async config(settings: DailyNoteSettings): Promise<DailyNoteConfig> {
    if (settings.dailyNotesUseCore) {
      const path = normalizePath(`${this.app.vault.configDir}/daily-notes.json`);
      if (await this.app.vault.adapter.exists(path)) {
        const raw = JSON.parse(await this.app.vault.adapter.read(path)) as Record<string, unknown>;
        return {
          folder: typeof raw.folder === "string" ? raw.folder : "",
          format: typeof raw.format === "string" && raw.format.trim() ? raw.format : "YYYY-MM-DD",
          template: typeof raw.template === "string" ? raw.template : "",
        };
      }
    }
    return { folder: settings.dailyNotesFolder, format: settings.dailyNotesFormat || "YYYY-MM-DD", template: "" };
  }

  private pathForDate(date: string, config: DailyNoteConfig): string {
    const day = createMoment(date, "YYYY-MM-DD", true);
    if (!day.isValid()) throw new Error(t("invalidDateValue", { date: date }));
    const name = day.format(config.format);
    const path = this.relativePath(`${config.folder ? `${config.folder}/` : ""}${name}.md`);
    return path;
  }

  private async createFolders(path: string): Promise<void> {
    const folders = path.split("/").slice(0, -1);
    let current = "";
    for (const folder of folders) {
      current = current ? `${current}/${folder}` : folder;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing && !(existing instanceof TFolder)) throw new Error(t("folderIsFile", { path: current }));
      if (!existing) {
        try { await this.app.vault.createFolder(current); }
        catch (error) {
          if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error;
        }
      }
    }
  }

  private async template(date: string, config: DailyNoteConfig): Promise<string> {
    if (!config.template) return "";
    const templatePath = this.relativePath(config.template.endsWith(".md") ? config.template : `${config.template}.md`);
    const file = this.app.vault.getAbstractFileByPath(templatePath);
    if (!(file instanceof TFile)) throw new Error(t("missingTemplate", { path: templatePath }));
    const content = await this.app.vault.cachedRead(file);
    const day = createMoment(date, "YYYY-MM-DD", true);
    return content.replace(/\{\{\s*(date|time)(?::([^}]+))?\s*\}\}/g, (_match, kind: string, format?: string) =>
      (kind === "date" ? day : createMoment()).format(format?.trim() || (kind === "date" ? config.format : "HH:mm")),
    );
  }

  private async ensureNote(path: string, date: string, config: DailyNoteConfig): Promise<TFile> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    if (existing) throw new Error(t("noteIsFolder", { path: path }));
    const initial = await this.template(date, config);
    await this.createFolders(path);
    try { return await this.app.vault.create(path, initial); }
    catch (error) {
      const created = this.app.vault.getAbstractFileByPath(path);
      if (created instanceof TFile) return created;
      throw error;
    }
  }

  async sync(events: ScheduleEvent[], settings: DailyNoteSettings, knownPaths: string[]): Promise<DailyNoteSyncResult> {
    const config = await this.config(settings);
    const groups = new Map<string, DailyOccurrence[]>();
    for (const event of events) {
      for (const date of eventDates(event)) {
        const path = this.pathForDate(date, config);
        const group = groups.get(path) ?? [];
        group.push({ event, date });
        groups.set(path, group);
      }
    }
    const paths = new Set(knownPaths);
    const errors: string[] = [];
    const writtenPaths: string[] = [];
    for (const path of new Set([...groups.keys(), ...knownPaths])) {
      try {
        this.relativePath(path);
        const schedules = groups.get(path) ?? [];
        if (schedules.length === 0 && errors.length > 0) continue;
        const existing = this.app.vault.getAbstractFileByPath(path);
        const file = schedules.length > 0
          ? await this.ensureNote(path, schedules[0].date, config)
          : existing instanceof TFile ? existing : null;
        if (file) {
          const block = renderSchedules(schedules);
          const current = await this.app.vault.read(file);
          if (replaceScheduleBlock(current, block) !== current) {
            await this.app.vault.process(file, (content) => replaceScheduleBlock(content, block));
            writtenPaths.push(path);
          }
        }
        if (schedules.length > 0) paths.add(path);
        else paths.delete(path);
      } catch (error) {
        errors.push(t("pathError", { path, error: errorMessage(error) }));
      }
    }
    return { paths: [...paths].sort(), errors, writtenPaths };
  }

  async open(date: string, settings: DailyNoteSettings): Promise<void> {
    const config = await this.config(settings);
    const path = this.pathForDate(date, config);
    const file = await this.ensureNote(path, date, config);
    const existing = this.app.workspace.getLeavesOfType("markdown")
      .find((leaf) => leaf.getViewState().state?.file === file.path);
    if (existing) await this.app.workspace.revealLeaf(existing);
    else await this.app.workspace.getLeaf("tab").openFile(file, { active: true });
  }

  async scan(settings: DailyNoteSettings, progress: (done: number, total: number) => void = () => {}): Promise<DiaryScan> {
    const config = await this.config(settings);
    const folder = this.relativePath(config.folder);
    // Read all Markdown files: another device may use a different Daily notes folder.
    const files = this.app.vault.getMarkdownFiles();
    const result: DiaryScan = { files: files.length, blocks: 0, candidates: [], issues: [] };
    const dateForPath = (path: string): string => {
      const relative = folder && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1, -3) : path.slice(0, -3);
      const tokens = config.format.replace(/\[[^\]]*\]/g, "");
      // Never let Moment fill missing month/day fields using today's date.
      if (/Y/.test(tokens) && /M/.test(tokens) && /D/.test(tokens)) {
        for (const locale of [createMoment.locale(), "en", "zh-cn"]) {
          const date = createMoment(relative, config.format, locale, true);
          if (date.isValid()) return date.format("YYYY-MM-DD");
        }
      }
      const basename = path.split("/").pop()?.replace(/\.md$/i, "") || "";
      const date = createMoment(basename, "YYYY-MM-DD", true);
      return date.isValid() ? date.format("YYYY-MM-DD") : "";
    };
    progress(0, files.length);
    for (let offset = 0; offset < files.length; offset += 20) {
      const batch = await Promise.all(files.slice(offset, offset + 20).map(async file => {
        try {
          const content = await this.app.vault.read(file);
          if (!content.includes(BLOCK_START) && !content.includes(BLOCK_END)) return null;
          return { ...parseDailySchedules(content, file.path, dateForPath(file.path)), marked: true };
        } catch (error) {
          return { candidates: [], issues: [{ path: file.path, line: 0, reason: errorMessage(error) }], marked: false };
        }
      }));
      for (const parsed of batch) {
        if (!parsed) continue;
        if (parsed.marked) result.blocks++;
        result.candidates.push(...parsed.candidates); result.issues.push(...parsed.issues);
      }
      progress(Math.min(offset + 20, files.length), files.length);
    }
    return result;
  }
}
