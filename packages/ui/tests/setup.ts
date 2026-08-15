import * as matchers from '@testing-library/jest-dom/matchers';
import { expect, vi } from 'vitest';

// Register against this workspace's Vitest instance explicitly; importing the
// jest-dom Vitest bridge can resolve a different peer instance in a monorepo.
expect.extend(matchers);

Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
  configurable: true,
  value: vi.fn(),
});
