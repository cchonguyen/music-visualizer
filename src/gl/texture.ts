// One-row float data textures for audio arrays (spectrum, waveform), read in
// shaders with texture(tex, vec2(x, 0.5)).r. R32F is core WebGL2, so there is no
// 8-bit fallback; only linear filtering needs an extension.

export interface DataTexture {
  texture: WebGLTexture;
  length: number;
}

export function createDataTexture(gl: WebGL2RenderingContext, length: number): DataTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('could not create data texture');
  const filter = gl.getExtension('OES_texture_float_linear') ? gl.LINEAR : gl.NEAREST;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, length, 1, 0, gl.RED, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { texture, length };
}

/** Upload a Float32Array of exactly `tex.length` values. */
export function updateDataTexture(gl: WebGL2RenderingContext, tex: DataTexture, data: Float32Array): void {
  gl.bindTexture(gl.TEXTURE_2D, tex.texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tex.length, 1, gl.RED, gl.FLOAT, data, 0);
  gl.bindTexture(gl.TEXTURE_2D, null);
}
