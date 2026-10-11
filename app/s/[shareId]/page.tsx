import Link from 'next/link';

export default function SharePage() {
  return (
    <main className="mx-auto max-w-lg space-y-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">全景查看</h1>
      <p className="text-stone-600">全景分享功能正在准备中。</p>
      <Link className="inline-block text-emerald-800 underline" href="/">
        返回首页
      </Link>
    </main>
  );
}
