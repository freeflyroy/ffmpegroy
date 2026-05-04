import { z } from 'zod';

export const VideoConcatJobDataSchema = z.object({
  inputPaths: z.array(z.string()).min(2),
  outputPath: z.string(),
  reencode: z.boolean().default(false),
  uploadToS3: z.boolean().default(false)
});

export type VideoConcatJobData = z.infer<typeof VideoConcatJobDataSchema>;
