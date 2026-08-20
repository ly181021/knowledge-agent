/**
 * test-setup —— 全局测试环境补充
 * jsdom 实现了 HTMLCanvasElement.prototype.getContext，但会打 Not implemented
 * 警告并返回 null，导致 ECharts/zrender 在 setOption 时崩溃
 * （Cannot set properties of null (setting 'dpr')）。
 * 这里无条件覆盖 getContext，返回一个最小化的 2D 上下文 stub，让 ECharts
 * 能在 jsdom 下完成初始化/绘制（仅用于单测，不影响真实浏览器渲染）。
 */

function noop() {}

/** 最小化 2D 上下文：实现 zrender/ECharts 实际调用的若干方法/属性 */
function make2DContext(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    canvas: { width: 300, height: 150 },
    // —— 常用属性（数值/字符串）——
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    lineDashOffset: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'ltr',
    imageSmoothingEnabled: true,
    // —— 绘制方法（全部空实现）——
    save: noop,
    restore: noop,
    scale: noop,
    rotate: noop,
    translate: noop,
    setTransform: noop,
    resetTransform: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({}),
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    arcTo: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    isPointInPath: () => false,
    isPointInStroke: () => false,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 10 } as TextMetrics),
    drawImage: noop,
    createImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
    putImageData: noop,
    setLineDash: noop,
    getLineDash: () => [],
  }
  return ctx as unknown as CanvasRenderingContext2D
}

// 无条件覆盖：jsdom 自带的 getContext 返回 null，必须替换。
// （lib.dom 对 getContext 有 2d/bitmaprenderer/webgl 多个重载，
// 这里用 any 绕开重载签名校验——仅测试环境使用。）
HTMLCanvasElement.prototype.getContext = function (): CanvasRenderingContext2D | null {
  return make2DContext()
} as typeof HTMLCanvasElement.prototype.getContext

// jsdom 不提供 ResizeObserver（useEcharts 的 onMounted 会用到），补一个空 stub。
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
