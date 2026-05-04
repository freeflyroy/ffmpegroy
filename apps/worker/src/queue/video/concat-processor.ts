import type { Job } from 'bullmq';
import type { JobResult } from '..';
import type { VideoConcatJobData } from '@shared/queue/video/concat-schemas';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { mkdir, writeFile, rm } from 'fs/promises';
import { dirname, basename } from 'path';
import path from 'path';
import { uploadToS3 } from '@worker/utils/storage';

const execFileAsync = promisify(execFile);
const PROCESSING_TIMEOUT = 600000;

export async function processVideoConcat(job: Job<VideoConcatJobData>): Promise<JobResult> {
  const { inputPaths, outputPath, reencode } = job.data;

  for (const p of inputPaths) {
    if (!existsSync(p)) {
      return {
        success: false,
        error: `Input file does not exist: ${p}`
      };
    }
  }

  try {
    const outputDir = dirname(outputPath);
    await mkdir(outputDir, { recursive: true });

    const fileListPath = path.join(outputDir, 'filelist.txt');
    const fileListContent = inputPaths.map((p) => `file '${p}'`).join('\n');
    await writeFile(fileListPath, fileListContent);

    const args: string[] = ['-f', 'concat', '-safe', '0', '-i', fileListPath];

    if (reencode) {
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
      error: `Failed to concatenate videos: ${errorMessage}`
    };
  }
}
