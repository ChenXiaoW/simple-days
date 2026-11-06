import { setIcon } from "obsidian";
export function icon(parent: HTMLElement, name: string, cls = ""): HTMLElement {
  const el = parent.createSpan({ cls: `schedule-icon ${cls}` });
  el.setAttribute("aria-hidden", "true"); setIcon(el, name); return el;
}
export function button(parent: HTMLElement, text: string, iconName: string | null, action: () => void, cls = ""): HTMLButtonElement {
  const el = parent.createEl("button", { cls: `schedule-button ${cls}`, attr: { type: "button", "aria-label": text } });
  if (iconName) icon(el, iconName);
  if (text && !cls.includes("schedule-icon-only")) el.createSpan({ text });
  el.addEventListener("click", action); return el;
}
export function badge(parent: HTMLElement, text: string, category: string): HTMLElement {
  return parent.createSpan({ cls: `schedule-badge schedule-category-${category}`, text });
}
