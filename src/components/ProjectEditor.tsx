'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { StorageStatus } from './StorageStatus';
import { useProjectStore } from '@/model/provider';
import { downloadProject } from '@/model/download';

const EditorCanvas = dynamic(
  () => import('@/editor2d/EditorCanvas').then((module) => module.EditorCanvas),
  {
    ssr: false,
    loading: () => (
      <p className="py-12 text-center text-stone-500">正在加载画布…</p>
    ),
  },
);
const STEPS = [
  { id: 'recognize', label: '识别' },
  { id: 'edit', label: '编辑' },
  { id: 'furniture', label: '家具' },
  { id: 'style', label: '风格' },
  { id: 'anchors', label: '锚点' },
  { id: 'render', label: '渲染' },
  { id: 'publish', label: '发布' },
] as const;

export function ProjectEditor({ id }: { id: string }) {
  const [step, setStep] = useState<(typeof STEPS)[number]['id']>('edit');
  const state = useProjectStore((store) => store);
  const project = state.currentProject?.id === id ? state.currentProject : null;
  const { hydration, openProject, closeProject } = state;
  useEffect(() => {
    if (hydration === 'ready') {
      void openProject(id);
      return closeProject;
    }
  }, [id, hydration, openProject, closeProject]);

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(
      new FormData(event.currentTarget).get('name') || '',
    ).trim();
    if (name) state.updateProject({ name });
  }
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <Link className="inline-block text-emerald-800 underline" href="/">
        返回项目列表
      </Link>
      <h1 className="text-3xl font-semibold">项目编辑器</h1>
      <StorageStatus />
      {state.projectLoad === 'loading' && <p role="status">正在打开项目…</p>}
      {state.projectError && (
        <div role="alert">
          <p>{state.projectError}</p>
          <button
            type="button"
            className="mt-2 underline"
            onClick={() => void openProject(id)}
          >
            重试打开
          </button>
        </div>
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
          <nav
            aria-label="项目步骤"
            className="flex flex-wrap gap-2 rounded-xl bg-stone-100 p-2"
          >
            {STEPS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-current={step === item.id ? 'step' : undefined}
                onClick={() => setStep(item.id)}
                className={
                  step === item.id
                    ? 'flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-3 text-sm font-medium text-white'
                    : 'flex items-center gap-2 rounded-lg px-4 py-3 text-sm text-stone-600 hover:bg-white'
                }
              >
                <span aria-hidden="true">{index + 1}</span>
                {item.label}
              </button>
            ))}
          </nav>
          {step === 'edit' ? (
            <EditorCanvas key={project.id} background={project.background} />
          ) : (
            <section
              className="rounded-2xl border border-stone-200 bg-white p-10 text-center"
              aria-label={`${STEPS.find((item) => item.id === step)?.label}步骤`}
            >
              <h2 className="text-xl font-medium">
                {STEPS.find((item) => item.id === step)?.label}
              </h2>
              <p className="mt-3 text-stone-600">
                此步骤将在后续版本提供。当前可以上传户型图、调整画布和手动校准比例尺。
              </p>
              <button
                type="button"
                className="mt-6 text-emerald-800 underline"
                onClick={() => setStep('edit')}
              >
                返回编辑步骤
              </button>
            </section>
          )}
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
              当前可上传户型图并校准比例尺，底图修改支持撤销与重做。墙体、门窗、房间和家具的绘制工具将在后续版本提供。
            </p>
          </section>
        </>
      )}
    </main>
  );
}
