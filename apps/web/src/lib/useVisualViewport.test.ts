import { describe, expect, it } from 'vitest';
import { computeInset, computeOverlap } from './useVisualViewport';

describe('computeInset', () => {
  it('0 sans clavier', () => {
    expect(computeInset(844, 844, 0)).toBe(0);
  });
  it('hauteur du clavier iOS (visualViewport réduit)', () => {
    expect(computeInset(844, 508, 0)).toBe(336);
  });
  it('tient compte du défilement du visualViewport', () => {
    expect(computeInset(844, 508, 100)).toBe(236);
  });
  it('ignore les petites variations (barre d’adresse)', () => {
    expect(computeInset(844, 820, 0)).toBe(0);
  });
  it('ignore le zoom au pincement', () => {
    expect(computeInset(844, 400, 0, 2)).toBe(0);
  });
  it('jamais négatif', () => {
    expect(computeInset(700, 844, 0)).toBe(0);
  });
});

describe('computeOverlap', () => {
  it('partie cachée sous le clavier', () => {
    expect(computeOverlap(800, 508, 0)).toBe(292);
  });
  it('0 quand l’élément est au-dessus du clavier', () => {
    expect(computeOverlap(400, 508, 0)).toBe(0);
  });
});
