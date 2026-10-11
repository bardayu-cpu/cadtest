import { describe, expect, it } from 'vitest';
import {
  createProject,
  exportProjectJson,
  parseProjectJson,
} from '../../src/model/project';
import { projectSchema } from '../../src/model/schema';
import { completeProject } from '../helpers/project';

describe('project model and JSON', () => {
  it('creates independent version 2 projects with millimetre defaults', () => {
    const first = createProject('  我的家  ');
    const second = createProject('');
    expect(projectSchema.parse(first)).toEqual(first);
    expect(first.name).toBe('我的家');
    expect(second.name).toBe('未命名项目');
    expect(first.id).not.toBe(second.id);
    expect(first.settings).toEqual({
      wallHeight: 2800,
      defaultWallThickness: 240,
    });
    expect(first.walls).not.toBe(second.walls);
  });
  it('round trips every field, including future-stage optional data, without changing it', () => {
    const project = completeProject();
    expect(parseProjectJson(exportProjectJson(project))).toEqual({
      success: true,
      project,
    });
  });
  it.each(['{', 'null', '[]', '{}', '{"version":1}'])(
    'reports invalid JSON in Chinese without throwing: %s',
    (text) => {
      const result = parseProjectJson(text);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('无法导入');
    },
  );
  it('rejects invalid nested fields, unsupported versions and unknown fields', () => {
    const project = completeProject();
    expect(projectSchema.safeParse({ ...project, version: 1 }).success).toBe(
      false,
    );
    expect(
      projectSchema.safeParse({ ...project, unexpected: true }).success,
    ).toBe(false);
    project.walls[0].confidence = 2;
    expect(projectSchema.safeParse(project).success).toBe(false);
    project.walls[0].confidence = 0.9;
    project.background.mmPerPixel = 0;
    expect(projectSchema.safeParse(project).success).toBe(false);
  });
  it('rejects duplicate entity ids and non-JSON render parameters', () => {
    const project = completeProject();
    project.walls.push({ ...project.walls[0] });
    expect(projectSchema.safeParse(project).success).toBe(false);
    project.walls.pop();
    project.floorPlanRenders[0].params.invalid = undefined;
    expect(projectSchema.safeParse(project).success).toBe(false);
  });
});

const invalidReferences: {
  name: string;
  change(project: ReturnType<typeof completeProject>): void;
  path: string;
  message: string;
}[] = [
  {
    name: 'opening wall',
    change: (p) => {
      p.openings[0].wallId = 'missing';
    },
    path: 'openings.0.wallId',
    message: '门窗引用的墙体不存在',
  },
  {
    name: 'equal opening heights',
    change: (p) => {
      p.openings[0].sillHeight = p.openings[0].headHeight;
    },
    path: 'openings.0.sillHeight',
    message: '门窗底部高度必须小于顶部高度',
  },
  {
    name: 'reversed opening heights',
    change: (p) => {
      p.openings[0].sillHeight = 3000;
    },
    path: 'openings.0.sillHeight',
    message: '门窗底部高度必须小于顶部高度',
  },
  {
    name: 'anchor room',
    change: (p) => {
      p.anchors[0].roomId = 'missing';
    },
    path: 'anchors.0.roomId',
    message: '锚点引用的房间不存在',
  },
  {
    name: 'hotspot target',
    change: (p) => {
      p.anchors[0].links[0].targetAnchorId = 'missing';
    },
    path: 'anchors.0.links.0.targetAnchorId',
    message: '热点引用的锚点不存在',
  },
  {
    name: 'self hotspot',
    change: (p) => {
      p.anchors[0].links[0].targetAnchorId = p.anchors[0].id;
    },
    path: 'anchors.0.links.0.targetAnchorId',
    message: '热点不能指向自身锚点',
  },
  {
    name: 'furniture room',
    change: (p) => {
      p.furniture[0].roomId = 'missing';
    },
    path: 'furniture.0.roomId',
    message: '家具引用的房间不存在',
  },
  {
    name: 'panorama anchor',
    change: (p) => {
      p.panoramas[0].anchorId = 'missing';
    },
    path: 'panoramas.0.anchorId',
    message: '全景引用的锚点不存在',
  },
  {
    name: 'approved floor plan',
    change: (p) => {
      p.approvedFloorPlanId = 'missing';
    },
    path: 'approvedFloorPlanId',
    message: '已确认的彩平图不存在',
  },
];

it.each(invalidReferences)(
  'rejects an invalid $name reference with a Chinese field error',
  ({ change, path, message }) => {
    const project = completeProject();
    change(project);
    const result = parseProjectJson(JSON.stringify(project));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(path);
      expect(result.error).toContain(message);
    }
  },
);
it('permits unassigned furniture and an unapproved floor plan', () => {
  const project = completeProject();
  delete project.furniture[0].roomId;
  delete project.approvedFloorPlanId;
  expect(projectSchema.safeParse(project).success).toBe(true);
});
