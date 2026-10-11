import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomePage from '../../app/page';
import { ProjectProvider } from '../../src/model/provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('project list initial render', () => {
  it('renders safely without browser storage and disables changes until hydration', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectProvider, null, createElement(HomePage)),
    );
    expect(html).toContain('我的项目');
    expect(html).toContain('新建项目');
    expect(html).toContain('正在读取本地项目');
    expect(html).toContain('disabled');
    expect(html).not.toContain('暂无项目');
  });
});
