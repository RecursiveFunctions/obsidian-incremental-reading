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

export function toAnkiTsv(
  elements: IrElement[],
  opts: AnkiExportOptions,
): string {
  const items = elements
    .filter((e) => e.type === "item" && e.dismissed === false)
    .sort((a, b) => a.id.localeCompare(b.id));

  const header = [
    "#separator:tab",
    "#html:false",
    "#notetype:Cloze",
    `#deck:${opts.deck}`,
    `#columns:Text\tguid`,
    "#guid column:2",
  ];

  const rows = items.map(
    (el) => `${tsvSafeBody(el.text)}\t${el.id}`,
  );

  return [...header, ...rows].join("\n") + "\n";
}
