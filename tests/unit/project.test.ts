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
