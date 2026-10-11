import { expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, sanitizeFloorPlan } from '../../src/editor2d/image';

it('rejects unsupported files before allocating browser image resources', async () => {
  await expect(
    sanitizeFloorPlan(
      new File(['plain text'], 'floorplan.svg', { type: 'image/svg+xml' }),
    ),
  ).rejects.toThrow('JPG、PNG 或 WebP');
});
it('rejects oversized files before allocating browser image resources', async () => {
  const file = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'large.png', {
    type: 'image/png',
  });
  await expect(sanitizeFloorPlan(file)).rejects.toThrow('20 MB');
});
