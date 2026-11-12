import { t, weekdayLabels, monthHeading, weekHeading, errorMessage } from "./i18n";
import { ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type ScheduleManagerPlugin from "./main";
import type { ScheduleDraft, ScheduleEvent } from "./main";
import { CATEGORIES, type CalendarMode, type Category, categoryOf, categoryLabel, dateKey, parseDate, validDate, addDays, addMonths,
  startOfWeek, weekNumber, dayLabel, timeRange, sortEvents, eventInterval, placeEvents, clockTime,
  occursOn, overlapsDates, isAllDay, endDateOf, dayTimeRange, durationInDates } from "./calendar";
import { EventDragController } from "./event-drag";
import { ScheduleEditorModal, ScheduleDetailModal, newDraft } from "./schedule-modals";
import { badge, button, icon } from "./ui";

export const VIEW_TYPE_SCHEDULE = "schedule-manager-view";
export class ScheduleView extends ItemView {
  selectedDate = new Date();
  viewMode: CalendarMode = "month";
  rootEl!: HTMLElement;
  private category: Category | "all" = "all";
  private zoom = 100;
  private editor: ScheduleEditorModal | null = null;
  private restore: { draft: ScheduleDraft; id: string | null } | null = null;
  private eventDrag: EventDragController;
  private overviewAction: HTMLElement | null = null;
  constructor(leaf: WorkspaceLeaf, public plugin: ScheduleManagerPlugin) {
    super(leaf); this.eventDrag = new EventDragController(plugin, date => this.selectDate(parseDate(date)));
  }
  getViewType(): string { return VIEW_TYPE_SCHEDULE; }
  getDisplayText(): string { return t("scheduleTitle"); }
  getIcon(): string { return "calendar-days"; }
  async onOpen(): Promise<void> {
    this.overviewAction = this.addAction("panel-right", t("openOverview"), () => {
      void this.plugin.toggleOverview().catch((error: unknown) => {
        new Notice(t("overviewToggleFailed", { error: errorMessage(error) }), 10000);
      });
    });
    this.updateOverviewAction();
    this.rootEl = this.contentEl; this.rootEl.addClass("schedule-manager-view"); this.render(); this.restoreEditor();
  }
  async onClose(): Promise<void> { this.overviewAction = null; this.eventDrag.dispose(); this.editor?.close(); this.rootEl?.empty(); }
  updateOverviewAction(): void {
    const open = this.plugin.isOverviewOpen();
    this.overviewAction?.setAttribute("aria-label", t(open ? "closeOverview" : "openOverview"));
    this.overviewAction?.setAttribute("aria-pressed", String(open));
    this.overviewAction?.toggleClass("is-active", open);
  }
  getState(): Record<string, unknown> {
    return { date: dateKey(this.selectedDate), viewMode: this.viewMode, category: this.category, zoom: this.zoom,
      editorVisible: !!this.editor || !!this.restore, editingId: this.editor?.snapshotId ?? this.restore?.id ?? null,
      draft: this.editor?.snapshot() ?? this.restore?.draft ?? null };
  }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (state && typeof state === "object") {
      const saved = state as Record<string, unknown>;
      if (typeof saved.date === "string" && validDate(saved.date)) this.selectedDate = parseDate(saved.date);
      this.viewMode = saved.viewMode === "week" ? "week" : "month";
      this.category = CATEGORIES.some(item => item.id === saved.category) ? saved.category as Category : "all";
      if (typeof saved.zoom === "number") this.zoom = Math.min(150, Math.max(75, saved.zoom));
      const draft = saved.draft as ScheduleDraft | null;
      if (saved.editorVisible && draft && ["title", "date", "startTime", "endTime", "location", "notes"].every(key => typeof draft[key as keyof ScheduleDraft] === "string")) {
        this.restore = { draft, id: typeof saved.editingId === "string" ? saved.editingId : null };
      }
      this.render(); this.restoreEditor();
    }
    await super.setState(state, result);
  }
  private restoreEditor(): void {
    if (!this.rootEl || !this.restore || this.editor) return;
    const restored = this.restore; this.restore = null; this.showEditor(restored.draft, restored.id);
  }
  private showEditor(draft: ScheduleDraft, id: string | null): void {
    this.editor?.close();
    this.editor = new ScheduleEditorModal(this.plugin, draft, id, () => { this.editor = null; }); this.editor.open();
  }
  openEditor(event?: ScheduleEvent, values: Partial<ScheduleDraft> = {}): void {
    this.showEditor(event ? { ...event } : newDraft(this.selectedDate, values), event?.id ?? null);
  }
  selectDate(date: Date): void { this.plugin.selectDate(date); }
  applySelectedDate(date: Date): void {
    const sameMonth = this.selectedDate.getFullYear() === date.getFullYear() && this.selectedDate.getMonth() === date.getMonth();
    this.selectedDate = new Date(date);
    const calendar = this.rootEl?.querySelector<HTMLElement>(".schedule-month");
    if (this.viewMode !== "month" || !sameMonth || !calendar) { this.render(); return; }
    // Keep the grid in place so a second click can still trigger double-click creation.
    calendar.querySelectorAll<HTMLElement>(".schedule-month-cell").forEach(cell => {
      const selected = cell.dataset.date === dateKey(date);
      cell.toggleClass("is-selected", selected);
      cell.querySelector(".schedule-date-button")?.setAttribute("aria-pressed", String(selected));
    });
    const content = this.rootEl.querySelector<HTMLElement>(".schedule-view-content");
    if (content) {
      content.querySelector(".schedule-agenda")?.remove(); this.renderAgenda(content);
    }
  }
  private events(): ScheduleEvent[] {
    return sortEvents(this.plugin.data.events.filter(event => this.category === "all" || categoryOf(event) === this.category));
  }
  private forDate(date: string): ScheduleEvent[] { return this.events().filter(event => occursOn(event, date)); }
  render(): void {
    if (!this.rootEl) return;
    const scroll = this.rootEl.scrollTop;
    this.rootEl.empty();
    const shell = this.rootEl.createDiv("schedule-shell");
    const top = shell.createDiv("schedule-topbar"); this.renderHeader(top); this.renderToolbar(top);
    const content = shell.createDiv("schedule-view-content");
    if (this.viewMode === "month") this.renderMonth(content); else this.renderWeek(content);
    this.renderLegend(content); this.renderAgenda(content); this.rootEl.scrollTop = scroll;
  }
  private renderHeader(parent: HTMLElement): void {
    const header = parent.createDiv("schedule-header");
    const heading = header.createDiv("schedule-title-wrap");
    const title = heading.createDiv("schedule-heading-line");
    const start = startOfWeek(this.selectedDate); const end = addDays(start, 6);
    title.createEl("h2", { text: this.viewMode === "month" ? monthHeading(this.selectedDate)
      : weekHeading(start, end), attr: { "aria-live": "polite" } });
    badge(title, this.viewMode === "week" ? t("weekNumber", { week: weekNumber(this.selectedDate) }) : t("year", { year: this.selectedDate.getFullYear() }), "work");
    const month = dateKey(this.selectedDate).slice(0, 7);
    const from = this.viewMode === "month" ? `${month}-01` : dateKey(start);
    const to = this.viewMode === "month" ? dateKey(new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth() + 1, 0)) : dateKey(end);
    const period = this.events().filter(event => overlapsDates(event, from, to));
    const hours = period.reduce((total, event) => total + durationInDates(event, from, to), 0);
    heading.createDiv("schedule-current-date").setText(t("periodSummary", { view: this.viewMode === "month" ? t("monthSummary") : t("weekSummary"), count: period.length, hours: Number(hours.toFixed(1)) }));
    const actions = header.createDiv("schedule-header-actions");
    const move = (direction: number) => this.selectDate(this.viewMode === "month" ? addMonths(this.selectedDate, direction) : addDays(this.selectedDate, direction * 7));
    const previous = button(actions, t("previous"), "chevron-left", () => move(-1), "schedule-icon-only");
    this.eventDrag.pageTarget(previous, () => move(-1));
    button(actions, t("today"), "locate-fixed", () => this.selectDate(new Date()), "schedule-today-button");
    const next = button(actions, t("next"), "chevron-right", () => move(1), "schedule-icon-only");
    this.eventDrag.pageTarget(next, () => move(1));
    button(actions, t("new"), "plus", () => this.openEditor(), "schedule-primary schedule-add-button");
  }
  private renderToolbar(parent: HTMLElement): void {
    const toolbar = parent.createDiv("schedule-view-toolbar");
    const group = toolbar.createDiv("schedule-view-switch"); group.setAttribute("role", "group"); group.setAttribute("aria-label", t("calendarView"));
    ([{ mode: "month", label: t("monthView"), icon: "calendar-days" }, { mode: "week", label: t("weekView"), icon: "calendar-range" }] as const).forEach(item => {
      const toggle = button(group, item.label, item.icon, () => {
        if (this.viewMode === item.mode) return;
        this.viewMode = item.mode;
        if (!this.plugin.isMainLeaf(this.leaf)) { void this.plugin.activateView(false, this.leaf); return; }
        this.render(); this.rootEl.querySelector<HTMLButtonElement>(`[data-mode="${item.mode}"]`)?.focus({ preventScroll: true });
      });
      toggle.dataset.mode = item.mode; toggle.setAttribute("aria-pressed", String(this.viewMode === item.mode));
    });
    const tools = toolbar.createDiv("schedule-view-tools");
    const zoom = tools.createDiv("schedule-zoom"); zoom.toggleClass("is-hidden", this.viewMode !== "week");
    zoom.setAttribute("aria-hidden", String(this.viewMode !== "week"));
    button(zoom, t("zoomOut"), "minus", () => { this.zoom = Math.max(75, this.zoom - 25); this.render(); }, "schedule-icon-only").disabled = this.zoom <= 75;
    zoom.createSpan({ text: `${this.zoom}%` });
    button(zoom, t("zoomIn"), "plus", () => { this.zoom = Math.min(150, this.zoom + 25); this.render(); }, "schedule-icon-only").disabled = this.zoom >= 150;
    const filter = tools.createEl("select", { cls: "schedule-filter", attr: { "aria-label": t("filterCalendars") } });
    filter.createEl("option", { text: t("allCalendars"), value: "all" });
    CATEGORIES.forEach(item => filter.createEl("option", { text: item.label, value: item.id })); filter.value = this.category;
    filter.addEventListener("change", () => { this.category = filter.value as typeof this.category; this.render(); });
  }
  private renderMonth(parent: HTMLElement): void {
    const calendar = parent.createDiv("schedule-month");
    const weekdays = calendar.createDiv("schedule-month-weekdays");
    weekdayLabels().forEach((day, index) => weekdays.createSpan({ cls: index > 4 ? "is-weekend" : "", text: day }));
    const grid = calendar.createDiv("schedule-month-grid");
    const first = startOfWeek(new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), 1));
    const today = dateKey(new Date());
    const daysInMonth = new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth() + 1, 0).getDate();
    const offset = (new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), 1).getDay() + 6) % 7;
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
    for (let index = 0; index < cells; index++) {
      const date = addDays(first, index); const key = dateKey(date); const events = this.forDate(key);
      const cell = grid.createDiv("schedule-month-cell"); cell.dataset.date = key;
      this.eventDrag.dropTarget(cell, key);
      cell.toggleClass("is-outside", date.getMonth() !== this.selectedDate.getMonth());
      cell.toggleClass("is-selected", key === dateKey(this.selectedDate)); cell.toggleClass("is-today", key === today); cell.toggleClass("is-weekend", index % 7 > 4);
      const cellHeader = cell.createDiv("schedule-cell-header");
      const day = button(cellHeader, String(date.getDate()), null, () => this.selectDate(date), "schedule-date-button");
      day.setAttribute("aria-label", t("dateCell", { date: key, today: key === today ? ` ${t("today")}` : "", count: events.length }));
      day.setAttribute("aria-pressed", String(key === dateKey(this.selectedDate)));
      if (key === today) day.setAttribute("aria-current", "date");
      if (key === today) cellHeader.createSpan({ cls: "schedule-today-label", text: t("today") });
      events.slice(0, 3).forEach(event => this.eventChip(cell, event, key));
      if (events.length > 3) button(cell, t("moreEvents", { count: events.length - 3 }), null, () => {
        this.selectDate(date); this.rootEl.querySelector(".schedule-agenda")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, "schedule-overflow");
      cell.addEventListener("click", evt => {
        if ((evt.target as HTMLElement).closest("button")) return;
        this.selectDate(date);
      });
      cell.addEventListener("dblclick", evt => {
        if ((evt.target as HTMLElement).closest("button")) return;
        this.openEditor(undefined, { date: key });
      });
    }
  }
  private eventChip(parent: HTMLElement, event: ScheduleEvent, date = event.date): void {
    const chip = button(parent, event.title, null, () => new ScheduleDetailModal(this.plugin, event, date).open(), `schedule-event-chip schedule-category-${categoryOf(event)}`);
    chip.empty(); chip.toggleClass("is-completed", event.completed);
    chip.createSpan({ cls: "schedule-chip-dot" });
    if (endDateOf(event) !== event.date) chip.createSpan({ cls: "schedule-chip-time", text: date === event.date ? t("multiDay") : t("continued") });
    else if (event.startTime) chip.createSpan({ cls: "schedule-chip-time", text: event.startTime });
    chip.createSpan({ cls: "schedule-chip-title", text: event.title });
    chip.setAttribute("aria-label", `${categoryLabel(event)} · ${timeRange(event)} · ${event.title}${event.completed ? ` · ${t("completed")}` : ""}`);
    chip.title = `${timeRange(event)} ${event.title}`;
    this.eventDrag.draggable(chip, event, date);
  }
  private renderWeek(parent: HTMLElement): void {
    const first = startOfWeek(this.selectedDate); const last = dateKey(addDays(first, 6));
    const events = this.events().filter(event => overlapsDates(event, dateKey(first), last));
    const timed = events.filter(event => !isAllDay(event));
    const intervals = Array.from({ length: 7 }, (_, index) => dateKey(addDays(first, index)))
      .reduce<{ start: number; end: number }[]>((all, date) => all.concat(timed.filter(event => occursOn(event, date)).map(event => eventInterval(event, date))), []);
    const startHour = Math.min(8, ...intervals.map(item => Math.floor(item.start / 60)));
    const endHour = Math.max(20, ...intervals.map(item => Math.ceil(item.end / 60)));
    const hourHeight = 64 * this.zoom / 100;
    const viewport = parent.createDiv("schedule-week-viewport"); viewport.setAttribute("aria-label", t("weekTimeline"));
    const week = viewport.createDiv("schedule-week");
    const head = week.createDiv("schedule-week-head");
    const offset = -new Date().getTimezoneOffset();
    const zone = `GMT${offset >= 0 ? "+" : "−"}${Math.floor(Math.abs(offset) / 60)}${Math.abs(offset) % 60 ? `:${String(Math.abs(offset) % 60).padStart(2, "0")}` : ""}`;
    head.createDiv("schedule-timezone").setText(zone);
    const allDay = week.createDiv("schedule-all-day-row"); allDay.createDiv("schedule-timezone").setText(t("allDay"));
    const body = week.createDiv("schedule-week-body"); body.style.height = `${(endHour - startHour) * hourHeight}px`;
    const gutter = body.createDiv("schedule-time-gutter");
    for (let hour = startHour; hour < endHour; hour++) {
      const label = gutter.createSpan({ cls: "schedule-time-tick", text: `${String(hour).padStart(2, "0")}:00` }); label.style.top = `${(hour - startHour) * hourHeight}px`;
    }
    for (let index = 0; index < 7; index++) {
      const date = addDays(first, index); const key = dateKey(date); const isToday = key === dateKey(new Date());
      const dayHead = button(head, "", null, () => this.selectDate(date), "schedule-week-day-heading");
      dayHead.setAttribute("aria-label", dayLabel(date)); dayHead.toggleClass("is-today", isToday); dayHead.toggleClass("is-selected", key === dateKey(this.selectedDate));
      dayHead.createSpan({ text: weekdayLabels()[index] }); dayHead.createEl("strong", { text: String(date.getDate()) });
      const allDayCell = allDay.createDiv("schedule-all-day-cell"); allDayCell.toggleClass("is-today", isToday);
      this.eventDrag.dropTarget(dayHead, key); this.eventDrag.dropTarget(allDayCell, key);
      const dailyAll = events.filter(event => occursOn(event, key) && isAllDay(event));
      dailyAll.forEach(event => this.eventChip(allDayCell, event, key));
      button(allDayCell, t("addAllDay"), "plus", () => this.openEditor(undefined, { date: key, startTime: "", endTime: "" }), "schedule-all-day-add schedule-icon-only");
      const column = body.createDiv("schedule-day-column"); column.dataset.date = key; column.toggleClass("is-today", isToday);
      this.eventDrag.dropTarget(column, key);
      for (let half = startHour * 2; half < endHour * 2; half++) {
        const minute = half * 30;
        const slot = button(column, t("createAtTime", { date: dayLabel(date), time: clockTime(minute) }), null, () => {}, "schedule-time-slot");
        slot.empty();
        slot.style.height = `${hourHeight / 2}px`; slot.dataset.minute = String(minute);
        slot.addEventListener("click", evt => {
          if (evt.detail === 0 || (evt.instanceOf(PointerEvent) && evt.pointerType === "touch")) {
            this.openEditor(undefined, { date: key, startTime: clockTime(minute), endTime: clockTime(minute + 60) });
          }
        });
      }
      this.enableDrag(column, key, startHour, hourHeight, endHour);
      placeEvents(timed.filter(event => occursOn(event, key)), key).forEach(item => {
        const block = button(column, "", null, () => new ScheduleDetailModal(this.plugin, item.event, key).open(), `schedule-time-event schedule-category-${categoryOf(item.event)}`);
        block.toggleClass("is-completed", item.event.completed); block.style.top = `${(item.start / 60 - startHour) * hourHeight}px`;
        block.style.height = `${Math.max(Math.min(27, hourHeight / 2 - 3), (item.end - item.start) / 60 * hourHeight - 3)}px`;
        block.style.left = `calc(${item.lane / item.lanes * 100}% + 3px)`; block.style.width = `calc(${100 / item.lanes}% - 6px)`;
        block.createEl("strong", { text: item.event.title }); block.createSpan({ text: dayTimeRange(item.event, key) });
        if (item.event.location) block.createSpan({ cls: "schedule-event-location", text: item.event.location });
        block.setAttribute("aria-label", `${categoryLabel(item.event)} · ${item.event.title} · ${timeRange(item.event)}`);
        block.title = `${item.event.title}\n${timeRange(item.event)}`;
        this.eventDrag.draggable(block, item.event, key);
      });
      if (isToday) {
        const now = new Date(); const minute = now.getHours() * 60 + now.getMinutes();
        if (minute >= startHour * 60 && minute < endHour * 60) {
          const line = column.createDiv("schedule-now-line"); line.style.top = `${(minute / 60 - startHour) * hourHeight}px`; line.setAttribute("aria-label", t("currentTime", { time: clockTime(minute) }));
        }
      }
    }
  }
  private enableDrag(column: HTMLElement, date: string, startHour: number, height: number, endHour: number): void {
    let start: number | null = null; let preview: HTMLElement | null = null;
    const position = (evt: PointerEvent) => Math.min(endHour * 60 - 30, Math.max(startHour * 60, Math.floor((evt.clientY - column.getBoundingClientRect().top) / height * 2) * 30 + startHour * 60));
    const range = (evt: PointerEvent) => { const current = position(evt); return { from: Math.min(start!, current), to: Math.max(start!, current) + 30 }; };
    column.addEventListener("pointerdown", evt => {
      if (evt.button !== 0 || evt.pointerType === "touch" || !(evt.target as HTMLElement).closest(".schedule-time-slot")) return;
      evt.preventDefault(); start = position(evt); column.setPointerCapture(evt.pointerId); preview = column.createDiv("schedule-drag-preview");
      preview.style.top = `${(start / 60 - startHour) * height}px`; preview.style.height = `${height / 2}px`;
    });
    column.addEventListener("pointermove", evt => {
      if (start === null || !preview) return; const { from, to } = range(evt);
      preview.style.top = `${(from / 60 - startHour) * height}px`; preview.style.height = `${(to - from) / 60 * height}px`; preview.setText(`${clockTime(from)} – ${clockTime(to)}`);
    });
    column.addEventListener("pointerup", evt => {
      if (start === null) return; const { from, to } = range(evt); start = null; preview?.remove(); preview = null;
      if (column.hasPointerCapture(evt.pointerId)) column.releasePointerCapture(evt.pointerId);
      this.openEditor(undefined, { date, startTime: clockTime(from), endTime: clockTime(to) });
    });
    column.addEventListener("pointercancel", () => { start = null; preview?.remove(); preview = null; });
  }
  private renderLegend(parent: HTMLElement): void {
    const footer = parent.createDiv("schedule-calendar-footer"); const legend = footer.createDiv("schedule-legend");
    CATEGORIES.forEach(item => { const label = legend.createSpan({ cls: `schedule-legend-item schedule-category-${item.id}` }); label.createSpan({ cls: "schedule-chip-dot" }); label.createSpan({ text: item.label }); });
    footer.createSpan({ cls: "schedule-muted schedule-calendar-hint", text: this.viewMode === "week" ? t("weekHint") : t("monthHint") });
  }
  private renderAgenda(parent: HTMLElement): void {
    const agenda = parent.createDiv("schedule-agenda"); const header = agenda.createDiv("schedule-agenda-header");
    const heading = header.createDiv(); heading.createEl("h3", { text: dayLabel(this.selectedDate, this.plugin.settings.dateFormat === "long") });
    const events = this.forDate(dateKey(this.selectedDate)); heading.createSpan({ cls: "schedule-muted", text: t("agendaCount", { count: events.length }) });
    const actions = header.createDiv("schedule-agenda-actions");
    button(actions, t("openDailyNote"), "notebook-pen", () => { void this.plugin.openDailyNote(dateKey(this.selectedDate)); });
    button(actions, t("createEvent"), "plus", () => this.openEditor());
    if (!events.length) {
      const empty = agenda.createDiv("schedule-agenda-empty"); icon(empty, "coffee"); empty.createSpan({ text: this.category === "all" ? t("agendaEmpty") : t("categoryEmpty") });
    }
    events.forEach(event => {
      const row = button(agenda, "", null, () => new ScheduleDetailModal(this.plugin, event, dateKey(this.selectedDate)).open(), "schedule-agenda-row");
      row.createSpan({ cls: "schedule-agenda-time", text: dayTimeRange(event, dateKey(this.selectedDate)) });
      const title = row.createEl("strong", { text: event.title }); title.toggleClass("is-completed", event.completed);
      badge(row, categoryLabel(event), categoryOf(event)); icon(row, "chevron-right");
      row.setAttribute("aria-label", `${event.title} ${timeRange(event)}`);
    });
  }
}
