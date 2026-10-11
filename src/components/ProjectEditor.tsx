'use client';

import Link from 'next/link';
import { useEffect, type FormEvent } from 'react';
import { StorageStatus } from './StorageStatus';
import { useProjectStore } from '@/model/provider';
import { downloadProject } from '@/model/download';

export function ProjectEditor({ id }: { id: string }) {
  const state = useProjectStore((store) => store);
  const project = state.projects.find((item) => item.id === id);
  const storedId = project?.id;
  const { hydration, openProject, closeProject } = state;
  useEffect(() => {
    if (hydration === 'ready' && storedId) {
      openProject(id);
      return closeProject;
    }
  }, [id, storedId, hydration, openProject, closeProject]);

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(
      new FormData(event.currentTarget).get('name') || '',
    ).trim();
    if (name) state.updateProject({ name });
  }
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-16">
      <Link className="inline-block text-emerald-800 underline" href="/">
        返回项目列表
      </Link>
      <h1 className="text-3xl font-semibold">项目编辑器</h1>
      <StorageStatus />
      {state.hydration === 'ready' && !project && (
        <p role="alert">项目不存在或已被删除，请返回项目列表。</p>
      )}
      {project && (
        <>
          <section
            className="space-y-5 rounded-2xl border border-stone-200 bg-white p-6"
            aria-label="项目信息"
          >
            <h2 className="break-words text-2xl font-medium">{project.name}</h2>
            <form onSubmit={rename} className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-2">
                项目名称
                <input
                  key={project.name}
                  name="name"
                  defaultValue={project.name}
                  required
                  maxLength={200}
                  className="rounded-lg border border-stone-300 px-3 py-2"
                />
              </label>
              <button
                type="submit"
                disabled={state.activeProjectId !== id}
                className="rounded-lg bg-emerald-800 px-4 py-2 text-white disabled:opacity-50"
              >
                保存名称
              </button>
            </form>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={state.activeProjectId !== id || !state.past.length}
                onClick={state.undo}
                className="rounded-lg border border-stone-300 px-4 py-2 disabled:opacity-40"
              >
                撤销
              </button>
              <button
                type="button"
                disabled={state.activeProjectId !== id || !state.future.length}
                onClick={state.redo}
                className="rounded-lg border border-stone-300 px-4 py-2 disabled:opacity-40"
              >
                重做
              </button>
              <button
                type="button"
                onClick={() => downloadProject(project)}
                className="rounded-lg border border-stone-300 px-4 py-2"
              >
                导出 JSON
              </button>
            </div>
            <p className="text-sm text-stone-600">
              Ctrl / Cmd + Z 撤销，Ctrl / Cmd + Shift + Z
              重做。输入框内保留文字编辑快捷键。
            </p>
          </section>
          <section
            className="space-y-3 rounded-2xl border border-stone-200 bg-white p-6"
            aria-label="项目数据概览"
          >
            <h2 className="text-xl font-medium">项目数据</h2>
            <p>
              {project.walls.length} 面墙 · {project.openings.length} 个门窗 ·{' '}
              {project.rooms.length} 个房间 · {project.furniture.length} 件家具
              · {project.anchors.length} 个锚点
            </p>
            <p className="text-stone-600">
              画布与空间编辑功能将在后续版本中提供。当前可管理、备份项目并撤销或重做项目名称修改。
            </p>
          </section>
        </>
      )}
    </main>
  );
}
