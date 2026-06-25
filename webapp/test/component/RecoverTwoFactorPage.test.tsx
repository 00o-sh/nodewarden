import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import RecoverTwoFactorPage from '@/components/RecoverTwoFactorPage';

type Values = { email: string; password: string; recoveryCode: string };

// The page is fully controlled (values + onChange). Wrap it so typing actually
// updates the rendered inputs, mirroring real usage.
function ControlledHarness(props: {
  initial?: Partial<Values>;
  onSubmit: () => void;
  onCancel: () => void;
  onChangeSpy?: (next: Values) => void;
}) {
  const [values, setValues] = useState<Values>({
    email: '',
    password: '',
    recoveryCode: '',
    ...props.initial,
  });
  return (
    <RecoverTwoFactorPage
      values={values}
      onChange={(next) => {
        props.onChangeSpy?.(next);
        setValues(next);
      }}
      onSubmit={props.onSubmit}
      onCancel={props.onCancel}
    />
  );
}

function setup(initial?: Partial<Values>) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const onChangeSpy = vi.fn();
  render(<ControlledHarness initial={initial} onSubmit={onSubmit} onCancel={onCancel} onChangeSpy={onChangeSpy} />);
  return { onSubmit, onCancel, onChangeSpy };
}

function field(label: string): HTMLInputElement {
  return screen.getByText(label).closest('label')!.querySelector('input') as HTMLInputElement;
}

afterEach(() => {
  cleanup();
});

describe('<RecoverTwoFactorPage>', () => {
  it('renders the recovery form with the title and inputs', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Recover Two-step Login' })).toBeInTheDocument();
    expect(field('Email')).toBeInTheDocument();
    expect(field('Master Password')).toBeInTheDocument();
    expect(field('Recovery Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('propagates email/password input via onChange', () => {
    const { onChangeSpy } = setup();
    fireEvent.input(field('Email'), { target: { value: 'user@example.com' } });
    expect(onChangeSpy).toHaveBeenCalledWith(expect.objectContaining({ email: 'user@example.com' }));
    fireEvent.input(field('Master Password'), { target: { value: 'pw' } });
    expect(onChangeSpy).toHaveBeenCalledWith(expect.objectContaining({ password: 'pw' }));
  });

  it('uppercases the recovery code on input', () => {
    const { onChangeSpy } = setup();
    fireEvent.input(field('Recovery Code'), { target: { value: 'abc123' } });
    expect(onChangeSpy).toHaveBeenCalledWith(expect.objectContaining({ recoveryCode: 'ABC123' }));
  });

  it('fires onSubmit when the form is submitted', () => {
    const { onSubmit } = setup({ email: 'u@e.com', password: 'pw', recoveryCode: 'CODE' });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('fires onCancel when cancel is clicked', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('toggles the master-password visibility', () => {
    setup({ password: 'secret' });
    const pw = field('Master Password');
    expect(pw.type).toBe('password');
    const toggle = pw.closest('.password-wrap')!.querySelector('button.eye-btn') as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(pw.type).toBe('text');
    fireEvent.click(toggle);
    expect(pw.type).toBe('password');
  });
});
