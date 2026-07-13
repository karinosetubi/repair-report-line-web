  var PHOTO_MAX_SIDE = 1600;
  var PHOTO_QUALITY = 0.7;
  var VIDEO_MAX_BYTES = 15 * 1024 * 1024; // 15MB目安(google.script.runの安定送信を考慮した上限)

  function readFileAsDataUrl_(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /** 画像ファイルをCanvasで長辺 PHOTO_MAX_SIDE px にリサイズしJPEGのdataURLを返す */
  function resizeImageFile_(file) {
    return readFileAsDataUrl_(file).then(function (dataUrl) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          var scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
        };
        img.onerror = reject;
        img.src = dataUrl;
      });
    });
  }

  function handlePhotoFiles_(fileList) {
    var files = Array.prototype.slice.call(fileList);
    var remaining = 10 - formData.photos.length;
    if (remaining <= 0) {
      alert('写真は最大10枚までです。');
      return;
    }
    files = files.slice(0, remaining);
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        return resizeImageFile_(file).then(function (dataUrl) {
          formData.photos.push(dataUrl);
          renderPhotoGrid_();
        });
      });
    });
    return chain;
  }

  function renderPhotoGrid_() {
    var grid = document.getElementById('photo-grid');
    grid.innerHTML = '';
    formData.photos.forEach(function (dataUrl, index) {
      var thumb = document.createElement('div');
      thumb.className = 'photo-thumb';
      var img = document.createElement('img');
      img.src = dataUrl;
      var removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.type = 'button';
      removeBtn.textContent = '✕';
      removeBtn.onclick = function () {
        formData.photos.splice(index, 1);
        renderPhotoGrid_();
      };
      thumb.appendChild(img);
      thumb.appendChild(removeBtn);
      grid.appendChild(thumb);
    });
    document.getElementById('photo-count').textContent = formData.photos.length;
  }

  function handleVideoFile_(file) {
    if (file.size > VIDEO_MAX_BYTES) {
      document.getElementById('video-status').textContent =
        '⚠ 動画のサイズが大きすぎます(' + Math.round(file.size / 1024 / 1024) + 'MB)。' +
        '短く撮影し直すか、動画アプリで圧縮してから選び直してください。';
      return;
    }
    readFileAsDataUrl_(file).then(function (dataUrl) {
      formData.video = dataUrl;
      document.getElementById('video-status').textContent = '✅ 動画を設定しました(' + Math.round(file.size / 1024 / 1024) + 'MB)';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btn-add-photo').addEventListener('click', function () {
      document.getElementById('photo-input').click();
    });
    document.getElementById('photo-input').addEventListener('change', function (e) {
      handlePhotoFiles_(e.target.files);
      e.target.value = '';
    });
    document.getElementById('btn-add-video').addEventListener('click', function () {
      document.getElementById('video-input').click();
    });
    document.getElementById('video-input').addEventListener('change', function (e) {
      if (e.target.files[0]) handleVideoFile_(e.target.files[0]);
      e.target.value = '';
    });
  });
