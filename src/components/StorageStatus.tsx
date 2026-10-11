'use client';

import { useProjectStore } from '@/model/provider';

export function StorageStatus() {
  const { hydration, isSaving, storageError, hydrate, retrySave } =
    useProjectStore((state) => state);
  if (storageError)
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"
      >
        <p>{storageError}</p>
        <button
          type="button"
          className="mt-2 underline"
          onClick={() => (hydration === 'error' ? void hydrate() : retrySave())}
        >
          重试
        </button>
      </div>
    );
  return (
    <p role="status" className="text-sm text-stone-600">
      {hydration !== 'ready'
        ? '正在读取本地项目…'
        : isSaving
          ? '正在保存…'
          : '已保存到本机'}
    </p>
  );
}
