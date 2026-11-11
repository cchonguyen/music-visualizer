import { describe, it, expect } from 'vitest';
import { clampSize } from './fbo';

describe('clampSize', () => {
  it('keeps normal sizes', () => {
    expect(clampSize(1280, 720)).toEqual({ width: 1280, height: 720 });
  });
  it('clamps zero, negative and non-finite sizes to at least 1 pixel', () => {
    expect(clampSize(0, -5)).toEqual({ width: 1, height: 1 });
    expect(clampSize(NaN, Infinity)).toEqual({ width: 1, height: 1 });
  });
  it('floors fractional sizes', () => {
    expect(clampSize(10.9, 3.2)).toEqual({ width: 10, height: 3 });
  });
});

import { vi } from 'vitest';
import { PingPong, bytesPerPixel, detectFeedbackFormat, feedbackFormat, setFloatBuffersEnabled } from './fbo';
import feedbackSrc from '../render/shaders/feedback.frag.glsl?raw';

function fakeGl(o: { floatExt?: boolean; halfExt?: boolean; complete?: boolean } = {}) {
  const gl = {
    TEXTURE_2D: 1, FRAMEBUFFER: 2, COLOR_ATTACHMENT0: 3, FRAMEBUFFER_COMPLETE: 0x8cd5,
    RGBA: 4, RGBA8: 5, RGBA16F: 6, UNSIGNED_BYTE: 7, HALF_FLOAT: 8,
    LINEAR: 9, TEXTURE_MIN_FILTER: 10, TEXTURE_MAG_FILTER: 11, TEXTURE_WRAP_S: 12, TEXTURE_WRAP_T: 13, CLAMP_TO_EDGE: 14,
    getExtension: vi.fn((n: string) => {
      if (n === 'EXT_color_buffer_float' && o.floatExt) return {};
      if (n === 'EXT_color_buffer_half_float' && o.halfExt) return {};
      return null;
    }),
    createTexture: vi.fn(() => ({})),
    createFramebuffer: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    bindFramebuffer: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => (o.complete === false ? 0x8cd6 : 0x8cd5)),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
  };
  return gl as unknown as WebGL2RenderingContext & typeof gl;
}

describe('feedback buffer format (Slice 16.7)', () => {
  it('uses 8-bit without a float-render extension', () => {
    expect(detectFeedbackFormat(fakeGl())).toBe('rgba8');
  });

  it('uses half-float with EXT_color_buffer_float or EXT_color_buffer_half_float when the framebuffer is complete', () => {
    expect(detectFeedbackFormat(fakeGl({ floatExt: true }))).toBe('rgba16f');
    expect(detectFeedbackFormat(fakeGl({ halfExt: true }))).toBe('rgba16f');
  });

  it('falls back to 8-bit when the half-float framebuffer is incomplete, and cleans up its test objects', () => {
    const gl = fakeGl({ floatExt: true, complete: false });
    expect(detectFeedbackFormat(gl)).toBe('rgba8');
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  });

  it('checks completeness once per context and remembers the answer', () => {
    const gl = fakeGl({ floatExt: true });
    expect(feedbackFormat(gl)).toBe('rgba16f');
    expect(feedbackFormat(gl)).toBe('rgba16f');
    expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(1);
  });

  it('detects again on request (after a context restore)', () => {
    const gl = fakeGl({ floatExt: true });
    feedbackFormat(gl);
    detectFeedbackFormat(gl);
    expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(2);
  });

  it('can be switched off for diagnosis', () => {
    setFloatBuffersEnabled(false);
    try {
      expect(detectFeedbackFormat(fakeGl({ floatExt: true }))).toBe('rgba8');
    } finally {
      setFloatBuffersEnabled(true);
    }
  });

  it('half-float takes twice the bytes of 8-bit per pixel', () => {
    expect(bytesPerPixel('rgba8')).toBe(4);
    expect(bytesPerPixel('rgba16f')).toBe(8);
  });
});

describe('PingPong format (Slice 16.7)', () => {
  it('allocates RGBA8 by default', () => {
    const gl = fakeGl();
    const pp = new PingPong(gl, 8, 4);
    expect(pp.format).toBe('rgba8');
    expect(gl.texImage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 0, gl.RGBA8, 8, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  });

  it('allocates RGBA16F as half-float when asked, and keeps the format across a resize', () => {
    const gl = fakeGl({ floatExt: true });
    const pp = new PingPong(gl, 8, 4, 'rgba16f');
    expect(gl.texImage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 0, gl.RGBA16F, 8, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
    pp.resize(16, 8);
    expect(gl.texImage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 0, gl.RGBA16F, 16, 8, 0, gl.RGBA, gl.HALF_FLOAT, null);
    expect(pp.format).toBe('rgba16f');
  });

  it('throws when the framebuffer is incomplete', () => {
    expect(() => new PingPong(fakeGl({ complete: false }), 8, 4, 'rgba16f')).toThrow(/incomplete/);
  });
});

describe('feedback shader keeps the 8-bit look (Slice 16.7)', () => {
  it('reads the previous frame only through the clamped helper', () => {
    const outside = feedbackSrc.replace(/vec4 prevTex\(vec2 uv\) \{[\s\S]*?\n\}/, '');
    expect(outside).not.toMatch(/texture\(uPrev,/);
    expect(feedbackSrc).toMatch(/min\(texture\(uPrev, uv\), vec4\(1\.0\)\)/);
  });
});
