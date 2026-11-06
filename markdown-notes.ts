import { t, errorMessage } from "./i18n";
import { App, Component, MarkdownRenderer, Modal, Notice } from "obsidian";
import { button, icon } from "./ui";
import { markdownTaskOffsets } from "./markdown-tasks";

/** Each render owns its embeds and post-processors until it is replaced or closed. */
export class MarkdownNotesPreview {
  private component: Component | null = null;
  constructor(private app: App, private root: HTMLElement,
    private saveTasks?: (markdown: string, previous: string) => Promise<void>) {
    root.addClass("schedule-markdown", "markdown-rendered");
    root.addEventListener("click", event => {
      const link = (event.target as Element).closest<HTMLAnchorElement>("a.internal-link");
      const path = link?.getAttribute("data-href") ?? link?.getAttribute("href");
      if (!path) return;
      event.preventDefault(); event.stopPropagation();
      // Notes belong to an event rather than a Markdown file; resolve links from the vault root.
      void this.app.workspace.openLinkText(path, "", event.ctrlKey || event.metaKey)
        .catch((error: unknown) => new Notice(t("openLinkFailed", { error: errorMessage(error) })));
    });
  }

  clear(): void {
    this.component?.unload(); this.component = null;
    this.root.empty(); this.root.removeAttribute("aria-busy");
  }

  async render(markdown: string): Promise<void> {
    this.clear();
    if (!markdown.trim()) {
      this.root.createDiv({ cls: "schedule-notes-empty", text: t("notesEmpty") });
      return;
    }
    const owner = new Component(); this.component = owner; owner.load();
    const content = this.root.createDiv("schedule-markdown-content");
    this.root.setAttribute("aria-busy", "true");
    try {
      await MarkdownRenderer.render(this.app, markdown, content, "", owner);
      if (this.component !== owner) { owner.unload(); return; }
      this.bindTasks(content, markdown, owner);
    } catch {
      if (this.component !== owner) { owner.unload(); return; }
      owner.unload(); this.component = null; content.empty();
      content.createDiv({ cls: "schedule-muted", text: t("previewFailed") });
      content.createEl("pre", { text: markdown });
    } finally {
      if (this.component === owner || this.component === null) this.root.removeAttribute("aria-busy");
    }
  }

  private bindTasks(content: HTMLElement, markdown: string, owner: Component): void {
    const inputs = Array.from(content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    inputs.forEach(input => input.disabled = true);
    if (!this.saveTasks) return;
    // Embedded notes and raw HTML inputs do not belong to this event's Markdown.
    const tasks = inputs.filter(input => input.closest("li.task-list-item")
      && !input.closest(".internal-embed,.markdown-embed"));
    const offsets = markdownTaskOffsets(markdown);
    // A renderer extension may change the task structure. Never risk editing another line.
    if (tasks.length !== offsets.length) return;
    let source = markdown;
    let saving = false;
    tasks.forEach(input => input.disabled = false);
    content.addEventListener("click", event => {
      const input = event.target as HTMLInputElement;
      const index = tasks.indexOf(input);
      if (index === -1) return;
      // Handle persistence here instead of Obsidian's file-based checkbox click handler.
      event.stopImmediatePropagation();
      if (saving || this.component !== owner) return;
      const previous = source;
      const checked = input.checked;
      const wasChecked = previous[offsets[index]].toLowerCase() === "x";
      if (checked === wasChecked) return;
      const next = previous.slice(0, offsets[index]) + (checked ? "x" : " ") + previous.slice(offsets[index] + 1);
      saving = true;
      tasks.forEach(task => task.disabled = true);
      this.root.setAttribute("aria-busy", "true");
      void (async () => {
        try {
          await this.saveTasks!(next, previous);
          source = next;
          if (this.component !== owner) return;
          const item = input.closest("li.task-list-item");
          item?.classList.toggle("is-checked", checked);
          item?.setAttribute("data-task", checked ? "x" : " ");
        } catch (error) {
          input.checked = wasChecked;
          new Notice(t("saveTaskFailed", { error: errorMessage(error) }));
        } finally {
          saving = false;
          if (this.component === owner) {
            tasks.forEach(task => task.disabled = false);
            this.root.removeAttribute("aria-busy");
          }
        }
      })();
    }, true);
  }
}

let editorId = 0;
export class MarkdownNotesEditor {
  readonly input: HTMLTextAreaElement;
  private preview: MarkdownNotesPreview;
  private previewMode = false;
  private expanded: ExpandedNotesModal | null = null;

