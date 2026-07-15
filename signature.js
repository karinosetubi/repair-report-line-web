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

  var sigBodyScrollY_ = 0;

  /**
   * サイン中はiOS Safariで背後のページがバウンドスクロールしてしまうのを防ぐため、
   * bodyをposition:fixedで固定する(iOSでの定番の背景スクロールロック手法)。
   */
  function lockBodyScroll_() {
    sigBodyScrollY_ = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + sigBodyScrollY_ + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }
  function unlockBodyScroll_() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, sigBodyScrollY_);
  }

  /**
   * LINEアプリ内ブラウザ(WebView)ではPointer Eventのtouch-action/preventDefaultだけでは
   * スクロール・拡大縮小ジェスチャーを止めきれない端末があるため、documentレベルでtouchmove
   * そのものをブロックする(オーバーレイを開いている間のみ)。passive:falseを明示しないと
   * preventDefault()が効かない点に注意。
   */
  function preventDocumentTouchMove_(e) {
    e.preventDefault();
  }

  /**
   * サインオーバーレイを開く。canvasの実解像度は、開くたびに実際に表示される
   * ピクセルサイズ(スマホ画面いっぱい)に合わせて設定し直す(devicePixelRatioで高精細化)。
   * 【注意】canvasのwidth/height属性を変更するとその時点の描画内容は消えるため、
   * 既にサイン済みの状態で開き直すと「やり直す」を押したのと同じ結果になる
   * (このツールの用途では現地でその場サインする一発利用が前提のため許容している)。
   */
  function openSignatureOverlay_() {
    lockBodyScroll_();
    document.addEventListener('touchmove', preventDocumentTouchMove_, { passive: false });
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
    document.removeEventListener('touchmove', preventDocumentTouchMove_, { passive: false });
    unlockBodyScroll_();
    var status = document.getElementById('signature-status');
    if (sigHasContent) {
      status.textContent = '✅ サイン済み(押すと開き直せます。やり直しになります)';
      status.classList.add('signed');
    } else {
      status.textContent = '未サイン';
      status.classList.remove('signed');
    }
  }

  /** openSignatureOverlay_でctx.scale(devicePixelRatio)済みのため、CSSピクセル座標をそのまま返す */
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
