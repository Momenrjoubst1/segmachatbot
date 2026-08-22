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

  it('should build complete system prompt with all layers', () => {
    const result = buildSystemPrompt(baseOptions);
    
    expect(result).toContain('Identity — الهوية');
    expect(result).toContain('Identity Guard — حماية الهوية');
    expect(result).toContain('Formatting Rules — قواعد التنسيق');
    expect(result).toContain('User courses: CS101, MATH201');
    expect(result).toContain('Tool Use Rules — قواعد استخدام الأدوات');
    expect(result).toContain('RAG Rules — تعليمات السياق المسترجع');
    expect(result).toContain('Previous conversation summary');
  });

  it('should include tool instructions when tools enabled', () => {
    const result = buildSystemPrompt({ ...baseOptions, enabledTools: ['web_search'] });
    
    expect(result).toContain('Tool Use Rules');
  });

  it('should exclude tool instructions when no tools enabled', () => {
    const result = buildSystemPrompt({ ...baseOptions, enabledTools: [] });
    
    expect(result).not.toContain('Tool Use Rules');
  });

  it('should exclude RAG when no ragContext', () => {
    const result = buildSystemPrompt({ ...baseOptions, ragContext: undefined });
    
    expect(result).not.toContain('RAG Rules');
  });

  it('should exclude memory when no memoryContext', () => {
    const result = buildSystemPrompt({ ...baseOptions, memoryContext: undefined });
    
    expect(result).not.toContain('Previous conversation summary');
  });

  it('should include multi-agent when enabled', () => {
    const result = buildSystemPrompt({ ...baseOptions, multiAgentMode: true });
    
    expect(result).toContain('MULTI-AGENT PROTOCOL');
    expect(result).toContain('MAIN AGENT DRAFTING');
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
    it('should apply token budget when maxSystemTokens provided', () => {
      const result = buildSystemPrompt({ ...baseOptions, maxSystemTokens: 50 });
      
      expect(result.length).toBeLessThan(2000);
    });

    it('should not apply budget when maxSystemTokens is 0', () => {
      const result = buildSystemPrompt({ ...baseOptions, maxSystemTokens: 0 });
      
      expect(result.length).toBeGreaterThan(500);
    });

    it('should not apply budget when maxSystemTokens is undefined', () => {
      const result = buildSystemPrompt({ ...baseOptions, maxSystemTokens: undefined });
      
      expect(result.length).toBeGreaterThan(500);
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

    it('should apply A/B variant to system prompt', () => {
      const result = buildSystemPrompt({ 
        ...baseOptions, 
        abTest: { forceVariant: 'concise' } 
      });
      
      expect(result).toContain('Keep responses under 200 words');
      expect(result).not.toContain('Behavioral Examples'); // Concise doesn't have examples
    });

    it('should apply motivational variant to system prompt', () => {
      const result = buildSystemPrompt({ 
        ...baseOptions, 
        abTest: { forceVariant: 'motivational' } 
      });
      
      expect(result).toContain('Great question');
      expect(result).toContain('growth mindset');
    });
  });
});