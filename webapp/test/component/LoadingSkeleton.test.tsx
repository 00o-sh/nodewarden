import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { CardSkeleton, ListSkeleton, PageSkeleton } from '@/components/LoadingSkeleton';

describe('LoadingSkeleton', () => {
  describe('<CardSkeleton>', () => {
    it('renders a card skeleton with avatar and content lines', () => {
      const { container } = render(<CardSkeleton />);
      expect(container.querySelector('.skeleton-card')).toBeInTheDocument();
      expect(container.querySelector('.skeleton-avatar')).toBeInTheDocument();
      expect(container.querySelectorAll('.skeleton-line')).toHaveLength(2);
    });
  });

  describe('<ListSkeleton>', () => {
    it('renders the default number of list items (5)', () => {
      const { container } = render(<ListSkeleton />);
      expect(container.querySelectorAll('.skeleton-list-item')).toHaveLength(5);
    });

    it('renders the requested number of list items', () => {
      const { container } = render(<ListSkeleton count={3} />);
      expect(container.querySelectorAll('.skeleton-list-item')).toHaveLength(3);
    });

    it('renders zero items when count is 0', () => {
      const { container } = render(<ListSkeleton count={0} />);
      expect(container.querySelectorAll('.skeleton-list-item')).toHaveLength(0);
    });
  });

  describe('<PageSkeleton>', () => {
    it('renders a page skeleton with a header and an embedded list skeleton', () => {
      const { container } = render(<PageSkeleton />);
      expect(container.querySelector('.skeleton-page')).toBeInTheDocument();
      expect(container.querySelector('.skeleton-header')).toBeInTheDocument();
      // PageSkeleton embeds a default ListSkeleton (5 items).
      expect(container.querySelectorAll('.skeleton-list-item')).toHaveLength(5);
    });
  });
});
