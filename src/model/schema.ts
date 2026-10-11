import { z } from 'zod';
import type { Project, ProjectIndexEntry } from './types';

const idSchema = z.string().min(1);
const positive = z.number().positive();
const confidenceSchema = z.number().min(0).max(1).optional();
export const sourceSchema = z.enum(['auto', 'manual']);
export const vec2Schema = z.strictObject({ x: z.number(), y: z.number() });
export const vec3Schema = z.strictObject({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const wallSchema = z.strictObject({
  id: idSchema,
  start: vec2Schema,
  end: vec2Schema,
  thickness: positive,
  height: positive.optional(),
  source: sourceSchema,
  confidence: confidenceSchema,
});
export const openingSchema = z.strictObject({
  id: idSchema,
  wallId: idSchema,
  offset: z.number().nonnegative(),
  width: positive,
  kind: z.enum(['door', 'window', 'sliding_door', 'opening', 'floor_window']),
  sillHeight: z.number().nonnegative(),
  headHeight: positive,
  source: sourceSchema,
  confidence: confidenceSchema,
});
export const roomTypeSchema = z.enum([
  'living',
  'dining',
  'bedroom',
  'master_bedroom',
  'kitchen',
  'bathroom',
  'study',
  'balcony',
  'entrance',
  'corridor',
  'other',
]);
export const roomSchema = z.strictObject({
  id: idSchema,
  type: roomTypeSchema,
  name: z.string(),
  polygon: z.array(vec2Schema).min(3),
  ceilingStyle: z.enum(['flat', 'cove_light', 'drop_edge']),
  source: sourceSchema,
});
export const furnitureSchema = z.strictObject({
  id: idSchema,
  catalogId: idSchema,
  position: vec2Schema,
  rotation: z.number(),
  size: z.strictObject({ w: positive, d: positive, h: positive }),
  elevation: z.number(),
  roomId: idSchema.optional(),
  source: sourceSchema,
});
export const styleConfigSchema = z.strictObject({
  presetId: z.string().optional(),
  keywords: z.string().optional(),
  referenceImageDataUrl: z.string().optional(),
  seed: z.number().int(),
  materialPalette: z.array(z.string()).optional(),
});
export const anchorLinkSchema = z.strictObject({
  targetAnchorId: idSchema,
  yaw: z.number(),
  pitch: z.number(),
  label: z.string(),
});
export const anchorSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  roomId: idSchema,
  position: vec3Schema,
  initialHeading: z.number(),
  links: z.array(anchorLinkSchema),
  source: sourceSchema,
});
export const imageResultSchema = z.strictObject({
  id: idSchema,
  createdAt: z.iso.datetime({ offset: true }),
  imageDataUrl: z.string(),
  provider: z.string(),
  params: z.record(z.string(), z.json()),
});
export const panoramaResultSchema = imageResultSchema.extend({
  anchorId: idSchema,
  approved: z.boolean(),
});
export const recognitionReportSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  method: z.enum(['cv', 'vision_model', 'cv+vision_model']),
  scaleDetected: z.boolean(),
  warnings: z.array(z.string()),
});

export const projectSchema = z
  .strictObject({
    id: idSchema,
    name: z.string().min(1),
    version: z.literal(2),
    background: z.strictObject({
      imageDataUrl: z.string(),
      mmPerPixel: positive,
      offset: vec2Schema,
      opacity: z.number().min(0).max(1),
    }),
    settings: z.strictObject({
      wallHeight: positive,
      defaultWallThickness: positive,
    }),
    recognition: recognitionReportSchema.optional(),
    walls: z.array(wallSchema),
    openings: z.array(openingSchema),
    rooms: z.array(roomSchema),
    furniture: z.array(furnitureSchema),
    requirements: z.string().optional(),
    style: styleConfigSchema,
    floorPlanRenders: z.array(imageResultSchema),
    approvedFloorPlanId: idSchema.optional(),
    anchors: z.array(anchorSchema),
    panoramas: z.array(panoramaResultSchema),
    publish: z
      .strictObject({
        shareId: idSchema,
        publishedAt: z.iso.datetime({ offset: true }),
        revoked: z.boolean(),
      })
      .optional(),
  })
  .superRefine((project, context) => {
    const walls = new Set(project.walls.map((item) => item.id));
    const rooms = new Set(project.rooms.map((item) => item.id));
    const anchors = new Set(project.anchors.map((item) => item.id));
    const renders = new Set(project.floorPlanRenders.map((item) => item.id));
    function invalid(path: (string | number)[], message: string) {
      context.addIssue({ code: 'custom', path, message });
    }
    project.openings.forEach((opening, index) => {
      if (!walls.has(opening.wallId))
        invalid(['openings', index, 'wallId'], '门窗引用的墙体不存在');
      if (opening.sillHeight >= opening.headHeight)
        invalid(
          ['openings', index, 'sillHeight'],
          '门窗底部高度必须小于顶部高度',
        );
    });
    project.anchors.forEach((anchor, index) => {
      if (!rooms.has(anchor.roomId))
        invalid(['anchors', index, 'roomId'], '锚点引用的房间不存在');
      anchor.links.forEach((link, linkIndex) => {
        const path = ['anchors', index, 'links', linkIndex, 'targetAnchorId'];
        if (!anchors.has(link.targetAnchorId))
          invalid(path, '热点引用的锚点不存在');
        else if (link.targetAnchorId === anchor.id)
          invalid(path, '热点不能指向自身锚点');
      });
    });
    project.furniture.forEach((item, index) => {
      if (item.roomId !== undefined && !rooms.has(item.roomId))
        invalid(['furniture', index, 'roomId'], '家具引用的房间不存在');
    });
    project.panoramas.forEach((item, index) => {
      if (!anchors.has(item.anchorId))
        invalid(['panoramas', index, 'anchorId'], '全景引用的锚点不存在');
    });
    if (
      project.approvedFloorPlanId !== undefined &&
      !renders.has(project.approvedFloorPlanId)
    )
      invalid(['approvedFloorPlanId'], '已确认的彩平图不存在');
    for (const collection of [
      'walls',
      'openings',
      'rooms',
      'furniture',
      'anchors',
      'floorPlanRenders',
      'panoramas',
    ] as const) {
      const ids = project[collection].map((item) => item.id);
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: 'custom',
          path: [collection],
          message: '元素编号不能重复',
        });
      }
    }
  }) satisfies z.ZodType<Project>;

export const projectIndexEntrySchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  updatedAt: z.iso.datetime({ offset: true }),
}) satisfies z.ZodType<ProjectIndexEntry>;

export const projectIndexSchema = z
  .array(projectIndexEntrySchema)
  .refine(
    (projects) =>
      new Set(projects.map((project) => project.id)).size === projects.length,
    '项目编号不能重复',
  );
