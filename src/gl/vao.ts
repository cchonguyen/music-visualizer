// Empty VAO for shaders that generate their own vertices from gl_VertexID
// (the full-screen triangle and instanced quads need no vertex buffers).

export function createVao(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('could not create vertex array object');
  return vao;
}
