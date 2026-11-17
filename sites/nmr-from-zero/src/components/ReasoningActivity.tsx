import { useState } from 'react';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import './reasoning-activity.css';

const milestones=['接收回环：已知电信号能被正确记录','可信 FID：证实信号与样品及共振条件有关','回波：检验磁化重聚相及接收时序','一维定位：验证梯度编码与位置换算','二维模体：核对重建图像与已知尺寸'];
const evidence=['制造文件与材料清单','模块之间的接口说明','校准操作和原始数据','实测性能及测量条件','配套版本及许可证'];

export default function ReasoningActivity({id}:{id:string}) {
  const [order,setOrder]=useState([4,2,0,3,1]);
  const [resetKey,setResetKey]=useState(0);
  const [checked,setChecked]=useState(false),[decision,setDecision]=useState('');
  const [classifications,setClassifications]=useState<string[]>(['','','']);
  const reset=()=>{setResetKey(k=>k+1);setOrder([4,2,0,3,1]);setChecked(false);setDecision('');setClassifications(['','','']);};
  const move=(index:number,offset:number)=>{setOrder(items=>{const next=[...items];[next[index],next[index+offset]]=[next[index+offset],next[index]];return next;});setChecked(false);};
  return <div className="reasoning-board"><header><span>桌面推理 · 可自由尝试</span><button className="text-button" onClick={reset}><RotateCcw size={14}/>重置练习</button></header>
    {id==='workflow'?<><h3>把验证步骤排成可排错的路线</h3><p>使用上移、下移按钮排序。这里比较的是能力里程碑；各模块的台架检查还要在实际连接前完成。</p><ol className="milestone-order">{order.map((value,index)=><li key={value}><span>{index+1}</span><div>{milestones[value]}</div><button aria-label={`上移：${milestones[value]}`} disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button><button aria-label={`下移：${milestones[value]}`} disabled={index===4} onClick={()=>move(index,1)}><ArrowDown size={16}/></button></li>)}</ol><button className="secondary-button" onClick={()=>setChecked(true)}>检查排序的依据</button>{checked&&<p className="reasoning-feedback" role="status">{order.every((v,i)=>v===i)?'这条路线先用已知电压验证接收与采样，再检验样品磁化是否产生可信的感应电压，随后验证重聚相和空间编码。':'试着让每一步都使用上一步已证明的能力：先接收回环，再可信 FID、回波、一维定位，最后二维模体。'} 排序本身不是验收：每步都要注明信号在哪里施加、在哪两个端口测电压、由哪个模块处理，并用原始数据与预期比较。</p>}<label>选择其中一步，写下输入、输出、测点和通过证据<textarea key={resetKey} rows={3} placeholder="输入是什么？在哪里测？预期与实测怎样比较？"/></label></>
    :id==='source-audit'?<><h3>先标记证据状态，再下结论</h3><p>把公开文件链接与它支持的具体结论一起记录：它描述哪个部件、输入输出是什么、测的是磁场还是电压。空白或“待核查”只表示尚未确认，不能自动算作缺失。</p><div className="evidence-checklist">{evidence.map(item=><div key={`${resetKey}-${item}`}><label>{item}<select aria-label={`${item}的核验状态`} defaultValue="pending"><option value="pending">待核查</option><option value="found">已找到对应版本的证据</option><option value="external">项目说明需外接／另行提供</option><option value="gap">已查阅，仍需向作者核实</option></select></label><label>来源与依据<input type="text" placeholder="文件路径或公开链接；支持什么结论"/></label></div>)}</div><p>每条记录的状态由你核对后选择。本站不会把填入的链接发送给任何服务；离开本页后清空。</p></>
    :id==='fault-finding'?<><h3>目前更值得优先检查哪个假设？</h3><fieldset><legend>移走样品后，接收端仍记录到强短振荡；把采样窗延后，这段记录减弱。</legend>{[['sample','已经证明是样品信号'],['residual','优先检查发射残留与硬件恢复'],['broken','已经证明接收器损坏']].map(([value,label])=><label key={value}><input type="radio" name="fault-hypothesis" checked={decision===value} onChange={()=>setDecision(value)}/>{label}</label>)}</fieldset>{decision&&<p className="reasoning-feedback" role="status">{decision==='residual'?'这个优先次序有证据支持：样品移走后接收电压仍出现，且延后采样时减弱，应先检查发射泄漏、线圈振铃和接收电路恢复。':'现有观察还不足以支持这个结论。先检查发射泄漏、线圈振铃和接收电路恢复，再用对照证明记录中哪些电压来自样品磁化。'} 仍要做对照，不能仅凭这一现象排除与残留电压叠加的微弱样品感应电压。</p>}<label>下一项对照怎样区分两个假设？<textarea key={resetKey} rows={3} placeholder="只改变什么？测在哪里？两种假设各预期什么？"/></label></>
    :<><h3>把物理性质、表示方法与类比分开</h3>{['氢核具有自旋。','用箭头表示磁矩的方向与大小。','把氢核想成不停旋转的机械小球。'].map((sentence,i)=><label key={sentence}>{sentence}<select value={classifications[i]} onChange={e=>setClassifications(values=>values.map((v,j)=>i===j?e.target.value:v))}><option value="">请选择</option><option value="property">物理性质</option><option value="representation">表示方法</option><option value="analogy">有限类比</option></select></label>)}<button className="secondary-button" onClick={()=>setChecked(true)}>查看辨析</button>{checked&&<p className="reasoning-feedback" role="status">{classifications.join(',')==='property,representation,analogy'?'分类正确。':'依次是物理性质、表示方法、有限类比。'} 自旋不是机械小球转动。单核磁矩 μ 描述核的磁性，宏观磁化 M 描述样品中许多核的合成贡献；主场 B₀ 描述外部环境。绘图箭头必须先说明代表哪个量，不能当作核表面的实拍。</p>}</>}
  </div>;
}
