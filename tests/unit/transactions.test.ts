import { expect, it } from 'vitest';
import { createProjectStore, HISTORY_LIMIT } from '../../src/model/store';
import { completeProject } from '../helpers/project';
import { memoryStorage } from '../helpers/storage';
async function setup() {
  const project = completeProject();
  const storage = memoryStorage([project]);
  const store = createProjectStore(storage);
  await store.getState().hydrate();
  await store.getState().openProject(project.id);
  return { store, project, storage };
}
it.each(['endpoint', 'whole wall'])(
  'updates a %s drag in real time, saves it, and restores all positions/source in one undo',
  async (kind) => {
    const { store, project, storage } = await setup();
    const s = store.getState();
    s.beginTransaction();
    for (const x of [100, 200, 400, 800]) {
      s.updateWall(
        'wall-1',
        kind === 'endpoint'
          ? { end: { x: 5000 + x, y: 0 } }
          : { start: { x, y: 500 }, end: { x: 5000 + x, y: 500 } },
      );
      expect(store.getState().past).toHaveLength(0);
      expect(store.getState().currentProject!.walls[0].end.x).toBe(5000 + x);
    }
    await s.flush();
    expect(storage.save.mock.calls.at(-1)![0].walls[0].end.x).toBe(5800);
    const moved = store.getState().currentProject;
    s.endTransaction();
    expect(store.getState().past).toHaveLength(1);
    s.undo();
    expect(store.getState().currentProject).toEqual(project);
    s.redo();
    expect(store.getState().currentProject).toEqual(moved);
    expect(store.getState().currentProject!.walls[0].source).toBe('manual');
    await s.flush();
  },
);
it('cancels a drag including its manual flag, preserving the previous redo branch', async () => {
  const { store, project } = await setup();
  const s = store.getState();
  s.updateProject({ name: 'changed' });
  s.undo();
  const future = store.getState().future;
  s.beginTransaction();
  s.updateWall('wall-1', { end: { x: 5500, y: 0 } });
  s.cancelTransaction();
  expect(store.getState().currentProject).toEqual(project);
  expect(store.getState().future).toEqual(future);
  expect(store.getState().past).toHaveLength(0);
  await s.flush();
});
it('does not record unchanged or returned-to-origin drags and supports nested batches', async () => {
  const { store } = await setup();
  const s = store.getState();
  s.updateWall('wall-1', { thickness: 240 }); // A manual touch retains the same geometry.
  const count = store.getState().past.length;
  const original = store.getState().currentProject!.walls[0];
  s.beginTransaction();
  s.beginTransaction();
  s.updateWall('wall-1', { end: { x: 6000, y: 0 } });
  s.updateWall('wall-1', { end: original.end });
  s.endTransaction();
  expect(store.getState().transactionActive).toBe(true);
  s.endTransaction();
  expect(store.getState().past).toHaveLength(count);
  s.beginTransaction();
  s.endTransaction();
  expect(store.getState().past).toHaveLength(count);
  await s.flush();
});
it('undo during a drag finalizes and undoes it; switching projects cannot leak a transaction', async () => {
  const { store, project } = await setup();
  const s = store.getState();
  s.beginTransaction();
  s.updateWall('wall-1', { end: { x: 6000, y: 0 } });
  s.undo();
  expect(store.getState().currentProject).toEqual(project);
  expect(store.getState().transactionActive).toBe(false);
  s.beginTransaction();
  s.updateWall('wall-1', { thickness: 120 });
  s.createProject('next');
  expect(store.getState().transactionActive).toBe(false);
  expect(store.getState().past).toHaveLength(0);
  await s.openProject(project.id);
  expect(store.getState().currentProject!.walls[0].thickness).toBe(120);
  s.beginTransaction();
  expect(() => s.updateWall('wall-1', { thickness: -1 })).toThrow();
  s.endTransaction();
  expect(store.getState().past).toHaveLength(0);
  await s.flush();
});
it('preserves the history bound for many completed drags', async () => {
  const { store } = await setup();
  const s = store.getState();
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
    s.beginTransaction();
    s.updateWall('wall-1', { end: { x: 6000 + i, y: 0 } });
    s.endTransaction();
  }
  expect(store.getState().past).toHaveLength(HISTORY_LIMIT);
  await s.flush();
});
