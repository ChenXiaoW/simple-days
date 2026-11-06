import { t, formatDate, errorMessage, uiLanguage } from "./i18n";
import { Modal, Notice } from "obsidian";
import type ScheduleManagerPlugin from "./main";
import type { ScheduleDraft, ScheduleEvent } from "./main";
import { CATEGORIES, categoryOf, categoryLabel, dateKey, dayLabel, parseDate, validDate, timeRange, splitNames, endDateOf,
  validateEventRange, daysBetween, addDays } from "./calendar";
import { badge, button, icon } from "./ui";
import { MarkdownNotesEditor, MarkdownNotesPreview } from "./markdown-notes";

export class ScheduleEditorModal extends Modal {
  private form!: HTMLFormElement;
  private saving = false;
  private notesEditor: MarkdownNotesEditor | null = null;
  saved = false;
  get snapshotId(): string | null { return this.editingId; }
  constructor(private plugin: ScheduleManagerPlugin, private initial: ScheduleDraft,
    private editingId: string | null = null, private closed: () => void = () => {}) { super(plugin.app); }

  snapshot(): ScheduleDraft {
    if (!this.form) return this.initial;
    const value = (name: string) => (this.form.elements.namedItem(name) as HTMLInputElement).value;
    const allDay = (this.form.elements.namedItem("allDay") as HTMLInputElement).checked;
    return { title: value("title"), date: value("date"), endDate: value("endDate"), startTime: allDay ? "" : value("startTime"),
      endTime: allDay ? "" : value("endTime"), category: value("category") as ScheduleDraft["category"],
      location: value("location"), notes: value("notes"), tags: splitNames(value("tags")), participants: splitNames(value("participants")) };
  }

  onOpen(): void {
    this.modalEl.lang = uiLanguage();
    this.modalEl.addClass("schedule-modal", "schedule-editor-modal");
    const root = this.contentEl; root.empty();
    const header = root.createDiv("schedule-modal-header");
    icon(header, "calendar-plus", "schedule-header-emblem");
    const heading = header.createDiv("schedule-modal-heading");
    heading.createEl("h2", { text: this.editingId ? t("editEvent") : t("createEvent") });
    const subtitle = heading.createDiv("schedule-muted");
    const updateSubtitle = (date: string) => subtitle.setText(validDate(date) ? `${date.replace(/-/g, "/")} · ${dayLabel(parseDate(date))}` : t("selectDate"));
    updateSubtitle(this.initial.date);
    this.form = root.createEl("form", { cls: "schedule-form" });
    const field = (parent: HTMLElement, label: string, name: string, type: string, value: string, placeholder = "") => {
      const wrap = parent.createEl("label", { cls: "schedule-field" }); wrap.createSpan({ text: label });
      const input = wrap.createEl("input", { attr: { type, name, placeholder } }); input.value = value; return input;
    };
    const title = field(this.form, t("eventTitle"), "title", "text", this.initial.title, t("eventTitlePlaceholder"));
    title.required = true; title.maxLength = 200; title.addClass("schedule-title-input");
    const row = this.form.createDiv("schedule-form-grid");
    const date = field(row, t("startDate"), "date", "date", this.initial.date); date.required = true;
    const endDate = field(row, t("endDate"), "endDate", "date", endDateOf(this.initial)); endDate.required = true;
    let previousDate = this.initial.date;
    date.addEventListener("input", () => {
      updateSubtitle(date.value);
      if (validDate(date.value) && validDate(previousDate) && validDate(endDate.value)) {
        endDate.value = dateKey(addDays(parseDate(endDate.value), daysBetween(previousDate, date.value)));
      }
      if (validDate(date.value)) previousDate = date.value;
    });
    const timeField = this.form.createDiv("schedule-field");
    const timeLabel = timeField.createDiv("schedule-time-label"); timeLabel.createSpan({ text: t("time") });
    const toggle = timeLabel.createEl("label", { cls: "schedule-all-day" });
    const allDay = toggle.createEl("input", { attr: { type: "checkbox", name: "allDay" } });
    allDay.checked = !this.initial.startTime && !this.initial.endTime; toggle.createSpan({ text: t("allDay") });
    const times = timeField.createDiv("schedule-time-inputs");
    const start = times.createEl("input", { attr: { type: "time", name: "startTime", "aria-label": t("startTime") } });
    start.value = this.initial.startTime || "09:00";
    icon(times, "arrow-right");
    const end = times.createEl("input", { attr: { type: "time", name: "endTime", "aria-label": t("endTime") } });
    end.value = this.initial.endTime || "10:00";
    const changeAllDay = () => { start.disabled = end.disabled = allDay.checked; times.toggleClass("is-disabled", allDay.checked); };
    allDay.addEventListener("change", changeAllDay); changeAllDay();
    const row2 = this.form.createDiv("schedule-form-grid");
    const category = row2.createEl("label", { cls: "schedule-field" }); category.createSpan({ text: t("calendar") });
    const select = category.createEl("select", { attr: { name: "category", "aria-label": t("calendar") } });
    CATEGORIES.forEach(item => select.createEl("option", { text: item.label, value: item.id }));
    select.value = categoryOf(this.initial);
    field(row2, t("location"), "location", "text", this.initial.location, t("locationPlaceholder"));
    const row3 = this.form.createDiv("schedule-form-grid");
    field(row3, t("tags"), "tags", "text", (this.initial.tags ?? []).join(t("inputSeparator")), t("tagsPlaceholder"));
    field(row3, t("participants"), "participants", "text", (this.initial.participants ?? []).join(t("inputSeparator")), t("participantsPlaceholder"));
    this.notesEditor = new MarkdownNotesEditor(this.app, this.form, this.initial.notes);
    const sync = this.form.createDiv("schedule-sync-note"); icon(sync, "notebook-pen");
    sync.createSpan({ text: this.plugin.settings.dailyNotesEnabled ? t("syncAfterSave") : t("syncDisabledHint") });
    const error = this.form.createDiv("schedule-form-error"); error.setAttribute("role", "alert");
    const footer = this.form.createDiv("schedule-modal-footer");
    button(footer, t("cancel"), null, () => this.close());
    const save = button(footer, this.editingId ? t("saveChanges") : t("saveEvent"), "check", () => {}, "schedule-primary"); save.type = "submit";
    this.form.addEventListener("submit", evt => {
      evt.preventDefault();
      void this.submit(allDay, error, save);
    });
  }

