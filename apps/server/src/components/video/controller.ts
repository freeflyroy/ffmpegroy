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

  // --- Raw binary body endpoints ---
  // Workaround for n8n HTTP Request node v4.x multipart/form-data bug.
  // Accept application/octet-stream body instead of multipart file field.

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

  app.post('/video/concat/binary', async (c) => {
    try {
      const reencode = c.req.query('reencode') ?? 'no';

      const body = await c.req.arrayBuffer();
      if (!body || body.byteLength === 0) return c.json({ error: 'Request body is empty' }, 400);

      const file = new File([body], 'input.mp4', { type: 'video/mp4' });
      const inputBuffer = Buffer.from(await file.arrayBuffer());

      const jobId = randomUUID();
      const jobDir = path.join(env.TEMP_DIR, jobId);
      await mkdir(jobDir, { recursive: true });

      const inputPath = path.join(jobDir, 'input_0.mp4');
      await writeFile(inputPath, inputBuffer);

      const outputPath = path.join(jobDir, 'output.mp4');
      const job = await addJob(JobType.VIDEO_CONCAT, {
        inputPaths: [inputPath],
        outputPath,
        reencode: reencode === 'yes'
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
