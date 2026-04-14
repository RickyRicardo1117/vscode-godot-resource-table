export type CellKind = "bool" | "int" | "float" | "string" | "readonly";

export interface ExtResourceEntry {
  readonly id: string;
  readonly type: string | undefined;
  readonly path: string | undefined;
}

export interface ResourceProperty {
  readonly key: string;
  readonly rawValue: string;
  /** 0-based line index in full file */
  readonly lineIndex: number;
}

export interface ParsedTres {
  readonly rawText: string;
  readonly gdResourceLine: string | undefined;
  readonly scriptClass: string | undefined;
  readonly resourceType: string | undefined;
  readonly extResources: ReadonlyMap<string, ExtResourceEntry>;
  readonly resourceStartLine: number;
  readonly resourceEndLine: number;
  readonly properties: readonly ResourceProperty[];
}

export interface CellModel {
  readonly key: string;
  readonly displayText: string;
  readonly rawValue: string | undefined;
  readonly kind: CellKind;
  readonly editable: boolean;
}
