import type { Job } from 'bullmq';
import type { JobResult } from '..';
import type { VideoCropJobData } from '@shared/queue/video/crop-schemas';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { dirname, basename } from 'path';
import { uploadToS3 } from '@worker/utils/storage';

const execFileAsync = promisify(execFile);
const PROCESSING_TIMEOUT = 600000;

export async function processVideoCrop(job: Job<VideoCropJobData>): Promise<JobResult> {
  const { inputPath, outputPath, w, h, x, y, sw, sh } = job.data;

  if (!existsSync(inputPath)) {
    return {
      success: false,
      error: `Input file does not exist: ${inputPath}`
    };
  }

  try {
    const outputDir = dirname(outputPath);
    await mkdir(outputDir, { recursive: true });

    const vf = `crop=${w}:${h}:${x}:${y},scale=${sw}:${sh}`;
    const args: string[] = [
      '-i', inputPath,
      '-vf', vf,
      '-c:a', 'copy',
      '-movflags', '+faststart',
      '-y', outputPath
    ];

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
      error: `Failed to crop video: ${errorMessage}`
    };
  }
}
