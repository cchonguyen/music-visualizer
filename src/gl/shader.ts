// Shader compile/link with errors a human can read: the driver's log plus the
// offending source lines, numbered.

export class ShaderError extends Error {}

/** Prefix each line with its number so driver errors like "0:12" are easy to find. */
export function numberLines(src: string): string {
  return src
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(3, ' ')}| ${line}`)
    .join('\n');
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new ShaderError(`${label}: could not create shader`);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)';
    gl.deleteShader(shader);
    throw new ShaderError(`${label} shader failed to compile:\n${log}\n${numberLines(src)}`);
  }
  return shader;
}

export function compileProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
  name = 'program',
): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc, `${name} vertex`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc, `${name} fragment`);
  const program = gl.createProgram();
  if (!program) throw new ShaderError(`${name}: could not create program`);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Shaders can be deleted once linked; the program keeps what it needs.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(no log)';
    gl.deleteProgram(program);
    throw new ShaderError(`${name} failed to link:\n${log}`);
  }
  return program;
}

/** Full-screen triangle vertex shader (no vertex buffer needed: uses gl_VertexID). */
export const FULLSCREEN_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
