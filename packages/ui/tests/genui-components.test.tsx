import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EntityChipStream } from '../components/genui/EntityChipStream';
import { ReasoningTicker } from '../components/genui/ReasoningTicker';
import { ScoreRing } from '../components/genui/ScoreRing';
import { StreamList } from '../components/genui/StreamList';
import { StreamSection } from '../components/genui/StreamSection';
import { StreamingText } from '../components/genui/StreamingText';

describe('generative UI components', () => {
  it('marks a section busy only while streaming', () => {
    const { rerender } = render(<StreamSection title="Research" state="idle"><p>Ready</p></StreamSection>);
    const section = screen.getByText('Research').closest('[data-stream-state]');
    expect(section).toHaveAttribute('data-stream-state', 'idle');
    expect(section).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByText('generating…')).not.toBeInTheDocument();

    rerender(<StreamSection title="Research" state="streaming"><p>Working</p></StreamSection>);
    expect(section).toHaveAttribute('data-stream-state', 'streaming');
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('generating…')).toBeVisible();

    rerender(<StreamSection title="Research" state="error"><p>Try again</p></StreamSection>);
    expect(section).toHaveAttribute('data-stream-state', 'error');
    expect(section).toHaveAttribute('aria-busy', 'false');
  });

  it('announces reasoning updates and hides an empty ticker', () => {
    const { rerender } = render(<ReasoningTicker text="" active={false} />);
    expect(screen.queryByTestId('reasoning-ticker')).not.toBeInTheDocument();
    rerender(<ReasoningTicker text="Checking evidence" active />);
    const ticker = screen.getByTestId('reasoning-ticker');
    expect(ticker).toHaveAttribute('aria-live', 'polite');
    expect(ticker).toHaveTextContent('Checking evidence');
  });

  it('renders pending and final scores with the expected progress angle', () => {
    const { rerender } = render(<ScoreRing score={null} label="Qualification" />);
    expect(screen.getByTestId('score-ring')).toHaveTextContent('–');
    expect(screen.getByTestId('score-ring')).toHaveClass('animate-pulse');
    rerender(<ScoreRing score={75} label="Qualification" />);
    expect(screen.getByTestId('score-ring')).toHaveTextContent('75');
    expect(screen.getByTestId('score-ring').firstElementChild).toHaveStyle({
      background: 'conic-gradient(hsl(var(--primary)) 270deg, hsl(var(--muted)) 270deg)',
    });
  });

  it('renders streaming copy, completion, and list items', () => {
    const { rerender } = render(<StreamingText text="Draft" done={false} />);
    expect(screen.getByText(/Draft/).querySelector('span')).toBeInTheDocument();
    rerender(<StreamingText text="Draft complete" done />);
    expect(screen.getByText('Draft complete').querySelector('span')).not.toBeInTheDocument();

    render(<StreamList items={['Collect', 'Validate', 'Persist']} />);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '•Collect', '•Validate', '•Persist',
    ]);
  });

  it('groups entities in domain order, skips malformed entries, and deduplicates names', () => {
    const { container } = render(<EntityChipStream entities={[
      { name: 'Postgres', type: 'Database' },
      { name: 'React', type: 'Framework' },
      { name: 'Faster delivery', type: 'BusinessValue' },
      { name: 'Postgres', type: 'Database' },
      { name: '', type: 'Feature' },
      { name: 'Custom', type: 'Other' },
    ]} />);
    const headings = [...container.querySelectorAll('.font-medium')].map((item) => item.textContent);
    expect(headings).toEqual(['BusinessValues', 'Databases', 'Frameworks', 'Others']);
    expect(screen.getAllByText('Postgres')).toHaveLength(1);
  });
});
