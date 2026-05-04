import type { Job } from 'bullmq';
import type { JobResult } from '..';
import type { VideoCutJobData } from '@shared/queue/video/cut-schemas';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { dirname, basename } from 'path';
import { uploadToS3 } from '@worker/utils/storage';

const execFileAsync = promisify(execFile);
const PROCESSING_TIMEOUT = 600000;

export async function processVideoCut(job: Job<VideoCutJobData>): Promise<JobResult> {
  const { inputPath, outputPath, startTime, endTime, precise } = job.data;

  if (!existsSync(inputPath)) {
    return {
      success: false,
      error: `Input file does not exist: ${inputPath}`
    };
  }

  try {
    const outputDir = dirname(outputPath);
    await mkdir(outputDir, { recursive: true });

    const args: string[] = ['-i', inputPath, '-ss', startTime, '-to', endTime];

    if (precise) {
      args.push('-codec:v', 'libx264', '-preset', 'fast', '-crf', '18', '-codec:a', 'aac', '-b:a', '128k');
    } else {
      args.push('-c', 'copy');
    }

    args.push('-movflags', '+faststart', '-y', outputPath);

    await execFileAsync('ffmpeg', args, { timeout: PROCESSING_TIMEOUT });

    if (job.data.uploadToS3) {
      const { url } = await uploadToS3(outputPath, 'video/mp4', basename(outputPath));
      await rm(outputPath, { force: true });
      return { success: true, outputUrl: url };
    }

    return { success: true, outputPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to cut video: ${errorMessage}`
    };
  }
}
