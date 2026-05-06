import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  videoToMp4Route,
  videoToMp4UrlRoute,
  extractAudioRoute,
  extractAudioUrlRoute,
  extractFramesRoute,
  extractFramesUrlRoute,
  downloadFrameRoute
} from './schemas';
import { videoToGifRoute, videoToGifUrlRoute } from './gif-schemas';
import { JobType } from '~/queue';
import { env } from '~/config/env';
import { processMediaJob, getOutputFilename } from '~/utils/job-handler';
import { videoCutRoute, videoCutUrlRoute } from './cut-schemas';
import { videoConcatRoute, videoConcatUrlRoute } from './concat-schemas';
import { videoCropRoute, videoCropUrlRoute } from './crop-schemas';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import path from 'path';
import { addJob, queueEvents, validateJobResult } from '~/queue';

export function registerVideoRoutes(app: OpenAPIHono) {
  app.openapi(videoToMp4Route, async (c) => {
    try {
      const { file } = c.req.valid('form');

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_TO_MP4,
        outputExtension: 'mp4',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          crf: 23,
          preset: 'medium',
          smartCopy: true
        })
      });

      if (!result.success) {
        return c.json({ error: result.error }, 400);
      }

      if (!result.outputBuffer) {
        return c.json({ error: 'Conversion failed' }, 400);
      }

      return c.body(new Uint8Array(result.outputBuffer), 200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${getOutputFilename(file.name, 'mp4')}"`
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });

  app.openapi(extractAudioRoute, async (c) => {
    try {
      const { file } = c.req.valid('form');
      const query = c.req.valid('query');
      const mono = query.mono === 'yes';

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_EXTRACT_AUDIO,
        outputExtension: 'wav',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          mono
        })
      });

      if (!result.success) {
        return c.json({ error: result.error }, 400);
      }

      if (!result.outputBuffer) {
        return c.json({ error: 'Audio extraction failed' }, 400);
      }

      return c.body(new Uint8Array(result.outputBuffer), 200, {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${getOutputFilename(file.name, 'wav')}"`
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });

  app.openapi(extractFramesRoute, async (c) => {
    try {
      const { file } = c.req.valid('form');
      const query = c.req.valid('query');
      const fps = query.fps || 1;
      const compress = query.compress;

      if (!compress) {
        return c.json(
          {
            error: 'compress parameter is required',
            message: 'Please specify compress=zip or compress=gzip to get frames as an archive'
          },
          400
        );
      }

      const extension = compress === 'zip' ? 'zip' : 'tar.gz';

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_EXTRACT_FRAMES,
        outputExtension: extension,
        jobData: ({ inputPath, jobDir }) => ({
          inputPath,
          outputDir: `${jobDir}/frames`,
          fps,
          format: 'png',
          compress
        })
      });

      if (!result.success) {
        return c.json({ error: result.error }, 400);
      }

      if (!result.outputBuffer) {
        return c.json({ error: 'Frame extraction failed' }, 400);
      }

      const contentType = compress === 'zip' ? 'application/zip' : 'application/gzip';
      return c.body(new Uint8Array(result.outputBuffer), 200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${getOutputFilename(file.name, '')}_frames.${extension}"`
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });

  app.openapi(videoToMp4UrlRoute, async (c) => {
    try {
      if (env.STORAGE_MODE !== 's3') {
        return c.json({ error: 'S3 mode not enabled' }, 400);
      }

      const { file } = c.req.valid('form');

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_TO_MP4,
        outputExtension: 'mp4',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          crf: 23,
          preset: 'medium',
          smartCopy: true,
          uploadToS3: true
        })
      });

      if (!result.success) {
        return c.json({ error: result.error }, 400);
      }

      if (!result.outputUrl) {
        return c.json({ error: 'Conversion failed' }, 400);
      }

      return c.json({ url: result.outputUrl }, 200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });

  app.openapi(extractAudioUrlRoute, async (c) => {
    try {
      if (env.STORAGE_MODE !== 's3') {
        return c.json({ error: 'S3 mode not enabled' }, 400);
      }

      const { file } = c.req.valid('form');
      const query = c.req.valid('query');
      const mono = query.mono === 'yes';

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_EXTRACT_AUDIO,
        outputExtension: 'wav',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          mono,
          uploadToS3: true
        })
      });

      if (!result.success) {
        return c.json({ error: result.error }, 400);
      }

      if (!result.outputUrl) {
        return c.json({ error: 'Audio extraction failed' }, 400);
      }

      return c.json({ url: result.outputUrl }, 200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });

  app.openapi(extractFramesUrlRoute, async (c) => {
    try {
      if (env.STORAGE_MODE !== 's3') {
        return c.json({ error: 'S3 mode not enabled' }, 400);
      }

      const { file } = c.req.valid('form');
      const query = c.req.valid('query');
      const fps = query.fps || 1;
      const compress = query.compress;

      if (!compress) {
        return c.json(
          {
            error: 'compress parameter is required',
            message: 'Please specify compress=zip or compress=gzip to get frames as an archive'
          },
          400
        );
      }

      const extension = compress === 'zip' ? 'zip' : 'tar.gz';

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_EXTRACT_FRAMES,
        outputExtension: extension,
        jobData: ({ inputPath, jobDir }) => ({
          inputPath,
          outputDir: `${jobDir}/frames`,
          fps,
          format: 'png',
          compress,
          uploadToS3: true
        })
      });

      if (!result.success) {
        return c.json({ error: result.error }, 400);
      }

      if (!result.outputUrl) {
        return c.json({ error: 'Frame extraction failed' }, 400);
      }

      return c.json({ url: result.outputUrl }, 200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });

  app.openapi(downloadFrameRoute, (c) => {
    return c.json(
      {
        error: 'Not implemented - use compress parameter on POST /video/frames instead'
      },
      501
    );
  });

  app.openapi(videoToGifRoute, async (c) => {
    try {
      const { file } = c.req.valid('form');
      const query = c.req.valid('query');

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_TO_GIF,
        outputExtension: 'gif',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          fps: query.fps,
          width: query.width
        })
      });

      if (!result.success) {
        return c.json({ error: result.error }, 400);
      }

      if (!result.outputBuffer) {
        return c.json({ error: 'Conversion failed' }, 400);
      }

      return c.body(new Uint8Array(result.outputBuffer), 200, {
        'Content-Type': 'image/gif',
        'Content-Disposition': `attachment; filename="${getOutputFilename(file.name, 'gif')}"`
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });

  app.openapi(videoToGifUrlRoute, async (c) => {
    try {
      if (env.STORAGE_MODE !== 's3') {
        return c.json({ error: 'S3 mode not enabled' }, 400);
      }

      const { file } = c.req.valid('form');
      const query = c.req.valid('query');

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_TO_GIF,
        outputExtension: 'gif',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          fps: query.fps,
          width: query.width,
          uploadToS3: true
        })
      });

      if (!result.success) {
        return c.json({ error: result.error }, 400);
      }

      if (!result.outputUrl) {
        return c.json({ error: 'Conversion failed' }, 400);
      }

      return c.json({ url: result.outputUrl }, 200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });
}

