import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, trimToTokenBudget, resolveABVariant, buildPersonaWithVariant, type PromptBuildOptions, type PersonaVariant, type ABTestConfig } from '../prompts/index.js';

describe('Prompt Index - System Prompt Builder', () => {
  const baseOptions: PromptBuildOptions = {
    language: 'ar',
    enabledTools: ['web_search', 'calculator'],
    userCoursesContext: 'User courses: CS101, MATH201',
    ragContext: {
      hasContext: true,
      contextText: '[Source: Test.pdf] Test content',
      sourceNames: ['Test.pdf'],
      retrievalMethod: 'hybrid',
    },
    memoryContext: 'Previous conversation summary',
    multiAgentMode: false,
  };

  it('should return an empty system prompt (schema-driven system)', () => {
    const result = buildSystemPrompt(baseOptions);

    expect(result).toBe('');
  });

  it('should stay empty regardless of tools, RAG, memory or budget options', () => {
    expect(buildSystemPrompt({ ...baseOptions, enabledTools: [] })).toBe('');
    expect(buildSystemPrompt({ ...baseOptions, ragContext: undefined })).toBe('');
    expect(buildSystemPrompt({ ...baseOptions, memoryContext: undefined })).toBe('');
    expect(buildSystemPrompt({ ...baseOptions, maxSystemTokens: 0 })).toBe('');
    expect(buildSystemPrompt({ ...baseOptions, maxSystemTokens: undefined })).toBe('');
  });

  it('should not include multi-agent instructions in the prompt', () => {
    const result = buildSystemPrompt({ ...baseOptions, multiAgentMode: true });

    expect(result).not.toContain('MULTI-AGENT PROTOCOL');
    expect(result).not.toContain('MAIN AGENT DRAFTING');
  });

  describe('trimToTokenBudget', () => {
    it('should return original if under budget', () => {
      const prompt = 'Short prompt';
      const result = trimToTokenBudget(prompt, 1000);
      
      expect(result).toBe(prompt);
    });

    it('should truncate when over budget', () => {
      const prompt = 'Layer 1\n\nLayer 2\n\nLayer 3\n\nLayer 4';
      const result = trimToTokenBudget(prompt, 2); // ~8 chars budget
      
      expect(result.length).toBeLessThanOrEqual(prompt.length);
      expect(result).toContain('Layer 1');
    });

    it('should preserve layer order when truncating', () => {
      const prompt = 'Layer 1\n\nLayer 2\n\nLayer 3\n\nLayer 4';
      const result = trimToTokenBudget(prompt, 10); // ~40 chars budget
      
      const layer1Index = result.indexOf('Layer 1');
      const layer2Index = result.indexOf('Layer 2');
      
      expect(layer1Index).toBeLessThan(layer2Index);
    });

    it('should return truncated string if even first layer exceeds budget', () => {
      const prompt = 'Very long layer that exceeds budget';
      const result = trimToTokenBudget(prompt, 2); // ~8 chars
      
      expect(result.length).toBeLessThanOrEqual(8);
    });
  });

  describe('maxSystemTokens option', () => {
    it('should keep the prompt empty for any budget value', () => {
      expect(buildSystemPrompt({ ...baseOptions, maxSystemTokens: 50 })).toBe('');
      expect(buildSystemPrompt({ ...baseOptions, maxSystemTokens: 0 })).toBe('');
      expect(buildSystemPrompt({ ...baseOptions, maxSystemTokens: undefined })).toBe('');
    });
  });

  it('should handle language parameter', () => {
    const resultAr = buildSystemPrompt({ ...baseOptions, language: 'ar' });
    const resultEn = buildSystemPrompt({ ...baseOptions, language: 'en' });
    
    expect(resultAr).toBe(resultEn);
  });

  describe('A/B Testing', () => {
    it('should resolve default variant when no config', () => {
      const variant = resolveABVariant({});
      expect(variant).toBe('default');
    });

    it('should resolve forced variant', () => {
      const variant = resolveABVariant({ forceVariant: 'concise' });
      expect(variant).toBe('concise');
    });

    it('should resolve explicit variant', () => {
      const variant = resolveABVariant({ variant: 'detailed' });
      expect(variant).toBe('detailed');
    });

    it('should deterministically assign variant based on userId', () => {
      const variant1 = resolveABVariant({ userId: 'user123', variant: 'auto' });
      const variant2 = resolveABVariant({ userId: 'user123', variant: 'auto' });
      expect(variant1).toBe(variant2);
    });

    it('should assign different variants for different users', () => {
      const variants = new Set<PersonaVariant>();
      for (let i = 0; i < 100; i++) {
        variants.add(resolveABVariant({ userId: `user${i}`, variant: 'auto' }));
      }
      // Should distribute across multiple variants
      expect(variants.size).toBeGreaterThan(1);
    });

    it('should build concise persona', () => {
      const persona = buildPersonaWithVariant('concise');
      expect(persona).toContain('Style — الأسلوب');
      expect(persona).toContain('Keep responses under 200 words');
      expect(persona).toContain('Lead with the answer');
    });

    it('should build detailed persona', () => {
      const persona = buildPersonaWithVariant('detailed');
      expect(persona).toContain('Style — الأسلوب');
      expect(persona).toContain('Provide thorough');
      expect(persona).toContain('Explain the');
    });

    it('should build motivational persona', () => {
      const persona = buildPersonaWithVariant('motivational');
      expect(persona).toContain('Style — الأسلوب');
      expect(persona).toContain('Great question');
      expect(persona).toContain('you can');
      expect(persona).toContain('growth mindset');
    });

    it('should build default persona', () => {
      const persona = buildPersonaWithVariant('default');
      expect(persona).toContain('Academic Advisor');
      expect(persona).toContain('Behavioral Examples');
    });

    it('should not inject A/B persona variants into the system prompt', () => {
      const result = buildSystemPrompt({ 
        ...baseOptions, 
        abTest: { forceVariant: 'concise' } 
      });
      
      expect(result).not.toContain('Keep responses under 200 words');
      expect(result).not.toContain('Behavioral Examples');
    });

    it('should not inject motivational persona into the system prompt', () => {
      const result = buildSystemPrompt({ 
        ...baseOptions, 
        abTest: { forceVariant: 'motivational' } 
      });
      
      expect(result).not.toContain('Great question');
      expect(result).not.toContain('growth mindset');
    });
  });
});