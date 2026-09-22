import { z } from "zod";

export const evidenceSchema = z.object({
  page: z.number().int().positive(),
  sourceText: z.string().min(1),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const fieldValueSchema = z.object({
  value: z.string().min(1),
  evidence: evidenceSchema,
});
export type FieldValue = z.infer<typeof fieldValueSchema>;

export const refusalCodeSchema = z.enum([
  "page_no_text",
  "page_parse_failed",
  "unreadable_value",
  "value_not_stated",
  "would_require_computation",
  "ambiguous_reference",
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
  description: fieldValueSchema,
  quantity: fieldValueSchema.optional(),
  unit: fieldValueSchema.optional(),
  weight: fieldValueSchema.optional(),
  unitPrice: fieldValueSchema.optional(),
  lineTotal: fieldValueSchema.optional(),
  rowSourceText: z.string().min(1),
});
export type LineItem = z.infer<typeof lineItemSchema>;

export const documentFieldsSchema = z.object({
  documentNumber: fieldValueSchema.optional(),
  date: fieldValueSchema.optional(),
  deliveredTo: fieldValueSchema.optional(),
  orderedBy: fieldValueSchema.optional(),
  sectionTitle: fieldValueSchema.optional(),
  total: fieldValueSchema.optional(),
});
export type DocumentFields = z.infer<typeof documentFieldsSchema>;

export const documentInfoSchema = z.object({
  fileName: z.string(),
  pageCount: z.number().int().nonnegative(),
  docType: z.enum(["packing_list", "delivery_docket", "unknown"]),
  fields: documentFieldsSchema,
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
  z.object({
    code: z.literal("derived_value"),
    plainLanguage: z.string().min(1),
    derived: derivedValueSchema,
  }),
]);
export type Issue = z.infer<typeof issueSchema>;

export const extractionResultSchema = z.object({
  document: documentInfoSchema,
  items: z.array(lineItemSchema),
  refusals: z.array(refusalSchema),
  issues: z.array(issueSchema),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
