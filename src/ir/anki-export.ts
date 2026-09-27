import type { IrElement } from "./model";

export interface AnkiExportOptions {
  deck: string;
}

function tsvSafeBody(text: string | undefined): string {
  return (text ?? "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\n/g, " ");
}

export function isOcclusionItem(element: IrElement): boolean {
  return /```ir-occlusion\b/.test(element.text);
}

export function toAnkiTsv(
  elements: IrElement[],
  opts: AnkiExportOptions,
): string {
  const items = elements
    .filter((e) => e.type === "item" && e.dismissed === false && !isOcclusionItem(e))
    .sort((a, b) => a.id.localeCompare(b.id));

  const header = [
    "#separator:tab",
    "#html:false",
    "#notetype:Cloze",
    `#deck:${tsvSafeBody(opts.deck)}`,
    `#columns:Text\tguid`,
    "#guid column:2",
  ];

  const rows = items.map(
    (el) => `${tsvSafeBody(el.text)}\t${el.id}`,
  );

  return [...header, ...rows].join("\n") + "\n";
}
