import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pencil, Trash2 } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ListCard } from '../components/ListCard';
import { ListRow, ListRows } from '../components/ListRow';
import { ListSurface } from '../components/ListSurface';
import { StatRow } from '../components/StatRow';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

describe('dense collection components', () => {
  it('labels the scroll region and keeps semantic table roles', () => {
    render(
      <Table containerClassName="rounded-lg border" containerLabel="Credit activity">
        <TableHeader>
          <TableRow><TableHead>Action</TableHead><TableHead>Credits</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          <TableRow><TableCell>Generate draft</TableCell><TableCell>12</TableCell></TableRow>
        </TableBody>
      </Table>,
    );

    const region = screen.getByRole('region', { name: 'Credit activity' });
    expect(region).toHaveClass('rounded-lg', 'border');
    expect(within(region).getByRole('table')).toBeInTheDocument();
    expect(within(region).getAllByRole('columnheader')).toHaveLength(2);
  });

  it('renders record identity, meta, and ordered actions through one row anatomy', () => {
    const edit = vi.fn();
    const remove = vi.fn();
    render(
      <ListCard title="Projects" description="Workspace projects">
        <ListRows>
          <ListRow
            actions={[
              { destructive: true, icon: Trash2, label: 'Delete Atlas', onSelect: remove },
              { icon: Pencil, label: 'Edit Atlas', onSelect: edit },
            ]}
            href="/projects/atlas"
            meta={['12 entities', 'updated 2h ago']}
            title="Atlas"
          />
        </ListRows>
      </ListCard>,
    );

    expect(screen.getByRole('link', { name: 'Atlas' })).toHaveAttribute('href', '/projects/atlas');
    expect(screen.getByText('12 entities').parentElement).toHaveTextContent('12 entities·updated 2h ago');
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Edit Atlas',
      'Delete Atlas',
    ]);
  });

  it('integrates search, filters, result count, and the terminal state', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <ListSurface
        count={1}
        description="Workspace projects"
        filters={<button type="button">Active</button>}
        onSearchChange={onSearchChange}
        searchValue=""
        title="Projects"
      >
        <ListRows>
          <ListRow title="Atlas" />
        </ListRows>
      </ListSurface>,
    );

    await user.keyboard('/');
    expect(screen.getByRole('textbox', { name: 'Search Projects' })).toHaveFocus();
    expect(screen.getByText('1 item')).toBeInTheDocument();
    expect(screen.getByText('All caught up · 1 item')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search Projects' }), 'a');
    expect(onSearchChange).toHaveBeenLastCalledWith('a');
  });

  it('renders page metrics through the shared stat anatomy without inventing a delta', () => {
    const { container } = render(
      <StatRow
        stats={[
          {
            description: '3 currently reserved',
            featured: true,
            label: 'Available',
            value: '97',
          },
        ]}
      />,
    );

    expect(container.firstElementChild).toHaveClass('grid-cols-1');
    const card = screen.getByText('Available').closest('[data-slot="card"]');
    expect(card).toHaveClass('border-primary/25', 'bg-primary/5');
    expect(within(card as HTMLElement).getByText('97')).toHaveClass('tabular-nums');
    expect(within(card as HTMLElement).getByText('3 currently reserved')).toBeInTheDocument();
    expect(within(card as HTMLElement).queryByText(/[+-]\\d/)).not.toBeInTheDocument();
  });

  it('fills the row for three metrics instead of reserving a fourth column', () => {
    const { container } = render(
      <StatRow
        stats={[
          { label: 'Sources', value: '12' },
          { label: 'Active', value: '9' },
          { label: 'Disabled', value: '3' },
        ]}
      />,
    );

    expect(container.firstElementChild).toHaveClass('lg:grid-cols-3');
    expect(container.firstElementChild).not.toHaveClass('lg:grid-cols-4');
  });
});
