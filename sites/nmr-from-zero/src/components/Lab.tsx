import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { Play, Pause, StepForward, RotateCcw } from 'lucide-react';
import type { LabId } from '../types';
import type { ActivityHandle, LabSnapshot, SnapshotValue } from '../learning';
import { GAMMA_H_HZ_T, TAU, aliasedFrequency, capacitanceForFrequencyPf, checkTiming, ensembleSignal, fft, fieldErrorPpm, fieldStatistics, larmorHz, lcFrequencyHz, linspace, longitudinalRecovery, reconstructPhantom, resonatorResponse, rotatingFrameVector, shiftedIndex, transverseDecay, waveAt } from '../physics/models';
import type { SamplingMask, Vec3 } from '../physics/models';
import './labs.css';

const COLORS = { blue: '#386fb1', orange: '#c77932', teal: '#218e82', ink: '#173b3a', grey: '#7b8790' };
type Point = { x: number; y: number };
type Series = { label: string; color: string; values: Point[]; dashed?: boolean };
type SnapshotData = Omit<LabSnapshot, 'id' | 'title' | 'capturedAt'>;
type Playback = { progress: number; advanced: boolean; resetTime: () => void; mode?: string; report: (data: SnapshotData) => void };
function useReport(report: Playback['report'], parameters: SnapshotValue[], readings: SnapshotValue[], model: string, time: LabSnapshot['time'], view?: string) {
  useLayoutEffect(() => { report({ parameters, readings, model, time, view }); });
}
const descriptors: Record<LabId, { title: string; description: string }> = {
  waves: { title: '两列波，为什么会增强或消失？', description: '这里生成两条抽象正弦波，逐时刻把它们的数值相加。分开改变波 B 的频率和初相位，观察合成值；曲线不是两个原子核的运动轨迹。' },
  spin: { title: '观察理想脉冲之后的样品磁化', description: '主磁体提供 B₀；射频线圈产生的 B₁ 可改变样品净磁化 M。本实验直接指定理想翻转结果，只演示脉冲结束后的 M 如何相对参考频率转动。' },
  relaxation: { title: '散开的相位，能找回来多少？', description: '图中纵轴是样品磁化的比例。不同频偏的自旋组会出现横向磁化相位分散；理想 180° 脉冲可使其中由静态频偏造成的部分重新汇合，核并没有在空间里散开。' },
  sampling: { title: '电脑看到的频率，一定是真的吗？', description: '把模拟接收电压的低频余弦按时刻取样，再由同一批样本计算 FFT。不同输入频率可能给出相同采样点；电脑不能只凭这些点认出原始频率。' },
  field: { title: '放得进去，不等于都能成像', description: '颜色表示样品不同位置的主磁场强度偏差。缩小评价区域只改变统计范围；加入补偿才改变该模型里的磁场分布，两种操作要分清。' },
  coil: { title: '把线圈调到正确的频率', description: '图中峰属于线圈与电容组成的电路，标线是样品氢核的目标共振频率。改变 L、C、Q，比较电路响应与目标频率，不把电路谐振峰当成样品频谱。' },
  timing: { title: '什么时候才可以开始接收？', description: '电路驱动线圈发射后，样品的磁化变化会在线圈端口产生微弱电压，但强发射残留和电路恢复会妨碍接收。移动采样窗口，检查接收器什么时候才开始记录。' },
  imaging: { title: '从 k 空间，算回一张图', description: '电脑先给定一幅人工模体图，再计算其二维傅里叶数据，保留其中一些点并逆变换。这里用已知答案检查重建；没有真的驱动梯度线圈或采集样品电压。' },
};

function Slider({ label, value, min, max, step = 1, unit = '', onChange, disabled = false }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (n: number) => void; disabled?: boolean }) {
  const id = useId();
  return <label className="lab-slider" htmlFor={id}><span>{label}<output htmlFor={id}>{Number(value.toFixed(3))} <small>{unit}</small></output></span><input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} /><span className="lab-range-ends"><span>{min} {unit}</span><span>{max} {unit}</span></span></label>;
}
function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="lab-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}
function Legend({ series }: { series: Pick<Series, 'label' | 'color' | 'dashed'>[] }) {
  return <div className="lab-legend">{series.map(s => <span key={s.label}><i style={{ borderColor: s.color, borderStyle: s.dashed ? 'dashed' : 'solid' }} />{s.label}</span>)}</div>;
}
function Plot({ series, xMin = 0, xMax, yMin = -1, yMax = 1, xLabel, yLabel, cursor, points = [], markers = [] }: { series: Series[]; xMin?: number; xMax: number; yMin?: number; yMax?: number; xLabel: string; yLabel: string; cursor?: number; points?: Point[]; markers?: { x: number; label: string; color?: string }[] }) {
  const width = 640, height = 260, left = 54, right = 24, top = 27, bottom = 44;
  const px = (x: number) => left + (x - xMin) / (xMax - xMin) * (width - left - right);
  const py = (y: number) => top + (yMax - y) / (yMax - yMin) * (height - top - bottom);
  const tick = (n: number) => Number(n.toFixed(Math.abs(n) < 3 ? 2 : 1)).toString();
  return <div className="lab-chart"><svg className="lab-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${yLabel}随${xLabel}的曲线`}><title>{`${yLabel}随${xLabel}的曲线`}</title>
    {linspace(yMin, yMax, 5).map((y, i) => <g key={`y${i}`}><line x1={left} x2={width - right} y1={py(y)} y2={py(y)} stroke="#e5ebe9" /><text x={left - 9} y={py(y) + 4} textAnchor="end">{tick(y)}</text></g>)}
    {linspace(xMin, xMax, 5).map((x, i) => <g key={`x${i}`}><line x1={px(x)} x2={px(x)} y1={top} y2={height - bottom} stroke="#edf0ef" /><text x={px(x)} y={height - bottom + 21} textAnchor="middle">{tick(x)}</text></g>)}
    <text x={left} y={15} className="lab-axis-label">{yLabel}</text><text x={width - right} y={height - 5} textAnchor="end" className="lab-axis-label">{xLabel}</text>
    {series.map(s => <path key={s.label} d={s.values.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(2)},${py(p.y).toFixed(2)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.label.includes('合成') ? 2.8 : 2} strokeDasharray={s.dashed ? '6 5' : undefined} />)}
    {markers.filter(m => m.x >= xMin && m.x <= xMax).map(m => <g key={m.label}><line x1={px(m.x)} x2={px(m.x)} y1={top} y2={height - bottom} stroke={m.color || COLORS.grey} strokeDasharray="4 4" /><text x={Math.min(width - 70, Math.max(left + 40, px(m.x)))} y={top + 15} textAnchor="middle" fill={m.color || COLORS.ink}>{m.label}</text></g>)}
    {points.map((p, i) => <circle key={i} cx={px(p.x)} cy={py(p.y)} r="3.3" fill={COLORS.ink} stroke="white" strokeWidth=".6" />)}
    {cursor !== undefined && <line x1={px(cursor)} x2={px(cursor)} y1={top} y2={height - bottom} stroke={COLORS.ink} strokeWidth="1.5" strokeDasharray="3 3" />}
  </svg><Legend series={series} /></div>;
}

