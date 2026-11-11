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

/** A program whose compile and link have been started but whose status has not been read. */
export interface PendingProgram {
  program: WebGLProgram;
  vs: WebGLShader;
  fs: WebGLShader;
  name: string;
  vertSrc: string;
  fragSrc: string;
}

function startShader(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new ShaderError(`${label}: could not create shader`);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return shader;
}

/**
 * Starts compiling and linking without reading any status. Reading a status makes the browser wait for
 * the driver, so it is left to `finishProgram`, which reads it only once the work is done.
 */
export function startProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
  name = 'program',
): PendingProgram {
  const vs = startShader(gl, gl.VERTEX_SHADER, vertSrc, `${name} vertex`);
  let fs: WebGLShader;
  try {
    fs = startShader(gl, gl.FRAGMENT_SHADER, fragSrc, `${name} fragment`);
  } catch (err) {
    gl.deleteShader(vs);
    throw err;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new ShaderError(`${name}: could not create program`);
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  return { program, vs, fs, name, vertSrc, fragSrc };
}

/**
 * True when the driver has finished the program, so `finishProgram` will not wait. Without the
 * KHR_parallel_shader_compile extension there is no way to ask, so this is always true.
 */
export function isProgramComplete(gl: WebGL2RenderingContext, pending: PendingProgram): boolean {
  const ext = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
  if (!ext) return true;
  return Boolean(gl.getProgramParameter(pending.program, ext.COMPLETION_STATUS_KHR));
}

/**
 * Reads the link status. Compile status is read only when linking failed, to explain why.
 * Throws a ShaderError with the driver log and numbered source lines on failure.
 */
export function finishProgram(gl: WebGL2RenderingContext, pending: PendingProgram): WebGLProgram {
  const { program, vs, fs, name } = pending;
  const linked = Boolean(gl.getProgramParameter(program, gl.LINK_STATUS));
  if (linked) {
    // Shaders can be deleted once linked; the program keeps what it needs.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }
  let message = '';
  for (const [shader, src, label] of [
    [vs, pending.vertSrc, `${name} vertex`],
    [fs, pending.fragSrc, `${name} fragment`],
  ] as const) {
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? '(no log)';
      message = `${label} shader failed to compile:\n${log}\n${numberLines(src)}`;
      break;
    }
  }
  if (!message) {
    message = `${name} failed to link:\n${gl.getProgramInfoLog(program) ?? '(no log)'}`;
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  gl.deleteProgram(program);
  throw new ShaderError(message);
}

/** Compile and link now. The browser waits for the result. */
export function compileProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
  name = 'program',
): WebGLProgram {
  return finishProgram(gl, startProgram(gl, vertSrc, fragSrc, name));
}

/** Full-screen triangle vertex shader (no vertex buffer needed: uses gl_VertexID). */
export const FULLSCREEN_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
