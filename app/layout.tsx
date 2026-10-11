import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ProjectProvider } from '@/model/provider';

export const metadata: Metadata = {
  title: 'cadtest · 户型图到全景效果图',
  description: '从户型平面图开始，规划空间并生成室内全景效果图。',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ProjectProvider>{children}</ProjectProvider>
      </body>
    </html>
  );
}