function WavesLab({ progress, resetTime, report }: Playback) {
  const [frequency, setFrequency] = useState(4), [phase, setPhase] = useState(0);
  const series = useMemo(() => {
    const times = linspace(0, 1, 501);
    return [
      { label: '波 A：4 Hz', color: COLORS.blue, values: times.map(x => ({ x, y: waveAt(x, 4) })) },
      { label: '波 B', color: COLORS.orange, values: times.map(x => ({ x, y: waveAt(x, frequency, phase) })), dashed: true },
      { label: '合成 A + B', color: COLORS.teal, values: times.map(x => ({ x, y: waveAt(x, 4) + waveAt(x, frequency, phase) })) },
    ];
  }, [frequency, phase]);
  const preset = (nextPhase: number) => { setFrequency(4); setPhase(nextPhase); resetTime(); };
  useReport(report, [{ label: '波 A 频率', value: 4, unit: 'Hz' }, { label: '波 B 频率', value: frequency, unit: 'Hz' }, { label: '波 B 初相位', value: phase, unit: '°' }], [{ label: '合成瞬时值', value: waveAt(progress, 4) + waveAt(progress, frequency, phase), unit: '相对单位' }], '两条等幅抽象正弦逐时刻相加；读数是当前时刻的合成值，不是波的峰值幅度，也未模拟线圈或样品。', { value: progress, unit: 's' });
  return <><div className="lab-presets"><p>先预测，再对照：同频同幅时，相位会怎样改变合成波？</p><div role="group" aria-label="波叠加对照预设"><button type="button" aria-pressed={frequency === 4 && phase === 0} onClick={() => preset(0)}>同相 · 0°</button><button type="button" aria-pressed={frequency === 4 && phase === 180} onClick={() => preset(180)}>反相 · 180°</button></div></div><div className="lab-controls"><Slider label="波 B 的频率" value={frequency} min={1} max={12} unit="Hz" onChange={setFrequency} /><Slider label="波 B 的初始相位" value={phase} min={0} max={360} step={15} unit="°" onChange={setPhase} /></div><Plot series={series} xMax={1} yMin={-2.2} yMax={2.2} xLabel="时间 / s" yLabel="瞬时值 / 相对单位" cursor={progress} /><div className="lab-metrics"><Metric label="光标时刻" value={`${progress.toFixed(2)} s`} /><Metric label="这一刻的合成值" value={(waveAt(progress, 4) + waveAt(progress, frequency, phase)).toFixed(2)} /></div><p className="lab-observation"><b>试试看：</b>将频率设为 4 Hz，相位设为 180°，两列等幅波逐点抵消。频率不同，即使一开始同相，也会逐渐错开。</p><p className="lab-model-note">模型：理想正弦波，数值按选定幅度缩放；相加的是同一时刻的数值。在核磁接收中，不同区域磁化的变化在线圈中感应出电压，各区域贡献在线圈的总感应电压中叠加，接收链记录这个总电压。此处只练习叠加数学，不计算磁化、感应或电路。</p></>;
}