export function registerVideoCutConcatRoutes(app: OpenAPIHono) {
  app.openapi(videoCutRoute, async (c) => {
    try {
      const { file } = c.req.valid('form');
      const query = c.req.valid('query');

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_CUT,
        outputExtension: 'mp4',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          startTime: query.start,
          endTime: query.end,
          precise: query.precise === 'yes'
        })
      });

      if (!result.success) return c.json({ error: result.error }, 400);
      if (!result.outputBuffer) return c.json({ error: 'Cut failed' }, 400);

      return c.body(new Uint8Array(result.outputBuffer), 200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${getOutputFilename(file.name, 'mp4')}"`
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: msg }, 500);
    }
  });

  app.openapi(videoCutUrlRoute, async (c) => {
    try {
      if (env.STORAGE_MODE !== 's3') return c.json({ error: 'S3 mode not enabled' }, 400);
      const { file } = c.req.valid('form');
      const query = c.req.valid('query');

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_CUT,
        outputExtension: 'mp4',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          startTime: query.start,
          endTime: query.end,
          precise: query.precise === 'yes',
          uploadToS3: true
        })
      });

      if (!result.success) return c.json({ error: result.error }, 400);
      if (!result.outputUrl) return c.json({ error: 'Cut failed' }, 400);
      return c.json({ url: result.outputUrl }, 200);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: msg }, 500);
    }
  });

  app.openapi(videoConcatRoute, async (c) => {
    try {
      const { files } = c.req.valid('form');
      const query = c.req.valid('query');

      const jobId = randomUUID();
      const jobDir = path.join(env.TEMP_DIR, jobId);
      await mkdir(jobDir, { recursive: true });

      const inputPaths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const inputPath = path.join(jobDir, `input_${i}.mp4`);
        const buffer = Buffer.from(await files[i].arrayBuffer());
        await writeFile(inputPath, buffer);
        inputPaths.push(inputPath);
      }

      const outputPath = path.join(jobDir, 'output.mp4');
      const job = await addJob(JobType.VIDEO_CONCAT, {
        inputPaths,
        outputPath,
        reencode: query.reencode === 'yes'
      });

      const rawResult = await job.waitUntilFinished(queueEvents);
      const result = validateJobResult(rawResult);

      if (!result.success) {
        await rm(jobDir, { recursive: true, force: true });
        return c.json({ error: result.error }, 400);
      }

      if (!result.outputPath) {
        await rm(jobDir, { recursive: true, force: true });
        return c.json({ error: 'Concat failed' }, 400);
      }

      const outputBuffer = await readFile(result.outputPath);
      await rm(jobDir, { recursive: true, force: true });

      return c.body(new Uint8Array(outputBuffer), 200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="concat_output.mp4"`
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: msg }, 500);
    }
  });

  app.openapi(videoConcatUrlRoute, async (c) => {
    try {
      if (env.STORAGE_MODE !== 's3') return c.json({ error: 'S3 mode not enabled' }, 400);
      const { files } = c.req.valid('form');
      const query = c.req.valid('query');

      const jobId = randomUUID();
      const jobDir = path.join(env.TEMP_DIR, jobId);
      await mkdir(jobDir, { recursive: true });

      const inputPaths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const inputPath = path.join(jobDir, `input_${i}.mp4`);
        const buffer = Buffer.from(await files[i].arrayBuffer());
        await writeFile(inputPath, buffer);
        inputPaths.push(inputPath);
      }

      const outputPath = path.join(jobDir, 'output.mp4');
      const job = await addJob(JobType.VIDEO_CONCAT, {
        inputPaths,
        outputPath,
        reencode: query.reencode === 'yes',
        uploadToS3: true
      });

      const rawResult = await job.waitUntilFinished(queueEvents);
      const result = validateJobResult(rawResult);
      await rm(jobDir, { recursive: true, force: true });

      if (!result.success) return c.json({ error: result.error }, 400);
      if (!result.outputUrl) return c.json({ error: 'Concat failed' }, 400);
      return c.json({ url: result.outputUrl }, 200);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: msg }, 500);
    }
  });

  app.openapi(videoCropRoute, async (c) => {
    try {
      const { file } = c.req.valid('form');
      const query = c.req.valid('query');

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_CROP,
        outputExtension: 'mp4',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          w: query.w,
          h: query.h,
          x: query.x,
          y: query.y,
          sw: query.sw,
          sh: query.sh
        })
      });

      if (!result.success) return c.json({ error: result.error }, 400);
      if (!result.outputBuffer) return c.json({ error: 'Crop failed' }, 400);

      return c.body(new Uint8Array(result.outputBuffer), 200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${getOutputFilename(file.name, 'mp4')}"`
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: msg }, 500);
    }
  });

  app.openapi(videoCropUrlRoute, async (c) => {
    try {
      if (env.STORAGE_MODE !== 's3') return c.json({ error: 'S3 mode not enabled' }, 400);
      const { file } = c.req.valid('form');
      const query = c.req.valid('query');

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_CROP,
        outputExtension: 'mp4',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          w: query.w,
          h: query.h,
          x: query.x,
          y: query.y,
          sw: query.sw,
          sh: query.sh,
          uploadToS3: true
        })
      });

      if (!result.success) return c.json({ error: result.error }, 400);
      if (!result.outputUrl) return c.json({ error: 'Crop failed' }, 400);
      return c.json({ url: result.outputUrl }, 200);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: msg }, 500);
    }
  });

  // --- Assemble endpoint: one API call does cut + concat + crop ---

  app.post('/job/assemble/init', async (c) => {
    try {
      const body = await c.req.json();

      if (!body.segments || !Array.isArray(body.segments)) {
        return c.json({ error: 'segments array is required' }, 400);
      }

      const keepSegments = body.segments
        .filter((s: { type: string }) => s.type === 'keep')
        .map((s: { start: number; end: number }) => ({
          start: String(s.start),
          end: String(s.end)
        }));

      if (keepSegments.length === 0) {
        return c.json({ error: 'No keep segments found in cut sheet' }, 400);
      }

      // Apply 0.5s outward buffer, clamp to video bounds, prevent overlap
      const totalDuration = body.totalDuration ?? 9999;
      const BUFFER = 0.5;

      for (let i = 0; i < keepSegments.length; i++) {
        let start = parseFloat(keepSegments[i].start) - BUFFER;
        let end = parseFloat(keepSegments[i].end) + BUFFER;

        start = Math.max(0, start);
        end = Math.min(totalDuration, end);

        if (i > 0) {
          const prevEnd = parseFloat(keepSegments[i - 1].end);
          if (start < prevEnd) start = prevEnd;
        }

        if (i < keepSegments.length - 1) {
          const nextStart = parseFloat(keepSegments[i + 1].start);
          if (end > nextStart) end = nextStart;
        }

        keepSegments[i].start = String(start);
        keepSegments[i].end = String(end);
      }

      const jobId = randomUUID();
      const jobDir = path.join(env.TEMP_DIR, `assemble_${jobId}`);
      await mkdir(jobDir, { recursive: true });

      const config = {
        segments: keepSegments,
        crop: body.crop || null
      };

      await writeFile(path.join(jobDir, 'config.json'), JSON.stringify(config));

      return c.json({ jobId, segmentCount: keepSegments.length }, 200);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Init failed', message: msg }, 500);
    }
  });

  app.post('/job/assemble/start', async (c) => {
    try {
      const jobId = c.req.query('jobId');
      if (!jobId) return c.json({ error: 'jobId query parameter is required' }, 400);

      const jobDir = path.join(env.TEMP_DIR, `assemble_${jobId}`);
      const configPath = path.join(jobDir, 'config.json');

      const { existsSync } = await import('fs');
      if (!existsSync(configPath)) return c.json({ error: 'Invalid or expired jobId' }, 400);

      const inputPath = path.join(jobDir, 'input.mp4');
      const contentType = c.req.header('content-type') || '';

      if (contentType.includes('application/json')) {
        // URL mode: download video from provided URL
        const jsonBody = await c.req.json();
        if (!jsonBody.videoUrl) {
          await rm(jobDir, { recursive: true, force: true });
          return c.json({ error: 'videoUrl is required in JSON body' }, 400);
        }
        const { createWriteStream: cws } = await import('fs');
        const { pipeline } = await import('stream/promises');
        const { Readable } = await import('stream');
        const response = await fetch(jsonBody.videoUrl, { redirect: 'follow' });
        if (!response.ok || !response.body) {
          await rm(jobDir, { recursive: true, force: true });
          return c.json({ error: `Failed to download video: HTTP ${response.status}` }, 400);
        }
        const fileStream = cws(inputPath);
        await pipeline(Readable.fromWeb(response.body as never), fileStream);
      } else {
        // Binary mode: read video from request body (original behavior)
        const body = await c.req.arrayBuffer();
        if (!body || body.byteLength === 0) {
          await rm(jobDir, { recursive: true, force: true });
          return c.json({ error: 'Request body is empty' }, 400);
        }
        await writeFile(inputPath, Buffer.from(body));
      }

      const configRaw = await readFile(configPath, 'utf-8');
      const config = JSON.parse(configRaw);

      const outputPath = path.join(jobDir, 'output.mp4');
      const job = await addJob(JobType.VIDEO_ASSEMBLE, {
        inputPath,
        outputPath,
        segments: config.segments,
        crop: config.crop || undefined
      });

      const rawResult = await job.waitUntilFinished(queueEvents);
      const result = validateJobResult(rawResult);

      if (!result.success) {
        await rm(jobDir, { recursive: true, force: true });
        return c.json({ error: result.error, metadata: result.metadata }, 400);
      }

      if (!result.outputPath) {
        await rm(jobDir, { recursive: true, force: true });
        return c.json({ error: 'Assembly failed - no output' }, 400);
      }

      const outputBuffer = await readFile(result.outputPath);
      const metadata = result.metadata;
      await rm(jobDir, { recursive: true, force: true });

      return c.body(new Uint8Array(outputBuffer), 200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="assembled.mp4"',
        'X-Assembly-Metadata': JSON.stringify(metadata || {})
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Assembly failed', message: msg }, 500);
    }
  });

  // --- Raw binary body endpoints ---

  app.post('/video/cut/binary', async (c) => {
    try {
      const start = c.req.query('start');
      const end = c.req.query('end');
      const precise = c.req.query('precise') ?? 'no';

      if (!start || !end) return c.json({ error: 'start and end query parameters are required' }, 400);

      const body = await c.req.arrayBuffer();
      if (!body || body.byteLength === 0) return c.json({ error: 'Request body is empty' }, 400);

      const file = new File([body], 'input.mp4', { type: 'video/mp4' });

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_CUT,
        outputExtension: 'mp4',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          startTime: start,
          endTime: end,
          precise: precise === 'yes'
        })
      });

      if (!result.success) return c.json({ error: result.error }, 400);
      if (!result.outputBuffer) return c.json({ error: 'Cut failed' }, 400);

      return c.body(new Uint8Array(result.outputBuffer), 200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="output.mp4"'
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: msg }, 500);
    }
  });

  // Two-step sequential concat: init stores file1, finish concats with file2.
  // Each request sends a single file as raw binary body.
  app.post('/video/concat/binary/init', async (c) => {
    try {
      const body = await c.req.arrayBuffer();
      if (!body || body.byteLength === 0) return c.json({ error: 'Request body is empty' }, 400);

      const tempId = randomUUID();
      const tempDir = path.join(env.TEMP_DIR, `concat_${tempId}`);
      await mkdir(tempDir, { recursive: true });
      await writeFile(path.join(tempDir, 'input_0.mp4'), Buffer.from(body));

      return c.json({ tempId }, 200);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: msg }, 500);
    }
  });

  app.post('/video/concat/binary/finish', async (c) => {
    try {
      const tempId = c.req.query('tempId');
      const reencode = c.req.query('reencode') ?? 'no';

      if (!tempId) return c.json({ error: 'tempId query parameter is required' }, 400);

      const tempDir = path.join(env.TEMP_DIR, `concat_${tempId}`);
      const firstFilePath = path.join(tempDir, 'input_0.mp4');

      const { existsSync } = await import('fs');
      if (!existsSync(firstFilePath)) return c.json({ error: 'Invalid or expired tempId' }, 400);

      const body = await c.req.arrayBuffer();
      if (!body || body.byteLength === 0) {
        await rm(tempDir, { recursive: true, force: true });
        return c.json({ error: 'Request body is empty' }, 400);
      }

      const secondFilePath = path.join(tempDir, 'input_1.mp4');
      await writeFile(secondFilePath, Buffer.from(body));

      const outputPath = path.join(tempDir, 'output.mp4');
      const job = await addJob(JobType.VIDEO_CONCAT, {
        inputPaths: [firstFilePath, secondFilePath],
        outputPath,
        reencode: reencode === 'yes'
      });

      const rawResult = await job.waitUntilFinished(queueEvents);
      const result = validateJobResult(rawResult);

      if (!result.success) {
        await rm(tempDir, { recursive: true, force: true });
        return c.json({ error: result.error }, 400);
      }

      if (!result.outputPath) {
        await rm(tempDir, { recursive: true, force: true });
        return c.json({ error: 'Concat failed' }, 400);
      }

      const outputBuffer = await readFile(result.outputPath);
      await rm(tempDir, { recursive: true, force: true });

      return c.body(new Uint8Array(outputBuffer), 200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="concat_output.mp4"'
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: msg }, 500);
    }
  });

  app.post('/video/crop/binary', async (c) => {
    try {
      const w = c.req.query('w');
      const h = c.req.query('h');
      const x = c.req.query('x');
      const y = c.req.query('y');
      const sw = c.req.query('sw');
      const sh = c.req.query('sh');

      if (!w || !h) return c.json({ error: 'w and h query parameters are required' }, 400);

      const body = await c.req.arrayBuffer();
      if (!body || body.byteLength === 0) return c.json({ error: 'Request body is empty' }, 400);

      const file = new File([body], 'input.mp4', { type: 'video/mp4' });

      const result = await processMediaJob({
        file,
        jobType: JobType.VIDEO_CROP,
        outputExtension: 'mp4',
        jobData: ({ inputPath, outputPath }) => ({
          inputPath,
          outputPath,
          w,
          h,
          x: x ?? undefined,
          y: y ?? undefined,
          sw: sw ?? undefined,
          sh: sh ?? undefined
        })
      });

      if (!result.success) return c.json({ error: result.error }, 400);
      if (!result.outputBuffer) return c.json({ error: 'Crop failed' }, 400);

      return c.body(new Uint8Array(result.outputBuffer), 200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="output.mp4"'
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: msg }, 500);
    }
  });
}
