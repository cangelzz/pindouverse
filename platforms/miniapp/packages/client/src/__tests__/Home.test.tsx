import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Home from '../pages/Home';

describe('Home', () => {
  it('renders title 拼豆工坊', () => {
    render(<Home onNavigate={() => {}} />);
    expect(screen.getByText('拼豆工坊')).toBeInTheDocument();
  });

  it('has 开始创作 button', () => {
    render(<Home onNavigate={() => {}} />);
    expect(screen.getByText('开始创作')).toBeInTheDocument();
  });

  it('has 我的作品 button', () => {
    render(<Home onNavigate={() => {}} />);
    expect(screen.getByText('我的作品')).toBeInTheDocument();
  });

  it('calls onNavigate with "import" when 开始创作 clicked', () => {
    const onNavigate = vi.fn();
    render(<Home onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('开始创作'));
    expect(onNavigate).toHaveBeenCalledWith('import');
  });

  it('calls onNavigate with "projects" when 我的作品 clicked', () => {
    const onNavigate = vi.fn();
    render(<Home onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('我的作品'));
    expect(onNavigate).toHaveBeenCalledWith('projects');
  });
});
