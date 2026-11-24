import { describe, expect, it, vi } from 'vitest';
import { getCompanionPhrase, speakCompanionPhrase } from '../../src/companion/assistant';

describe('Умнай companion', () => {
  it('supports independent settings and keeps navigation exact', () => {
    expect(getCompanionPhrase({ type: 'greeting' }, { boldness: 'witty' })).toContain('Умнай');
    expect(getCompanionPhrase({ type: 'greeting' }, { enabled: false })).toBeNull();
    expect(getCompanionPhrase({ type: 'greeting' }, { boldness: 'bold', allowProfanity: false })).not.toContain('бля');
    expect(getCompanionPhrase({ type: 'greeting' }, { boldness: 'bold', allowProfanity: true })).toContain('бля');
    expect(getCompanionPhrase({ type: 'navigation', instruction: 'Поверните направо через 20 м' }, { boldness: 'bold' })).toBe('Поверните направо через 20 м');
  });
  it('fails safely when browser speech is unavailable', () => {
    expect(speakCompanionPhrase('тест', { voiceEnabled: true })).toBe(false);
  });
  it('uses browser speech when enabled', () => {
    const speak = vi.fn();
    Object.defineProperty(globalThis, 'window', { value: { speechSynthesis: { speak }, SpeechSynthesisUtterance: class { lang = ''; constructor(public text: string) {} } }, configurable: true });
    expect(speakCompanionPhrase('привет', { voiceEnabled: true })).toBe(true);
    expect(speak).toHaveBeenCalledOnce();
  });
});