  private async submit(allDay: HTMLInputElement, error: HTMLElement, save: HTMLButtonElement): Promise<void> {
    if (this.saving) return;
    const draft = this.snapshot(); draft.title = draft.title.trim(); draft.location = draft.location.trim();
    if (!draft.title || !validDate(draft.date)) { error.setText(t("titleDateRequired")); return; }
    try { validateEventRange(draft); }
    catch (cause) { error.setText(cause instanceof Error ? cause.message : String(cause)); return; }
    if (!allDay.checked && (!draft.startTime || !draft.endTime)) { error.setText(t("timesRequired")); return; }
    error.empty(); this.saving = true;
    const controls = Array.from(this.form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>("input,button,textarea,select"));
    const disabled = controls.map(control => control.disabled); controls.forEach(control => control.disabled = true);
    save.setText(t("saving"));
    try {
      if (this.editingId) await this.plugin.updateEvent(this.editingId, draft);
      else await this.plugin.addEvent(draft);
      this.saved = true; this.plugin.selectDate(parseDate(draft.date));
      new Notice(this.editingId ? t("eventUpdated") : t("eventCreated")); this.close();
    } catch (cause) {
      error.setText(t("saveFailed", { error: errorMessage(cause) }));
    } finally {
      this.saving = false; controls.forEach((control, index) => control.disabled = disabled[index]);
      save.setText(this.editingId ? t("saveChanges") : t("saveEvent"));
    }
  }
  onClose(): void { this.notesEditor?.destroy(); this.notesEditor = null; this.closed(); }
}

class DeleteScheduleModal extends Modal {
  constructor(private plugin: ScheduleManagerPlugin, private event: ScheduleEvent, private deleted: () => void) { super(plugin.app); }
  onOpen(): void {
    this.modalEl.lang = uiLanguage();
    this.modalEl.addClass("schedule-modal", "schedule-confirm-modal");
    this.contentEl.createEl("h2", { text: t("deleteConfirm") });
    this.contentEl.createEl("p", { text: t("deleteDescription", { title: this.event.title }) });
    const footer = this.contentEl.createDiv("schedule-modal-footer"); button(footer, t("cancel"), null, () => this.close());
    const remove = button(footer, t("deleteEvent"), "trash-2", () => {
      remove.disabled = true;
      void this.plugin.removeEvent(this.event.id).then(() => { this.deleted(); this.close(); new Notice(t("eventDeleted")); })
        .catch((error: unknown) => { new Notice(t("deleteFailed", { error: errorMessage(error) })); remove.disabled = false; });
    }, "schedule-danger");
  }
}

