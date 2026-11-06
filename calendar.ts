import { t, formatDate } from "./i18n";
import type { ScheduleEvent } from "./main";

export type CalendarMode = "month" | "week";
export type Category = "work" | "meeting" | "client" | "delivery";
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "work", get label() { return t("work"); } }, { id: "meeting", get label() { return t("meeting"); } },
  { id: "client", get label() { return t("client"); } }, { id: "delivery", get label() { return t("delivery"); } },
];
export function categoryOf(event: Pick<ScheduleEvent, "category">): Category {
  return CATEGORIES.some(item => item.id === event.category) ? event.category as Category : "work";
}
export function categoryLabel(event: Pick<ScheduleEvent, "category">): string {
  return CATEGORIES.find(item => item.id === categoryOf(event))!.label;
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(parseDate(value)) === value;
}
export function addDays(date: Date, amount: number): Date {
  const result = new Date(date); result.setDate(result.getDate() + amount); return result;
}
export function addMonths(date: Date, amount: number): Date {
  const first = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  first.setDate(Math.min(date.getDate(), new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()));
  return first;
}
export function startOfWeek(date: Date): Date {
  const result = addDays(date, -((date.getDay() + 6) % 7)); result.setHours(0, 0, 0, 0); return result;
}
export function weekNumber(date: Date): number {
  const thursday = addDays(startOfWeek(date), 3);
  const first = startOfWeek(new Date(thursday.getFullYear(), 0, 4));
  return Math.round((Date.UTC(thursday.getFullYear(), thursday.getMonth(), thursday.getDate()) -
    Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / 604800000) + 1;
}
export function dayLabel(date: Date, long = true): string {
  return formatDate(date, { month: "long", day: "numeric", weekday: long ? "long" : "short" });
}
export function timeRange(event: ScheduleEvent): string {
  if (endDateOf(event) !== event.date) {
    return `${event.date}${event.startTime ? ` ${event.startTime}` : ""} → ${endDateOf(event)}${event.endTime ? ` ${event.endTime}` : ""}${isAllDay(event) ? ` · ${t("allDay")}` : ""}`;
  }
  if (!event.startTime) return event.endTime ? t("untilTime", { time: event.endTime }) : t("allDay");
  return event.startTime + (event.endTime ? ` – ${event.endTime}` : "");
}
export function minutes(time: string): number {
  const [hours, mins] = time.split(":").map(Number); return hours * 60 + mins;
}
export function clockTime(minute: number): string {
  const value = Math.min(1439, Math.max(0, minute));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function eventInterval(event: ScheduleEvent, onDate = event.date): { start: number; end: number } {
  if (endDateOf(event) !== event.date) {
    return { start: onDate === event.date && event.startTime ? minutes(event.startTime) : 0,
      end: onDate === endDateOf(event) && event.endTime ? minutes(event.endTime) : 1440 };
  }
  const start = event.startTime ? minutes(event.startTime) : Math.max(0, minutes(event.endTime) - 60);
  const end = event.endTime ? minutes(event.endTime) : start + 60;
  return { start, end: Math.min(1440, Math.max(start + 15, end)) };
}
export function sortEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title));
}
export interface PlacedEvent { event: ScheduleEvent; start: number; end: number; lane: number; lanes: number }
// Each connected overlap group shares a lane count; adjacent appointments reuse space.
export function placeEvents(events: ScheduleEvent[], onDate?: string): PlacedEvent[] {
  const sorted = events.map(event => ({ event, ...eventInterval(event, onDate), lane: 0, lanes: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: PlacedEvent[] = []; let groupEnd = -1; let laneEnds: number[] = [];
  const finish = () => { group.forEach(item => item.lanes = laneEnds.length); group = []; laneEnds = []; };
  for (const item of sorted) {
    if (item.start >= groupEnd) finish();
    let lane = laneEnds.findIndex(end => end <= item.start);
    if (lane < 0) lane = laneEnds.length;
    // Reserve at least 30 minutes so small visual blocks also avoid overlap.
    laneEnds[lane] = Math.max(item.end, item.start + 30);
    item.lane = lane; group.push(item); groupEnd = Math.max(...laneEnds);
  }
  finish(); return sorted;
}
export function splitNames(value: string): string[] {
  return [...new Set(value.split(/[,，、\n]+/).map(item => item.trim().replace(/^#/, "")).filter(Boolean))];
}

export function endDateOf(event: Pick<ScheduleEvent, "date" | "endDate">): string {
  return event.endDate && validDate(event.endDate) && event.endDate >= event.date ? event.endDate : event.date;
}
export function isAllDay(event: Pick<ScheduleEvent, "startTime" | "endTime">): boolean {
  return !event.startTime && !event.endTime;
}
export function daysBetween(from: string, to: string): number {
  const utc = (value: string) => { const date = parseDate(value); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); };
  return Math.round((utc(to) - utc(from)) / 86400000);
}
export function lastEventDate(event: ScheduleEvent): string {
  const end = endDateOf(event);
  return end > event.date && !isAllDay(event) && event.endTime === "00:00" ? dateKey(addDays(parseDate(end), -1)) : end;
}
export function occursOn(event: ScheduleEvent, date: string): boolean {
  return date >= event.date && date <= lastEventDate(event);
}
export function overlapsDates(event: ScheduleEvent, from: string, to: string): boolean {
  return event.date <= to && lastEventDate(event) >= from;
}
export function eventDates(event: ScheduleEvent): string[] {
  const end = endDateOf(event);
  if (!validDate(event.date) || !validDate(end)) throw new Error(t("invalidDate"));
  const dates: string[] = [];
  const last = lastEventDate(event);
  for (let offset = 0; offset <= daysBetween(event.date, last); offset++) dates.push(dateKey(addDays(parseDate(event.date), offset)));
  return dates;
}
export function dayTimeRange(event: ScheduleEvent, date: string): string {
  if (endDateOf(event) === event.date) return timeRange(event);
  if (isAllDay(event)) return `${t("allDay")} · ${t("multiDay")}`;
  const { start, end } = eventInterval(event, date);
  return `${clockTime(start)} – ${end === 1440 ? "24:00" : clockTime(end)} · ${t("multiDay")}`;
}
export function durationInDates(event: ScheduleEvent, from: string, to: string): number {
  if (isAllDay(event) || !overlapsDates(event, from, to)) return 0;
  let minutesTotal = 0;
  const first = event.date > from ? event.date : from;
  const last = lastEventDate(event) < to ? lastEventDate(event) : to;
  for (let offset = 0; offset <= daysBetween(first, last); offset++) {
    const part = eventInterval(event, dateKey(addDays(parseDate(first), offset))); minutesTotal += part.end - part.start;
  }
  return minutesTotal / 60;
}
export function shiftedDates(event: ScheduleEvent, from: string, to: string): { date: string; endDate?: string } {
  if (!validDate(from) || !validDate(to) || !occursOn(event, from)) throw new Error(t("invalidMoveDate"));
  const delta = daysBetween(from, to);
  const date = dateKey(addDays(parseDate(event.date), delta));
  const endDate = dateKey(addDays(parseDate(endDateOf(event)), delta));
  if (!validDate(date) || !validDate(endDate)) throw new Error(t("moveOutOfRange"));
  return { date, endDate: event.endDate ? endDate : undefined };
}
export function validateEventRange(event: Pick<ScheduleEvent, "date" | "endDate" | "startTime" | "endTime">): void {
  if (!validDate(event.date) || (event.endDate && !validDate(event.endDate))) throw new Error(t("validDatesRequired"));
  const end = event.endDate || event.date;
  if (end < event.date) throw new Error(t("endBeforeStart"));
  if (event.startTime && event.endTime && end === event.date && minutes(event.endTime) <= minutes(event.startTime)) {
    throw new Error(t("endTimeOrder"));
  }
}
