'use strict';
(function(){
  const params=new URLSearchParams(location.search);
  const query=new URLSearchParams();
  ['view','course','module','focus','scale','motion','directory','q'].forEach(key=>{if(params.has(key))query.set(key,params.get(key));});
  const target='index.html'+(query.size?'?'+query.toString():'');
  ['standalone','desktop-link','mobile-link'].forEach(id=>{document.getElementById(id).href=target;});
  document.querySelectorAll('iframe').forEach(frame=>{
    frame.addEventListener('load',()=>{
      const doc=frame.contentDocument;if(!doc||!doc.body)return;
      doc.documentElement.style.setProperty('--app-viewport-height',frame.id==='desktop-frame'?'900px':'844px');
      function fit(){frame.style.height=Math.ceil(doc.body.getBoundingClientRect().height+2)+'px';}
      fit();if(doc.fonts)doc.fonts.ready.then(fit);
      if(window.ResizeObserver)new ResizeObserver(fit).observe(doc.body);
      doc.addEventListener('toggle',fit,true);
    });
    frame.src=target;
  });
})();
