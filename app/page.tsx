export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16 sm:px-10">
      <header className="space-y-3">
        <p className="text-sm font-medium tracking-wide text-emerald-800">
          cadtest
        </p>
        <h1 className="text-3xl font-semibold sm:text-4xl">我的项目</h1>
        <p className="max-w-xl leading-7 text-stone-600">
          从一张户型图开始，规划你的室内空间。
        </p>
      </header>
      <section
        aria-labelledby="empty-projects-title"
        className="rounded-2xl border border-stone-200 bg-white px-6 py-12 text-center"
      >
        <h2 id="empty-projects-title" className="text-xl font-medium">
          暂无项目
        </h2>
        <p className="mt-3 leading-7 text-stone-600">
          新建、保存与编辑项目功能将在后续版本中提供。
        </p>
      </section>
    </main>
  );
}
