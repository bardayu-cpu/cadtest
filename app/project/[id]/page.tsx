import Link from 'next/link';

export default function ProjectPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-6 py-16">
      <h1 className="text-3xl font-semibold">项目编辑器</h1>
      <p className="text-stone-600">编辑功能正在准备中。</p>
      <Link className="inline-block text-emerald-800 underline" href="/">
        返回项目列表
      </Link>
    </main>
  );
}
