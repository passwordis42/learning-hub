import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import ReasoningActivity from './ReasoningActivity';
import { ChevronDown, MessageCircle } from 'lucide-react';
import type { ActivityHandle, ActivitySpec, AskContext, GuidedId } from '../learning';
import type { LabId } from '../types';
import { ConceptTrigger, TermText, useLearningHelp } from './LearningHelp';
import { labGuides } from '../content/labGuides';
import { conceptById } from '../content/concepts';
const Lab = lazy(()=>import('./Lab'));
const Guided = lazy(()=>import('./GuidedActivity'));
const labTerms:Record<string,string[]>={waves:['频率','相位','振幅'],spin:['主磁场','射频场','翻转角','频偏','旋转坐标系'],relaxation:['纵向弛豫时间','横向弛豫时间','自由感应衰减','自旋回波'],sampling:['采样率','混叠','傅里叶变换'],field:['场图','匀场','百万分之一','DSV'],coil:['电感','电容','调谐','阻抗匹配','品质因数'],timing:['发射','接收','死时间','收发切换'],imaging:['k 空间','视野','分辨率','信噪比']};
function LabTerms({id,mode}:{id:string;mode?:string}) {const terms=id==='spin'&&mode==='basic'?['主磁场','射频场','翻转角']:id==='sampling'&&mode==='time'?['采样率','混叠']:id==='relaxation'&&mode==='t1t2'?['纵向弛豫时间','横向弛豫时间']:id==='relaxation'&&mode==='fid'?['自由感应衰减','表观横向衰减时间','频偏']:labTerms[id]??[];return <div className="lab-term-tools"><span>读图时遇到生词</span>{terms.filter(id=>conceptById.has(id)).map(id=><ConceptTrigger key={id} id={id}/>)}</div>;}

export default function ActivityHost({activity,context,active=true}:{activity:ActivitySpec;context:AskContext;active?:boolean}) {
  const ref=useRef<ActivityHandle>(null),help=useLearningHelp();
  const [prediction,setPrediction]=useState('');
  const [locked,setLocked]=useState(false);
  useEffect(()=>{if(!active)ref.current?.pause();},[active]);
  const ask=(anchor:HTMLElement)=>{ref.current?.pause();const snapshot=ref.current?.getSnapshot();help.ask({...context,title:`${activity.title} · ${context.title}`,quote:[activity.title,activity.setup,`需要先预测：${activity.prediction}`,'操作任务：',...activity.actions].join('\n'),snapshot,refreshSnapshot:snapshot?()=>{ref.current!.pause();return ref.current!.getSnapshot();}:undefined},anchor);};
  return <section className="guided-exercise">
    <div className="activity-purpose"><span>为什么做这个活动</span><p><TermText text={activity.purpose} context={context}/></p></div>
    <h2>{activity.title}</h2><p className="activity-setup"><TermText text={activity.setup} context={context}/></p>
    <div className="activity-prediction"><div className="activity-prediction-head"><strong>① 先预测，再动手</strong>{prediction.trim()&&<button type="button" className="text-button" onClick={()=>setLocked(v=>!v)}>{locked?'修改猜想':'锁定猜想去验证'}</button>}</div><p><TermText text={activity.prediction} context={context}/></p><label>记下你的猜想（可跳过）<textarea value={prediction} readOnly={locked} onChange={e=>setPrediction(e.target.value)} rows={2} placeholder="我猜会……因为……"/></label>{locked&&prediction.trim()&&<small className="activity-prediction-saved">已记录你的猜想，完成下方操作后可在“现在观察这里”对照。</small>}</div>
    <div className="activity-steps-box"><strong className="activity-steps-title">② 按顺序动手试一试</strong><ol className="activity-instructions">{activity.actions.map((action,i)=><li key={i}><span>{i+1}</span><TermText text={action} context={context}/></li>)}</ol></div>
    {activity.kind==='reasoning'&&<ReasoningActivity key={activity.id} id={activity.id}/>}
    {activity.kind==='lab'&&<LabTerms id={activity.id} mode={activity.mode}/>}
    {activity.kind!=='reasoning'&&<Suspense fallback={<div className="loading-lab">正在准备这一步的演示…</div>}>{activity.kind==='lab'?<Lab ref={ref} id={activity.id as LabId} mode={activity.mode}/>:<Guided ref={ref} id={activity.id as GuidedId}/>}</Suspense>}
    <button className="activity-ask secondary-button" onClick={e=>ask(e.currentTarget)}><MessageCircle size={16}/>{activity.kind==='reasoning'?'带着这道任务问 AI':'暂停并问当前实验'}</button>
    <div className="activity-observe"><strong>③ 现在观察这里</strong><p><TermText text={activity.observe} context={context}/></p>{prediction.trim()&&<p className="activity-prediction-recap"><span>对照你刚才的猜想：</span>{prediction}</p>}</div>
    <details className="activity-explanation" open><summary>④ 看完后，理解刚才发生了什么<ChevronDown size={17}/></summary><p><TermText text={activity.explain} context={context}/></p></details>
    <p className="activity-model"><strong>模型与范围：</strong><TermText text={activity.modelScope} context={context}/></p>
  </section>;
}

export function StandaloneLab({id}:{id:LabId}) {
  const help=useLearningHelp();
  return <ActivityHost key={id} activity={labGuides[id]} context={help.page}/>;
}
