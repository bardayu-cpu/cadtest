import { describe, expect, it, vi } from 'vitest';
import {
  createProjectStore,
  HISTORY_LIMIT,
  type ProjectState,
} from '../../src/model/store';
import { exportProjectJson } from '../../src/model/project';
import type { Project } from '../../src/model/types';
import { completeProject } from '../helpers/project';

async function setup() {
  const project = completeProject();
  const storage = {
    load: vi.fn(async () => [project]),
    save: vi.fn(async () => {}),
  };
  const store = createProjectStore(storage);
  await store.getState().hydrate();
  store.getState().openProject(project.id);
  return { store, project, storage };
}
const cases: {
  name: string;
  add(state: ProjectState, project: Project): void;
  update(state: ProjectState): void;
  remove(state: ProjectState): void;
  entity(project: Project): { id: string; source: string } | undefined;
}[] = [
  {
    name: 'wall',
    add: (s, p) => s.addWall({ ...p.walls[0], id: 'new' }),
    update: (s) => s.updateWall('new', { thickness: 120 }),
    remove: (s) => s.removeWall('new'),
    entity: (p) => p.walls.find((item) => item.id === 'new'),
  },
  {
    name: 'opening',
    add: (s, p) => s.addOpening({ ...p.openings[0], id: 'new' }),
    update: (s) => s.updateOpening('new', { width: 1200 }),
    remove: (s) => s.removeOpening('new'),
    entity: (p) => p.openings.find((item) => item.id === 'new'),
  },
  {
    name: 'room',
    add: (s, p) => s.addRoom({ ...p.rooms[0], id: 'new' }),
    update: (s) => s.updateRoom('new', { name: '卧室' }),
    remove: (s) => s.removeRoom('new'),
    entity: (p) => p.rooms.find((item) => item.id === 'new'),
  },
  {
    name: 'furniture',
    add: (s, p) => s.addFurniture({ ...p.furniture[0], id: 'new' }),
    update: (s) => s.updateFurniture('new', { rotation: 180 }),
    remove: (s) => s.removeFurniture('new'),
    entity: (p) => p.furniture.find((item) => item.id === 'new'),
  },
  {
    name: 'anchor',
    add: (s, p) => s.addAnchor({ ...p.anchors[0], id: 'new' }),
    update: (s) => s.updateAnchor('new', { initialHeading: 180 }),
    remove: (s) => s.removeAnchor('new'),
    entity: (p) => p.anchors.find((item) => item.id === 'new'),
  },
];

describe('project store', () => {
  it.each(cases)(
    'adds, edits, removes and restores a $name, including auto/manual source',
    async (example) => {
      const { store, project } = await setup();
      const current = () => store.getState().projects[0];
      example.add(store.getState(), project);
      expect(example.entity(current())?.source).toBe('auto');
      expect(() => example.add(store.getState(), project)).toThrow(
        '元素编号已存在',
      );
      example.update(store.getState());
      expect(example.entity(current())?.source).toBe('manual');
      store.getState().undo();
      expect(example.entity(current())?.source).toBe('auto');
      store.getState().redo();
      expect(example.entity(current())?.source).toBe('manual');
      example.remove(store.getState());
      expect(example.entity(current())).toBeUndefined();
      store.getState().undo();
      expect(example.entity(current())?.source).toBe('manual');
      await store.getState().flush();
    },
  );
  it('removes a wall and its openings together, and restores both in one undo', async () => {
    const { store, project } = await setup();
    store.getState().removeWall('wall-1');
    expect(store.getState().projects[0].openings).toEqual([]);
    store.getState().undo();
    expect(store.getState().projects[0]).toEqual(project);
    await store.getState().flush();
  });
  it('removes anchor links and panoramas together, with full undo', async () => {
    const { store, project } = await setup();
    store.getState().removeAnchor('anchor-2');
    expect(store.getState().projects[0].anchors[0].links).toEqual([]);
    expect(store.getState().projects[0].anchors[0].source).toBe('manual');
    expect(store.getState().projects[0].panoramas).toEqual([]);
    store.getState().undo();
    expect(store.getState().projects[0]).toEqual(project);
    await store.getState().flush();
  });
  it('supports more than 50 undo/redo steps and clears redo on a new edit', async () => {
    const { store, project } = await setup();
    for (let index = 1; index <= 60; index++)
      store.getState().updateProject({ name: `项目 ${index}` });
    for (let index = 0; index < 60; index++) store.getState().undo();
    expect(store.getState().projects[0]).toEqual(project);
    for (let index = 0; index < 60; index++) store.getState().redo();
    expect(store.getState().projects[0].name).toBe('项目 60');
    store.getState().undo();
    store.getState().updateProject({ name: '另一修改' });
    expect(store.getState().future).toEqual([]);
    store.getState().redo();
    expect(store.getState().projects[0].name).toBe('另一修改');
    await store.getState().flush();
  });
  it('bounds history and ignores no-op or invalid changes', async () => {
    const { store, project } = await setup();
    store.getState().updateProject({ name: project.name });
    store.getState().removeWall('missing');
    expect(store.getState().past).toHaveLength(0);
    expect(() =>
      store.getState().updateWall('wall-1', { thickness: -1 }),
    ).toThrow();
    expect(store.getState().projects[0]).toEqual(project);
    for (let index = 1; index <= HISTORY_LIMIT + 10; index++)
      store.getState().updateProject({ name: `项目 ${index}` });
    expect(store.getState().past).toHaveLength(HISTORY_LIMIT);
    for (let index = 0; index < HISTORY_LIMIT; index++) store.getState().undo();
    expect(store.getState().projects[0].name).toBe('项目 10');
    await store.getState().flush();
  });
  it('isolates project histories and clears the active project on deletion', async () => {
    const { store, project } = await setup();
    const id = store.getState().createProject('新项目');
    store.getState().updateProject({ name: '修改后' });
    store.getState().openProject(project.id);
    expect(store.getState().past).toEqual([]);
    store.getState().updateProject({ name: '原项目修改' });
    store.getState().undo();
    expect(store.getState().projects.find((item) => item.id === id)?.name).toBe(
      '修改后',
    );
    store.getState().deleteProject(project.id);
    expect(store.getState().activeProjectId).toBeNull();
    expect(store.getState().past).toEqual([]);
    await store.getState().flush();
  });
  it('imports without loss, rejects corrupt input and requires explicit overwrite', async () => {
    const { store, project } = await setup();
    const original = store.getState().projects;
    expect(store.getState().importProject('{').success).toBe(false);
    expect(store.getState().projects).toBe(original);
    expect(
      store.getState().importProject(exportProjectJson(project)).success,
    ).toBe(false);
    store.getState().deleteProject(project.id);
    expect(store.getState().importProject(exportProjectJson(project))).toEqual({
      success: true,
      project,
    });
    expect(store.getState().projects[0]).toEqual(project);
    expect(
      store
        .getState()
        .importProject(
          exportProjectJson({ ...project, name: '导入覆盖' }),
          true,
        ).success,
    ).toBe(true);
    expect(store.getState().projects[0].name).toBe('导入覆盖');
    await store.getState().flush();
  });
  it('does not retain mutable references from action arguments', async () => {
    const { store, project } = await setup();
    const wall = { ...project.walls[0], id: 'new', start: { x: 0, y: 0 } };
    store.getState().addWall(wall);
    wall.start.x = 999;
    expect(store.getState().projects[0].walls[1].start.x).toBe(0);
    await store.getState().flush();
  });
});
