'use strict';
(function(){
  const data=window.PORTAL;
  const M=window.ARCHIPELAGO;
  if(!data||!M)return;
  if(window.ATLAS_CATALOG){
    for(const course of data.courses){
      if(window.ATLAS_CATALOG[course.id]) course.modules=window.ATLAS_CATALOG[course.id];
    }
  }
  const localRoot={ai:'ai/',nmr:'nmr-from-zero/',game:'game/'};
  const standaloneHref=module=>module.local||module.url;
  const frameHref=module=>{
    if(module.kind==='document')return '';
    const href=standaloneHref(module);
    if(/^https?:/i.test(href))return href;
    const [path,hash='']=href.split('#');
    return path+(path.includes('?')?'&':'?')+'embed=1'+(hash?'#'+hash:'');
  };
  const $=id=>document.getElementById(id);
  const compact=matchMedia('(max-width:849px)');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const params=new URLSearchParams(location.search);
  const moduleAlias={'nmr-s1':'nmr-1-1','game-p1':'game-w01','game-p4':'game-w16','game-w1':'game-w01'};
  if(moduleAlias[params.get('module')]) params.set('module',moduleAlias[params.get('module')]);
  const state=M.initial(data,params,reduced.matches);
  let courseRendered=null,lessonRendered=null,tocOpen=false;
  let readingTrigger=null,readingReturnY=0;
  let directoryTrigger=document.querySelector('[data-directory-toggle]');
  let selectionTrigger=null;
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const announce=text=>{$('announcement').textContent=text;};
  const external=(url,label,cls='')=>'<a class="'+cls+'" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' <span aria-hidden="true">↗</span></a>';
  function writeUrl(){
    const url=new URL(location.href);
    ['view','course','module','focus','scale','motion','directory','q'].forEach(k=>url.searchParams.delete(k));
    url.searchParams.set('view',state.view);
    url.searchParams.set('course',state.course);
    if(state.module)url.searchParams.set('module',state.module);
    if(state.focus!=='overview')url.searchParams.set('focus',state.focus);
    if(state.scale!==3)url.searchParams.set('scale',String(state.scale));
    if(state.paused&&!reduced.matches)url.searchParams.set('motion','paused');
    if(state.directory)url.searchParams.set('directory','1');
    if(state.query)url.searchParams.set('q',state.query);
    history.replaceState(null,'',url.pathname+url.search);
  }
  function reveal(el,focus=false){
    if(focus){if(!el.hasAttribute('tabindex'))el.setAttribute('tabindex','-1');el.focus({preventScroll:true});}
    const box=el.getBoundingClientRect();
    const safeTop=document.querySelector('.site-header').getBoundingClientRect().height+12;
    if(box.top<safeTop||box.top>innerHeight-120)el.scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});
  }
  function fitReader(){
    if(state.view==='reader')return;
    const reader=$('reader'),groups=$('course-groups');
    const contents=document.querySelector('.course-contents');
    const padding=getComputedStyle(contents);
    const ticketStyle=getComputedStyle($('module-preview'));
    const fixed=document.querySelector('.reader-course').offsetHeight+$('module-preview').offsetHeight+parseFloat(ticketStyle.marginTop||0)+parseFloat(ticketStyle.marginBottom||0);
    const reserve=document.querySelector('.contents-heading').offsetHeight+$('chapter-scroll-hint').offsetHeight+parseFloat(padding.paddingTop)+parseFloat(padding.paddingBottom)+140;
    const fallback=!compact.matches&&(innerHeight<=800||reader.clientHeight-fixed<reserve);
    reader.classList.toggle('is-compact-height',fallback);
    reader.tabIndex=fallback?0:-1;
    groups.tabIndex=compact.matches||fallback?-1:0;
    groups.setAttribute('aria-label',compact.matches||fallback?'教学章节列表':'可滚动章节列表');
    if(compact.matches||fallback)groups.removeAttribute('aria-describedby');
    else groups.setAttribute('aria-describedby','chapter-scroll-hint');
  }
  function syncScene(){
    document.body.dataset.view=state.view;
    document.body.dataset.course=state.course;
    $('explore-page').hidden=state.view!=='overview';
    $('learning-page').hidden=state.view!=='reader';
    if($('settings-page')) $('settings-page').hidden=state.view!=='settings';
    document.body.dataset.focus=state.focus;
    document.body.dataset.scale=String(state.scale);
    document.body.classList.toggle('is-paused',state.paused||reduced.matches);
    const camera=M.cameraFor(state.course,state.focus,compact.matches);
    $('camera').style.transform=camera.transform;
    $('world-svg').setAttribute('viewBox',camera.viewBox);
    $('view-label').textContent=compact.matches?M.districts[state.course]+'近景':state.focus==='overview'?'群岛总览':M.districts[state.focus]+'近景';
    document.querySelectorAll('button[data-course]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.course===state.course)));
    document.querySelectorAll('[data-landmark]').forEach(node=>{
      const focused=compact.matches?state.course:state.focus;
      const context=focused!=='overview'&&node.dataset.landmark!==focused;
      node.classList.toggle('is-context',context);
      node.setAttribute('aria-hidden',String(context));
      node.setAttribute('aria-pressed',String(node.dataset.landmark===state.course));
      node.setAttribute('tabindex',compact.matches||context?'-1':'0');
    });
    $('world-notice').hidden=state.scale===3;
    document.querySelectorAll('button[data-scale]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.scale)===state.scale)));
    $('motion-toggle').setAttribute('aria-pressed',String(state.paused||reduced.matches));
    $('motion-toggle').setAttribute('aria-disabled',String(reduced.matches));
    $('motion-label').textContent=reduced.matches?'系统静态模式':state.paused?'继续动态':'暂停动态';
    $('motion-toggle').querySelector('.motion-icon').textContent=state.paused||reduced.matches?'▷':'Ⅱ';
  }
  function renderPreview(){
    const c=M.courseBy(data,state.course);
    const m=M.moduleBy(c,state.module);
    $('preview-title').textContent=m?m.title:'从这座岛开始';
    let html='';
    if(m){
      html='<p>'+esc(m.group)+' / '+esc(c.title)+'</p>';
      if(m.note)html+='<p>'+esc(m.note)+'</p>';

    }else html='<p>从下面的目录选一节，或直接进入教学网站。</p>';
    $('preview-content').innerHTML=html;
    $('module-direct').href=m?standaloneHref(m):localRoot[c.id];
    $('module-direct').setAttribute('aria-label','打开本地课程页：'+(m?m.title:c.title)+'，新标签页');
    document.querySelectorAll('.module-button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.module===state.module)));
  }
  function renderGroups(force=false){
    const c=M.courseBy(data,state.course);
    if(!force&&courseRendered===c.id)return;
    const selected=M.moduleBy(c,state.module);
    $('course-groups').innerHTML=M.groups(c).map((g,i)=>'<details class="course-group" data-group="'+esc(g)+'"'+(selected?selected.group===g?' open':'':i===0?' open':'')+'><summary>'+esc(g)+'</summary><ul>'+c.modules.filter(m=>m.group===g).map(m=>'<li><button type="button" class="module-button" data-module="'+esc(m.id)+'" data-module-course="'+c.id+'" aria-controls="module-preview" aria-pressed="'+(m.id===state.module)+'"><span>'+esc(m.title)+'</span><span aria-hidden="true">'+(m.id===state.module?'✓':'›')+'</span></button></li>').join('')+'</ul></details>').join('');
    $('course-groups').scrollTop=0;
    courseRendered=c.id;
  }
  function renderCourse(){
    const c=M.courseBy(data,state.course);
    $('reader-location').textContent=c.short+' / '+M.districts[c.id];
    $('course-title').textContent=c.title;
    $('course-description').textContent=M.descriptions[c.id];
    $('course-start').href=localRoot[c.id];
    $('course-start').setAttribute('aria-label','本地课程：'+c.title+'，新标签页打开');
    $('course-repo').href=c.repo;
    renderGroups();renderPreview();
    const current=M.moduleBy(c,state.module);
    const selectedGroup=current&&[...document.querySelectorAll('.course-group')].find(g=>g.dataset.group===current.group);
    if(selectedGroup)selectedGroup.open=true;
    if(state.view==='reader')renderLesson();
  }
  function selectCourse(id,moduleId,trigger){
    const c=M.courseBy(data,id);if(!c)return;
    const same=state.course===id;
    state.course=id;
    const m=M.moduleBy(c,moduleId);
    if(m)state.module=m.id;
    else if(!same)state.module=c.modules[0].id;
    state.focus=id;
    selectionTrigger=trigger&&trigger.closest('#text-directory')?document.querySelector('.world .course-tab[data-course="'+id+'"]'):state.view==='reader'?document.querySelector('.world .course-tab[data-course="'+id+'"]'):trigger||selectionTrigger;
    syncScene();renderCourse();fitReader();
    if(m){
      const details=[...document.querySelectorAll('.course-group')].find(g=>g.dataset.group===m.group);
      if(details)details.open=true;
    }
    if(state.directory)renderDirectory();
    writeUrl();
    announce('正在探索'+c.title+(m?'，已选择'+m.title:'')+'。右侧或下方有教学入口。');
    if(state.view==='reader'){tocOpen=false;syncLessonNav();reveal($('lesson-title'),true);}
    else if(compact.matches||trigger&&trigger.closest('#text-directory'))reveal($('course-title'),true);
  }
  function selectModule(courseId,id,trigger){
    const c=M.courseBy(data,courseId);const m=M.moduleBy(c,id);if(!m)return;
    if(state.course!==c.id){selectCourse(c.id,id,trigger);return;}
    state.module=m.id;renderPreview();fitReader();
    const selectedGroup=[...document.querySelectorAll('.course-group')].find(g=>g.dataset.group===m.group);
    if(selectedGroup)selectedGroup.open=true;
    document.querySelectorAll('.module-button').forEach(b=>{
      const on=b.dataset.module===id;
      b.setAttribute('aria-pressed',String(on));
      b.lastElementChild.textContent=on?'✓':'›';
    });
    writeUrl();announce('已选择'+m.title+'，可打开原教学入口。');
    if(state.view==='reader'){renderLesson();tocOpen=false;syncLessonNav();reveal($('lesson-title'),true);return;}
    const rect=$('module-preview').getBoundingClientRect();
    if(compact.matches||rect.top<0||trigger&&trigger.closest('#text-directory'))reveal($('module-preview'),true);
  }
  function overview(restore=false){
    state.focus='overview';syncScene();writeUrl();announce('已返回群岛总览，当前教学目录仍保留。');
    if(restore&&selectionTrigger&&selectionTrigger.isConnected){selectionTrigger.focus({preventScroll:true});reveal(selectionTrigger);}
  }
  function renderDirectory(){
    if($('search-input').value!==state.query)$('search-input').value=state.query;
    const found=M.search(data,state.query,state.scale);
    $('directory-status').textContent=state.query?found.length?'找到 '+found.length+' 个匹配入口。':'没有找到匹配内容。':'按手册展开章节，或直接搜索问题。占位仅在增量演示中出现。';
    let html='';
    if(!found.length){
      html='<div class="empty-result"><h3>这片海域还没有这个入口。</h3><p>试试“信号”“模型”或“关卡”，也可以清空搜索，回到完整文字目录。</p><button type="button" data-reset-search>查看完整目录</button></div>';
    }else if(state.query){
      html='<ul class="result-list">'+found.map(row=>'<li>'+resultButton(row)+'</li>').join('')+'</ul>';
    }else{
      for(const c of data.courses){
        html+='<details class="directory-course"'+(c.id===state.course?' open':'')+'><summary><span>'+esc(c.title)+'</span><span>展开章节</span></summary><ul class="result-list">'+c.modules.map(m=>'<li>'+resultButton({kind:'module',course:c.id,id:m.id,title:m.title,group:c.short+' / '+m.group})+'</li>').join('')+'</ul></details>';
      }
      const placeholders=M.inventory(data,state.scale).filter(x=>x.kind==='placeholder');
      const groups=[...new Set(placeholders.map(p=>p.group))];
      for(const group of groups)html+='<details class="directory-course placeholder-group"><summary><span>'+esc(group)+'<span class="placeholder-tag">未开放</span></span><span>仅布局演示</span></summary><ul class="result-list">'+placeholders.filter(p=>p.group===group).map(p=>'<li>'+resultButton(p)+'</li>').join('')+'</ul></details>';
    }
    $('directory-results').innerHTML=html;
  }
  function resultButton(row){
    if(row.kind==='placeholder')return '<button class="result-button" type="button" disabled><span>'+esc(row.title)+'<span class="placeholder-tag">未开放</span></span><small>仅测试增量布局，不可进入</small></button>';
    return '<button class="result-button" type="button" data-result-course="'+row.course+'"'+(row.kind==='module'?' data-result-module="'+esc(row.id)+'"':'')+'><span>'+esc(row.title)+'</span><small>'+esc(row.group)+(row.kind==='course'?' / 探索手册':' / 查看入口')+'</small></button>';
  }
  function setDirectory(open,trigger,move=true){
    state.directory=open;
    if(trigger)directoryTrigger=trigger;
    $('text-directory').hidden=!open;
    document.querySelectorAll('[data-directory-toggle]').forEach(b=>b.setAttribute('aria-expanded',String(open)));
    if(open){renderDirectory();if(move)reveal($('search-input'),true);}
    else if(move&&directoryTrigger&&directoryTrigger.isConnected){directoryTrigger.focus({preventScroll:true});reveal(directoryTrigger);}
    writeUrl();
  }
  function clearSearch(){state.query='';renderDirectory();writeUrl();$('search-input').focus({preventScroll:true});}
  function syncLessonNav(){
    const expanded=!compact.matches||tocOpen;
    $('lesson-nav').hidden=!expanded;
    $('lesson-nav').tabIndex=compact.matches?-1:0;
    $('lesson-toc-toggle').setAttribute('aria-expanded',String(expanded));
    $('lesson-toc-toggle').innerHTML=(expanded?'收起章节目录':'展开章节目录')+' <span aria-hidden="true">'+(expanded?'−':'＋')+'</span>';
  }
  function renderLesson(){
    const lesson=M.lessonContent(data,state.course,state.module);
    const c=lesson.course,m=lesson.module;
    $('lesson-course-location').textContent=c.short+' / '+M.districts[c.id];
    $('lesson-course-title').textContent=c.title;
    $('lesson-breadcrumb').textContent=c.short+' / '+m.group;
    $('lesson-title').textContent=m.title;
    $('lesson-course-line').textContent=c.title;
    const href=standaloneHref(m);
    $('lesson-source').href=href;
    $('lesson-source').setAttribute('aria-label','在独立页面打开'+m.title+'，新标签页');
    const frame=$('lesson-frame'), doc=$('lesson-document');
    if(m.kind==='document'){
      frame.hidden=true; frame.removeAttribute('src');
      doc.hidden=false; doc.textContent='正在读取原文…';
      fetch(href).then(response=>{ if(!response.ok) throw new Error(String(response.status)); return response.text(); })
        .then(text=>{ doc.textContent=text; })
        .catch(()=>{ doc.textContent='无法读取这份原文。独立页面链接仍可打开。'; });
    }else{
      doc.hidden=true; frame.hidden=false;
      const next=frameHref(m);
      frame.title=m.title;
      if(frame.getAttribute('src')!==next) frame.src=next;
    }
    $('lesson-provenance').textContent=c.fullName;
    $('lesson-repo').href=c.repo;
    if(lessonRendered!==c.id){
      $('lesson-nav').innerHTML=M.groups(c).map(g=>'<details class="lesson-group" data-lesson-group="'+esc(g)+'"'+(m.group===g?' open':'')+'><summary>'+esc(g)+'</summary><ul>'+c.modules.filter(row=>row.group===g).map(row=>'<li><button type="button" class="lesson-module-button" data-lesson-module="'+esc(row.id)+'" data-lesson-course="'+c.id+'" aria-controls="lesson-title" aria-pressed="false"><span>'+esc(row.title)+'</span><span class="lesson-check" aria-hidden="true"></span></button></li>').join('')+'</ul></details>').join('');
      $('lesson-nav').scrollTop=0;lessonRendered=c.id;
    }
    document.querySelectorAll('.lesson-module-button').forEach(b=>{
      const selected=b.dataset.lessonModule===m.id;
      b.setAttribute('aria-pressed',String(selected));
      b.querySelector('.lesson-check').textContent=selected?'✓':'';
    });
    const group=[...document.querySelectorAll('[data-lesson-group]')].find(g=>g.dataset.lessonGroup===m.group);
    if(group)group.open=true;
    $('lesson-related-list').innerHTML=lesson.related.map(row=>'<li><button type="button" data-lesson-module="'+esc(row.id)+'" data-lesson-course="'+c.id+'" aria-controls="lesson-title"><span>'+esc(row.title)+'</span><span aria-hidden="true">↗</span></button></li>').join('');
    $('lesson-related-empty').hidden=lesson.related.length>0;
    syncLessonNav();
  }
  function openReading(trigger){
    readingTrigger=trigger;readingReturnY=scrollY;
    if(state.directory)setDirectory(false,null,false);
    const c=M.courseBy(data,state.course);
    if(!M.moduleBy(c,state.module))state.module=c.modules[0].id;
    state.view='reader';tocOpen=false;
    syncScene();renderCourse();writeUrl();
    window.scrollTo({top:0,behavior:'instant'});
    $('lesson-title').focus({preventScroll:true});
    announce('已打开'+c.title+'。');
  }
  function returnIslands(){
    Object.assign(state,M.backToIslands(state));
    syncScene();renderCourse();fitReader();writeUrl();
    window.scrollTo({top:readingReturnY,behavior:'instant'});
    const target=readingTrigger&&readingTrigger.isConnected?readingTrigger:$('open-learning');
    target.focus({preventScroll:true});
    announce('已返回群岛，保留当前课程与章节。');
  }
  $('module-preview').addEventListener('click',event=>{const b=event.target.closest('#open-learning');if(b)openReading(b);});
  $('return-islands').addEventListener('click',returnIslands);
  $('lesson-toc-toggle').addEventListener('click',()=>{tocOpen=!tocOpen;syncLessonNav();});
  $('learning-page').addEventListener('click',event=>{const b=event.target.closest('[data-lesson-module]');if(b)selectModule(b.dataset.lessonCourse,b.dataset.lessonModule,b);});
  $('lesson-directory-link').addEventListener('click',()=>{tocOpen=true;syncLessonNav();const b=$('lesson-nav').querySelector('[aria-pressed="true"]');if(b)reveal(b,true);});
  document.querySelectorAll('button[data-course]').forEach(b=>b.addEventListener('click',()=>selectCourse(b.dataset.course,null,b)));
  document.querySelectorAll('[data-landmark]').forEach(node=>{
    node.addEventListener('click',()=>selectCourse(node.dataset.landmark,null,node));
    node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCourse(node.dataset.landmark,null,node);}});
  });
  $('course-groups').addEventListener('click',event=>{const b=event.target.closest('[data-module]');if(b)selectModule(b.dataset.moduleCourse,b.dataset.module,b);});
  $('view-overview').addEventListener('click',()=>overview());
  let settingsReturn=null;
  let restoreScroll=null;
  function openSettings(){
    if(state.view==='settings')return;
    settingsReturn={view:state.view,course:state.course,module:state.module,scroll:window.scrollY};
    state.view='settings';
    syncScene();writeUrl();
    window.scrollTo({top:0,behavior:'instant'});
    $('settings-back')?.focus({preventScroll:true});
  }
  function closeSettings(){
    const back=settingsReturn||{view:state.module?'reader':'overview',course:state.course,module:state.module,scroll:0};
    state.view=back.view==='settings'?'overview':back.view;
    if(back.course)state.course=back.course;
    if(back.module)state.module=back.module;
    syncScene();renderCourse();
    if(state.view==='reader')renderLesson();
    writeUrl();
    const top=back.scroll||0;
    restoreScroll=top;
    const apply=()=>{if(restoreScroll===top)window.scrollTo({top,behavior:'instant'});};
    apply();
    requestAnimationFrame(apply);
    const pin=()=>apply();
    addEventListener('scroll',pin);
    setTimeout(()=>{removeEventListener('scroll',pin);if(restoreScroll===top)restoreScroll=null;},700);
    settingsReturn=null;
    announce('已返回刚才的课程位置。');
  }
  function guarded(next){
    if(state.view==='settings'&&window.ATLAS_SETTINGS?.confirmLeave)window.ATLAS_SETTINGS.confirmLeave(next);
    else next();
  }
  $('open-settings').addEventListener('click',()=>openSettings());
  $('settings-back')?.addEventListener('click',()=>guarded(closeSettings));
  $('nav-overview').addEventListener('click',()=>{guarded(()=>{if(state.view==='reader'){returnIslands();return;}if(state.view==='settings')closeSettings();overview();reveal($('world-stage'));});});
  $('view-selected').addEventListener('click',()=>{state.focus=state.course;syncScene();writeUrl();announce('已聚焦'+M.districts[state.course]+'。');});
  $('motion-toggle').addEventListener('click',()=>{
    if(reduced.matches){announce('已遵循系统减弱动态偏好，保持静态。');return;}
    state.paused=!state.paused;syncScene();writeUrl();announce(state.paused?'水流、信号和镜头过渡已暂停。':'已恢复轻柔动态。');
  });
  document.querySelectorAll('[data-directory-toggle]').forEach(b=>b.addEventListener('click',()=>setDirectory(!state.directory,b)));
  $('directory-close').addEventListener('click',()=>setDirectory(false));
  $('search-input').addEventListener('input',event=>{if(event.isComposing)return;state.query=event.target.value;renderDirectory();writeUrl();});
  $('search-input').addEventListener('compositionend',event=>{state.query=event.target.value;renderDirectory();writeUrl();});
  $('search-clear').addEventListener('click',clearSearch);
  $('directory-results').addEventListener('click',event=>{
    const reset=event.target.closest('[data-reset-search]');if(reset){clearSearch();return;}
    const b=event.target.closest('[data-result-course]');if(!b)return;
    if(b.dataset.resultModule)selectModule(b.dataset.resultCourse,b.dataset.resultModule,b);
    else selectCourse(b.dataset.resultCourse,null,b);
  });
  $('demo-toggle').addEventListener('click',()=>{
    const open=$('scale-demo').hidden;
    $('scale-demo').hidden=!open;
    $('demo-toggle').setAttribute('aria-expanded',String(open));
    $('demo-toggle').querySelector('span').textContent=open?'−':'＋';
  });
  document.querySelectorAll('button[data-scale]').forEach(b=>b.addEventListener('click',()=>{
    state.scale=Number(b.dataset.scale);syncScene();
    if(state.scale>3)setDirectory(true,b,false);
    else if(state.directory)renderDirectory();
    writeUrl();announce(state.scale===3?'已恢复真实课程内容。':'已启用'+state.scale+'项布局演示，新增项目均为未开放占位。');
  }));
  $('demo-close').addEventListener('click',()=>{
    state.scale=3;syncScene();if(state.directory)renderDirectory();
    $('scale-demo').hidden=true;$('demo-toggle').setAttribute('aria-expanded','false');$('demo-toggle').querySelector('span').textContent='＋';writeUrl();$('demo-toggle').focus();
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if($('settings-clear-dialog')?.open||$('settings-unsaved-dialog')?.open||$('settings-rebind-dialog')?.open||$('settings-admin-dialog')?.open)return;
    if(state.view==='settings'){event.preventDefault();guarded(closeSettings);return;}
    if(state.directory){event.preventDefault();if(state.query)clearSearch();else setDirectory(false);}
    else if(state.view==='reader'){event.preventDefault();returnIslands();}
    else if(state.focus!=='overview'){event.preventDefault();overview(true);}
  });
  compact.addEventListener('change',()=>{syncScene();fitReader();if(state.view==='reader')syncLessonNav();});
  reduced.addEventListener('change',()=>{if(reduced.matches)state.paused=true;syncScene();});
  syncScene();renderCourse();fitReader();
  if(state.scale!==3){$('scale-demo').hidden=false;$('demo-toggle').setAttribute('aria-expanded','true');$('demo-toggle').querySelector('span').textContent='−';}
  if(state.directory){$('text-directory').hidden=false;document.querySelectorAll('[data-directory-toggle]').forEach(b=>b.setAttribute('aria-expanded','true'));renderDirectory();}
  if('ResizeObserver' in window){
    const readerObserver=new ResizeObserver(fitReader);
    [$('reader'),document.querySelector('.reader-course'),$('module-preview')].forEach(n=>readerObserver.observe(n));
  }
  addEventListener('message',event=>{
    if(event.origin!==location.origin||!event.data)return;
    if(event.data.type==='hub-embed-height'&&$('lesson-frame')){
      $('lesson-frame').style.height=Math.max(240,Number(event.data.height)||0)+'px';
      if(restoreScroll!=null) window.scrollTo({top:restoreScroll,behavior:'instant'});
    }
    if(event.data.type==='hub-embed-escape'&&state.view==='reader') returnIslands();
  });
  window.ATLAS_QA=Object.freeze({
    snapshot:()=>({...state}),
    learning:()=>({view:state.view,course:state.course,module:state.module,articleWidth:$('learning-page').getBoundingClientRect().width,documentOverflow:document.documentElement.scrollWidth>innerWidth,focusHidden:!!document.activeElement.closest('[hidden]'),tocOverflow:getComputedStyle($('lesson-nav')).overflowY}),
    bounds:()=>{
      if(state.view==='reader')return {view:'reader',worldHidden:$('explore-page').hidden};
      const stage=$('world-stage').getBoundingClientRect();
      const label=document.querySelector('#island-'+state.course+' .landmark-label');
      const box=label.getBoundingClientRect();
      const visible=getComputedStyle(label).display!=='none';
      const rect=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
      return {course:state.course,focus:state.focus,mobile:compact.matches,stage:rect(stage),selectedLabel:rect(box),selectedContained:visible&&box.left>=stage.left-1&&box.top>=stage.top-1&&box.right<=stage.right+1&&box.bottom<=stage.bottom+1,
        otherInteractive:[...document.querySelectorAll('[data-landmark]')].filter(n=>n.dataset.landmark!==state.course&&n.getAttribute('tabindex')==='0').map(n=>n.dataset.landmark)};
    },
    scroll:()=>{const n=$('course-groups');return {clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,scrollTop:n.scrollTop,style:getComputedStyle(n).overflowY};}
  });
  // All content is local; no fake loading, stored progress or external requests.
})();
