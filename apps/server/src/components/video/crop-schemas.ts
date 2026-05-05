import { createRoute, z } from '@hono/zod-openapi';
import { FileSchema, ErrorSchema, UrlResponseSchema } from '~/utils/schemas';

const CropQuerySchema = z.object({
  w: z.coerce.number().int().positive().openapi({
    param: { name: 'w', in: 'query' },
    example: 608,
    description: 'Crop width in pixels'
  }),
  h: z.coerce.number().int().positive().openapi({
    param: { name: 'h', in: 'query' },
    example: 1080,
    description: 'Crop height in pixels'
  }),
  x: z.coerce.number().int().min(0).openapi({
    param: { name: 'x', in: 'query' },
    example: 656,
    description: 'Crop X offset from left'
  }),
  y: z.coerce.number().int().min(0).openapi({
    param: { name: 'y', in: 'query' },
    example: 0,
    description: 'Crop Y offset from top'
  }),
  sw: z.coerce.number().int().positive().openapi({
    param: { name: 'sw', in: 'query' },
    example: 1080,
    description: 'Scale output width'
  }),
  sh: z.coerce.number().int().positive().openapi({
    param: { name: 'sh', in: 'query' },
    example: 1920,
    description: 'Scale output height'
  })
});

export const videoCropRoute = createRoute({
  method: 'post',
  path: '/video/crop',
  tags: ['Video'],
  request: {
    query: CropQuerySchema,
    body: {
      content: { 'multipart/form-data': { schema: z.object({ file: FileSchema }) } },
      required: true
    }
  },
  responses: {
    200: { content: { 'video/mp4': { schema: FileSchema } }, description: 'Cropped and scaled video' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Invalid parameters' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Processing failed' }
  }
});

export const videoCropUrlRoute = createRoute({
  method: 'post',
  path: '/video/crop/url',
  tags: ['Video'],
  request: {
    query: CropQuerySchema,
    body: {
      content: { 'multipart/form-data': { schema: z.object({ file: FileSchema }) } },
      required: true
    }
  },
  responses: {
    200: { content: { 'application/json': { schema: UrlResponseSchema } }, description: 'Cropped video uploaded to S3' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Invalid parameters or S3 not enabled' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Processing failed' }
  }
});