  constructor(private app: App, parent: HTMLElement, value: string, expanded = false,
    private changed: (value: string) => void = () => {}) {
    const id = `schedule-notes-${++editorId}`;
    const field = parent.createDiv("schedule-field schedule-notes-field");
    const label = field.createDiv("schedule-notes-label");
    label.createEl("label", { text: t("notes"), attr: { for: id } });
    label.createSpan({ cls: "schedule-muted", text: "Markdown" });
    const panel = field.createDiv("schedule-notes-panel");
    const toolbar = panel.createDiv("schedule-notes-toolbar");
    const modes = toolbar.createDiv("schedule-notes-modes");
    modes.setAttribute("role", "group"); modes.setAttribute("aria-label", t("notesMode"));
    const edit = button(modes, t("edit"), "pencil", () => setMode(false));
    const view = button(modes, t("preview"), "eye", () => setMode(true));
    if (!expanded) {
      const expand = button(toolbar, t("expandNotes"), "maximize-2", () => this.expand(), "schedule-notes-expand");
      expand.title = t("expandNotesTitle");
    }
    this.input = panel.createEl("textarea", { cls: "schedule-notes-input", attr: {
      id, name: "notes", rows: "6", "aria-label": t("notesMarkdown"),
      placeholder: t("notesPlaceholder"), spellcheck: "false",
    } });
    this.input.value = value;
    const previewEl = panel.createDiv("schedule-notes-preview");
    previewEl.setAttribute("role", "region"); previewEl.setAttribute("aria-label", t("notesPreview"));
    this.preview = new MarkdownNotesPreview(app, previewEl);
    const setMode = (preview: boolean) => {
      this.previewMode = preview;
      this.input.hidden = preview; previewEl.hidden = !preview;
      edit.setAttribute("aria-pressed", String(!preview)); view.setAttribute("aria-pressed", String(preview));
      if (preview) void this.preview.render(this.input.value);
      else this.preview.clear();
    };
    setMode(false);
    this.input.addEventListener("input", () => this.changed(this.input.value));
    field.createDiv({ cls: "schedule-notes-hint", text: expanded
      ? t("expandedHint") : t("resizeHint") });
  }

  private expand(): void {
    if (this.expanded) return;
    const start = this.input.selectionStart, end = this.input.selectionEnd;
    this.expanded = new ExpandedNotesModal(this.app, this.input.value, value => {
      this.input.value = value; this.changed(value);
    }, () => {
      this.expanded = null;
      if (this.previewMode) void this.preview.render(this.input.value);
    }, start, end);
    this.expanded.open();
  }

  destroy(): void {
    this.expanded?.close(); this.expanded = null; this.preview.clear();
  }
}

class ExpandedNotesModal extends Modal {
  private editor: MarkdownNotesEditor | null = null;
  constructor(app: App, private value: string, private changed: (value: string) => void,
    private closed: () => void, private selectionStart: number, private selectionEnd: number) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("schedule-modal", "schedule-notes-modal");
    const header = this.contentEl.createDiv("schedule-modal-header");
    icon(header, "notebook-pen", "schedule-header-emblem");
    const heading = header.createDiv("schedule-modal-heading");
    heading.createEl("h2", { text: t("editNotes") });
    heading.createDiv({ cls: "schedule-muted", text: t("notesSubtitle") });
    this.editor = new MarkdownNotesEditor(this.app, this.contentEl, this.value, true, this.changed);
    const footer = this.contentEl.createDiv("schedule-modal-footer");
    button(footer, t("collapse"), "minimize-2", () => this.close(), "schedule-primary");
    this.editor.input.focus(); this.editor.input.setSelectionRange(this.selectionStart, this.selectionEnd);
  }

  onClose(): void {
    if (this.editor) this.changed(this.editor.input.value);
    this.editor?.destroy(); this.editor = null; this.closed();
  }
}
