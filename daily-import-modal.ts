import { Modal, Notice } from "obsidian";
import type ScheduleManagerPlugin from "./main";
import { type DiaryScan, planDailyImport } from "./daily-import";
import { timeRange } from "./calendar";
import { errorMessage, t, uiLanguage } from "./i18n";
import { button, icon } from "./ui";

export class DailyImportModal extends Modal {
  private closed = false;
  private busy = false;
  private scan: DiaryScan | null = null;
  private results!: HTMLElement;
  private status!: HTMLElement;
  private scanButton!: HTMLButtonElement;
  private importButton!: HTMLButtonElement;

  constructor(private plugin: ScheduleManagerPlugin) { super(plugin.app); }

  onOpen(): void {
    this.closed = false;
    this.modalEl.lang = uiLanguage();
    this.modalEl.addClass("schedule-modal", "schedule-import-modal");
    const root = this.contentEl; root.empty();
    const header = root.createDiv("schedule-modal-header");
    icon(header, "calendar-arrow-down", "schedule-header-emblem");
    header.createEl("h2", { text: t("importCommand") });
    root.createEl("p", { text: t("importDescription"), cls: "schedule-muted" });
    root.createEl("p", { text: t("importLimits"), cls: "schedule-muted" });
    this.status = root.createDiv({ cls: "schedule-import-status", attr: { role: "status", "aria-live": "polite" } });
    this.results = root.createDiv("schedule-import-results");
    const actions = root.createDiv("schedule-import-actions");
    button(actions, t("cancel"), null, () => this.close());
    this.scanButton = button(actions, t("importScan"), "search", () => { void this.runScan(); });
    this.importButton = button(actions, t("importConfirm"), "download", () => { void this.runImport(); }, "schedule-primary");
    this.importButton.disabled = true;
  }

  private async runScan(): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.scan = null; this.results.empty();
    this.scanButton.disabled = true; this.importButton.disabled = true;
    try {
      const scan = await this.plugin.scanDailyNotes((done, total) => {
        if (!this.closed) this.status.setText(t("importScanning", { done, total }));
      });
      if (this.closed) return;
      this.scan = scan;
      this.showResults();
    } catch (error) {
      if (!this.closed) this.status.setText(t("importFailed", { error: errorMessage(error) }));
    } finally {
      this.busy = false;
      if (!this.closed) this.scanButton.disabled = false;
    }
  }

  private showResults(): void {
    if (!this.scan) return;
    const plan = planDailyImport(this.scan.candidates, this.plugin.data.events);
    const issues = [...this.scan.issues, ...plan.issues];
    this.results.empty();
    this.status.setText(t("importSummary", { files: this.scan.files, blocks: this.scan.blocks,
      count: plan.additions.length, duplicates: plan.duplicates, skipped: issues.length }));
    if (!plan.additions.length) this.results.createEl("p", { text: t("importEmpty"), cls: "schedule-muted" });
    const list = this.results.createDiv("schedule-import-list");
    for (const candidate of plan.additions.slice(0, 100)) {
      const row = list.createDiv("schedule-import-row");
      row.createEl("strong", { text: candidate.event.title });
      row.createDiv({ cls: "schedule-muted", text: `${candidate.event.date} · ${timeRange({ ...candidate.event, id: "" })}` });
      row.createDiv({ cls: "schedule-muted schedule-import-source", text: `${candidate.path}:${candidate.line}` });
    }
    if (plan.additions.length > 100) this.results.createEl("p", { text: t("importMore", { count: plan.additions.length - 100 }) });
    if (issues.length) {
      const details = this.results.createEl("details", { cls: "schedule-import-issues" });
      details.createEl("summary", { text: t("importIssues", { count: issues.length }) });
      const items = details.createEl("ul");
      for (const issue of issues.slice(0, 100)) items.createEl("li", { text: `${issue.path}${issue.line ? `:${issue.line}` : ""} — ${issue.reason}` });
      if (issues.length > 100) details.createEl("p", { text: t("importMore", { count: issues.length - 100 }) });
    }
    this.importButton.disabled = !plan.additions.length;
  }

  private async runImport(): Promise<void> {
    if (this.busy || !this.scan) return;
    this.busy = true; this.scanButton.disabled = true; this.importButton.disabled = true;
    try {
      // Recheck against current data inside the write queue in case an edit/pull followed the preview.
      const preview = planDailyImport(this.scan.candidates, this.plugin.data.events);
      const result = await this.plugin.importDailySchedules(preview.additions);
      new Notice(t("importSuccess", { count: result.additions.length, skipped: result.duplicates + result.issues.length }));
      this.close();
    } catch (error) {
      if (!this.closed) {
        this.showResults();
        this.status.setText(t("importFailed", { error: errorMessage(error) }));
      }
    } finally {
      this.busy = false;
      if (!this.closed) this.scanButton.disabled = false;
    }
  }

  onClose(): void { this.closed = true; this.contentEl.empty(); }
}
