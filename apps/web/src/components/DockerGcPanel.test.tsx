import { describe, expect, it } from 'vitest';
import { formatBytes } from './DockerGcPanel';

describe('formatBytes', () => {
  it('formats decimal units like Docker', () => {
    expect(formatBytes(0)).toBe('0 o');
    expect(formatBytes(999)).toBe('999 o');
    expect(formatBytes(1_500_000_000)).toBe('1,5 Go');
    expect(formatBytes(425_000_000_000)).toBe('425 Go');
    expect(formatBytes(null)).toBe('0 o');
  });
});
