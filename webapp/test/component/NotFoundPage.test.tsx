import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import NotFoundPage from '@/components/NotFoundPage';

describe('<NotFoundPage>', () => {
  it('renders the 404 code and default title/message', () => {
    render(<NotFoundPage />);
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Page Not Found' })).toBeInTheDocument();
    expect(
      screen.getByText('The page may have been removed, expired, or the link is incomplete.')
    ).toBeInTheDocument();
  });

  it('renders a back-to-home link pointing at / by default', () => {
    render(<NotFoundPage />);
    const link = screen.getByRole('link', { name: /Back To Home/i });
    expect(link).toHaveAttribute('href', '/');
  });

  it('uses custom title, message and homeHref when provided', () => {
    render(<NotFoundPage title="Gone" message="Nothing here" homeHref="/dashboard" />);
    expect(screen.getByRole('heading', { name: 'Gone' })).toBeInTheDocument();
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back To Home/i })).toHaveAttribute('href', '/dashboard');
  });

  it('renders the decorative brand block (logo + wordmark)', () => {
    const { container } = render(<NotFoundPage />);
    const logo = container.querySelector('.not-found-brand .not-found-logo');
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', '/nodewarden-logo.svg');
    expect(container.querySelector('.not-found-brand .not-found-wordmark')).toBeInTheDocument();
  });
});
