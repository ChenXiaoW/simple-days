/** Character offsets preserve duplicate task labels, indentation and original line endings. */
export function markdownTaskOffsets(markdown: string): number[] {
  const offsets: number[] = [];
  let offset = 0;
  let fence: { character: string; length: number } | null = null;
  for (const line of markdown.split("\n")) {
    const content = line.replace(/^[ \t]*(?:>[ \t]*)*/, "");
    if (fence) {
      const closing = content.match(/^(`{3,}|~{3,})[ \t\r]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
    } else {
      const opening = content.replace(/^(?:[-+*]|\d+[.)])[ \t]+/, "").match(/^(`{3,}|~{3,})/);
      if (opening) fence = { character: opening[1][0], length: opening[1].length };
      else {
        const task = line.match(/^([ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+\[)[ xX]\](?=[ \t\r]|$)/);
        if (task) offsets.push(offset + task[1].length);
      }
    }
    offset += line.length + 1;
  }
  return offsets;
}
