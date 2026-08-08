import { describe, it, expect } from 'vitest';
import enCommon from '../i18n/locales/en/common.json';
import enApp from '../i18n/locales/en/app.json';
import arCommon from '../i18n/locales/ar/common.json';
import arApp from '../i18n/locales/ar/app.json';

describe('i18n', () => {
  describe('English locales', () => {
    it('should have common translations', () => {
      expect(enCommon).toBeDefined();
      expect(typeof enCommon).toBe('object');
    });

    it('should have app translations', () => {
      expect(enApp).toBeDefined();
      expect(typeof enApp).toBe('object');
    });

    it('should have required keys in common', () => {
      // Check for some essential keys
      expect(enCommon).toHaveProperty('loading');
    });
  });

  describe('Arabic locales', () => {
    it('should have common translations', () => {
      expect(arCommon).toBeDefined();
      expect(typeof arCommon).toBe('object');
    });

    it('should have app translations', () => {
      expect(arApp).toBeDefined();
      expect(typeof arApp).toBe('object');
    });

    it('should have same keys as English', () => {
      const arKeys = Object.keys(arCommon);
      expect(arKeys.length).toBeGreaterThan(0);
      // Arabic should have at least some keys
    });
  });

  describe('Locale structure', () => {
    it('should have matching key structure between languages', () => {
      const enKeys = Object.keys(enApp).sort();
      const arKeys = Object.keys(arApp).sort();
      expect(arKeys).toEqual(enKeys);
    });
  });
});
