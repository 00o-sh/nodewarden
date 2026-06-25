import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import WebsiteIcon from '@/components/vault/WebsiteIcon';
import type { Cipher } from '@/lib/types';

describe('<WebsiteIcon>', () => {
  it('renders the fallback when the cipher has no resolvable host', () => {
    const cipher = { login: { uris: [] } } as unknown as Cipher;
    const { container } = render(<WebsiteIcon cipher={cipher} fallback={<span>FB</span>} />);
    expect(container.querySelector('.list-icon-fallback')?.textContent).toBe('FB');
  });

  it('renders an icon stack for a cipher with a host', () => {
    const cipher = {
      login: { uris: [{ uri: 'https://example.com' }] },
    } as unknown as Cipher;
    const { container } = render(<WebsiteIcon cipher={cipher} />);
    // Before the network icon resolves, the fallback shows inside the stack.
    expect(container.querySelector('.list-icon-stack')).not.toBeNull();
  });
});
