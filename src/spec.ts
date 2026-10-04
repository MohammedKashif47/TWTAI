import { z } from "zod";

/*
 * The guide specification the model writes after reading the sources.
 * Inline formatting inside any text field:
 *   **Label**   bold, for UI elements the user selects or sees (MSTP)
 *   *term*      italic, for new terms and placeholders
 *   `value`     monospace, for text the user types, file names, codes
 */

const text = z.string().min(1);

/** A word-for-word quote from a registered source that supports a part of the guide. */
export const EvidenceSchema = z.object({
  sourceId: z.string().describe("Registered source id, e.g. jira:KAN-20, confluence:12345, figma:<key>, or image:img-03 for recorded screenshot text."),
  quote: z.string().min(12).describe("Exact text copied from that source. Use ... to join two parts of one passage."),
});
const evidence = z
  .array(EvidenceSchema)
  .optional()
  .describe("Required. Quotes from the sources that this content explains. Content without evidence is out of scope and is rejected.");

export const StepSchema = z.object({
  text: text.describe("Imperative instruction, one action per step, e.g. 'Select **Settings**.'"),
  result: z.string().optional().describe("What the user sees after the step, e.g. 'The **Settings** page appears.'"),
  imageId: z.string().optional().describe("Id of a collected image (img-01, ...) that shows this step."),
  imageCaption: z.string().optional(),
  note: z.string().optional().describe("Short note tied to this step."),
  substeps: z.array(z.string()).optional(),
});

export const ProcedureSchema = z.object({
  title: text.describe("Infinitive or gerund heading, e.g. 'To export a report' or 'Exporting a report'."),
  intro: z.string().optional(),
  prerequisites: z.array(z.string()).optional(),
  steps: z.array(StepSchema).min(1),
  evidence,
});

export const NoteSchema = z.object({
  type: z.enum(["note", "tip", "important", "caution", "warning"]).default("note"),
  text,
  evidence,
});

export const FeatureSchema = z.object({
  title: text.describe("Feature name as the product shows it."),
  overview: z.array(text).min(1).describe("Paragraphs: what the feature is, who uses it, and why."),
  navigation: z
    .object({
      intro: z.string().optional(),
      steps: z.array(StepSchema).min(1).describe("Path from the home screen to the feature, one step per click/tap."),
    })
    .describe("How to reach the feature from the home screen."),
  details: z
    .array(
      z.object({
        heading: text,
        paragraphs: z.array(z.string()).default([]),
        bullets: z.array(z.string()).optional(),
        imageId: z.string().optional(),
        imageCaption: z.string().optional(),
        evidence,
      }),
    )
    .optional()
    .describe("Detailed explanation sections: behaviour, rules, validations, states, permissions."),
  uiElements: z
    .array(z.object({ name: text, description: text }))
    .optional()
    .describe("Table of fields, buttons and controls on the screen."),
  procedures: z.array(ProcedureSchema).optional().describe("Tasks the user performs once in the feature."),
  notes: z.array(NoteSchema).optional(),
  images: z.array(z.object({ imageId: text, caption: text })).optional().describe("Extra screenshots not tied to a step."),
  sourceIds: z.array(z.string()).optional().describe("Source ids this section was written from (jira:KAN-21, confluence:123, ...)."),
  evidence,
});

export const GuideSpecSchema = z.object({
  title: text.describe("Descriptive guide title chosen from the product and features. Never a Jira key."),
  subtitle: z.string().optional(),
  productName: text,
  productVersion: z.string().optional(),
  documentVersion: z.string().default("1.0"),
  publishDate: z.string().optional().describe("Defaults to today."),
  companyName: z.string().optional(),
  introduction: z.object({
    purpose: z.array(text).min(1),
    audience: text,
    scope: z.array(z.string()).optional(),
    prerequisites: z.array(z.string()).optional(),
    overviewImageId: z.string().optional(),
    overviewImageCaption: z.string().optional(),
  }),
  features: z.array(FeatureSchema).min(1),
  appendix: z.object({
    contacts: z
      .array(
        z.object({
          role: text.describe("e.g. 'Technical support', 'Product owner'"),
          name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          hours: z.string().optional(),
          url: z.string().optional(),
        }),
      )
      .default([]),
    glossary: z.array(z.object({ term: text, definition: text })).optional(),
    troubleshooting: z.array(z.object({ problem: text, solution: text, evidence })).optional(),
    references: z.array(z.object({ title: text, url: z.string().optional() })).optional(),
    additional: z
      .array(z.object({ heading: text, paragraphs: z.array(z.string()).default([]), bullets: z.array(z.string()).optional() }))
      .optional(),
  }),
  excludedImages: z
    .array(z.object({ imageId: z.string(), reason: z.string().min(5) }))
    .optional()
    .describe("Collected images deliberately left out, each with the reason. Every other collected image must be placed in the guide."),
  numberHeadings: z.boolean().default(true).describe("Number headings 1, 1.1, 1.1.1 (appendix: A.1)."),
  outputFileName: z.string().optional().describe("File name without folder. Defaults to a slug of the title."),
});

export type GuideSpec = z.infer<typeof GuideSpecSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
