/*
 * Ocean renderer · 学习入口海洋场景
 * 原创编写的全屏 WebGL1 片元着色器：程序化波浪（指数正弦叠加 + 波拖拽）、
 * 菲涅尔天空反射、太阳闪烁、浅滩焦散、岸边涌浪泡沫、岛屿 SDF 地形。
 * 技术思路参考了公开讨论的通用方法（指数正弦波、SDF 岸线），未复制任何第三方着色器代码。
 * 无依赖，可直接 file:// 打开。
 */
(function (global) {
  'use strict';

  var MAX_ISL = 10;
  var TAN_HALF_FOV = 0.42;

  var VERT = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}';

  var FRAG = [
    'precision highp float;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform vec3 uCam;',      // target.x, target.z, distance
    'uniform float uPitch;',
    'uniform vec4 uIsl[' + MAX_ISL + '];',   // x, z, radius, seed
    'uniform vec4 uTint[' + MAX_ISL + '];',  // rgb tint, w = kind (0 course, 1 planned)
    'uniform int uCount;',
    'uniform float uSel;',
    'uniform float uHov;',
    'uniform float uCalm;',
    'uniform float uSelT;',
    'const float TANH=' + TAN_HALF_FOV.toFixed(3) + ';',
    'const vec3 SUN=vec3(-0.36,0.34,-0.87);',
    'const vec3 SUNC=vec3(1.0,0.84,0.6);',

    'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);',
    ' return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}',
    'float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<4;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}',

    // ---------- 波浪高度场 ----------
    'float waves(vec2 p,float t,int oct){',
    ' float h=0.,w=0.,a=1.,f=.55,ang=.7;',
    ' for(int i=0;i<9;i++){ if(i>=oct)break;',
    '  vec2 d=vec2(cos(ang),sin(ang));',
    '  float x=dot(d,p)*f+t*sqrt(f)*1.25;',
    '  float s=exp(sin(x)-1.);',
    '  h+=s*a;w+=a;',
    '  p+=d*(-s*cos(x))*a*.28;',          // 波拖拽：让小波聚集在大波波峰
    '  ang+=2.399;f*=1.33;a*=.74;',
    ' }',
    ' return h/w;}',

    // ---------- 岛屿 SDF ----------
    'float islShape(vec2 p,vec4 I){',
    ' vec2 q=(p-I.xy)/I.z;float a=atan(q.y,q.x);float s=I.w;',
    ' float wob=.11*sin(a*3.+s*6.)+.07*sin(a*5.+s*3.7)+.05*sin(a*9.+s*1.3)+.16*(fbm(q*1.4+s*9.)-.5);',
    ' return (length(q)-1.-wob)*I.z;}',

    'float scene(vec2 p,out float id,out vec4 bi,out vec4 bt){',
    ' float d=1e5;id=-1.;bi=vec4(0.,0.,1.,0.);bt=vec4(1.);',
    ' for(int i=0;i<' + MAX_ISL + ';i++){ if(i>=uCount)break;',
    '  float di=islShape(p,uIsl[i]);',
    '  if(di<d){d=di;id=float(i);bi=uIsl[i];bt=uTint[i];}',
    ' }',
    ' return d;}',
    'float sceneD(vec2 p){float id;vec4 a,b;return scene(p,id,a,b);}',

    // ---------- 天空（用于反射） ----------
    'vec3 sky(vec3 d){',
    ' float y=max(d.y,0.);',
    ' vec3 top=vec3(.36,.62,.82),hor=vec3(.86,.9,.88);',
    ' vec3 c=mix(hor,top,pow(y,.5));',
    ' float s=max(dot(d,SUN),0.);',
    ' c+=SUNC*(pow(s,8.)*.35+pow(s,64.)*.6);',
    ' c=mix(c,vec3(1.,.8,.62),smoothstep(.5,1.,s)*.3*(1.-y));',
    ' return c;}',

    // ---------- 焦散 ----------
    'float caustic(vec2 p,float t){',
    ' vec2 q=p;float c=0.;',
    ' for(int i=0;i<3;i++){',
    '  q+=vec2(sin(q.y*1.7+t*.9+float(i)),cos(q.x*1.5-t*.8+float(i)*1.7))*.45;',
    '  c+=abs(sin(q.x+q.y)*cos(q.x-q.y*.7));',
    ' }',
    ' c=c/3.;return pow(1.-c,6.);}',

    // ---------- 陆地高度（用于法线） ----------
    'float landH(vec2 p){float id;vec4 I,T;float d=scene(p,id,I,T);',
    ' float hn=clamp(-d/I.z,0.,1.);',
    ' float plan=step(.5,T.w)*(1.-step(1.5,T.w));',
    ' float h=smoothstep(0.,.55,hn)*mix(1.,.15,plan)+fbm(p*.9+I.w*7.)*.35*smoothstep(.08,.5,hn)*(1.-plan);',
    ' return h;}',

    'void main(){',
    ' vec2 uv=(gl_FragCoord.xy-.5*uRes)/(.5*uRes.y);',
    ' float sp=sin(uPitch),cp=cos(uPitch);',
    ' vec3 F=vec3(0.,-sp,-cp),R=vec3(1.,0.,0.),U=vec3(0.,cp,-sp);',
    ' vec3 ro=vec3(uCam.x,0.,uCam.y)-F*uCam.z;',
    ' vec3 rd=normalize(F+(uv.x*R+uv.y*U)*TANH);',
    ' float T=uTime*mix(1.,.45,uCalm);',
    ' vec3 col;',
    ' if(rd.y>-.004){ col=sky(rd); gl_FragColor=vec4(col,1.); return; }',
    ' float t=-ro.y/rd.y; vec2 p=ro.xz+rd.xz*t;',
    ' float id;vec4 I,TT; float d=scene(p,id,I,TT);',
    ' float far=smoothstep(30.,110.,t);',
    ' vec3 L=normalize(SUN);',

    ' if(d<0.){',
    // ================= 陆地 =================
    '  float hn=clamp(-d/I.z,0.,1.);',
    '  float plan=step(.5,TT.w)*(1.-step(1.5,TT.w));',
    '  float offline=step(1.5,TT.w);',
    '  float e=.06;',
    '  float hx=landH(p+vec2(e,0.))-landH(p-vec2(e,0.));',
    '  float hz=landH(p+vec2(0.,e))-landH(p-vec2(0.,e));',
    '  vec3 n=normalize(vec3(-hx*1.1,2.*e,-hz*1.1));',
    '  vec3 sand=vec3(.95,.86,.66);',
    '  vec3 wet=vec3(.8,.72,.56);',
    '  vec3 grass=mix(vec3(.42,.66,.42),TT.rgb,.35);',
    '  vec3 grass2=mix(vec3(.24,.48,.36),TT.rgb*.7,.3);',
    '  float pat=fbm(p*1.3+I.w*4.);',
    '  vec3 g=mix(grass2,grass,smoothstep(.3,.75,pat));',
    '  float sw=.02+.015*sin(T*.9+I.w*5.+atan(p.y-I.y,p.x-I.x)*3.);',
    '  vec3 c=mix(wet,sand,smoothstep(sw,sw+.03,hn));',
    '  float gEdge=.2+.05*(fbm(p*2.+I.w)-.5);',
    '  if(plan<.5){',
    '   c=mix(c,g,smoothstep(gEdge,gEdge+.04,hn));',
    // 树冠：程序化圆点簇
    '   vec2 gp=p*2.1+I.w*13.;vec2 ci=floor(gp);vec2 cf=fract(gp)-.5;',
    '   vec2 off=vec2(hash(ci),hash(ci+7.1))-.5;float rr=.28+.16*hash(ci+3.3);',
    '   float tm=step(.42,fbm(p*.7+I.w*2.))*smoothstep(gEdge+.06,gEdge+.12,hn)*(1.-smoothstep(.6,.66,hn));',
    '   float dd=length(cf-off*.4);',
    '   float can=(1.-smoothstep(rr-.06,rr,dd))*tm;',
    '   vec3 canC=mix(vec3(.16,.38,.3),TT.rgb*.55+vec3(.05,.12,.06),.3);',
    '   float lit=clamp(dot(normalize(cf-off*.4+vec2(.0001)),-normalize(L.xz))*.5+.5,0.,1.);',
    '   canC*=mix(.75,1.35,lit*(1.-smoothstep(0.,rr,dd)*.5));',
    '   c=mix(c,canC,can);',
    // 中央广场
    '   float plaza=smoothstep(.72,.78,hn);',
    '   vec3 pc=mix(vec3(.93,.88,.76),vec3(.86,.8,.68),noise(p*6.));',
    '   c=mix(c,pc,plaza*.92);',
    '   c=mix(c,vec3(.78,.7,.56),smoothstep(.71,.73,hn)*(1.-smoothstep(.73,.75,hn))*.6);',
    '  }',
    '  if(plan>.5){c=mix(vec3(.5,.8,.74),sand,smoothstep(0.,.3,hn)*.9);}',
    '  float dif=clamp(dot(n,L)*.7+.45,0.,1.3);',
    '  vec3 amb=vec3(.55,.68,.78)*.5;',
    '  c=c*(amb+SUNC*dif*.78);',
    // 选中/悬停的陆地提亮
    '  float isSel=1.-step(.5,abs(id-uSel));float isHov=1.-step(.5,abs(id-uHov));',
    '  c*=1.+.08*isHov+.05*isSel;',
    '  if(offline>.5){float gy=dot(c,vec3(.299,.587,.114));c=mix(vec3(gy),vec3(.42,.46,.48),.62)*.46;}',
    '  col=c;',
    ' } else {',
    // ================= 水面 =================
    '  float shore=d;',
    '  float depthF=1.-exp(-shore*.42);',
    '  int oct=t>70.?5:8;',
    '  float amp=mix(.35,1.,smoothstep(0.,3.,shore))*mix(1.,.55,uCalm);',
    '  float e=.04+t*.0012;',
    '  float h=waves(p,T,oct);',
    '  float hx=waves(p+vec2(e,0.),T,oct);',
    '  float hz=waves(p+vec2(0.,e),T,oct);',
    '  float A=.55*amp;',
    '  vec3 n=normalize(vec3((h-hx)*A,e,(h-hz)*A));',
    '  n=normalize(mix(n,vec3(0.,1.,0.),far*.7));',
    // 水色：深浅 + 大尺度洋流色斑
    '  vec3 deep=vec3(.015,.14,.25),mid=vec3(.02,.3,.42),shal=vec3(.16,.7,.7),sandU=vec3(.62,.84,.72);',
    '  float patch=fbm(p*.045+vec2(T*.006,-T*.004));',
    '  vec3 dc=mix(deep,mid,smoothstep(.25,.8,patch)*.8);',
    '  vec3 base=mix(shal,dc,smoothstep(0.,1.,depthF));',
    '  base=mix(sandU,base,smoothstep(0.,.55,depthF));',
    // 水下沙纹
    '  float rip=sin(dot(p,vec2(.8,.6))*6.+fbm(p*1.5)*4.)*.5+.5;',
    '  base+=vec3(.06,.07,.05)*rip*(1.-smoothstep(0.,.5,depthF));',
    // 焦散
    '  float ca=caustic(p*1.15+n.xz*.6,T*.9);',
    '  base+=vec3(.55,.75,.6)*ca*pow(1.-depthF,1.6)*.85;',
    // 岛屿投下的水面阴影
    '  float dsh=sceneD(p+normalize(L.xz)*1.4);',
    '  float shad=smoothstep(.6,-.4,dsh)*.35;',
    // 光照
    '  vec3 V=-rd;',
    '  float ndv=max(dot(n,V),0.);',
    '  float fres=.04+.96*pow(1.-ndv,5.);',
    '  fres=clamp(fres*1.25,0.,.85);',
    '  vec3 rf=reflect(rd,n); rf.y=abs(rf.y);',
    '  vec3 refl=sky(rf);',
    '  float sss=pow(max(h-.35,0.),2.)*1.2;',
    '  vec3 wc=base*(.72+.4*max(dot(n,L),0.))+shal*sss*.45*(1.-far);',
    '  wc=mix(wc,refl,fres);',
    '  float sd=max(dot(rf,L),0.);',
    '  float glit=pow(sd,700.)*9.+pow(sd,90.)*.6+pow(sd,12.)*.08;',
    '  wc+=SUNC*glit*(1.-shad*2.);',
    '  wc*=1.-shad;',
    // 岸边涌浪泡沫
    '  float ang=atan(p.y-I.y,p.x-I.x);',
    '  float sw=.1+.09*sin(T*.85+I.w*5.+ang*3.)+.04*sin(T*1.7+ang*7.);',
    '  float brk=noise(p*7.+vec2(T*.6,0.));',
    '  float edge=(1.-smoothstep(sw,sw+.12,shore))*smoothstep(.15,.55,brk+.25);',
    '  float ph=shore*2.4-T*1.1+fbm(p*.8+I.w)*2.5;',
    '  float band=smoothstep(.82,.97,sin(ph))*(1.-smoothstep(.2,2.4,shore))*step(.38,noise(p*5.+T*.3));',
    '  float lace=smoothstep(.55,.75,noise(p*3.5-T*.2))*(1.-smoothstep(.0,1.,shore))*.5;',
    '  float crest=smoothstep(.8,.96,h)*smoothstep(.55,.8,noise(p*2.6+T*.25))*.55*(1.-far)*(1.-uCalm*.6);',
    '  float foam=clamp(edge+band*.75+lace+crest,0.,1.);',
    '  wc=mix(wc,vec3(.96,.98,.97)*(.85+.2*max(dot(n,L),0.)),foam*(1.-far*.8));',
    // 选中涟漪环（金色）与悬停光晕
    '  float isSel=1.-step(.5,abs(id-uSel));float isHov=1.-step(.5,abs(id-uHov));',
    '  float rg=fract((shore-uSelT*.55)/1.5);',
    '  float ring=smoothstep(.06,0.,abs(rg-.5)-.04)*(1.-smoothstep(.3,3.6,shore))*smoothstep(0.,.3,shore);',
    '  wc+=vec3(1.,.84,.5)*ring*isSel*.95;',
    '  wc=mix(wc,wc*1.12+vec3(.05,.08,.06),(1.-smoothstep(0.,2.6,shore))*isSel*.6);',
    '  wc+=vec3(.9,1.,1.)*(1.-smoothstep(0.,1.8,shore))*isHov*.12;',
    // 规划中岛屿：虚线浮标圈
    '  float plan=TT.w;',
    '  float dash=step(.5,fract(ang*8./6.2831+T*.03));',
    '  float pr=smoothstep(.05,0.,abs(shore-1.3))*dash*plan;',
    '  wc=mix(wc,vec3(1.,.95,.85),pr*.5*(1.-far));',
    '  col=wc;',
    ' }',
    // 远景雾化 + 调色
    ' vec3 haze=mix(vec3(.6,.78,.84),vec3(.95,.85,.72),pow(max(dot(normalize(vec3(rd.x,0.,rd.z)),normalize(vec3(L.x,0.,L.z))),0.),4.)*.6);',
    ' col=mix(col,haze,far*.75);',
    ' vec2 q=gl_FragCoord.xy/uRes;',
    ' col*=.82+.18*pow(16.*q.x*q.y*(1.-q.x)*(1.-q.y),.18);',
    ' col=pow(col,vec3(.95));',
    ' col=col*1.04-.01;',
    ' gl_FragColor=vec4(clamp(col,0.,1.),1.);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('Shader compile failed: ' + log);
    }
    return s;
  }

  /**
   * createOcean(canvas, options)
   * options: { pitch, calm, quality: 'high'|'low', onFallback }
   * 返回控制器；若 WebGL 不可用返回 null（调用方显示降级画面）。
   */
  function createOcean(canvas, opts) {
    opts = opts || {};
    var gl;
    try {
      gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }) ||
           canvas.getContext('experimental-webgl');
    } catch (e) { gl = null; }
    if (!gl) return null;

    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      if (global.console) console.warn('[ocean] fallback:', e);
      return null;
    }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var U = {};
    ['uRes', 'uTime', 'uCam', 'uPitch', 'uIsl', 'uTint', 'uCount', 'uSel', 'uHov', 'uCalm', 'uSelT'].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });

    var state = {
      cam: { x: 0, z: 0, dist: 40 },
      pitch: opts.pitch || 0.92,
      islands: [],
      sel: -1, hov: -1,
      calm: opts.calm ? 1 : 0,
      time: 0, selT: 0,
      scale: opts.quality === 'low' ? 0.5 : 1,
      lost: false
    };

    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); state.lost = true; if (opts.onFallback) opts.onFallback(); });

    var islArr = new Float32Array(MAX_ISL * 4), tintArr = new Float32Array(MAX_ISL * 4);

    function setIslands(list) {
      state.islands = list.slice(0, MAX_ISL);
      islArr.fill(0); tintArr.fill(0);
      state.islands.forEach(function (it, i) {
        islArr.set([it.x, it.z, it.r, it.seed || i * 1.37 + 0.4], i * 4);
        var c = it.tint || [0.5, 0.7, 0.5];
        tintArr.set([c[0], c[1], c[2], it.disabled ? 2 : (it.planned ? 1 : 0)], i * 4);
      });
    }

    function resize() {
      var dpr = Math.min(global.devicePixelRatio || 1, 1.5) * state.scale;
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
    }

    function render() {
      if (state.lost) return;
      resize();
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, state.time);
      gl.uniform1f(U.uSelT, state.selT);
      gl.uniform3f(U.uCam, state.cam.x, state.cam.z, state.cam.dist);
      gl.uniform1f(U.uPitch, state.pitch);
      gl.uniform4fv(U.uIsl, islArr);
      gl.uniform4fv(U.uTint, tintArr);
      gl.uniform1i(U.uCount, state.islands.length);
      gl.uniform1f(U.uSel, state.sel);
      gl.uniform1f(U.uHov, state.hov);
      gl.uniform1f(U.uCalm, state.calm);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return { state: state, setIslands: setIslands, render: render, gl: gl };
  }

  /* 与着色器一致的投影：世界坐标 -> 屏幕 CSS 像素（供 HTML 悬浮层定位） */
  function makeCamera(cam, pitch) {
    var sp = Math.sin(pitch), cp = Math.cos(pitch);
    var F = [0, -sp, -cp], R = [1, 0, 0], Uv = [0, cp, -sp];
    var ro = [cam.x - F[0] * cam.dist, -F[1] * cam.dist, cam.z - F[2] * cam.dist];
    return { F: F, R: R, U: Uv, ro: ro };
  }
  function project(cam, pitch, w, h, x, y, z) {
    var c = makeCamera(cam, pitch);
    var v = [x - c.ro[0], y - c.ro[1], z - c.ro[2]];
    var zc = v[0] * c.F[0] + v[1] * c.F[1] + v[2] * c.F[2];
    if (zc <= 0.01) return null;
    var xs = (v[0] * c.R[0] + v[1] * c.R[1] + v[2] * c.R[2]) / (zc * TAN_HALF_FOV);
    var ys = (v[0] * c.U[0] + v[1] * c.U[1] + v[2] * c.U[2]) / (zc * TAN_HALF_FOV);
    return { x: w / 2 + xs * h / 2, y: h / 2 - ys * h / 2, depth: zc, scale: h / (zc * TAN_HALF_FOV * 2) };
  }
  /* 屏幕 -> 海平面世界坐标（点击拾取 / 拖拽平移） */
  function unproject(cam, pitch, w, h, sx, sy) {
    var c = makeCamera(cam, pitch);
    var ux = (sx - w / 2) / (h / 2), uy = -(sy - h / 2) / (h / 2);
    var rd = [c.F[0] + (ux * c.R[0] + uy * c.U[0]) * TAN_HALF_FOV,
              c.F[1] + (ux * c.R[1] + uy * c.U[1]) * TAN_HALF_FOV,
              c.F[2] + (ux * c.R[2] + uy * c.U[2]) * TAN_HALF_FOV];
    if (rd[1] >= -0.001) return null;
    var t = -c.ro[1] / rd[1];
    return { x: c.ro[0] + rd[0] * t, z: c.ro[2] + rd[2] * t };
  }

  global.Ocean = { create: createOcean, project: project, unproject: unproject, MAX_ISLANDS: MAX_ISL };
})(window);
