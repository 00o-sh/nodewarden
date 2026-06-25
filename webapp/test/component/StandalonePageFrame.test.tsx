import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import StandalonePageFrame from '@/components/StandalonePageFrame';

describe('<StandalonePageFrame>', () => {
  it('renders the title and children', () => {
    render(
      <StandalonePageFrame title="Sign in">
        <p>Body content</p>
      </StandalonePageFrame>
    );
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('does not render the eyebrow region when eyebrow is omitted', () => {
    const { container } = render(
      <StandalonePageFrame title="Sign in">
        <p>Body</p>
      </StandalonePageFrame>
    );
    expect(container.querySelector('.standalone-eyebrow')).toBeNull();
  });

  it('renders eyebrow and title accessory content when provided', () => {
    render(
      <StandalonePageFrame
        title="Sign in"
        eyebrow={<span>Welcome back</span>}
        titleAccessory={<span>Beta</span>}
      >
        <p>Body</p>
      </StandalonePageFrame>
    );
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('renders footer links to the repository and author', () => {
    render(
      <StandalonePageFrame title="Sign in">
        <p>Body</p>
      </StandalonePageFrame>
    );
    expect(screen.getByRole('link', { name: 'NodeWarden Repository' })).toHaveAttribute(
      'href',
      'https://github.com/shuaiplus/NodeWarden'
    );
    expect(screen.getByRole('link', { name: 'Author: @shuaiplus' })).toBeInTheDocument();
  });
});
