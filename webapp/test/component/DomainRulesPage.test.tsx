import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import DomainRulesPage from '@/components/DomainRulesPage';
import type { DomainRules } from '@/lib/types';

type Props = Parameters<typeof DomainRulesPage>[0];

function makeRules(overrides: Partial<DomainRules> = {}): DomainRules {
  return {
    equivalentDomains: [],
    customEquivalentDomains: [
      { id: 'r1', domains: ['alpha.com', 'alpha.net'], excluded: false },
    ],
    globalEquivalentDomains: [
      { type: 1, domains: ['google.com', 'youtube.com'], excluded: false },
      { type: 2, domains: ['amazon.com', 'amazon.co.uk'], excluded: false },
    ],
    object: 'domains',
    ...overrides,
  };
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    rules: makeRules(),
    loading: false,
    error: '',
    onRefresh: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onNotify: vi.fn(),
    ...overrides,
  };
}

describe('<DomainRulesPage>', () => {
  it('renders a full-card loading state when loading with no rules', () => {
    render(<DomainRulesPage {...baseProps({ loading: true, rules: null })} />);
    expect(screen.queryByText('Custom equivalent domains')).not.toBeInTheDocument();
  });

  it('renders the toolbar and both sections when rules are present', () => {
    render(<DomainRulesPage {...baseProps()} />);
    expect(screen.getByText('Custom equivalent domains')).toBeInTheDocument();
    expect(screen.getByText('Global equivalent domains')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sync/i })).toBeInTheDocument();
  });

  it('renders existing custom and global rules', () => {
    render(<DomainRulesPage {...baseProps()} />);
    expect(screen.getByText('alpha.com, alpha.net')).toBeInTheDocument();
    expect(screen.getByText('google.com, youtube.com')).toBeInTheDocument();
    expect(screen.getByText('amazon.com, amazon.co.uk')).toBeInTheDocument();
  });

  it('shows the error banner when error prop is set', () => {
    render(<DomainRulesPage {...baseProps({ error: 'boom' })} />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows empty state when there are no custom rules', () => {
    render(
      <DomainRulesPage
        {...baseProps({ rules: makeRules({ customEquivalentDomains: [] }) })}
      />
    );
    expect(screen.getByText('No custom domain rules')).toBeInTheDocument();
  });

  it('fires onRefresh when the Sync button is clicked', () => {
    const onRefresh = vi.fn();
    render(<DomainRulesPage {...baseProps({ onRefresh })} />);
    fireEvent.click(screen.getByRole('button', { name: /Sync/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onSave with normalized custom rules and excluded global types on Save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DomainRulesPage {...baseProps({ onSave })} />);
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [customArg, excludedArg] = onSave.mock.calls[0];
    expect(customArg).toEqual([
      expect.objectContaining({ id: 'r1', domains: ['alpha.com', 'alpha.net'] }),
    ]);
    expect(excludedArg).toEqual([]);
  });

  it('includes a deselected global rule type in the excluded list on Save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DomainRulesPage {...baseProps({ onSave })} />);
    // The global checkboxes are checked (= included). Uncheck the first one.
    const globalSection = screen.getByText('Global equivalent domains').closest('section')!;
    const checkbox = within(globalSection).getAllByRole('checkbox')[0] as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // type 1 corresponds to the first sorted global (amazon sorts before google),
    // so just assert one type ended up excluded.
    expect(onSave.mock.calls[0][1]).toHaveLength(1);
  });

  it('filters global rules by the search input', () => {
    render(<DomainRulesPage {...baseProps()} />);
    const filter = screen.getByPlaceholderText('Search domains');
    fireEvent.input(filter, { target: { value: 'amazon' } });
    expect(screen.getByText('amazon.com, amazon.co.uk')).toBeInTheDocument();
    expect(screen.queryByText('google.com, youtube.com')).not.toBeInTheDocument();
  });

  it('shows "no domain rules found" when the filter matches nothing', () => {
    render(<DomainRulesPage {...baseProps()} />);
    fireEvent.input(screen.getByPlaceholderText('Search domains'), {
      target: { value: 'zzzz-nothing' },
    });
    expect(screen.getByText('No domain rules found')).toBeInTheDocument();
  });

  it('opens the new-rule editor when Add is clicked and warns on too-few domains', () => {
    const onNotify = vi.fn();
    render(<DomainRulesPage {...baseProps({ onNotify })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    // Two empty domain inputs appear; confirming with empties should warn.
    const confirm = screen.getByRole('button', { name: /Confirm/i });
    fireEvent.click(confirm);
    expect(onNotify).toHaveBeenCalledWith('warning', expect.any(String));
  });
});
