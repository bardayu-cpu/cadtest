import { projectSchema } from './schema';
import type { Project } from './types';

export type ImportResult =
  { success: true; project: Project } | { success: false; error: string };

export function createProject(name = '未命名项目'): Project {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || '未命名项目',
    version: 2,
    background: {
      imageDataUrl: '',
      mmPerPixel: 1,
      offset: { x: 0, y: 0 },
      opacity: 1,
    },
    settings: { wallHeight: 2800, defaultWallThickness: 240 },
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
    style: { seed: crypto.getRandomValues(new Uint32Array(1))[0] },
    floorPlanRenders: [],
    anchors: [],
    panoramas: [],
  };
}

export function exportProjectJson(project: Project): string {
  return JSON.stringify(projectSchema.parse(project), null, 2);
}

export function parseProjectJson(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      success: false,
      error: '无法导入：文件不是有效的 JSON，请检查文件格式。',
    };
  }
  const result = projectSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.map(String).join('.') || '项目';
    return {
      success: false,
      error:
        issue.code === 'custom'
          ? `无法导入：${issue.message}（${field}）。`
          : `无法导入：项目数据格式错误（${field}），请选择 version 为 2 的完整项目文件。`,
    };
  }
  return { success: true, project: result.data };
}
