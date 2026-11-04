import { describe, it, expect } from 'vitest';
import { noAudioMessage } from './sources';

describe('noAudioMessage', () => {
  it('explains that a single window cannot carry sound', () => {
    expect(noAudioMessage('window')).toMatch(/single window/);
  });
  it('asks for system sound when the whole screen was shared', () => {
    expect(noAudioMessage('monitor')).toMatch(/Share system audio/);
  });
  it('gives the tab instruction by default', () => {
    expect(noAudioMessage(undefined)).toMatch(/Share tab audio/);
  });
});
