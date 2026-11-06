import { t, formatDate } from "./i18n";
import { ItemView, type WorkspaceLeaf, type ViewStateResult } from "obsidian";
import type ScheduleManagerPlugin from "./main";
import type { ScheduleEvent } from "./main";
import { addDays, dateKey, parseDate, validDate, weekNumber, sortEvents, startOfWeek, categoryOf, categoryLabel, timeRange,
  occursOn, overlapsDates, dayTimeRange } from "./calendar";
import { ScheduleEditorModal, ScheduleDetailModal, newDraft } from "./schedule-modals";
import { badge, button, icon } from "./ui";
export const VIEW_TYPE_OVERVIEW = "schedule-manager-overview";
export class OverviewView extends ItemView {
  selectedDate = new Date();
  constructor(leaf: WorkspaceLeaf, public plugin: ScheduleManagerPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_OVERVIEW; }
  getDisplayText(): string { return t("overviewTitle"); }
  getIcon(): string { return "calendar-check"; }
  getState(): Record<string, unknown> { return { date: dateKey(this.selectedDate) }; }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const date = (state as {date?: string} | null)?.date;
    if (date && validDate(date)) this.selectedDate = parseDate(date);
    this.render(); await super.setState(state, result);
  }
  async onOpen(): Promise<void> {
    this.addAction("panel-top", t("openCalendarTab"), () => { void this.plugin.activateView().then(() => this.plugin.selectDate(this.selectedDate)); });
    this.contentEl.addClass("schedule-overview"); this.render();
  }
  async onClose(): Promise<void> { this.contentEl.empty(); }
  render(): void {
    const root = this.contentEl; root.empty();
    const header = root.createDiv("schedule-overview-header"); const heading = header.createDiv();
    const dateHeading = heading.createDiv("schedule-overview-date");
    dateHeading.createEl("h2", { text: formatDate(this.selectedDate, { month: "long", day: "numeric" }) });
    if (dateKey(this.selectedDate) === dateKey(new Date())) badge(dateHeading, t("today"), "work");
    heading.createSpan({ cls: "schedule-muted", text: `${formatDate(this.selectedDate, { weekday: "long" })} · ${t("weekNumber", { week: weekNumber(this.selectedDate) })}` });
    button(header, t("openDailyNote"), "notebook-pen", () => { void this.plugin.openDailyNote(dateKey(this.selectedDate)); });
    const nav = root.createDiv("schedule-overview-nav");
    button(nav, t("previousDay"), "chevron-left", () => this.plugin.selectDate(addDays(this.selectedDate, -1)), "schedule-icon-only");
    button(nav, t("today"), null, () => this.plugin.selectDate(new Date()));
    button(nav, t("nextDay"), "chevron-right", () => this.plugin.selectDate(addDays(this.selectedDate, 1)), "schedule-icon-only");
    const date = dateKey(this.selectedDate); const day = sortEvents(this.plugin.data.events.filter(event => occursOn(event, date)));
    if (!day.length) {
      const empty = root.createDiv("schedule-overview-empty"); icon(empty, "coffee"); empty.createEl("strong", { text: t("overviewEmpty") });
      empty.createSpan({ cls: "schedule-muted", text: t("planNext") });
      button(empty, t("createEvent"), "plus", () => new ScheduleEditorModal(this.plugin, newDraft(this.selectedDate)).open(), "schedule-primary");
    } else {
      const section = root.createDiv("schedule-section-header");
      section.createEl("h3", { cls: "schedule-section-heading", text: t("dayAgenda", { count: day.length }) });
      button(section, t("createEvent"), "plus", () => new ScheduleEditorModal(this.plugin, newDraft(this.selectedDate)).open(), "schedule-icon-only");
      day.forEach(event => this.renderEvent(root, event, false));
    }
    const last = dateKey(new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth() + 1, 0));
    const month = this.plugin.data.events.filter(event => overlapsDates(event, `${date.slice(0, 7)}-01`, last));
    const stats = root.createDiv("schedule-overview-stats");
    [{ label: t("monthEvents"), count: month.length }, { label: t("pending"), count: month.filter(event => !event.completed).length }, { label: t("completed"), count: month.filter(event => event.completed).length }].forEach(item => {
      const stat = stats.createDiv(); stat.createEl("strong", { text: String(item.count) }); stat.createSpan({ text: item.label });
    });
    const end = dateKey(addDays(startOfWeek(this.selectedDate), 6));
    const upcoming = sortEvents(this.plugin.data.events.filter(event => event.date > date && event.date <= end && !event.completed));
    const section = root.createDiv("schedule-section-header"); section.createEl("h3", { text: t("upcoming") }); section.createSpan({ cls: "schedule-count", text: String(upcoming.length) });
    if (upcoming.length) upcoming.forEach(event => this.renderEvent(root, event, true));
    else root.createDiv("schedule-overview-upcoming-empty").setText(t("upcomingEmpty"));
  }
  private renderEvent(parent: HTMLElement, event: ScheduleEvent, showDate: boolean): void {
    const row = button(parent, "", null, () => new ScheduleDetailModal(this.plugin, event, showDate ? event.date : dateKey(this.selectedDate)).open(), `schedule-overview-event schedule-category-${categoryOf(event)}`);
    row.createSpan({ cls: "schedule-overview-event-bar" }); const body = row.createDiv();
    const title = body.createEl("strong", { text: event.title }); title.toggleClass("is-completed", event.completed);
    body.createSpan({ cls: "schedule-muted", text: showDate ? timeRange(event) : dayTimeRange(event, dateKey(this.selectedDate)) });
    badge(row, categoryLabel(event), categoryOf(event)); row.setAttribute("aria-label", `${event.title} ${event.date} ${timeRange(event)}`);
  }
}
