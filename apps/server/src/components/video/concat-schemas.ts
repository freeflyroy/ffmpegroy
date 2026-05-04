import { createRoute, z } from '@hono/zod-openapi';
import { FileSchema, ErrorSchema, UrlResponseSchema } from '~/utils/schemas';

const ConcatQuerySchema = z.object({
  reencode: z.enum(['yes', 'no']).optional().default('no').openapi({
    param: { name: 'reencode', in: 'query' },
    example: 'no',
    description: 'Re-encode output (yes) or stream copy (no). Use yes if inputs have different codecs.'
  })
});

const MultiFileSchema = z.object({
  files: z.array(FileSchema).min(2).openapi({
    description: 'Two or more video files to concatenate in order'
  })
});

export const videoConcatRoute = createRoute({
  method: 'post',
  path: '/video/concat',
  tags: ['Video'],
  request: {
    query: ConcatQuerySchema,
    body: {
      content: { 'multipart/form-data': { schema: MultiFileSchema } },
      required: true
    }
  },
  responses: {
    200: { content: { 'video/mp4': { schema: FileSchema } }, description: 'Concatenated video' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Invalid parameters' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Processing failed' }
  }
});

export const videoConcatUrlRoute = createRoute({
  method: 'post',
  path: '/video/concat/url',
  tags: ['Video'],
  request: {
    query: ConcatQuerySchema,
    body: {
      content: { 'multipart/form-data': { schema: MultiFileSchema } },
      required: true
    }
  },
  responses: {
    200: { content: { 'application/json': { schema: UrlResponseSchema } }, description: 'Concatenated video uploaded to S3' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Invalid parameters or S3 not enabled' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Processing failed' }
  }
});
