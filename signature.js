  var sigCanvas, sigCtx, sigDrawing = false, sigHasContent = false;

  function initSignaturePad_() {
    sigCanvas = document.getElementById('signature-canvas');
    sigCtx = sigCanvas.getContext('2d');

    sigCanvas.addEventListener('pointerdown', function (e) {
      sigDrawing = true;
      sigHasContent = true;
      var pos = getSigPos_(e);
      sigCtx.beginPath();
      sigCtx.moveTo(pos.x, pos.y);
      e.preventDefault();
    });
    sigCanvas.addEventListener('pointermove', function (e) {
      if (!sigDrawing) return;
      var pos = getSigPos_(e);
      sigCtx.lineTo(pos.x, pos.y);
      sigCtx.stroke();
      e.preventDefault();
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (evt) {
      sigCanvas.addEventListener(evt, function () { sigDrawing = false; });
    });

    document.getElementById('btn-signature-clear').addEventListener('click', function () {
      clearSignature_();
    });
    document.getElementById('btn-signature-open').addEventListener('click', openSignatureOverlay_);
    document.getElementById('btn-signature-done').addEventListener('click', closeSignatureOverlay_);
  }

  function openSignatureOverlay_() {
    var overlay = document.getElementById('signature-overlay');
    overlay.classList.remove('hidden');

    var rect = sigCanvas.getBoundingClientRect();
    var ratio = window.devicePixelRatio || 1;
    sigCanvas.width = Math.round(rect.width * ratio);
    sigCanvas.height = Math.round(rect.height * ratio);
    sigCtx.scale(ratio, ratio);
    sigCtx.lineWidth = 4;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.strokeStyle = '#000000';
    sigHasContent = false;
  }

  function closeSignatureOverlay_() {
    document.getElementById('signature-overlay').classList.add('hidden');
    var status = document.getElementById('signature-status');
    if (sigHasContent) {
      status.textContent = '✅ サイン済み(押すと開き直せます。やり直しになります)';
      status.classList.add('signed');
    } else {
      status.textContent = '未サイン';
      status.classList.remove('signed');
    }
  }

  function getSigPos_(e) {
    var rect = sigCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function clearSignature_() {
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    sigHasContent = false;
  }

  function getSignatureDataUrl_() {
    return sigHasContent ? sigCanvas.toDataURL('image/png') : '';
  }

  document.addEventListener('DOMContentLoaded', initSignaturePad_);
