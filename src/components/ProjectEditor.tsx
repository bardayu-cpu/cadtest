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
      <p className="p-8 text-center text-stone-500">正在加载画布…</p>
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
const actionClass =
  'rounded border border-stone-200 px-2 py-1 text-xs hover:bg-stone-100 disabled:opacity-40';

export function ProjectEditor({ id }: { id: string }) {
  const [step, setStep] = useState<(typeof STEPS)[number]['id']>('edit');
  const [informationOpen, setInformationOpen] = useState(false);
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
    if (name) {
      state.updateProject({ name });
      setInformationOpen(false);
    }
  }
  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <header className="relative z-40 flex shrink-0 flex-wrap items-center gap-x-3 border-b border-stone-200 bg-white px-3 lg:h-12 lg:flex-nowrap">
        <div className="flex h-12 min-w-0 flex-1 items-center gap-3 lg:max-w-[220px] lg:flex-initial">
          <Link
            href="/"
            aria-label="返回项目列表"
            title="返回项目列表"
            className="shrink-0 text-emerald-800"
          >
            ←
          </Link>
          <h1 className="truncate text-sm font-semibold" title={project?.name}>
            {project?.name ?? '项目编辑器'}
          </h1>
        </div>
        {project && (
          <nav
            aria-label="项目步骤"
            className="order-3 flex h-9 min-w-0 basis-full items-center gap-1 overflow-x-auto lg:order-none lg:h-12 lg:flex-1 lg:basis-auto"
          >
            {STEPS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-current={step === item.id ? 'step' : undefined}
                onClick={() => setStep(item.id)}
                className={`flex shrink-0 items-center gap-1 rounded px-2 py-1.5 text-xs ${step === item.id ? 'bg-emerald-800 font-medium text-white' : 'text-stone-600 hover:bg-stone-100'}`}
              >
                <span aria-hidden="true">{index + 1}</span>
                {item.label}
              </button>
            ))}
          </nav>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <StorageStatus compact />
          {project && (
            <>
              <button
                type="button"
                className={actionClass}
                disabled={state.activeProjectId !== id || !state.past.length}
                onClick={state.undo}
              >
                撤销
              </button>
              <button
                type="button"
                className={actionClass}
                disabled={state.activeProjectId !== id || !state.future.length}
                onClick={state.redo}
              >
                重做
              </button>
              <button
                type="button"
                className={actionClass}
                onClick={() => downloadProject(project)}
              >
                导出 JSON
              </button>
              <button
                type="button"
                className={actionClass}
                aria-expanded={informationOpen}
                aria-controls="project-information"
                onClick={() => setInformationOpen(!informationOpen)}
              >
                项目信息
              </button>
            </>
          )}
        </div>
        {project && informationOpen && (
          <section
            id="project-information"
            aria-label="项目信息"
            className="absolute right-2 top-full z-50 w-80 max-w-[calc(100vw-16px)] space-y-4 rounded-b-xl border border-stone-200 bg-white p-4 shadow-lg"
          >
            <form onSubmit={rename} className="space-y-3">
              <label className="flex flex-col gap-2 text-sm">
                项目名称
                <input
                  key={project.name}
                  name="name"
                  defaultValue={project.name}
                  required
                  maxLength={200}
                  className="rounded border border-stone-300 px-3 py-2"
                />
              </label>
              <button
                type="submit"
                disabled={state.activeProjectId !== id}
                className="rounded bg-emerald-800 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                保存名称
              </button>
            </form>
            <p className="text-xs leading-relaxed text-stone-500">
              Ctrl / Cmd + Z 撤销，Ctrl / Cmd + Shift + Z
              重做。输入框内保留文字编辑快捷键。
            </p>
            <button
              type="button"
              className="text-sm text-emerald-800 underline"
              onClick={() => setInformationOpen(false)}
            >
              关闭项目信息
            </button>
          </section>
        )}
      </header>
      {state.projectLoad === 'loading' && (
        <p role="status" className="p-6">
          正在打开项目…
        </p>
      )}
      {state.projectError && (
        <div role="alert" className="p-6">
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
      {project &&
        (step === 'edit' ? (
          <EditorCanvas key={project.id} project={project} />
        ) : (
          <section
            className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
            aria-label={`${STEPS.find((item) => item.id === step)?.label}步骤`}
          >
            <h2 className="text-xl font-medium">
              {STEPS.find((item) => item.id === step)?.label}
            </h2>
            <p className="text-stone-600">
              此步骤将在后续版本提供。当前可以上传户型图、调整画布和手动校准比例尺。
            </p>
            <button
              type="button"
              className="text-emerald-800 underline"
              onClick={() => setStep('edit')}
            >
              返回编辑步骤
            </button>
          </section>
        ))}
    </main>
  );
}