function SpinLab({ progress, report, mode, resetTime }: Playback) {
  const basic = mode === 'basic';
  const [b0, setB0] = useState(50), [flip, setFlip] = useState(90), [offset, setOffset] = useState(0);
  const activeOffset = basic ? 0 : offset;
  const marker = useId().replace(/:/g, '');
  const timeMs = progress * 200, vector = rotatingFrameVector(flip, activeOffset, timeMs);
  useReport(report, [{ label: 'B₀', value: b0, unit: 'mT' }, { label: '翻转角', value: flip, unit: '°' }, { label: '频偏', value: activeOffset, unit: 'Hz' }], [{ label: '拉莫尔频率', value: larmorHz(b0), unit: 'Hz' }, ...vector.map((value, i) => ({ label: ['Mx', 'My', 'Mz'][i], value, unit: 'M₀' }))], '样品净磁化 M 的旋转坐标模型：理想瞬时脉冲先给定翻转结果，之后仅按频偏进动；正氢核 γ，dM/dt=γM×B。B₀ 只更新共振频率读数；未计算实际 B₁ 波形、接收电压或弛豫。', { value: timeMs, unit: 'ms' });
  const project = ([x, y, z]: Vec3) => [250 + 118 * x + 62 * y, 180 + 40 * y - 115 * z];
  const origin = project([0, 0, 0]), tip = project(vector);
  const axes: { v: Vec3; label: string }[] = [{ v: [1.2, 0, 0], label: '+x' }, { v: [0, 1.4, 0], label: '+y' }, { v: [0, 0, 1.2], label: '+z' }];
  const xyCircle = linspace(0, TAU, 81).map(t => project([Math.cos(t), Math.sin(t), 0]));
  return <>{basic && <div className="lab-presets"><p>快捷对照翻转角（本节固定共振条件，暂不引入频偏）：</p><div role="group" aria-label="典型翻转角对照">{([0, 90, 180] as const).map(angle => <button key={angle} type="button" aria-pressed={flip === angle} onClick={() => { setFlip(angle); resetTime(); }}>{angle === 0 ? '0° · 沿 +z 平衡态' : angle === 90 ? '90° · 倒向横向平面' : '180° · 翻向 −z'}</button>)}</div></div>}
    <div className={`lab-controls ${basic ? '' : 'lab-controls-three'}`}><Slider label="静磁场 B₀" value={b0} min={10} max={200} step={5} unit="mT" onChange={setB0} /><Slider label="理想射频翻转角" value={flip} min={0} max={180} step={15} unit="°" onChange={setFlip} />{!basic && <Slider label="射频结束后的频偏 Δf" value={offset} min={-20} max={20} unit="Hz" onChange={setOffset} />}</div>
    <div className="lab-spin-layout"><svg viewBox="0 0 470 290" className="lab-spin" role="img" aria-label={`旋转坐标系磁化矢量，Mx=${vector[0].toFixed(2)}，My=${vector[1].toFixed(2)}，Mz=${vector[2].toFixed(2)}`}><title>右手坐标系中的净磁化矢量</title><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8Z" fill={COLORS.teal} /></marker><marker id={`${marker}b`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7Z" fill={COLORS.blue} /></marker></defs>
      <path d={xyCircle.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')} stroke="#d7e3df" fill="#f0f6f3" />
      {axes.map(a => { const end = project(a.v); return <g key={a.label}><line x1={origin[0]} y1={origin[1]} x2={end[0]} y2={end[1]} stroke="#8b9a96" strokeDasharray="4 4" /><text x={end[0] + 8} y={end[1] + 5}>{a.label}</text></g>; })}
      <line x1="70" y1="180" x2="70" y2="65" stroke={COLORS.blue} strokeWidth="3" markerEnd={`url(#${marker}b)`} /><text x="32" y="45" fill={COLORS.blue}>B₀ 沿 +z</text>
      <line x1={origin[0]} y1={origin[1]} x2={tip[0]} y2={tip[1]} stroke={COLORS.teal} strokeWidth="5" markerEnd={`url(#${marker})`} /><circle cx={origin[0]} cy={origin[1]} r="4" fill={COLORS.ink} /><text x={tip[0] + 10} y={tip[1] - 8} fill={COLORS.teal}>M</text>
      <text x="24" y="262" fill={COLORS.orange}>先前 B₁ 沿 +x；现只画样品磁化 M</text>
    </svg><div className="lab-spin-readout"><Metric label="氢核共振频率 f₀" value={`${(larmorHz(b0) / 1e6).toFixed(6)} MHz`} note="随静磁场 B₀ 成正比" /><Metric label="B₁ = 25 μT 时的理想脉冲时长" value={`${(flip / (360 * GAMMA_H_HZ_T * 25e-6) * 1e6).toFixed(1)} μs`} note="固定 B₁ 时，角度加倍则脉宽加倍" /><Metric label={`脉冲之后 ${timeMs.toFixed(0)} ms`} value={`M = (${vector.map(n => n.toFixed(2)).join(', ')})`} note="依次为 Mx、My（横向）、Mz（纵向），M₀ = 1" /></div></div>
    <p className="lab-observation"><b>试试看：</b>{basic ? '依次点选 0°、90°、180°：90° 时纵向 Mz 变为 0、横向 My 最大（1.00）；180° 时 M 指向 −z（Mz = −1.00），横向分量反而回到 0，说明不是脉冲越长接收信号就越大。蓝色 B₀ 始终存在。' : '把理想翻转角设为 90°，样品的 M 落到横向平面；180° 时指向 −z。频偏为 0 时，M 相对这套旋转坐标静止，不代表样品在实验室中没有进动。改为 5 Hz 再播放，观察的是脉冲后 M 的相位变化；修改 B₀ 只改变共振频率读数。'}</p><p className="lab-model-note">约定：右手坐标，氢核 γ &gt; 0，dM/dt = γ M × B。射频线圈产生的同向旋转 B₁ 分量若沿 +x，理想共振时可将 +Mz 转向 +My。本图跳过发射过程，直接给定翻转角；25 μT 只用于换算理想脉宽，不是可调驱动或实测场。未模拟离共振激发、线圈端电压或弛豫。</p></>;
}

function RelaxationLab({ progress, report, mode, resetTime }: Playback) {
  type View = 'echo' | 'fid' | 't1' | 't2';
  const [view, setView] = useState<View>(mode === 't1t2' ? 't1' : mode === 'fid' ? 'fid' : 'echo');
  const [tau, setTau] = useState(40), [t2, setT2] = useState(200), [spread, setSpread] = useState(40), [t1, setT1] = useState(500);
  const end = view === 'echo' ? 2.8 * tau : view === 'fid' ? 150 : 3 * (view === 't1' ? t1 : t2);
  const labels: Record<View, string> = { echo: 'FID → 回波', fid: 'FID 与静态失相', t1: 'T₁ 恢复', t2: 'T₂ 衰减' };
  const allowed: View[] = mode === 't1t2' ? ['t1', 't2'] : mode === 'fid' ? ['fid'] : ['echo', 'fid', 't2', 't1'];
  const series: Series[] = useMemo(() => {
    const times = linspace(0, end, 361);
    if (view === 't1') return [{ label: '纵向磁化 Mz 恢复', color: COLORS.blue, values: times.map(x => ({ x, y: longitudinalRecovery(x, t1) })) }];
    if (view === 't2') return [{ label: '横向磁化的 T₂ 衰减', color: COLORS.orange, values: times.map(x => ({ x, y: transverseDecay(x, t2) })) }];
    const curves: Series[] = [{ label: 'FID 幅度：含静态频偏', color: COLORS.grey, values: times.map(x => { const s = ensembleSignal(x, tau, t2, spread, false); return { x, y: Math.hypot(s.re, s.im) }; }) }, { label: '仅不可逆 T₂ 衰减', color: COLORS.orange, dashed: true, values: times.map(x => ({ x, y: transverseDecay(x, t2) })) }];
    if (view === 'echo') curves.push({ label: '理想 180° 后的回波幅度', color: COLORS.teal, values: times.map(x => { const s = ensembleSignal(x, tau, t2, spread); return { x, y: Math.hypot(s.re, s.im) }; }) });
    return curves;
  }, [end, view, t1, tau, t2, spread]);
  const time = progress * end;
  const current = view === 't1' ? longitudinalRecovery(time, t1) : view === 't2' ? transverseDecay(time, t2) : (() => { const s = ensembleSignal(time, tau, t2, spread, view === 'echo'); return Math.hypot(s.re, s.im); })();
  const model = view === 't1' || view === 't2' ? '绘制样品磁化分量的理想单指数变化：T₁ 从 Mz=0 恢复，T₂ 从初始横向磁化衰减且不含静态频偏。纵向 Mz 不是接收线圈直接测得的电压；本图未模拟读出脉冲与接收链。' : `把样品分成 257 个具有高斯权重的静态频偏组，先合成各组横向磁化，再取其幅度；共同乘上独立 T₂ 衰减包络。${view === 'echo' ? '理想瞬时 90°/180° 脉冲。' : '仅初始激励后的自由演化。'}未计算线圈感应和电路，纵轴是 |Mxy|/M₀，作为理想固定接收条件下信号包络的代理。无扩散、交换或 B₁ 不均匀；不把此高斯 FID 强行当作单指数。`;
  useReport(report, view === 't1' ? [{ label: 'T₁', value: t1, unit: 'ms' }] : [{ label: 'T₂', value: t2, unit: 'ms' }, ...(view === 't2' ? [] : [{ label: '静态频偏标准差', value: spread, unit: 'Hz' }]), ...(view === 'echo' ? [{ label: 'τ', value: tau, unit: 'ms' }] : [])], [{ label: view === 't1' ? 'Mz/M₀' : '|Mxy|/M₀', value: current }, ...(view === 'echo' ? [{ label: '几何聚相时刻', value: 2 * tau, unit: 'ms' }] : [])], model, { value: time, unit: 'ms' }, labels[view]);
  return <>{allowed.length > 1 && <div className="lab-segment" role="group" aria-label="选择弛豫实验">{allowed.map(v => <button key={v} type="button" className={view === v ? 'is-active' : ''} onClick={() => { setView(v); resetTime(); }}>{labels[v]}</button>)}</div>}
    <div className={`lab-controls ${view === 'echo' ? 'lab-controls-three' : ''}`}>{view === 'echo' && <Slider label="180° 脉冲时刻 τ" value={tau} min={20} max={80} step={5} unit="ms" onChange={setTau} />}{view === 't1' ? <Slider label="纵向弛豫时间 T₁" value={t1} min={100} max={1500} step={100} unit="ms" onChange={setT1} /> : <Slider label="横向弛豫时间 T₂" value={t2} min={60} max={600} step={20} unit="ms" onChange={setT2} />}{(view === 'echo' || view === 'fid') && <Slider label="静态频偏分布宽度 σ" value={spread} min={0} max={100} step={5} unit="Hz" onChange={setSpread} />}</div>
    <Plot series={series} xMax={end} yMin={0} yMax={1.05} xLabel="时间 / ms" yLabel={view === 't1' ? 'Mz / M₀' : '|Mxy| / M₀'} cursor={time} markers={view === 'echo' ? [{ x: 0, label: '90° 激励', color: COLORS.orange }, { x: tau, label: '180° 脉冲', color: COLORS.orange }, { x: 2 * tau, label: '2τ 聚相', color: COLORS.teal }] : view === 'fid' ? [] : [{ x: view === 't1' ? t1 : t2, label: view === 't1' ? '1 × T₁' : '1 × T₂' }, { x: end, label: view === 't1' ? '3 × T₁' : '3 × T₂' }]} />
    <div className="lab-metrics"><Metric label="当前时刻" value={`${time.toFixed(1)} ms`} /><Metric label={view === 't1' ? '已恢复的纵向比例' : '剩余横向磁化比例'} value={`${(100 * current).toFixed(1)}%`} />{view === 'echo' && <Metric label="2τ 处的理想剩余比例" value={`${(100 * transverseDecay(2 * tau, t2)).toFixed(1)}%`} />}{(view === 't1' || view === 't2') && <Metric label="1 个 / 3 个时间常数后" value={view === 't1' ? '63.2% / 95.0%' : '36.8% / 5.0%'} />}</div>
    <p className="lab-observation"><b>试试看：</b>{view === 'echo' ? '保持 T₂ 不变，增大各组核的静态频偏差异，合成横向磁化会更快减小。理想 180° 脉冲改变各组磁化的相位关系，使它们在 2τ 重新聚相；T₂ 已造成的衰减不能因此恢复。幅度峰可能受衰减包络影响，略早于几何聚相时刻。' : view === 'fid' ? '先把各组核的频偏宽度设为 0，再增大。不同组的横向磁化转速不同，方向逐渐抵消，使合成幅度更快减小；不是核在空间里散开或核磁矩消失。这里没有施加重聚焦脉冲，线圈直接测得的电压也未被逐点计算。' : view === 't1' ? '样品的纵向磁化从零回到平衡值：一个 T₁ 后恢复约 63.2%，三个 T₁ 后约 95%。它描述样品状态，不能把这条上升曲线当成线圈直接接收的电压。改变 T₁，会改变达到同一恢复比例所需的时间。' : '样品横向磁化在一个 T₂ 后剩约 36.8%，三个 T₂ 后约 5%。它描述横向相干的衰减，不是核的数量减少，也不是纵向磁化恢复；在接收条件固定的理想近似下，它控制回波包络的衰减。'}</p><p className="lab-model-note">模型：{model}</p></>;
}

function SamplingLab({ progress, resetTime, report, mode }: Playback) {
  const [frequency, setFrequency] = useState(45), [sampleRate, setSampleRate] = useState(64);
  const alias = aliasedFrequency(frequency, sampleRate), count = 64, duration = (count - 1) / sampleRate;
  const samples = Array.from({ length: count }, (_, i) => ({ x: i / sampleRate, y: Math.cos(TAU * frequency * i / sampleRate) }));
  const transformed = fft(samples.map(p => ({ re: p.y, im: 0 })));
  const spectrum = transformed.slice(0, count / 2 + 1).map((v, i) => ({ x: i * sampleRate / count, y: Math.hypot(v.re, v.im) / count * (i === 0 || i === count / 2 ? 1 : 2) }));
  const peak = spectrum.reduce((a, b) => b.y > a.y ? b : a);
  const times = linspace(0, duration, 901);
  const series = [{ label: '模型输入的连续余弦', color: COLORS.orange, values: times.map(x => ({ x, y: Math.cos(TAU * frequency * x) })) }, { label: '与采样点吻合的低频余弦', color: COLORS.blue, dashed: true, values: times.map(x => ({ x, y: Math.cos(TAU * alias * x) })) }];
  const applyPreset = (nextFreq: number, nextRate: number) => { setFrequency(nextFreq); setSampleRate(nextRate); resetTime(); };
  useReport(report, [{ label: '输入频率', value: frequency, unit: 'Hz' }, { label: '采样率', value: sampleRate, unit: '次/s' }, { label: '采样点数', value: count }], [{ label: '折叠频率', value: alias, unit: 'Hz' }, ...(mode === 'time' ? [] : [{ label: 'FFT 峰频点', value: peak.x, unit: 'Hz' }])], '以低频余弦模拟接收链输出电压，ADC 按时刻取 64 个实数样本；幅度为相对单位。没有真实样品、MHz 载波、噪声或模拟抗混叠滤波电路。', { value: progress * duration, unit: 's' }, mode === 'time' ? '时域采样' : '时域与频域');
  return <><div className="lab-presets"><p>快捷对照预设：比较充足采样与采样不足时的离散圆点</p><div role="group" aria-label="采样率对照预设"><button type="button" aria-pressed={frequency === 6 && sampleRate === 32} onClick={() => applyPreset(6, 32)}>6 Hz · 32 次/秒</button><button type="button" aria-pressed={frequency === 26 && sampleRate === 32} onClick={() => applyPreset(26, 32)}>26 Hz · 32 次/秒</button><button type="button" aria-pressed={frequency === 45 && sampleRate === 64} onClick={() => applyPreset(45, 64)}>45 Hz · 64 次/秒</button><button type="button" aria-pressed={frequency === 45 && sampleRate === 128} onClick={() => applyPreset(45, 128)}>45 Hz · 128 次/秒</button></div></div><div className="lab-controls"><Slider label="输入信号频率" value={frequency} min={1} max={90} unit="Hz" onChange={setFrequency} /><Slider label="采样率 fₛ" value={sampleRate} min={16} max={128} step={8} unit="次 / s" onChange={setSampleRate} /></div>
    <Plot series={series} xMax={duration} yMin={-1.15} yMax={1.15} xLabel="时间 / s" yLabel="连续波与 64 个采样点" cursor={progress * duration} points={samples} />
    {mode !== 'time' && <Plot series={[{ label: '64 点 FFT 单边幅度', color: COLORS.teal, values: spectrum }]} xMax={sampleRate / 2} yMin={0} yMax={1.05} xLabel="频率 / Hz" yLabel="幅度 / 归一化" markers={[{ x: alias, label: `${alias.toFixed(1)} Hz` }]} />}
    <div className="lab-metrics"><Metric label="奈奎斯特频率 fₛ / 2" value={`${sampleRate / 2} Hz`} note="不发生折叠的最高频率上限" /><Metric label="折叠后频率" value={`${alias.toFixed(1)} Hz`} note="蓝色虚线对应的等效慢波频率" />{mode !== 'time' && <Metric label="实际 FFT 最大频点" value={`${peak.x.toFixed(1)} Hz`} note={`频点间隔 ${sampleRate / count} Hz`} />}</div>
    <p className="lab-observation"><b>试试看：</b>对比 32 次/秒下的 6 Hz 与 26 Hz，或 64 次/秒下的 45 Hz（圆点同时吻合 19 Hz 蓝线）。不是 ADC 把样品的共振频率改掉了，而是这组离散样本无法单独区分快波和折叠后的慢波。提高采样率到 128 次/秒再比较。</p><p className="lab-model-note">用无噪声低频余弦代替接收电压，只模拟实数单通道采样；没有直接采样 MHz 核磁射频。橙线是已知输入，蓝线是另一种符合相同样本的解释，并非第二路实测电压。{mode !== 'time' && '不整周期截取会产生频谱泄漏，FFT 峰值未必刚好落在理论频率。'}</p></>;
}

function fieldColor(ppm: number) {
  const amount = Math.min(1, Math.abs(ppm) / 2500);
  return `hsl(${ppm < 0 ? 211 : 30} ${45 + amount * 15}% ${96 - amount * 54}%)`;
}
function FieldLab({ progress, report }: Playback) {
  const [diameter, setDiameter] = useState(160), [correction, setCorrection] = useState(0);
  const stats = fieldStatistics(diameter, correction / 100), baseStats = fieldStatistics(diameter, 0);
  useReport(report, [{ label: '评估区域直径', value: diameter, unit: 'mm' }, { label: '线性补偿', value: correction, unit: '%' }], [{ label: '峰峰不均匀度', value: stats.peakToPeakPpm, unit: 'ppm' }, { label: '50 mT 下频率跨度', value: larmorHz(50) * stats.peakToPeakPpm * 1e-6, unit: 'Hz' }], '样品截面的主磁场偏差由人为二维多项式给定；补偿改变模型场，圆圈只改变统计区域。不是 Halbach 仿真、实测场图、三维 DSV 或漏磁范围。', { value: progress * 100, unit: '% 查看进度' });
  const tiles = 32, px = (mm: number) => 190 + 1.2 * mm, py = (mm: number) => 153 - 1.2 * mm;
  return <><div className="lab-controls"><Slider label="目标圆形区域直径" value={diameter} min={40} max={200} step={10} unit="mm" onChange={setDiameter} /><Slider label="线性场误差补偿" value={correction} min={0} max={100} step={5} unit="%" onChange={setCorrection} /></div>
    <div className="lab-field-layout"><svg viewBox="0 0 390 325" className="lab-field" role="img" aria-label={`示例二维场图，目标直径${diameter}毫米，峰峰不均匀度${stats.peakToPeakPpm.toFixed(0)}ppm`}><title>示例二维场偏差，不是实际磁体的测量或仿真</title>
      {Array.from({ length: tiles * tiles }, (_, i) => { const ix = i % tiles, iy = Math.floor(i / tiles), x = -100 + (ix + .5) * 200 / tiles, y = 100 - (iy + .5) * 200 / tiles; return <rect key={i} x={70 + ix * 240 / tiles} y={33 + iy * 240 / tiles} width={240 / tiles + .2} height={240 / tiles + .2} fill={fieldColor(fieldErrorPpm(x, y, correction / 100))} />; })}
      <circle cx="190" cy="153" r={diameter * .6} fill="none" stroke={COLORS.ink} strokeWidth="2" strokeDasharray="6 3" />
      <line x1={px(-100 + progress * 200)} x2={px(-100 + progress * 200)} y1={py(100)} y2={py(-100)} stroke="white" strokeWidth="2" />
      <text x="70" y="19">场偏差 / ppm（固定色标）</text><text x="70" y="293">−100</text><text x="190" y="293" textAnchor="middle">0</text><text x="310" y="293" textAnchor="end">100 mm</text><text x="190" y="315" textAnchor="middle">虚线圆：当前评估区域</text>
    </svg><div className="lab-field-details"><div className="lab-colorbar" /><div className="lab-colorbar-labels"><span>−2500 ppm</span><span>0</span><span>+2500 ppm</span></div><Metric label="区域内峰峰场差 ΔB / B₀" value={`${stats.peakToPeakPpm.toFixed(0)} ppm`} /><Metric label="相应氢核频率跨度（50 mT）" value={`${(larmorHz(50) * stats.peakToPeakPpm * 1e-6 / 1000).toFixed(2)} kHz`} /><Metric label="相对同一区域、未补偿时" value={`改善 ${(100 * (1 - stats.peakToPeakPpm / baseStats.peakToPeakPpm)).toFixed(0)}%`} /><button type="button" className="lab-small-button" onClick={() => setCorrection(100)}>补偿所有线性项</button></div></div>
    <p className="lab-observation"><b>试试看：</b>把线性补偿调到 100%，仍有由二次项造成的场偏差。缩小圆圈也能改善统计数字，但没有因此把圆外磁场修好。真实匀场要用补偿磁块或线圈改变样品处的场，再测量验证；白线只是查看游标，不是在采集真实场图。</p><p className="lab-model-note">模型只给出样品二维截面的主场强度偏差，不计算产生它的磁块、导线或机械结构。颜色不是样品磁化，也不是图像亮度；虚线圆不是三维 DSV、净孔或漏磁边界。报告均匀度必须同时说明评估区域和统计口径。</p></>;
}

function CoilLab({ progress, report }: Playback) {
  const [inductance, setInductance] = useState(8), [capacitance, setCapacitance] = useState(699), [q, setQ] = useState(60);
  const target = larmorHz(50), resonance = lcFrequencyHz(inductance, capacitance), bandwidth = resonance / q;
  const lower = Math.min(target, resonance) * .86, upper = Math.max(target, resonance) * 1.14;
  useReport(report, [{ label: 'L', value: inductance, unit: 'μH' }, { label: 'C', value: capacitance, unit: 'pF' }, { label: 'Q', value: q }], [{ label: '谐振频率', value: resonance, unit: 'Hz' }, { label: '近似带宽', value: bandwidth, unit: 'Hz' }, { label: '光标频率', value: lower + (upper - lower) * progress, unit: 'Hz' }], '理想线圈—电容电路的近谐振归一化响应，非样品频谱或接收电压实测；50 mT 氢核频率只作为目标标线。不含寄生参数、匹配或振铃时域计算。', { value: progress * 100, unit: '% 扫频进度' });
  const points = [...linspace(lower, upper, 601), resonance].sort((a, b) => a - b).map(f => ({ x: f / 1e6, y: resonatorResponse(f, resonance, q) }));
  return <><div className="lab-controls lab-controls-three"><Slider label="线圈电感 L" value={inductance} min={2} max={20} step={.5} unit="μH" onChange={setInductance} /><Slider label="调谐电容 C" value={capacitance} min={100} max={3000} unit="pF" onChange={setCapacitance} /><Slider label="设定的品质因数 Q" value={q} min={10} max={200} step={5} onChange={setQ} /></div>
    <Plot series={[{ label: '线圈电路的相对响应', color: COLORS.teal, values: points }, { label: '−3 dB 幅度 ≈ 0.707', color: COLORS.grey, dashed: true, values: [{ x: lower / 1e6, y: Math.SQRT1_2 }, { x: upper / 1e6, y: Math.SQRT1_2 }] }]} xMin={lower / 1e6} xMax={upper / 1e6} yMin={0} yMax={1.1} xLabel="频率 / MHz" yLabel="相对幅度" cursor={(lower + (upper - lower) * progress) / 1e6} markers={[{ x: target / 1e6, label: '氢核 f₀', color: COLORS.blue }]} />
    <div className="lab-metrics"><Metric label="LC 共振频率" value={`${(resonance / 1e6).toFixed(4)} MHz`} note="峰值对准蓝色标线即完成调谐" /><Metric label="近似 −3 dB 带宽 f / Q" value={`${(bandwidth / 1000).toFixed(1)} kHz`} note="幅度降到约 0.707（半功率）的频宽" /><Metric label="目标频率" value={`${(target / 1e6).toFixed(4)} MHz`} note="氢核、50 mT" /></div>
    <button type="button" className="lab-small-button" onClick={() => setCapacitance(Math.round(capacitanceForFrequencyPf(inductance, target)))}>按当前电感，调谐到 50 mT 的氢核频率</button>
    <p className="lab-observation"><b>试试看：</b>先调电容，让线圈电路的响应峰靠近固定 50 mT 下的氢核频率。改变的是电路，不是把样品氢核频率调走。随后增大 Q，灰色虚线（0.707 半功率线）截取的频带变窄，可能不能覆盖所需脉冲或样品频带；较高 Q 通常也使储能消散更慢，但本图没有计算振铃曲线。</p><p className="lab-model-note">模型采用单电容教学近似，专门隔离展示谐振调谐频率 f₀（峰值固定为 1，非 1 V 或 B₁ 场强）；真实探头通常还需第二个匹配电容把端口调到 50 Ω 并用网分仪核验反射 S₁₁。</p></>;
}

function TimingLab({ progress, report }: Playback) {
  const [duration, setDuration] = useState(100), [ringdown, setRingdown] = useState(80), [receive, setReceive] = useState(240);
  const txStart = 40, txEnd = txStart + duration, result = checkTiming({ txStartUs: txStart, txDurationUs: duration, ringdownUs: ringdown, rxStartUs: receive, rxDurationUs: 300 });
  useReport(report, [{ label: '发射脉宽', value: duration, unit: 'μs' }, { label: '设定恢复期', value: ringdown, unit: 'μs' }, { label: '接收开始', value: receive, unit: 'μs' }], [{ label: '最早允许接收', value: result.safeStart, unit: 'μs' }, { label: '时序检查', value: result.message }], '单脉冲与固定接收窗，仅检查时间关系，不证明真实硬件保护合格。', { value: progress * 1000, unit: 'μs' });
  const x = (time: number) => 126 + time / 1000 * 480;
  const rows = [{ label: '驱动线圈', y: 50, start: txStart, end: txEnd, color: COLORS.orange }, { label: '保护 / 恢复', y: 112, start: txStart, end: result.safeStart, color: COLORS.grey }, { label: 'ADC 采样', y: 174, start: receive, end: receive + 300, color: result.valid ? COLORS.teal : '#ae4d43' }];
  return <><div className="lab-controls lab-controls-three"><Slider label="发射脉冲时长" value={duration} min={40} max={240} step={10} unit="μs" onChange={setDuration} /><Slider label="设定的发射后恢复期" value={ringdown} min={20} max={200} step={10} unit="μs" onChange={setRingdown} /><Slider label="接收开始时刻" value={receive} min={40} max={550} step={10} unit="μs" onChange={setReceive} /></div>
    <div className="lab-chart"><svg viewBox="0 0 640 275" className="lab-plot" role="img" aria-label={`收发时序图，${result.valid ? '未发现重叠' : '存在时序冲突'}`}><title>射频、接收保护和 ADC 的相对时序</title>{rows.map(r => <g key={r.label}><text x="10" y={r.y + 18}>{r.label}</text><line x1="126" x2="606" y1={r.y + 32} y2={r.y + 32} stroke="#cdd9d4" /><rect x={x(r.start)} y={r.y} width={x(r.end) - x(r.start)} height="32" rx="3" fill={r.color} opacity=".86" /><text x={x(r.start) + 5} y={r.y - 8}>{r.start}–{r.end} μs</text></g>)}<line x1={x(result.safeStart)} x2={x(result.safeStart)} y1="20" y2="222" stroke={COLORS.ink} strokeDasharray="4 4" /><line x1={x(progress * 1000)} x2={x(progress * 1000)} y1="20" y2="222" stroke={COLORS.blue} strokeWidth="2" />{[0, 250, 500, 750, 1000].map(t => <text key={t} x={x(t)} y="245" textAnchor="middle">{t}</text>)}<text x="606" y="267" textAnchor="end">时间 / μs</text></svg></div>
    <div className={`lab-status ${result.valid ? 'is-valid' : 'is-conflict'}`} role="status"><strong>{result.valid ? '✓ 时序检查通过' : '！发现时序冲突'}</strong><p>{result.message}</p></div>
    <div className="lab-metrics"><Metric label="模型允许的最早接收时刻" value={`${result.safeStart} μs`} /><Metric label="发射结束到接收的间隔" value={`${receive - txEnd} μs`} /></div>
    <p className="lab-observation"><b>试试看：</b>把 ADC 采样窗提前，可能撞上线圈仍被驱动的发射期，或线圈振铃及接收前端尚未恢复的阶段。样品磁化已在演化，其感应电压却可能被这些残留遮住。等待更久也有代价：样品的横向相干可能已经衰减，错过的早期电压无法靠延后采样找回。</p><p className="lab-model-note">模型只比较驱动、保护恢复和 ADC 采样的时间区间，接收窗固定为 300 μs，恢复时间由你指定。它没有计算样品磁化、端口电压或保护器件响应；“通过”只表示所填时间没有冲突，不证明接收器能承受实际发射。这不是可直接上机的序列。</p></>;
}

function PixelImage({ data, size, label, kspace = false, originalMax = 1 }: { data: number[]; size: number; label: string; kspace?: boolean; originalMax?: number }) {
  const pixel = 224 / size;
  return <figure className="lab-pixel-figure"><svg viewBox="0 0 224 224" role="img" aria-label={label}><title>{label}</title>{data.map((value, i) => { const intensity = Math.max(0, Math.min(1, kspace ? Math.log1p(value) / Math.log1p(originalMax) : value)); const grey = Math.round(intensity * 255); return <rect key={i} x={(i % size) * pixel} y={Math.floor(i / size) * pixel} width={pixel + .04} height={pixel + .04} fill={`rgb(${grey},${grey},${grey})`} />; })}</svg><figcaption>{label}</figcaption></figure>;
}
function ImagingLab({ progress, advanced, report }: Playback) {
  const [mode, setMode] = useState<SamplingMask>('full'), [fraction, setFraction] = useState(40), [noise, setNoise] = useState(0);
  const size = 32, scan = advanced ? progress : 1;
  const result = useMemo(() => reconstructPhantom(size, mode, fraction / 100, noise, scan), [mode, fraction, noise, scan]);
  useReport(report, [{ label: '采样掩膜', value: mode }, { label: '中心区域边长', value: fraction, unit: '%' }, { label: '噪声', value: noise }], [{ label: '已采样点', value: result.sampledCount }, { label: '已扫描行', value: result.acquiredRows }, { label: 'RMSE', value: result.rmse }], '电脑由 32×32 人工图生成复数傅里叶数据，再按规则保留并逆变换；未保留处补零、噪声种子固定。没有真实线圈感应或梯度采集过程。', { value: scan * 100, unit: '% 采集进度' });
  const rawMax = Math.max(...result.spectrum.map(v => Math.hypot(v.re, v.im)));
  const kspace = Array.from({ length: size * size }, (_, i) => { const v = result.sampled[shiftedIndex(i % size, Math.floor(i / size), size)]; return Math.hypot(v.re, v.im); });
  const selectedId = useId();
  return <><div className="lab-controls lab-controls-three"><label className="lab-select" htmlFor={selectedId}><span>保留哪些 k 空间点？</span><select id={selectedId} value={mode} onChange={e => setMode(e.target.value as SamplingMask)}><option value="full">完整采样</option><option value="lowpass">只保留中心区域</option><option value="alternate">每隔一行采样</option></select></label><Slider label="中心区域边长比例" value={fraction} min={10} max={100} step={5} unit="%" disabled={mode !== 'lowpass'} onChange={setFraction} /><Slider label="加入数据的示意噪声" value={noise} min={0} max={.1} step={.005} onChange={setNoise} /></div>
    <div className="lab-images"><PixelImage data={result.phantom} size={size} label="① 人工模体图 · 32 × 32" /><PixelImage data={kspace} size={size} label="② 已保留 k 空间 · 对数幅度" kspace originalMax={rawMax} /><PixelImage data={result.image} size={size} label="③ 逆 FFT · 幅度图" /></div>
    <div className="lab-metrics"><Metric label="当前保留的数据点" value={`${result.sampledCount} / ${size * size}`} /><Metric label="模拟扫描行数" value={`${result.acquiredRows} / ${size}`} note="点播放可看第 1→32 行逐行累积重建" /><Metric label="重建误差 RMSE（相对原图）" value={result.rmse.toFixed(4)} note="均方根误差：数值越小越接近 ① 原图（0 为完全一致）" /></div>
    <p className="lab-observation"><b>试试看：</b>完整保留且无噪声时，电脑由傅里叶数据逆变换恢复原图（RMSE = 0）。只留中心使边缘模糊，隔行保留会引入折叠伪影。点击上方“播放”，观察 k 空间从第 1 行累积到第 32 行时整幅图像怎样从模糊条纹逐渐清晰——每个点都含整幅图的空间频率成分，不是依次扫描单个像素。</p><p className="lab-model-note">模型假定单线圈均匀灵敏度，用实际复数 FFT/逆 FFT 计算人工图像的规则采样与重建，缺少的数据补零。中图为便于显示只画对数幅度，重建仍使用复数相位；图像灰度是相对数值，不是实测氢核数量。未计算 RF、梯度电流、线圈电压、T₁/T₂ 对比或真实组织。</p></>;
}

const components: Record<LabId, ComponentType<Playback>> = { waves: WavesLab, spin: SpinLab, relaxation: RelaxationLab, sampling: SamplingLab, field: FieldLab, coil: CoilLab, timing: TimingLab, imaging: ImagingLab };
const Lab = forwardRef<ActivityHandle, { id: LabId; mode?: string }>(function Lab({ id, mode }, ref) {
  const [progress, setProgress] = useState(0), [running, setRunning] = useState(false), [advanced, setAdvanced] = useState(false), [resetKey, setResetKey] = useState(0);
  const timelineId = useId();
  const snapshot = useRef<SnapshotData>({ parameters: [], readings: [], model: '' });
  const report = useCallback((data: SnapshotData) => { snapshot.current = data; }, []);
  useEffect(() => { setProgress(0); setRunning(false); setAdvanced(false); }, [id, mode]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setProgress(current => Math.min(1, current + 1 / 120)), 50);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => { if (progress >= 1) setRunning(false); }, [progress]);
  const Component = components[id], descriptor = id === 'spin' && mode === 'basic' ? { title: '观察理想脉冲改变磁化方向', description: '主磁体持续提供沿 +z 的 B₀；本实验先固定理想共振条件，比较 0°、90°、180° 翻转后样品净磁化 M 的纵向（Mz）与横向（My）分量。' } : id === 'sampling' && mode === 'time' ? { title: '把连续波变成采样点', description: '把低频余弦当作接收电压，先只看按时刻留下的样本；改变采样率，比较同一组点为什么可能来自不同频率。' } : id === 'relaxation' && mode === 't1t2' ? { title: '恢复与衰减：两个方向的变化', description: '两条曲线分别描述样品纵向磁化恢复、横向磁化衰减；它们不是两路直接测得的电压。先分开辨认对象与时间常数。' } : id === 'relaxation' && mode === 'fid' ? { title: '为什么刚收到的信号很快变小？', description: '比较样品横向磁化自身的衰减，以及各组核因静态频偏不同而相互抵消的影响；曲线画合成磁化幅度。' } : descriptors[id];
  useImperativeHandle(ref, () => ({ pause: () => setRunning(false), getSnapshot: () => ({ id, title: descriptor.title, capturedAt: new Date().toISOString(), ...snapshot.current }) }), [id, descriptor.title]);
  const resetTime = () => { setRunning(false); setProgress(0); setAdvanced(false); };
  const reset = () => { resetTime(); setResetKey(k => k + 1); };
  const seek = (value: number) => { setRunning(false); setAdvanced(true); setProgress(value); };
  return <section className="lab-surface" aria-label={descriptor.title}>
    <div className="lab-heading"><span className="lab-kicker"><i /> 教学模拟</span><h3>{descriptor.title}</h3><p>{descriptor.description}</p></div>
    <div className="lab-transport"><div className="lab-transport-buttons"><button type="button" className="lab-play" aria-label={running ? '暂停实验动画' : '播放实验动画'} onClick={() => { if (progress >= 1) setProgress(0); setAdvanced(true); setRunning(v => !v); }}>{running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{running ? '暂停' : '播放'}</button><button type="button" aria-label="实验动画前进一步" onClick={() => { setRunning(false); setAdvanced(true); setProgress(p => Math.min(1, p + .05)); }}><StepForward size={14} aria-hidden="true" />单步</button><button type="button" aria-label="重置实验参数和动画" onClick={reset}><RotateCcw size={14} aria-hidden="true" />重置</button></div><div className="lab-timeline"><div className="lab-timeline-label"><label htmlFor={timelineId}>拖动演示时间</label><output htmlFor={timelineId}>{(progress * 100).toFixed(1)}%</output></div><input id={timelineId} type="range" min={0} max={1} step={.001} value={progress} aria-label="演示时间进度，拖动或使用方向键调整并暂停" aria-valuetext={`${(progress * 100).toFixed(1)}% 的演示时间`} onPointerDown={() => setRunning(false)} onKeyDown={() => setRunning(false)} onChange={e => seek(Number(e.target.value))} /><span className="lab-playback-label">{running ? '正在演示' : progress >= 1 ? '演示完成' : advanced ? '已暂停' : '可随时开始'}<span className="lab-progress-track" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></span></span></div></div>
    <div className="lab-body"><Component key={`${id}-${mode}-${resetKey}`} progress={progress} advanced={advanced} resetTime={resetTime} mode={mode} report={report} /></div>
  </section>;
});
export default Lab;
