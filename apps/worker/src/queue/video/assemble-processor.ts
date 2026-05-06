import type { Job } from 'bullmq';
import type { JobResult } from '..';
import type { VideoAssembleJobData } from '@shared/queue/video/assemble-schemas';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { mkdir, writeFile, rm } from 'fs/promises';
import { dirname, basename } from 'path';
import path from 'path';
import { uploadToS3 } from '@worker/utils/storage';
import { logger } from '@worker/config/logger';

const execFileAsync = promisify(execFile);
const STEP_TIMEOUT = 600000;

export async function processVideoAssemble(job: Job<VideoAssembleJobData>): Promise<JobResult> {
  const { inputPath, outputPath, segments, crop } = job.data;

  if (!existsSync(inputPath)) {
    return { success: false, error: `Input file does not exist: ${inputPath}` };
  }

  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });
  const workDir = path.join(outputDir, 'assemble_work');
  await mkdir(workDir, { recursive: true });

  try {
    logger.info({ jobId: job.id, segmentCount: segments.length }, 'Assemble: cutting segments');

    const segmentPaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segPath = path.join(workDir, `seg_${String(i).padStart(3, '0')}.mp4`);

      const segDuration = parseFloat(String(seg.end)) - parseFloat(String(seg.start));
      const fadeMs = 0.04;
      const fadeOutStart = Math.max(0, segDuration - fadeMs);
      const audioFilter = `afade=t=in:d=${fadeMs},afade=t=out:st=${fadeOutStart}:d=${fadeMs}`;

      const args = [
        '-i',
        inputPath,
        '-ss',
        seg.start,
        '-to',
        seg.end,
        '-codec:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-af',
        audioFilter,
        '-codec:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        '-y',
        segPath
      ];

      await execFileAsync('ffmpeg', args, { timeout: STEP_TIMEOUT });

      if (!existsSync(segPath)) {
        return { success: false, error: `Failed to cut segment ${i} (${seg.start}-${seg.end})` };
      }

      segmentPaths.push(segPath);
      logger.info({ jobId: job.id, segment: i, start: seg.start, end: seg.end }, 'Assemble: segment cut complete');
    }

    let currentOutput: string;

    if (segmentPaths.length === 1) {
      currentOutput = segmentPaths[0];
    } else {
      logger.info({ jobId: job.id, fileCount: segmentPaths.length }, 'Assemble: concatenating segments');

      const concatPath = path.join(workDir, 'concat.mp4');
      const fileListPath = path.join(workDir, 'filelist.txt');
      const fileListContent = segmentPaths.map((p) => `file '${p}'`).join('\n');
      await writeFile(fileListPath, fileListContent);

      const concatArgs = [
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        fileListPath,
        '-codec:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-codec:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        '-y',
        concatPath
      ];

      await execFileAsync('ffmpeg', concatArgs, { timeout: STEP_TIMEOUT });

      if (!existsSync(concatPath)) {
        return { success: false, error: 'Failed to concatenate segments' };
      }

      currentOutput = concatPath;
    }

    if (crop) {
      logger.info(
        { jobId: job.id, target: `${crop.targetWidth}x${crop.targetHeight}` },
        'Assemble: probing dimensions for crop'
      );

      const { stdout } = await execFileAsync(
        'ffprobe',
        ['-v', 'quiet', '-print_format', 'json', '-show_streams', currentOutput],
        { timeout: 30000 }
      );

      const probeData = JSON.parse(stdout);
      const videoStream = probeData.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');

      if (videoStream) {
        const srcW = videoStream.width as number;
        const srcH = videoStream.height as number;
        const targetRatio = crop.targetWidth / crop.targetHeight;
        const srcRatio = srcW / srcH;

        let cropW: number, cropH: number, cropX: number, cropY: number;

        if (srcRatio > targetRatio) {
          cropH = srcH;
          cropW = Math.round(srcH * targetRatio);
          cropX = Math.round((srcW - cropW) / 2);
          cropY = 0;
        } else {
          cropW = srcW;
          cropH = Math.round(srcW / targetRatio);
          cropX = 0;
          cropY = Math.round((srcH - cropH) / 2);
        }

        const cropPath = path.join(workDir, 'cropped.mp4');
        const vf = `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${crop.targetWidth}:${crop.targetHeight}`;

        const cropArgs = [
          '-i',
          currentOutput,
          '-vf',
          vf,
          '-codec:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '18',
          '-codec:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          '-y',
          cropPath
        ];

        await execFileAsync('ffmpeg', cropArgs, { timeout: STEP_TIMEOUT });

        if (!existsSync(cropPath)) {
          return { success: false, error: 'Failed to crop video' };
        }

        currentOutput = cropPath;
        logger.info(
          {
            jobId: job.id,
            crop: `${cropW}x${cropH}+${cropX}+${cropY}`,
            scale: `${crop.targetWidth}x${crop.targetHeight}`
          },
          'Assemble: crop complete'
        );
      }
    }

    const { stdout: finalProbe } = await execFileAsync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', currentOutput],
      { timeout: 30000 }
    );

    const finalMeta = JSON.parse(finalProbe);
    const finalVideo = finalMeta.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
    const duration = parseFloat(finalMeta.format?.duration ?? '0');

    const { copyFile } = await import('fs/promises');
    await copyFile(currentOutput, outputPath);

    await rm(workDir, { recursive: true, force: true });

    logger.info({ jobId: job.id, duration, segments: segments.length }, 'Assemble: complete');

    if (job.data.uploadToS3) {
      const { url } = await uploadToS3(outputPath, 'video/mp4', basename(outputPath));
      await rm(outputPath, { force: true });
      return {
        success: true,
        outputUrl: url,
        metadata: {
          duration,
          width: finalVideo?.width,
          height: finalVideo?.height,
          segmentCount: segments.length
        }
      };
    }

    return {
      success: true,
      outputPath,
      metadata: {
        duration,
        width: finalVideo?.width,
        height: finalVideo?.height,
        segmentCount: segments.length
      }
    };
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      /* cleanup best-effort */
    });
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Assembly failed: ${errorMessage}` };
  }
}
