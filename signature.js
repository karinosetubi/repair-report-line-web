  var sigCanvas, sigCtx, sigDrawing = false, sigHasContent = false;

  function initSignaturePad_() {
    sigCanvas = document.getElementById('signature-canvas');
    sigCtx = sigCanvas.getContext('2d');
    sigCtx.lineWidth = 2.5;
    sigCtx.lineCap = 'round';
    sigCtx.strokeStyle = '#000000';

    sigCanvas.addEventListener('pointerdown', function (e) {
      sigDrawing = true;
      sigHasContent = true;
      var pos = getSigPos_(e);
      sigCtx.beginPath();
      sigCtx.moveTo(pos.x, pos.y);
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
  }

  function getSigPos_(e) {
    var rect = sigCanvas.getBoundingClientRect();
    var scaleX = sigCanvas.width / rect.width;
    var scaleY = sigCanvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function clearSignature_() {
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    sigHasContent = false;
  }

  function getSignatureDataUrl_() {
    return sigHasContent ? sigCanvas.toDataURL('image/png') : '';
  }

  document.addEventListener('DOMContentLoaded', initSignaturePad_);
