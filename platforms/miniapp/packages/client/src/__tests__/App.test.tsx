import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
  });

  it('shows home page by default with 拼豆工坊 title', () => {
    render(<App />);
    expect(screen.getByText('拼豆工坊')).toBeInTheDocument();
  });

  it('navigates to import page when clicking 开始创作', () => {
    render(<App />);
    fireEvent.click(screen.getByText('开始创作'));
    // Import page should render (Home should be gone)
    expect(screen.queryByText('拼豆工坊')).not.toBeInTheDocument();
  });
});