export class ScheduleDetailModal extends Modal {
  private notesPreview: MarkdownNotesPreview | null = null;
  constructor(private plugin: ScheduleManagerPlugin, private event: ScheduleEvent, private occurrenceDate = event.date) { super(plugin.app); }
  onOpen(): void { this.render(); }
  private render(): void {
    this.notesPreview?.clear(); this.notesPreview = null;
    const event = this.plugin.data.events.find(item => item.id === this.event.id);
    if (!event) { this.close(); return; } this.event = event;
    this.modalEl.lang = uiLanguage();
    this.modalEl.addClass("schedule-modal", "schedule-detail-modal");
    const root = this.contentEl; root.empty();
    const heading = root.createDiv(`schedule-detail-heading schedule-category-${categoryOf(event)}`);
    const accent = heading.createDiv("schedule-detail-accent");
    accent.setAttribute("aria-hidden", "true");
    const title = heading.createDiv("schedule-detail-heading-content");
    title.createEl("h2", { cls: "schedule-detail-title", text: event.title });
    const status = title.createDiv("schedule-detail-status"); badge(status, categoryLabel(event), categoryOf(event));
    if (event.completed) status.createSpan({ cls: "schedule-completed-label", text: t("completed") });
    const meta = root.createDiv("schedule-detail-meta");
    const info = (symbol: string, label: string, text: string) => {
      const row = meta.createDiv("schedule-detail-row"); icon(row, symbol); row.createSpan({ cls: "schedule-muted", text: label }); row.createSpan({ text });
    };
    const date = parseDate(event.date);
    info("calendar-days", t("date"), endDateOf(event) === event.date
      ? formatDate(date, { year: "numeric", month: "long", day: "numeric", weekday: "long" })
      : t("dateRange", { start: event.date, end: endDateOf(event) }));
    info("clock-3", t("time"), timeRange(event));
    if (event.location) info("map-pin", t("location"), event.location);
    if (event.participants?.length) info("users", t("participants"), event.participants.join(t("listSeparator")));
    if (event.tags?.length) {
      const tags = root.createDiv("schedule-detail-tags"); event.tags.forEach(tag => tags.createSpan({ cls: "schedule-tag", text: `#${tag}` }));
    }
    if (event.notes) {
      const notes = root.createDiv("schedule-detail-notes"); notes.createEl("h3", { text: t("notes") });
      this.notesPreview = new MarkdownNotesPreview(this.app, notes.createDiv(), async (notes, previous) => {
        await this.plugin.updateEventNotes(event.id, previous, notes);
        this.event = this.plugin.data.events.find(item => item.id === event.id) ?? this.event;
      });
      void this.notesPreview.render(event.notes);
    }
    const diary = root.createDiv("schedule-diary-link"); icon(diary, "notebook-pen");
    diary.createDiv().createSpan({ text: this.plugin.settings.dailyNotesEnabled ? t("syncedToDaily") : t("syncDisabled") });
    button(diary, t("openDailyNote"), "external-link", () => { void this.plugin.openDailyNote(this.occurrenceDate); });
    const footer = root.createDiv("schedule-detail-footer");
    const left = footer.createDiv("schedule-detail-secondary");
    button(left, t("delete"), "trash-2", () => new DeleteScheduleModal(this.plugin, event, () => this.close()).open(), "schedule-danger-text");
    button(left, t("duplicate"), "copy", () => {
      this.close(); const { id, completed, ...draft } = this.event;
      new ScheduleEditorModal(this.plugin, { ...draft, title: t("copyTitle", { title: event.title }) }).open();
    });
    const right = footer.createDiv("schedule-detail-primary");
    const complete = button(right, event.completed ? t("reopenEvent") : t("completeEvent"), "check-circle-2", () => {
      complete.disabled = true;
      void this.plugin.updateEvent(event.id, { completed: !event.completed }).then(() => this.render())
        .catch((error: unknown) => { new Notice(t("updateFailed", { error: errorMessage(error) })); complete.disabled = false; });
    });
    button(right, t("editEvent"), "pencil", () => {
      this.close(); new ScheduleEditorModal(this.plugin, { ...this.event }, event.id).open();
    }, "schedule-primary");
  }
  onClose(): void { this.notesPreview?.clear(); this.notesPreview = null; }
}

export function newDraft(date: Date, values: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return { title: "", date: dateKey(date), startTime: "09:00", endTime: "10:00", location: "", notes: "", category: "work", tags: [], participants: [], ...values };
}
