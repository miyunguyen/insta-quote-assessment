import { z } from "zod";

export const evidenceRectSchema = z.object({
  // PDF user-space units (points). x/y is the text baseline origin —
  // the same transform[4]/transform[5] the viewer converts with
  // viewport.convertToViewportPoint. height approximates the font size.
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type EvidenceRect = z.infer<typeof evidenceRectSchema>;

export const evidenceSchema = z.object({
  page: z.number().int().positive(),
  sourceText: z.string().min(1),
  // Position captured at extraction time, so the viewer draws the box
  // where the value actually sits instead of re-searching by text
  // (first-match search misplaces boxes when text repeats on a page).
  rect: evidenceRectSchema.optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const fieldValueSchema = z.object({
  value: z.string().min(1),
  evidence: evidenceSchema,
});
export type FieldValue = z.infer<typeof fieldValueSchema>;

export const cellValueSchema = z.object({
  // The document's own heading for this column ("" when the headings don't
  // line up with the data — the viewer then shows generic Column N plus the
  // quoted header line). Deliberately the doc's words, never our labels:
  // cells are plain text, untyped.
  label: z.string(),
  value: z.string().min(1),
  evidence: evidenceSchema,
});
export type CellValue = z.infer<typeof cellValueSchema>;

export const refusalCodeSchema = z.enum([
  "page_no_text",
  "page_parse_failed",
  "unreadable_value",
  "value_not_stated",
  "ambiguous_reference",
  "unparseable_table",
]);
export type RefusalCode = z.infer<typeof refusalCodeSchema>;

export const refusalScopeSchema = z.object({
  page: z.number().int().positive(),
  section: z.string().optional(),
  row: z.number().int().optional(),
  field: z.string().optional(),
});
export type RefusalScope = z.infer<typeof refusalScopeSchema>;

export const refusalSchema = z.object({
  code: refusalCodeSchema,
  scope: refusalScopeSchema,
  plainLanguage: z.string().min(1),
  technicalDetail: z.string().min(1),
  evidence: evidenceSchema.optional(),
});
export type Refusal = z.infer<typeof refusalSchema>;

export const lineItemSchema = z.object({
  section: z.string(),
  // Plain-text cells in document order — no field semantics. The only
  // number ever interpreted is a trailing money cell, used solely for the
  // page-total cross-check (never relabeled, never derived into output).
  cells: z.array(cellValueSchema).min(1),
  rowSourceText: z.string().min(1),
});
export type LineItem = z.infer<typeof lineItemSchema>;

export const documentFieldsSchema = z.object({
  documentNumber: fieldValueSchema.optional(),
  date: fieldValueSchema.optional(),
  deliveredTo: fieldValueSchema.optional(),
  orderedBy: fieldValueSchema.optional(),
});
export type DocumentFields = z.infer<typeof documentFieldsSchema>;

export const documentInfoSchema = z.object({
  fileName: z.string(),
  pageCount: z.number().int().nonnegative(),
  docType: z.enum(["packing_list", "delivery_docket", "unknown"]),
});
export type DocumentInfo = z.infer<typeof documentInfoSchema>;

export const derivedValueSchema = z.object({
  value: z.string(),
  derivation: z.string(),
  operands: z.array(fieldValueSchema).min(1),
});
export type DerivedValue = z.infer<typeof derivedValueSchema>;

export const claimSchema = z.object({
  label: z.string().min(1),
  value: z.string().optional(),
  evidence: evidenceSchema,
});
export type Claim = z.infer<typeof claimSchema>;

export const issueSchema = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("contradiction"),
    plainLanguage: z.string().min(1),
    claims: z.array(claimSchema).min(2),
  }),
  z.object({
    code: z.literal("arithmetic_mismatch"),
    plainLanguage: z.string().min(1),
    stated: z.array(fieldValueSchema).min(1),
    derived: derivedValueSchema,
  }),
]);
export type Issue = z.infer<typeof issueSchema>;

export const resultPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  sectionTitle: fieldValueSchema.optional(),
  fields: documentFieldsSchema,
  total: fieldValueSchema.optional(),
  items: z.array(lineItemSchema),
  refusals: z.array(refusalSchema),
  tableLabels: z.array(z.string()).optional(),
  tableHeaderText: z.string().optional(),
});
export type ResultPage = z.infer<typeof resultPageSchema>;

export const extractionResultSchema = z.object({
  document: documentInfoSchema,
  pages: z.array(resultPageSchema),
  issues: z.array(issueSchema),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
