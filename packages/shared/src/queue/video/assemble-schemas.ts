import { z } from 'zod';

export const AssembleSegmentSchema = z.object({
  start: z.string(),
  end: z.string()
});

export const AssembleCropSchema = z.object({
  targetWidth: z.number().int().positive(),
  targetHeight: z.number().int().positive()
});

export const VideoAssembleJobDataSchema = z.object({
  inputPath: z.string(),
  outputPath: z.string(),
  segments: z.array(AssembleSegmentSchema).min(1),
  crop: AssembleCropSchema.optional(),
  uploadToS3: z.boolean().default(false)
});

export type VideoAssembleJobData = z.infer<typeof VideoAssembleJobDataSchema>;
