(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var scene = window.ShaderScene;
    if (!scene) return;

    var canvas = document.getElementById('cloudtrain-canvas');
    if (!canvas) return;

    var fallback = document.getElementById('cloudtrain-fallback');

    function showFallback() {
      canvas.style.display = 'none';
      if (fallback) fallback.style.display = 'block';
    }

    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) { showFallback(); return; }

    /* ---- shader helpers ---- */

    var VS = '#version 300 es\nlayout(location=0) in vec2 pos;\nvoid main(){ gl_Position = vec4(pos, 0, 1); }\n';

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:\n' + gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    }

    function link(vsSrc, fsSrc) {
      var p = gl.createProgram();
      var vs = compile(gl.VERTEX_SHADER, vsSrc);
      var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('Program link error:\n' + gl.getProgramInfoLog(p));
        return null;
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return p;
    }

    function makeFBO(w, h) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fbo: fbo, tex: tex };
    }

    /* ---- determine mode ---- */

    var dualPass = !!(scene.bufferShader && scene.imageShader);
    var singleShader = scene.shader || null;

    if (!dualPass && !singleShader) { showFallback(); return; }

    /* ---- compile scene shaders ---- */

    var progA = null, progI = null, progS = null;
    var uA = null, uI = null, uS = null;

    if (dualPass) {
      progA = link(VS, scene.bufferShader);
      progI = link(VS, scene.imageShader);
      if (!progA || !progI) { showFallback(); return; }
      uA = {
        res:  gl.getUniformLocation(progA, 'iResolution'),
        time: gl.getUniformLocation(progA, 'iTime'),
        ch0:  gl.getUniformLocation(progA, 'iChannel0'),
        ch1:  gl.getUniformLocation(progA, 'iChannel1')
      };
      uI = {
        res: gl.getUniformLocation(progI, 'iResolution'),
        ch0: gl.getUniformLocation(progI, 'iChannel0')
      };
    } else {
      progS = link(VS, singleShader);
      if (!progS) { showFallback(); return; }
      uS = {
        res:  gl.getUniformLocation(progS, 'iResolution'),
        time: gl.getUniformLocation(progS, 'iTime'),
        ch0:  gl.getUniformLocation(progS, 'iChannel0')
      };
    }

    /* ---- fullscreen quad ---- */

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    /* ---- noise texture ---- */

    var noiseSize = scene.noiseSize || 1024;
    var noiseData = new Uint8Array(noiseSize * noiseSize * 4);
    for (var i = 0; i < noiseSize * noiseSize; i++) {
      var s = (i * 1103515245 + 12345) | 0;
      s = ((s >> 16) ^ s) * 0x45d9f3b | 0;
      s = ((s >> 16) ^ s) * 0x45d9f3b | 0;
      s = (s >> 16) ^ s;
      var v = s & 255;
      noiseData[i * 4]     = v;
      noiseData[i * 4 + 1] = v;
      noiseData[i * 4 + 2] = v;
      noiseData[i * 4 + 3] = 255;
    }
    var noiseTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, noiseSize, noiseSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    var noiseSrc = scene.noiseTexture
      || canvas.getAttribute('data-noise-src')
      || null;
    if (noiseSrc) {
      var img = new Image();
      img.onload = function () {
        gl.bindTexture(gl.TEXTURE_2D, noiseTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      };
      img.src = noiseSrc;
    }

    /* ---- resize ---- */

    var W, H, fbos = [];
    var container = canvas.parentElement;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.floor(container.clientWidth * dpr);
      H = Math.floor(container.clientHeight * dpr);
      if (W < 1 || H < 1) { showFallback(); return; }
      canvas.width = W;
      canvas.height = H;
      if (dualPass) {
        for (var j = 0; j < fbos.length; j++) {
          gl.deleteTexture(fbos[j].tex);
          gl.deleteFramebuffer(fbos[j].fbo);
        }
        fbos = [makeFBO(W, H), makeFBO(W, H)];
      }
    }
    resize();

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(resize).observe(container);
    } else {
      window.addEventListener('resize', resize);
    }

    /* ---- render loop ---- */

    var cur = 0;
    var t0 = performance.now();
    var animFrameId = null;

    function frameDual() {
      var t = (performance.now() - t0) / 1000.0;

      // Pass 1: Buffer A -> fbos[cur]
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[cur].fbo);
      gl.viewport(0, 0, W, H);
      gl.useProgram(progA);
      gl.uniform3f(uA.res, W, H, 1);
      gl.uniform1f(uA.time, t);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, noiseTex);
      gl.uniform1i(uA.ch0, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fbos[1 - cur].tex);
      gl.uniform1i(uA.ch1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Pass 2: Image -> screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(progI);
      gl.uniform3f(uI.res, W, H, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fbos[cur].tex);
      gl.uniform1i(uI.ch0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      cur = 1 - cur;
      animFrameId = requestAnimationFrame(frameDual);
    }

    function frameSingle() {
      var t = (performance.now() - t0) / 1000.0;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(progS);
      gl.uniform3f(uS.res, W, H, 1);
      gl.uniform1f(uS.time, t);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, noiseTex);
      gl.uniform1i(uS.ch0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animFrameId = requestAnimationFrame(frameSingle);
    }

    var frame = dualPass ? frameDual : frameSingle;

    function startLoop() {
      if (!animFrameId) animFrameId = requestAnimationFrame(frame);
    }

    function stopLoop() {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopLoop(); else startLoop();
    });

    startLoop();
  });
})();
