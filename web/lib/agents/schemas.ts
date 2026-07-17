import { z } from "zod";

// OpenAI Structured Outputs accepterar inte JSON Schema-formatet `uri`.
// Ett explicit mönster behåller protokollgrinden utan att generera format: "uri".
const sourceUrlSchema = z.string().regex(/^https?:\/\/[^\s]+$/i, "Källan måste vara en fullständig http- eller https-adress").nullable();

export const factSchema = z.object({
  claim: z.string(),
  sourceUrl: sourceUrlSchema,
  sourceQuote: z.string().nullable(),
  isFirsthandObservation: z.boolean(),
});

export const intakeSchema = z.object({
  status: z.enum(["needs_information", "ready"]),
  reply: z.string(),
  missingQuestions: z.array(z.string()),
  facts: z.array(factSchema),
});

export const patchSchema = z.object({
  field: z.enum(["description", "coordinates", "section", "route_fact", "access"]),
  value: z.string(),
  rationale: z.string(),
  sourceUrl: sourceUrlSchema,
  sourceQuote: z.string().nullable(),
});

export const editSchema = z.object({
  reply: z.string(),
  patches: z.array(patchSchema),
});

export const reviewSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  requiresHumanReview: z.boolean(),
});

export type Intake = z.infer<typeof intakeSchema>;
export type ProposedEdit = z.infer<typeof editSchema>;
export type Review = z.infer<typeof reviewSchema>;
