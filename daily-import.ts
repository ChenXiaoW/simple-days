import type { ScheduleEvent } from "./main";
import { endDateOf, occursOn, splitNames, validDate, validateEventRange } from "./calendar";
import { errorMessage, t } from "./i18n";

export const BLOCK_START = "<!-- obsidian-schedule-manager:start -->";
export const BLOCK_END = "<!-- obsidian-schedule-manager:end -->";
export type ImportedEvent = Omit<ScheduleEvent, "id">;
export interface DiaryCandidate { event: ImportedEvent; path: string; line: number }
export interface DiaryIssue { path: string; line: number; reason: string }
export interface DiaryScan {
  files: number;
  blocks: number;
  candidates: DiaryCandidate[];
  issues: DiaryIssue[];
}
export interface ImportPlan {
  additions: DiaryCandidate[];
  duplicates: number;
  issues: DiaryIssue[];
}

const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const decode = (value: string): string => value.replace(/&lt;!--/g, "<!--");

function parseEntry(lines: string[], date: string): ImportedEvent {
  const first = /^- \[([ xX])\] (.+)$/.exec(lines[0]);
  if (!first) throw new Error(t("importInvalidEntry"));
  // Time labels belong to the file's language, independently of the current UI language.
  const label = /^(全天|All day|截至 (\d{2}:\d{2})|Until (\d{2}:\d{2})|(\d{2}:\d{2})(?: [–-] (\d{2}:\d{2}))?)( · (?:跨天|Multi-day))? (.+)$/.exec(first[2]);
  if (!label) throw new Error(t("importInvalidTime"));
  const event: ImportedEvent = {
    title: decode(label[7]).trim(), date, startTime: label[4] || "", endTime: label[5] || label[2] || label[3] || "",
    location: "", notes: "", completed: first[1].toLowerCase() === "x", category: "work", tags: [], participants: [],
  };
  const fields = new Set<string>();
  let range = "";
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const field = /^  - (起止|Date range|地点|Location|参与人|Participants|标签|Tags|备注|Notes)[:：]\s*(.*)$/.exec(line);
    if (!field) throw new Error(t("importInvalidEntry"));
    const name = ({ 起止: "range", "Date range": "range", 地点: "location", Location: "location", 参与人: "participants",
      Participants: "participants", 标签: "tags", Tags: "tags", 备注: "notes", Notes: "notes" } as Record<string, string>)[field[1]];
    if (fields.has(name)) throw new Error(t("importInvalidEntry"));
    fields.add(name);
    const value = decode(field[2]);
    if (name === "range") range = value;
    else if (name === "location") event.location = value;
    else if (name === "participants") event.participants = splitNames(value);
    else if (name === "tags") event.tags = value.split(/\s+/).filter(Boolean).map(tag => tag.replace(/^#/, ""));
    else {
      const notes = lines.slice(index + 1);
      if (notes.some(note => note.trim() && !note.startsWith("    "))) throw new Error(t("importInvalidEntry"));
      // Remove the renderer's separator lines, retaining Markdown indentation and internal blank lines.
      while (notes.length && !notes[0]) notes.shift();
      while (notes.length && !notes[notes.length - 1]) notes.pop();
      event.notes = [value, ...notes.map(note => decode(note.startsWith("    ") ? note.slice(4) : note))]
        .filter((note, position) => position > 0 || note !== "").join("\n");
      break;
    }
  }
  if (range) {
    const match = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))? → (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?(?: · (?:全天|All day))?$/.exec(range);
    if (!match) throw new Error(t("importInvalidRange"));
    event.date = match[1]; event.endDate = match[3];
    event.startTime = match[2] || ""; event.endTime = match[4] || "";
  } else if (label[6]) throw new Error(t("importMissingRange"));
  if (!event.title) throw new Error(t("importInvalidEntry"));
  if (!validDate(event.date)) throw new Error(t("importMissingDate"));
  if ([event.startTime, event.endTime].some(time => time && !CLOCK.test(time))) throw new Error(t("importInvalidTime"));
  validateEventRange(event);
  if (date && (!validDate(date) || !occursOn({ ...event, id: "" }, date))) throw new Error(t("importInvalidRange"));
  return event;
}

export function parseDailySchedules(content: string, path: string, fileDate: string): { candidates: DiaryCandidate[]; issues: DiaryIssue[] } {
  const candidates: DiaryCandidate[] = [], issues: DiaryIssue[] = [];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const starts: number[] = [], ends: number[] = [];
  let fence = "", fenceLength = 0;
  for (let index = 0; index < lines.length; index++) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]);
    if (marker) {
      if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length; }
      else if (marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim()) fence = "";
    }
    if (fence) continue;
    if (lines[index] === BLOCK_START) starts.push(index);
    if (lines[index] === BLOCK_END) ends.push(index);
  }
  if (!starts.length && !ends.length) return { candidates, issues };
  if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) {
    return { candidates, issues: [{ path, line: (starts[0] ?? ends[0]) + 1, reason: t("malformedBlock") }] };
  }
  let date = fileDate;
  for (let index = starts[0] + 1; index < ends[0];) {
    const line = lines[index];
    if (!line.trim() || /^## [^#]/.test(line)) { index++; continue; }
    if (line.startsWith("### ")) { date = line.slice(4).trim(); index++; continue; }
    if (!/^- \[/.test(line)) {
      issues.push({ path, line: index + 1, reason: t("importInvalidEntry") }); index++; continue;
    }
    const start = index++;
    while (index < ends[0] && !/^(?:- \[|### )/.test(lines[index])) index++;
    try { candidates.push({ event: parseEntry(lines.slice(start, index), date), path, line: start + 1 }); }
    catch (error) { issues.push({ path, line: start + 1, reason: errorMessage(error) }); }
  }
  return { candidates, issues };
}

// The old diary format has no event ID or category. Match its stable title and complete time range.
function identity(event: ImportedEvent): string {
  return JSON.stringify([event.title.replace(/[\r\n]+/g, " ").trim(), event.date, endDateOf(event), event.startTime, event.endTime]);
}
function details(event: ImportedEvent): string {
  return JSON.stringify([event.completed, event.location.replace(/[\r\n]+/g, " "), event.notes.replace(/\r\n?/g, "\n").trim(),
    [...(event.tags || [])].sort(), [...(event.participants || [])].sort()]);
}

export function planDailyImport(candidates: DiaryCandidate[], existing: ScheduleEvent[]): ImportPlan {
  const groups = new Map<string, DiaryCandidate[]>();
  const current = new Map<string, ScheduleEvent[]>();
  for (const event of existing) { const key = identity(event); current.set(key, [...(current.get(key) || []), event]); }
  for (const candidate of candidates) { const key = identity(candidate.event); groups.set(key, [...(groups.get(key) || []), candidate]); }
  const additions: DiaryCandidate[] = [], issues: DiaryIssue[] = [];
  let duplicates = 0;
  for (const [key, group] of groups) {
    const signatures = new Set(group.map(candidate => details(candidate.event)));
    const saved = current.get(key) || [];
    if (signatures.size > 1 || saved.some(event => details(event) !== details(group[0].event))) {
      issues.push(...group.map(candidate => ({ path: candidate.path, line: candidate.line, reason: t("importConflict", { title: candidate.event.title }) })));
    } else {
      if (!saved.length) additions.push(group[0]);
      duplicates += group.length - (saved.length ? 0 : 1);
    }
  }
  return { additions, duplicates, issues };
}
