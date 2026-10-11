'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { StorageStatus } from '@/components/StorageStatus';
import { useProjectStore } from '@/model/provider';
import { parseProjectJson } from '@/model/project';
import { downloadProject } from '@/model/download';

export default function HomePage() {
  const router = useRouter();
  const state = useProjectStore((store) => store);
  const [message, setMessage] = useState<string | null>(null);
  const ready = state.hydration === 'ready';

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = state.createProject(String(data.get('name') || '未命名项目'));
    router.push(`/project/${encodeURIComponent(id)}`);
  }
  async function onImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseProjectJson(text);
      if (!parsed.success) {
        setMessage(parsed.error);
        return;
      }
      const exists = state.projects.some(
        (project) => project.id === parsed.project.id,
      );
      if (
        exists &&
        !window.confirm('此项目已存在。导入会覆盖本机的同编号项目，是否继续？')
      )
        return;
      const result = state.importProject(text, exists);
      setMessage(result.success ? '项目导入成功。' : result.error);
    } catch {
      setMessage('无法读取文件，请重新选择 JSON 项目文件。');
    }
  }

  async function onExport(id: string) {
    try {
      downloadProject(await state.readProject(id));
    } catch {
      setMessage('无法导出：项目不存在或数据格式错误，请重试。');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16 sm:px-10">
      <header className="space-y-3">
        <p className="text-sm font-medium tracking-wide text-emerald-800">
          cadtest
        </p>
        <h1 className="text-3xl font-semibold sm:text-4xl">我的项目</h1>
        <p className="max-w-xl leading-7 text-stone-600">
          从一张户型图开始，规划你的室内空间。项目自动保存在当前浏览器，可导出
          JSON 备份。
        </p>
      </header>
      <StorageStatus />
      <section
        aria-labelledby="new-project-title"
        className="rounded-2xl border border-stone-200 bg-white p-6"
      >
        <h2 id="new-project-title" className="text-xl font-medium">
          新建项目
        </h2>
        <form
          onSubmit={onCreate}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <label className="flex min-w-0 flex-1 flex-col gap-2">
            项目名称
            <input
              name="name"
              placeholder="未命名项目"
              maxLength={200}
              disabled={!ready}
              className="rounded-lg border border-stone-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={!ready}
            className="rounded-lg bg-emerald-800 px-4 py-2 text-white disabled:opacity-50"
          >
            新建项目
          </button>
        </form>
        <label className="mt-5 flex flex-wrap items-center gap-3 text-sm">
          导入 JSON 项目
          <input
            type="file"
            accept=".json,application/json"
            disabled={!ready}
            onChange={onImport}
            className="min-w-0 max-w-full"
          />
        </label>
        {message && (
          <p role="alert" className="mt-4 rounded-lg bg-stone-100 p-3">
            {message}
          </p>
        )}
      </section>
      {ready &&
        (state.projects.length === 0 ? (
          <section
            aria-labelledby="empty-projects-title"
            className="rounded-2xl border border-stone-200 bg-white px-6 py-12 text-center"
          >
            <h2 id="empty-projects-title" className="text-xl font-medium">
              暂无项目
            </h2>
            <p className="mt-3 leading-7 text-stone-600">
              新建项目，或导入之前导出的 JSON 文件。
            </p>
          </section>
        ) : (
          <section aria-label="项目列表" className="space-y-4">
            {state.projects.map((project) => (
              <article
                key={project.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-6"
              >
                <div className="min-w-0">
                  <h2 className="break-words text-xl font-medium">
                    {project.name}
                  </h2>
                  <p className="mt-2 text-sm text-stone-600">
                    更新时间：
                    {project.updatedAt
                      .replace('T', ' ')
                      .replace(/\.\d+Z$/, ' UTC')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4">
                  <Link
                    href={`/project/${encodeURIComponent(project.id)}`}
                    className="text-emerald-800 underline"
                    aria-label={`打开 ${project.name}`}
                  >
                    打开
                  </Link>
                  <button
                    type="button"
                    onClick={() => void onExport(project.id)}
                    className="text-emerald-800 underline"
                    aria-label={`导出 ${project.name}`}
                  >
                    导出 JSON
                  </button>
                  <button
                    type="button"
                    className="text-red-800 underline"
                    aria-label={`删除 ${project.name}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `删除“${project.name}”？此操作无法撤销，建议先导出备份。`,
                        )
                      )
                        state.deleteProject(project.id);
                    }}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </section>
        ))}
    </main>
  );
}
