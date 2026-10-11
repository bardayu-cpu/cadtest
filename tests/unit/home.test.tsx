import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from '../../app/page';

describe('project list scaffold', () => {
  it('renders a Chinese empty state without an unfinished create action', () => {
    const html = renderToStaticMarkup(createElement(HomePage));

    expect(html).toContain('我的项目');
    expect(html).toContain('暂无项目');
    expect(html).toContain('aria-labelledby="empty-projects-title"');
    expect(html).not.toContain('<button');
  });
});
