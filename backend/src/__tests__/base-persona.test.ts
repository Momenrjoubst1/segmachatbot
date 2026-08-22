import { describe, it, expect } from 'vitest';
import { buildBasePersona } from '../prompts/base-persona.js';

describe('Base Persona', () => {
  it('should return a string containing identity and roles', () => {
    const result = buildBasePersona();
    
    expect(result).toContain('Sigma');
    expect(result).toContain('Academic Advisor');
    expect(result).toContain('Challenge Maker');
    expect(result).toContain('Personal Organizer');
    expect(result).toContain('Study Supporter');
    expect(result).toContain('Psychological Motivator');
    expect(result).toContain('Automated Interface');
  });

  it('should contain behavioral examples section', () => {
    const result = buildBasePersona();
    
    expect(result).toContain('Behavioral Examples');
    expect(result).toContain('أمثلة سلوكية');
  });

  it('should contain all 4 behavioral examples', () => {
    const result = buildBasePersona();
    
    expect(result).toContain('Example 1: Academic Advisor');
    expect(result).toContain('Example 2: Challenge Maker');
    expect(result).toContain('Example 3: Psychological Motivator');
    expect(result).toContain('Example 4: Personal Organizer');
  });

  it('should include Arabic and English in examples', () => {
    const result = buildBasePersona();
    
    expect(result).toContain('أمثلة سلوكية');
    expect(result).toContain('Behavioral Examples');
    expect(result).toContain('recursion');
    expect(result).toContain('mock quiz');
    expect(result).toContain('sprint plan');
    expect(result).toContain('Pomodoro');
  });

  it('should accept language option without changing output (currently)', () => {
    const resultAr = buildBasePersona({ language: 'ar' });
    const resultEn = buildBasePersona({ language: 'en' });
    
    expect(resultAr).toBe(resultEn);
  });

  it('should not be empty', () => {
    const result = buildBasePersona();
    expect(result.length).toBeGreaterThan(500);
  });
});