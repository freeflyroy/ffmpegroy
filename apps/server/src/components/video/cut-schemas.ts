import { createRoute, z } from '@hono/zod-openapi';
import { FileSchema, ErrorSchema, UrlResponseSchema } from '~/utils/schemas';

const CutQuerySchema = z.object({
  start: z.string().openapi({
    param: { name: 'start', in: 'query' },
    example: '00:01:30',
    description: 'Start time (HH:MM:SS or seconds)'
  }),
  end: z.string().openapi({
    param: { name: 'end', in: 'query' },
    example: '00:02:45',
    description: 'End time (HH:MM:SS or seconds)'
  }),
  precise: z.enum(['yes', 'no']).optional().default('no').openapi({
    param: { name: 'precise', in: 'query' },
    example: 'no',
    description: 'Frame-accurate cut via re-encoding (yes) or fast keyframe cut (no)'
  })
});

export const videoCutRoute = createRoute({
  method: 'post',
  path: '/video/cut',
  tags: ['Video'],
  request: {
    query: CutQuerySchema,
    body: {
      content: { 'multipart/form-data': { schema: z.object({ file: FileSchema }) } },
      required: true
    }
  },
  responses: {
    200: { content: { 'video/mp4': { schema: FileSchema } }, description: 'Cut video segment' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Invalid parameters' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Processing failed' }
  }
});

export const videoCutUrlRoute = createRoute({
  method: 'post',
  path: '/video/cut/url',
  tags: ['Video'],
  request: {
    query: CutQuerySchema,
    body: {
      content: { 'multipart/form-data': { schema: z.object({ file: FileSchema }) } },
      required: true
    }
  },
  responses: {
    200: { content: { 'application/json': { schema: UrlResponseSchema } }, description: 'Cut video uploaded to S3' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Invalid parameters or S3 not enabled' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Processing failed' }
  }
});
