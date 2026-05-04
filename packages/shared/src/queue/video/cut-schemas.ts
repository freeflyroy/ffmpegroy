import { z } from 'zod';

export const VideoCutJobDataSchema = z.object({
  inputPath: z.string(),
  outputPath: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  precise: z.boolean().default(false),
  uploadToS3: z.boolean().default(false)
});

export type VideoCutJobData = z.infer<typeof VideoCutJobDataSchema>;
