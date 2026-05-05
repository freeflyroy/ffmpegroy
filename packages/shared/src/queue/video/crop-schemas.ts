import { z } from 'zod';

export const VideoCropJobDataSchema = z.object({
  inputPath: z.string(),
  outputPath: z.string(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  sw: z.number().int().positive(),
  sh: z.number().int().positive(),
  uploadToS3: z.boolean().default(false)
});

export type VideoCropJobData = z.infer<typeof VideoCropJobDataSchema>;
