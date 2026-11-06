import { t, errorMessage } from "./i18n";
import { Notice } from "obsidian";
import type ScheduleManagerPlugin from "./main";
import type { ScheduleEvent } from "./main";
import { occursOn, validDate } from "./calendar";

interface DraggedEvent { id: string; date: string }
const DRAG_TYPE = "application/x-obsidian-schedule";

export class EventDragController {
  private dragging: DraggedEvent | null = null;
  private pagingTimer: number | null = null;
  private moving = false;
  private suppressClickUntil = 0;
  constructor(private plugin: ScheduleManagerPlugin, private selected: (date: string) => void) {}

  draggable(element: HTMLElement, event: ScheduleEvent, date: string): void {
    element.draggable = true; element.dataset.eventId = event.id;
    element.addClass("schedule-draggable");
    element.addEventListener("dragstart", evt => {
      if (!evt.dataTransfer || this.moving) { evt.preventDefault(); return; }
      this.dragging = { id: event.id, date };
      evt.dataTransfer.setData(DRAG_TYPE, JSON.stringify(this.dragging));
      evt.dataTransfer.effectAllowed = "move"; element.addClass("schedule-dragging");
    });
    element.addEventListener("dragend", () => {
      element.removeClass("schedule-dragging"); this.dragging = null;
      this.suppressClickUntil = Date.now() + 250; this.clearTargets(); this.cancelPaging();
    });
    element.addEventListener("click", evt => {
      if (Date.now() < this.suppressClickUntil) { evt.preventDefault(); evt.stopImmediatePropagation(); }
    }, true);
  }

  dropTarget(element: HTMLElement, date: string): void {
    element.dataset.dropDate = date;
    const hover = (evt: DragEvent) => {
      if (!this.accepts(evt) || this.moving) return;
      evt.preventDefault(); if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
      this.clearTargets(element); element.addClass("schedule-drop-target");
    };
    element.addEventListener("dragenter", hover); element.addEventListener("dragover", hover);
    element.addEventListener("dragleave", evt => {
      if (!(evt.relatedTarget instanceof Node) || !element.contains(evt.relatedTarget)) element.removeClass("schedule-drop-target");
    });
    element.addEventListener("drop", evt => {
      if (!this.accepts(evt)) return;
      evt.preventDefault(); evt.stopPropagation(); this.clearTargets(); this.cancelPaging();
      const payload = this.readPayload(evt); this.dragging = null;
      if (!payload || this.moving || payload.date === date) return;
      this.moving = true; this.suppressClickUntil = Date.now() + 250;
      void this.plugin.moveEvent(payload.id, payload.date, date).then(() => {
        this.selected(date); new Notice(t("eventMoved"));
      }).catch(cause => new Notice(t("moveFailed", { error: errorMessage(cause) })))
        .finally(() => { this.moving = false; });
    });
  }

  pageTarget(element: HTMLElement, changePage: () => void): void {
    const hover = (evt: DragEvent) => {
      if (!this.accepts(evt) || this.moving) return;
      evt.preventDefault(); if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
      element.addClass("schedule-drop-target");
      if (this.pagingTimer === null) this.pagingTimer = window.setTimeout(() => {
        this.pagingTimer = null; changePage();
      }, 650);
    };
    element.addEventListener("dragenter", hover); element.addEventListener("dragover", hover);
    element.addEventListener("dragleave", evt => {
      if (evt.relatedTarget instanceof Node && element.contains(evt.relatedTarget)) return;
      this.cancelPaging(); element.removeClass("schedule-drop-target");
    });
    element.addEventListener("drop", evt => { evt.preventDefault(); this.cancelPaging(); element.removeClass("schedule-drop-target"); });
  }

  dispose(): void { this.cancelPaging(); this.clearTargets(); this.dragging = null; }
  private cancelPaging(): void {
    if (this.pagingTimer !== null) window.clearTimeout(this.pagingTimer);
    this.pagingTimer = null;
  }
  private accepts(evt: DragEvent): boolean {
    return !!this.dragging || Array.from(evt.dataTransfer?.types ?? []).includes(DRAG_TYPE);
  }
  private readPayload(evt: DragEvent): DraggedEvent | null {
    try {
      const data = evt.dataTransfer?.getData(DRAG_TYPE);
      const payload = data ? JSON.parse(data) as DraggedEvent : this.dragging;
      if (!payload || typeof payload.id !== "string" || typeof payload.date !== "string" || !validDate(payload.date)) return null;
      const event = this.plugin.data.events.find(event => event.id === payload.id);
      return event && occursOn(event, payload.date) ? payload : null;
    } catch { return null; }
  }
  private clearTargets(except?: HTMLElement): void {
    document.querySelectorAll<HTMLElement>(".schedule-drop-target").forEach(element => {
      if (element !== except) element.removeClass("schedule-drop-target");
    });
  }
}
