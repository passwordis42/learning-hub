(function(root,factory){
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  else root.ARCHIPELAGO=model;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const descriptions={
    ai:'从一份数据开始，理解模型，再构建自己的 AI 工具。先动手，也练习判断。',
    nmr:'从电磁感应与相位出发，沿着自旋、信号与成像，读懂核磁共振的工作方式。',
    game:'拆解玩家体验，试做机制与关卡，再通过试玩，把想法变成可玩的作品。'
  };
  const focusBounds={ai:{x:48,y:50,w:485,h:430},nmr:{x:520,y:100,w:450,h:385},game:{x:270,y:365,w:520,h:380}};
  function cameraFor(id,focus,compact){
    const b=focusBounds[id]||focusBounds.ai;
    if(compact)return {viewBox:[b.x-24,b.y-24,b.w+48,b.h+48].join(' '),transform:'translate(0px,0px) scale(1)',scale:1,tx:0,ty:0,bounds:b};
    if(focus==='overview')return {viewBox:'0 0 1000 760',transform:'translate(0px,0px) scale(1)',scale:1,tx:0,ty:0,bounds:b};
    const z=Math.min(872/b.w,664/b.h,1.65);
    const tx=(1000-b.w*z)/2-b.x*z,ty=(760-b.h*z)/2-b.y*z;
    return {viewBox:'0 0 1000 760',transform:'translate('+tx+'px,'+ty+'px) scale('+z+')',scale:z,tx,ty,bounds:b};
  }
  const districts={ai:'图谱设施',nmr:'信号实验站',game:'关卡工坊'};
  function courseBy(data,id){return data.courses.find(c=>c.id===id)||null;}
  function moduleBy(course,id){return course&&course.modules.find(m=>m.id===id)||null;}
  function groups(course){return [...new Set(course.modules.map(m=>m.group))];}
  function inventory(data,size){
    const limit=[3,10,30].includes(Number(size))?Number(size):3;
    const rows=data.courses.map(c=>({id:c.id,title:c.title,short:c.short,kind:'real',group:'真实课程'}));
    for(let i=4;i<=limit;i++)rows.push({id:'placeholder-'+i,title:'新增课程占位 '+String(i).padStart(2,'0'),short:'占位',kind:'placeholder',group:'增量演示分组 '+(1+Math.floor((i-4)/9)),note:'仅测试内容增量布局，未开放，不可进入。'});
    return rows;
  }
  function search(data,query,size){
    const q=String(query||'').trim().toLocaleLowerCase();
    const found=[];
    for(const c of data.courses){
      if(!q||(c.title+' '+c.short+' '+descriptions[c.id]).toLocaleLowerCase().includes(q))found.push({kind:'course',course:c.id,id:c.id,title:c.title,group:'真实课程'});
      if(q)for(const m of c.modules){
        if((m.title+' '+m.group+' '+c.title+' '+c.short).toLocaleLowerCase().includes(q))found.push({kind:'module',course:c.id,id:m.id,title:m.title,group:c.short+' / '+m.group});
      }
    }
    for(const p of inventory(data,size).filter(x=>x.kind==='placeholder'))if(!q||(p.title+' '+p.group).toLocaleLowerCase().includes(q))found.push(p);
    return found;
  }
  function initial(data,params,reduced){
    const c=courseBy(data,params.get('course'))||data.courses[0];
    const view=params.get('view')==='reader'?'reader':'overview';
    const explicit=params.get('module');
    const m=moduleBy(c,explicit)||(!params.has('course')?moduleBy(c,'ai-day1'):null)||(view==='reader'?c.modules[0]:null);
    const scale=[3,10,30].includes(Number(params.get('scale')))?Number(params.get('scale')):3;
    const focus=['ai','nmr','game'].includes(params.get('focus'))?c.id:view==='reader'?c.id:'overview';
    return {view,course:c.id,module:m?m.id:null,focus,scale,paused:!!reduced||params.get('motion')==='paused',directory:params.get('directory')==='1'||!!params.get('q'),query:params.get('q')||''};
  }
  function lessonContent(data,courseId,moduleId){
    const course=courseBy(data,courseId);if(!course)return null;
    const module=moduleBy(course,moduleId)||course.modules[0];
    return {course,module,description:descriptions[course.id],related:course.modules.filter(m=>m.group===module.group&&m.id!==module.id).slice(0,3)};
  }
  function backToIslands(state){return {...state,view:'overview'};}
  return {lessonContent,backToIslands,descriptions,districts,focusBounds,cameraFor,courseBy,moduleBy,groups,inventory,search,initial};
});
