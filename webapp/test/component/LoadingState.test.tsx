import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import LoadingState from '@/components/LoadingState';

describe('<LoadingState>', () => {
  it('renders the default number of skeleton rows (4) when no lines prop is given', () => {
    const { container } = render(<LoadingState />);
    expect(container.querySelectorAll('.loading-state-row')).toHaveLength(4);
  });

  it('renders the requested number of rows', () => {
    const { container } = render(<LoadingState lines={7} />);
    expect(container.querySelectorAll('.loading-state-row')).toHaveLength(7);
  });

  it('clamps a negative lines value to a minimum of 1', () => {
    // A negative (truthy) value bypasses the `|| 4` default and is clamped via Math.max.
    const { container } = render(<LoadingState lines={-3} />);
    expect(container.querySelectorAll('.loading-state-row')).toHaveLength(1);
  });

  it('is hidden from assistive tech via aria-hidden', () => {
    const { container } = render(<LoadingState />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the plain loading-state class by default (not card)', () => {
    const { container } = render(<LoadingState />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('loading-state');
    expect(root.className).not.toContain('loading-state-card');
    expect(root.className).not.toContain('card');
  });

  it('applies card classes when card is set', () => {
    const { container } = render(<LoadingState card />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('loading-state-card');
    expect(root.className).toContain('card');
  });

  it('applies the compact modifier when compact is set', () => {
    const { container } = render(<LoadingState compact />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('compact');
  });

  it('appends a custom className', () => {
    const { container } = render(<LoadingState className="my-extra" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('my-extra');
  });
});
