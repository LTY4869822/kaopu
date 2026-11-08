import { useEffect, useRef, useState } from "react";

type PortraitProps = { paused?: boolean; pulse?: number };
const ASSET_ROOT = "/sites/good-fella-com-0c318826/root-8a5edab2";
const PORTRAIT = `${ASSET_ROOT}/confucius-sculpture.png`;
const DEPTH = `${ASSET_ROOT}/confucius-depth.png`;
// Narrow punctuation in shadows, letters and broad symbols in highlights.
const CHARACTERS = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const VERTEX = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

// Independently reconstructed mechanism; no reference-site runtime is shipped.
const FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPortrait;
uniform sampler2D uDepth;
uniform sampler2D uAtlas;
uniform vec2 uSize;
uniform vec4 uImageRect;
uniform float uCell;
uniform float uGlyphCount;
uniform vec2 uParallax;
uniform vec2 uMouse;
uniform float uHover;
uniform float uSeed;
uniform float uTime;
uniform float uReveal;
uniform float uIntroColor;
uniform float uSourceMode;
uniform vec2 uClick;
uniform float uSweep;
uniform float uSweepFrom;
uniform float uSweepTo;
uniform float uImpact;

float randomCell(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float lightness(vec3 color) { return dot(color, vec3(0.299, 0.587, 0.114)); }
vec3 toLinear(vec3 color) {
  return mix(color / 12.92, pow((color + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), color));
}
vec3 toDisplay(vec3 color) {
  color = max(vec3(0.0), color);
  return mix(color * 12.92, 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), color));
}
vec2 pictureUv(vec2 uv) { return (uv - uImageRect.xy) / uImageRect.zw; }
float inside(vec2 p) {
  return step(0.0, p.x) * step(0.0, p.y) * step(p.x, 1.0) * step(p.y, 1.0);
}
vec4 picture(vec2 uv) {
  vec2 p = pictureUv(uv);
  return texture2D(uPortrait, clamp(p, 0.0, 1.0)) * inside(p);
}
float normalizedDistance(vec2 cell, vec2 origin, vec2 grid) {
  vec2 point = origin * grid;
  float farthest = max(max(length(point), length(vec2(grid.x, 0.0) - point)),
    max(length(vec2(0.0, grid.y) - point), length(grid - point)));
  return length(cell - point) / max(1.0, farthest);
}
void main() {
  vec2 depthUv = pictureUv(vUv);
  float depth = texture2D(uDepth, clamp(depthUv, 0.0, 1.0)).r * inside(depthUv);
  vec2 warped = vUv + uParallax * depth * 0.12;
  vec2 grid = uSize / uCell;
  vec2 cell = floor(warped * grid);
  vec2 screenCell = floor(vUv * grid);
  vec2 center = (cell + 0.5) / grid;
  vec4 photo = picture(center);
  float rawLight = lightness(photo.rgb);
  // Key out black surroundings; the ramp itself removes deeper face shadows.
  float foreground = smoothstep(0.012, 0.045, rawLight) * photo.a;
  if (foreground < 0.001) { gl_FragColor = vec4(0.0); return; }
  float tone = pow(smoothstep(0.0, 1.0, rawLight), 1.3);
  float glyph = floor((uGlyphCount - 1.0) * tone);

  vec2 aspect = vec2(uSize.x / uSize.y, 1.0);
  float mouseDistance = length((center - uMouse) * aspect);
  float roughness = randomCell(screenCell) * 0.04;
  roughness += sin(uTime * 1.5 + randomCell(screenCell * 1.7) * 6.28) * 0.006;
  float radius = 0.035 * uHover;
  float feather = max(0.0001, 0.02 * uHover);
  float hoverMask = uHover > 0.01
    ? 1.0 - smoothstep(radius - feather, radius + feather, mouseDistance + roughness)
    : 0.0;
  if (hoverMask > 0.0) {
    glyph = floor(mod(glyph + randomCell(screenCell + uSeed) * uGlyphCount * tone, uGlyphCount));
  }
  vec2 tile = vec2(mod(glyph, 16.0), floor(glyph / 16.0));
  vec2 local = fract(warped * grid);
  // Canvas atlas is flipped on upload, keeping text upright in WebGL.
  vec2 atlasUv = vec2((tile.x + local.x) / 16.0, 1.0 - (tile.y + 1.0 - local.y) / 16.0);
  float ink = texture2D(uAtlas, atlasUv).a;
  float radial = normalizedDistance(screenCell, vec2(0.2, 0.65), grid);
  float threshold = radial + randomCell(screenCell) * 0.09 + 0.06;
  float revealFront = uReveal * 1.28;
  float visible = 1.0 - smoothstep(revealFront - 0.05, revealFront + 0.05, threshold);
  float colorFront = uIntroColor * 1.28;
  float colored = 1.0 - smoothstep(colorFront - 0.05, colorFront + 0.05, threshold);
  float ripple = (exp(-pow(threshold - revealFront, 2.0) * 180.0)
    + exp(-pow(threshold - colorFront, 2.0) * 180.0)) * step(uReveal, 0.9999);
  float mode = uSourceMode;
  float clickDistance = 1.0;
  if (uSweep >= 0.0) {
    clickDistance = normalizedDistance(screenCell, uClick, grid);
    float clickThreshold = clickDistance + randomCell(screenCell) * 0.09;
    float front = uSweep * 1.18;
    float reached = 1.0 - smoothstep(front - 0.05, front + 0.05, clickThreshold);
    mode = mix(uSweepFrom, uSweepTo, reached);
    ripple += exp(-pow(clickThreshold - front, 2.0) * 180.0) * max(0.0, 1.0 - clickDistance * 0.7);
  }
  // THREE.Color uses linear uniforms. Interpolate there, then encode for the
  // browser, otherwise a raw-WebGL reimplementation crushes the orange midtones.
  vec3 orange = mix(toLinear(vec3(0.102, 0.0392, 0.1804)), toLinear(vec3(1.0, 0.4196, 0.2902)), tone);
  vec3 sourceColor = toLinear(photo.rgb);
  vec3 color = mix(sourceColor, mix(orange, sourceColor, mode), colored);
  color += ripple * 0.35;
  if (uImpact > 0.0 && uImpact < 1.0) {
    float impactRadius = 0.03 + uImpact * 0.18;
    color += (1.0 - uImpact) * exp(-clickDistance * clickDistance / (2.0 * impactRadius * impactRadius)) * 0.35;
  }
  if (hoverMask > 0.0) {
    color = mix(color, mix(sourceColor, orange, mode), smoothstep(0.0, 0.15, hoverMask));
  }
  float alpha = ink * foreground * visible;
  gl_FragColor = vec4(toDisplay(color) * alpha, alpha);
}`;
const ease = (value: number) => 1 - (1 - Math.min(1, Math.max(0, value))) ** 3;
// GSAP power3.out is quartic; the click animation separately uses cubic-out.
const introEase = (value: number) => 1 - (1 - Math.min(1, Math.max(0, value))) ** 4;

/** A fixed ASCII grid with a depth-warped source, not a particle simulation. */
export default function ConfuciusPortrait({ paused = false, pulse = 0 }: PortraitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const changePause = useRef<() => void>(() => {});
  const triggerSweep = useRef<() => void>(() => {});
  const lastPulse = useRef(pulse);
  const [fallback, setFallback] = useState(false);
  useEffect(() => { pausedRef.current = paused; changePause.current(); }, [paused]);
  useEffect(() => {
    if (lastPulse.current !== pulse) triggerSweep.current();
    lastPulse.current = pulse;
  }, [pulse]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!gl) { setFallback(true); return; }
    let alive = true, loaded = false, contextLost = false, onScreen = true;
    let frame = 0, previousTime = 0, elapsed = 0, width = 1, height = 1;
    let hovering = false, hoverAmount = 0, seed = 0;
    let pointerX = 0, pointerY = 0, smoothX = 0, smoothY = 0, offsetX = 0, offsetY = 0;
    let sourceMode = 0, sweepStart = -1, sweepFrom = 0, sweepTo = 1, clickX = 0.2, clickY = 0.65;
    const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
    const coarseQuery = matchMedia("(pointer: coarse)");
    let reduced = motionQuery.matches, coarse = coarseQuery.matches;
    const source = new Image(), depth = new Image();
    const textures: WebGLTexture[] = [], shaders: WebGLShader[] = [];
    let buffer: WebGLBuffer | null = null, program: WebGLProgram | null = null;
    function compile(type: number, code: string) {
      const shader = gl!.createShader(type);
      if (!shader) throw new Error("Shader unavailable");
      shaders.push(shader);
      gl!.shaderSource(shader, code);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error("Portrait shader compilation failed");
      return shader;
    }
    try {
      program = gl.createProgram();
      if (!program) throw new Error("Portrait program unavailable");
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Portrait shader linking failed");
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.clearColor(0, 0, 0, 0);
    } catch {
      shaders.forEach((shader) => gl.deleteShader(shader));
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      setFallback(true);
      return;
    }
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    function uniform(name: string) {
      if (!uniforms.has(name)) uniforms.set(name, gl!.getUniformLocation(program!, name));
      return uniforms.get(name)!;
    }
    const scalar = (name: string, value: number) => gl!.uniform1f(uniform(name), value);
    const vector = (name: string, x: number, y: number) => gl!.uniform2f(uniform(name), x, y);
    function upload(image: TexImageSource, slot: number, name: string) {
      const texture = gl!.createTexture();
      if (!texture) throw new Error("Texture unavailable");
      textures.push(texture);
      gl!.activeTexture(gl!.TEXTURE0 + slot);
      gl!.bindTexture(gl!.TEXTURE_2D, texture);
      gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, image);
      gl!.uniform1i(uniform(name), slot);
    }
    function stop() { cancelAnimationFrame(frame); frame = 0; previousTime = 0; }
    function render() {
      if (!loaded || contextLost || !alive) return;
      const still = pausedRef.current || reduced;
      vector("uParallax", still || coarse ? 0 : offsetX, still || coarse ? 0 : offsetY);
      vector("uMouse", (smoothX + 1) / 2, (smoothY + 1) / 2);
      scalar("uHover", still || coarse ? 0 : hoverAmount);
      scalar("uSeed", seed);
      scalar("uTime", elapsed / 1000);
      scalar("uReveal", still ? 1 : introEase(elapsed / 3500));
      scalar("uIntroColor", still ? 1 : introEase((elapsed - 150) / 3500));
      scalar("uSourceMode", sourceMode);
      const sweepAge = sweepStart >= 0 ? elapsed - sweepStart : -1;
      scalar("uSweep", sweepAge >= 0 ? ease(sweepAge / 2000) : -1);
      scalar("uSweepFrom", sweepFrom);
      scalar("uSweepTo", sweepTo);
      vector("uClick", clickX, clickY);
      scalar("uImpact", sweepAge >= 0 && sweepAge < 500 ? Math.sin((sweepAge / 500) * Math.PI / 2) : 0);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    }
    function tick(time: number) {
      frame = 0;
      if (!alive || !loaded || contextLost || document.hidden || !onScreen) return;
      const delta = previousTime ? Math.min(50, time - previousTime) : 16.667;
      previousTime = time;
      elapsed += delta;
      const dt = delta / 16.667;
      const lerp = (rate: number) => 1 - Math.pow(1 - rate, dt);
      smoothX += (pointerX - smoothX) * lerp(0.08);
      smoothY += (pointerY - smoothY) * lerp(0.08);
      const targetOffsetX = hovering ? -smoothX * 0.12 : 0;
      const targetOffsetY = hovering ? -smoothY * 0.12 * 0.5 : 0;
      offsetX += (targetOffsetX - offsetX) * lerp(hovering ? 0.08 : 0.05);
      offsetY += (targetOffsetY - offsetY) * lerp(hovering ? 0.08 : 0.05);
      hoverAmount += (Number(hovering) - hoverAmount) * lerp(hovering ? 0.08 : 0.06);
      if (sweepStart >= 0 && elapsed - sweepStart >= 2000) { sourceMode = sweepTo; sweepStart = -1; }
      render();
      const movement = Math.abs(pointerX - smoothX) + Math.abs(pointerY - smoothY)
        + Math.abs(targetOffsetX - offsetX) + Math.abs(targetOffsetY - offsetY)
        + Math.abs(Number(hovering) - hoverAmount);
      if (!pausedRef.current && !reduced && (elapsed < 3650 || sweepStart >= 0 || hovering || movement > 0.0001)) frame = requestAnimationFrame(tick);
      else previousTime = 0;
    }
    function wake() {
      if (!alive || !loaded || contextLost || frame || document.hidden || !onScreen) return;
      if (pausedRef.current || reduced) { render(); return; }
      frame = requestAnimationFrame(tick);
    }
    function resize() {
      if (!alive || contextLost) return;
      const rect = container!.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas!.width = Math.round(width * dpr); canvas!.height = Math.round(height * dpr);
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      vector("uSize", width, height);
      // Reference's DPR compensation simplifies to this CSS-space formula.
      scalar("uCell", 14 * 1.08 * Math.max(0.5, Math.max(width, height) / 1920));
      const ratio = source.naturalWidth / Math.max(1, source.naturalHeight);
      const portraitWidth = Math.min(width, height * ratio), portraitHeight = portraitWidth / Math.max(0.01, ratio);
      gl!.uniform4f(uniform("uImageRect"), (width - portraitWidth) / width / 2, 0, portraitWidth / width, portraitHeight / height);
      render(); wake();
    }
    function initialize() {
      if (!alive || loaded || !source.complete || !source.naturalWidth || !depth.complete || !depth.naturalWidth) return;
      try {
        const atlas = document.createElement("canvas");
        atlas.width = atlas.height = 1024;
        const painter = atlas.getContext("2d");
        if (!painter) throw new Error("Atlas unavailable");
        painter.font = '54px "Cascadia Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
        painter.fillStyle = "white"; painter.textAlign = "center"; painter.textBaseline = "middle";
        Array.from(CHARACTERS).forEach((character, index) => painter.fillText(character, (index % 16) * 64 + 32, Math.floor(index / 16) * 64 + 32));
        upload(source, 0, "uPortrait"); upload(depth, 1, "uDepth"); upload(atlas, 2, "uAtlas");
        scalar("uGlyphCount", CHARACTERS.length);
        loaded = true; resize();
      } catch { setFallback(true); stop(); }
    }
    function move(event: PointerEvent) {
      if (event.pointerType === "touch" || coarse || reduced || pausedRef.current) return;
      const rect = canvas!.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
      const isInside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      if (isInside && !hovering) seed++;
      hovering = isInside;
      // Tracking uses the global listener, but the effect is container-scoped.
      pointerX = isInside ? x * 2 - 1 : 0;
      pointerY = isInside ? 1 - y * 2 : 0;
      wake();
    }
    function leave() { pointerX = 0; pointerY = 0; hovering = false; wake(); }
    function sweep(x = 0.2, y = 0.65) {
      if (!loaded || sweepStart >= 0) return;
      clickX = x; clickY = y; sweepFrom = sourceMode; sweepTo = 1 - sourceMode;
      if (reduced || pausedRef.current) { sourceMode = sweepTo; render(); return; }
      elapsed = Math.max(elapsed, 3650); sweepStart = elapsed; wake();
    }
    function click(event: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      sweep((event.clientX - rect.left) / rect.width, 1 - (event.clientY - rect.top) / rect.height);
    }
    function keydown(event: KeyboardEvent) {
      if (typeof event.key !== "string" || event.key.toLowerCase() !== "c" || event.metaKey || event.ctrlKey || event.altKey || !onScreen) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      sweep();
    }
    function staticChanged() {
      if (pausedRef.current || reduced) {
        stop(); elapsed = Math.max(elapsed, 3650);
        if (sweepStart >= 0) sourceMode = sweepTo;
        sweepStart = -1; offsetX = offsetY = hoverAmount = smoothX = smoothY = pointerX = pointerY = 0;
        hovering = false; render();
      } else wake();
    }
    function mediaChanged() { reduced = motionQuery.matches; coarse = coarseQuery.matches; staticChanged(); }
    function visibilityChanged() { if (document.hidden) stop(); else wake(); }
    function loseContext(event: Event) { event.preventDefault(); contextLost = true; stop(); setFallback(true); }
    triggerSweep.current = () => sweep(); changePause.current = staticChanged;
    source.onload = depth.onload = initialize;
    source.onerror = depth.onerror = () => { if (alive) { setFallback(true); stop(); } };
    source.src = PORTRAIT; depth.src = DEPTH;
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("keydown", keydown);
    document.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", visibilityChanged);
    canvas.addEventListener("click", click);
    canvas.addEventListener("webglcontextlost", loseContext);
    motionQuery.addEventListener("change", mediaChanged);
    coarseQuery.addEventListener("change", mediaChanged);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const intersectionObserver = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; if (onScreen) wake(); else stop(); });
    intersectionObserver.observe(container);
    return () => {
      alive = false; stop();
      source.onload = depth.onload = source.onerror = depth.onerror = null;
      window.removeEventListener("pointermove", move); window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerleave", leave); document.removeEventListener("visibilitychange", visibilityChanged);
      canvas.removeEventListener("click", click); canvas.removeEventListener("webglcontextlost", loseContext);
      motionQuery.removeEventListener("change", mediaChanged); coarseQuery.removeEventListener("change", mediaChanged);
      resizeObserver.disconnect(); intersectionObserver.disconnect();
      textures.forEach((texture) => gl.deleteTexture(texture)); shaders.forEach((shader) => gl.deleteShader(shader));
      gl.deleteBuffer(buffer); gl.deleteProgram(program);
      triggerSweep.current = changePause.current = () => {};
    };
  }, []);
  return (
    <div ref={containerRef} className="confucius-portrait">
      <canvas ref={canvasRef} role="img" aria-label="橙色 ASCII 字符组成的孔子人脸近景；移动鼠标感受深度，点击切换色彩"
        style={{ display: fallback ? "none" : "block", width: "100%", height: "100%" }} />
      {fallback && <img className="portrait-fallback" src={PORTRAIT} alt="孔子人脸近景雕像" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center bottom" }} />}
    </div>
  );
}
