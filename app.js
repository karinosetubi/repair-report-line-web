  // ===== 設定(LIFFアプリやGASのデプロイをやり直したらここを更新する) =====
  var LIFF_ID = '2010686947-KFPaPxQD';
  var API_BASE_URL = 'https://script.google.com/macros/s/AKfycby9CioempNx2RqXbGdD_waPGE5au4YtvXReLqbY31F6vQ2TbFjrcr-0oUYiRkZPaMd1lw/exec';
  // GETのURLに乗せるには大きすぎる(写真等を含む)場合はPOSTに自動で切り替える
  var API_GET_LENGTH_LIMIT = 6000;

  var idToken = null;
  var currentUser = null;
  var formMasters = null;
  var formData = {};

  // ===== 汎用ヘルパー =====
  function showScreen_(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); });
    document.getElementById(id).classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function showOverlay_(text) {
    document.getElementById('overlay-text').textContent = text || '処理中...';
    document.getElementById('overlay').classList.remove('hidden');
  }
  function hideOverlay_() {
    document.getElementById('overlay').classList.add('hidden');
  }

  // GASのWebアプリ(ContentServiceのJSON API)をfetchで呼び出す。
  // ヘッダーを一切付けずに呼ぶことで、ブラウザのCORS事前確認(プリフライト)を回避している。
  function runServer_(action) {
    var args = Array.prototype.slice.call(arguments, 1);
    var argsJson = JSON.stringify(args);
    var request;
    if (argsJson.length < API_GET_LENGTH_LIMIT) {
      var url = API_BASE_URL + '?action=' + encodeURIComponent(action) + '&args=' + encodeURIComponent(argsJson);
      request = fetch(url);
    } else {
      request = fetch(API_BASE_URL, {
        method: 'POST',
        body: JSON.stringify({ action: action, args: args })
      });
    }
    return request.then(function (res) {
      if (!res.ok) throw new Error('サーバーエラー: HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      if (!json.ok) throw new Error(json.error || 'サーバーでエラーが発生しました。');
      return json.data;
    });
  }

  function showError_(err) {
    hideOverlay_();
    var msg = (err && err.message) ? err.message : String(err);
    document.getElementById('error-message').textContent = msg;
    showScreen_('screen-error');
  }

  function escapeHtml_(text) {
    var div = document.createElement('div');
    div.textContent = String(text === undefined || text === null ? '' : text);
    return div.innerHTML;
  }

  function populateSelect_(id, list) {
    var select = document.getElementById(id);
    select.innerHTML = '';
    (list || []).forEach(function (value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });
  }

  /** 検索画面の絞り込みセレクト用。先頭に「絞り込みなし」の空欄オプションを残す */
  function populateFilterSelect_(id, list, blankLabel) {
    var select = document.getElementById(id);
    select.innerHTML = '';
    var blankOpt = document.createElement('option');
    blankOpt.value = '';
    blankOpt.textContent = blankLabel;
    select.appendChild(blankOpt);
    (list || []).forEach(function (value) {
      if (value === 'その他') return; // 「その他」は絞り込み用途に向かないため除外
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });
  }

  // ===== 起動・ログイン =====
  function setLoadingStatus_(text) {
    var p = document.querySelector('#screen-loading p');
    if (p) p.textContent = text;
  }

  function initApp_() {
    if (!LIFF_ID) {
      showError_({ message: 'LIFF IDが未設定です。web/app.js先頭のLIFF_IDを、LINE Developersで発行した値に書き換えてください。' });
      return;
    }
    if (typeof liff === 'undefined') {
      showError_({ message: 'LIFF SDKが読み込めませんでした。ネットワーク状況を確認して再度開いてください。' });
      return;
    }
    var timeoutId = setTimeout(function () {
      setLoadingStatus_('読み込みに時間がかかっています。電波の良い場所で再度開いてみてください。');
    }, 10000);

    liff.init({ liffId: LIFF_ID }).then(function () {
      clearTimeout(timeoutId);
      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }
      idToken = liff.getIDToken();
      // 通常起動(登録済み社員)はプロフィール取得とフォームマスタ取得を1回のAPI呼び出しに
      // まとめている(以前はgetMyProfile→getFormMastersと逐次2回呼んでおり、GAS呼び出しの
      // オーバーヘッドとLINE idToken検証がそれぞれ2重になって起動が遅かったため)。
      return runServer_('getMyProfileAndMasters', idToken).then(function (result) {
        if (!result.profile.registered) {
          document.getElementById('register-display-name').textContent = result.profile.displayName || '';
          showScreen_('screen-register');
        } else {
          showHomeScreen_(result.profile, result.masters);
          // ホーム画面のスマホショートカットから「?start=new」付きで開いた場合、
          // メインメニューを経由せず新規作成画面まで自動で進める(タップ数を減らすため)。
          if (getStartParam_() === 'new') {
            startNewReport_();
          }
        }
      });
    }).catch(function (err) {
      clearTimeout(timeoutId);
      showError_(err);
    });
  }

  /**
   * LIFFのURLに付けた「?start=new」等のクエリを取り出す。LIFF URL(https://liff.line.me/{id}?start=new)
   * で開かれた場合、LINE側でエンドポイントURLに ?liff.state=<urlエンコードされた元のクエリ> という形で
   * 転送されてくるため、liff.stateがあればそちらを、無ければ通常のクエリをそのまま見る。
   */
  function getStartParam_() {
    var params = new URLSearchParams(window.location.search);
    var raw = params.get('liff.state') || window.location.search;
    var qIndex = raw.indexOf('?');
    var qs = qIndex >= 0 ? raw.substring(qIndex + 1) : raw;
    return new URLSearchParams(qs).get('start');
  }

  function startNewReport_() {
    resetFormData_();
    showOverlay_('受付番号を確認中...');
    return runServer_('previewNextReceiptNumber', idToken).then(function (no) {
      hideOverlay_();
      document.getElementById('f-receipt-preview').value = no;
      showScreen_('screen-form-1');
    }).catch(showError_);
  }

  function showHomeScreen_(profile, masters) {
    currentUser = profile;
    document.getElementById('user-info').textContent = '社員番号:' + profile.staffId + '　' + profile.staffName;
    document.getElementById('f-staff-display').textContent = profile.staffName;
    formMasters = masters;
    populateSelect_('f-equipment-name', masters.equipmentList);
    populateSelect_('f-maker', masters.makerList);
    populateSelect_('f-billing-type', masters.billingTypes);
    populateFilterSelect_('search-filter-equipment', masters.equipmentList, '設備名称(絞り込みなし)');
    populateFilterSelect_('search-filter-maker', masters.makerList, 'メーカー(絞り込みなし)');
    updateVoiceHintVisibility_();
    // ホーム画面はダッシュボード(screen-dashboard)。工事日報の新規作成/検索メニュー(screen-home)は
    // ダッシュボードのクイックリンクやフォームの「戻る」から遷移する2階層目の画面として残す。
    showDashboard_();
  }

  /**
   * iOS版LINEアプリ内ブラウザ(WKWebView)はWeb Speech APIの音声認識サービスをOS側で拒否するため
   * (service-not-allowedエラー、voice.js参照)、外部ブラウザ(Safari)で開き直せば無料のまま音声入力が
   * 使えることをホーム画面で案内する。Androidはアプリ内でも音声入力が動くことが多いため表示しない。
   * データ入力途中に切り替えると formData が消えるため、ホーム画面(入力開始前)にのみ表示する。
   */
  function updateVoiceHintVisibility_() {
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    var isInLineApp = window.liff && liff.isInClient && liff.isInClient();
    document.getElementById('voice-hint').classList.toggle('hidden', !(isIOS && isInLineApp));
  }

  /** 初回登録直後専用。登録時にはgetMyProfileAndMastersを使えない(未登録のためmastersがnull)ので、
   * 登録完了後に改めてgetFormMastersを1回呼ぶ(登録は一生に一度のイベントなのでコストは無視できる)。 */
  function onLoginSuccess_(profile) {
    return runServer_('getFormMasters', idToken).then(function (masters) {
      showHomeScreen_(profile, masters);
    });
  }

  // ===== フォームのリセット =====
  /** 今日の日付(YYYY-MM-DD)・現在時刻(HH:MM)をローカル時刻で返す(工事日・開始時間のデフォルト入力用) */
  function todayDateString_() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function nowTimeString_() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function resetFormData_() {
    formData = {
      workDate: '', startTime: '', endTime: '', customerName: '', address: '', phone: '',
      equipmentName: '', maker: '', model: '', serialNo: '',
      trouble: '', cause: '', repair: '',
      parts: [], photos: [], video: '', signature: '',
      comment: '', nextCheckDate: '', billingType: '',
      lat: '', lng: ''
    };
    ['f-work-date', 'f-start-time', 'f-end-time', 'f-customer-name', 'f-address', 'f-phone',
      'f-model', 'f-serial-no', 'f-trouble', 'f-cause', 'f-repair', 'f-comment', 'f-next-check-date']
      .forEach(function (id) { document.getElementById(id).value = ''; });
    // 工事日・開始時間は同日作業が多いため、今日の日付・現在時刻をデフォルト入力しておく
    // (誤りがあれば社員がその場で修正できるので、入力の手間を減らすことを優先する)
    document.getElementById('f-work-date').value = todayDateString_();
    document.getElementById('f-start-time').value = nowTimeString_();
    document.getElementById('photo-grid').innerHTML = '';
    document.getElementById('photo-count').textContent = '0';
    document.getElementById('video-status').textContent = '';
    clearSignature_();
    var sigStatus = document.getElementById('signature-status');
    sigStatus.textContent = '未サイン';
    sigStatus.classList.remove('signed');
    renderPartsList_();
  }

  // ===== 各ステップの入力収集・検証 =====
  function collectStep1_() {
    formData.workDate = document.getElementById('f-work-date').value;
    formData.startTime = document.getElementById('f-start-time').value;
    formData.endTime = document.getElementById('f-end-time').value;
    formData.customerName = document.getElementById('f-customer-name').value.trim();
    formData.address = document.getElementById('f-address').value.trim();
    formData.phone = document.getElementById('f-phone').value.trim();
  }
  function validateStep1_() {
    collectStep1_();
    if (!formData.workDate || !formData.startTime || !formData.customerName || !formData.address) {
      alert('工事日・開始時間・お客様名・住所は必須です。');
      return false;
    }
    return true;
  }

  function collectStep2_() {
    formData.equipmentName = document.getElementById('f-equipment-name').value;
    formData.maker = document.getElementById('f-maker').value;
    formData.model = document.getElementById('f-model').value.trim();
    formData.serialNo = document.getElementById('f-serial-no').value.trim();
  }
  function validateStep2_() {
    collectStep2_();
    if (!formData.equipmentName) {
      alert('設備名称を選択してください。');
      return false;
    }
    return true;
  }

  function collectStep3_() {
    formData.trouble = document.getElementById('f-trouble').value.trim();
    formData.cause = document.getElementById('f-cause').value.trim();
    formData.repair = document.getElementById('f-repair').value.trim();
  }
  function validateStep3_() {
    collectStep3_();
    if (!formData.trouble || !formData.repair) {
      alert('故障内容と修理内容は必須です。');
      return false;
    }
    return true;
  }

  function collectStep6_() {
    formData.signature = getSignatureDataUrl_();
    formData.comment = document.getElementById('f-comment').value.trim();
    formData.nextCheckDate = document.getElementById('f-next-check-date').value;
    formData.billingType = document.getElementById('f-billing-type').value;
  }
  function validateStep6_() {
    collectStep6_();
    if (!formData.billingType) {
      alert('請求区分を選択してください。');
      return false;
    }
    return true;
  }

  // ===== 交換部品(④) =====
  function renderPartsList_() {
    var container = document.getElementById('parts-list');
    container.innerHTML = '';
    formData.parts.forEach(function (part, index) {
      var row = document.createElement('div');
      row.className = 'parts-list-row';

      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = '部品名';
      nameInput.value = part.name || '';
      nameInput.addEventListener('input', function () { part.name = nameInput.value; });

      var qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.placeholder = '数量';
      qtyInput.value = part.qty || '';
      qtyInput.addEventListener('input', function () { part.qty = qtyInput.value; updatePartsTotal_(); });

      var priceInput = document.createElement('input');
      priceInput.type = 'number';
      priceInput.placeholder = '単価';
      priceInput.value = part.unitPrice || '';
      priceInput.addEventListener('input', function () { part.unitPrice = priceInput.value; updatePartsTotal_(); });

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-small';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', function () {
        formData.parts.splice(index, 1);
        renderPartsList_();
      });

      row.appendChild(nameInput);
      row.appendChild(qtyInput);
      row.appendChild(priceInput);
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
    updatePartsTotal_();
  }
  function updatePartsTotal_() {
    var total = formData.parts.reduce(function (sum, p) {
      return sum + (Number(p.qty) || 0) * (Number(p.unitPrice) || 0);
    }, 0);
    document.getElementById('parts-total-amount').textContent = total.toLocaleString();
  }

  // ===== 確認画面(⑩) =====
  function renderConfirm_() {
    var partsText = formData.parts.length
      ? formData.parts.map(function (p) {
          var amount = (Number(p.qty) || 0) * (Number(p.unitPrice) || 0);
          return p.name + ' x' + p.qty + '(' + amount.toLocaleString() + '円)';
        }).join('\n')
      : '(なし)';
    var rows = [
      ['受付番号(予定)', document.getElementById('f-receipt-preview').value],
      ['工事日', formData.workDate],
      ['時間', formData.startTime + ' 〜 ' + formData.endTime],
      ['お客様名', formData.customerName],
      ['住所', formData.address],
      ['電話番号', formData.phone],
      ['設備名称', formData.equipmentName],
      ['メーカー', formData.maker],
      ['型式', formData.model],
      ['製造番号', formData.serialNo],
      ['故障内容', formData.trouble],
      ['原因', formData.cause],
      ['修理内容', formData.repair],
      ['交換部品', partsText],
      ['写真', formData.photos.length + '枚'],
      ['動画', formData.video ? 'あり' : 'なし'],
      ['サイン', formData.signature ? 'あり' : 'なし'],
      ['作業員コメント', formData.comment],
      ['次回点検予定', formData.nextCheckDate],
      ['請求区分', formData.billingType]
    ];
    var html = rows.map(function (r) {
      return '<div class="confirm-row"><div class="label">' + escapeHtml_(r[0]) +
        '</div><div class="value">' + escapeHtml_(r[1] || '(未入力)') + '</div></div>';
    }).join('');
    document.getElementById('confirm-content').innerHTML = html;
  }

  // ===== 検索 =====
  var searchResults_ = [];
  function renderSearchResults_() {
    var list = document.getElementById('search-result-list');
    list.innerHTML = '';
    if (searchResults_.length === 0) {
      list.innerHTML = '<p class="hint">該当する報告書がありません。</p>';
      return;
    }
    searchResults_.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'search-card';
      card.innerHTML =
        '<div class="title">' + escapeHtml_(r.customerName) + '様 - ' + escapeHtml_(r.equipmentName || '') + '</div>' +
        '<div class="sub">' + escapeHtml_(r.receiptNo) + ' / ' + escapeHtml_(r.workDate) + ' / ' + escapeHtml_(r.address || '') + '</div>';
      card.addEventListener('click', function () {
        goToSearchDetail_(r, 'screen-search');
      });
      list.appendChild(card);
    });
  }
  function renderSearchDetail_(r) {
    var rows = [
      ['受付番号', r.receiptNo], ['工事日', r.workDate], ['お客様名', r.customerName], ['住所', r.address],
      ['設備名称', r.equipmentName], ['メーカー', r.maker], ['型式', r.model], ['担当者', r.staffName],
      ['故障内容', r.trouble], ['修理内容', r.repair], ['請求区分', r.billingType]
    ];
    var html = rows.map(function (row) {
      return '<div class="confirm-row"><div class="label">' + escapeHtml_(row[0]) +
        '</div><div class="value">' + escapeHtml_(row[1] || '') + '</div></div>';
    }).join('');
    if (r.pdfUrl) {
      html += '<a class="btn btn-primary" href="' + r.pdfUrl + '" target="_blank" rel="noopener">PDFを見る</a>';
    }
    document.getElementById('search-detail-content').innerHTML = html;
  }

  // ===== テーマ切替 =====
  function updateThemeIcon_() {
    var current = document.documentElement.getAttribute('data-theme');
    document.getElementById('theme-toggle').textContent = current === 'dark' ? '☀️' : '🌙';
  }

  // ===== イベント登録 =====
  document.addEventListener('DOMContentLoaded', function () {
    var savedTheme = localStorage.getItem('theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon_();
    document.getElementById('theme-toggle').addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      updateThemeIcon_();
    });

    document.getElementById('btn-register-submit').addEventListener('click', function () {
      var staffId = document.getElementById('register-staff-id').value.trim();
      var staffName = document.getElementById('register-staff-name').value.trim();
      var hireDate = document.getElementById('register-hire-date').value;
      if (!staffId || !staffName || !hireDate) { alert('社員番号・氏名・入社日を入力してください。'); return; }
      showOverlay_('登録中...');
      runServer_('registerMyself', idToken, staffId, staffName, hireDate).then(function (profile) {
        hideOverlay_();
        return onLoginSuccess_(profile);
      }).catch(showError_);
    });

    document.getElementById('btn-new-report').addEventListener('click', function () {
      startNewReport_();
    });
    document.getElementById('btn-search').addEventListener('click', function () {
      document.getElementById('search-keyword').value = '';
      document.getElementById('search-filter-equipment').value = '';
      document.getElementById('search-filter-maker').value = '';
      document.getElementById('search-result-list').innerHTML = '';
      showScreen_('screen-search');
    });
    document.getElementById('open-in-browser-link').addEventListener('click', function (e) {
      e.preventDefault();
      if (window.liff && liff.isInClient && liff.isInClient()) {
        liff.openWindow({ url: location.href, external: true });
      } else {
        window.open(location.href, '_blank');
      }
    });

    document.querySelectorAll('[data-back]').forEach(function (btn) {
      btn.addEventListener('click', function () { showScreen_(btn.getAttribute('data-back')); });
    });
    document.querySelectorAll('[data-next]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var step = btn.getAttribute('data-validate');
        var ok = true;
        if (step === '1') ok = validateStep1_();
        else if (step === '2') ok = validateStep2_();
        else if (step === '3') ok = validateStep3_();
        if (!ok) return;
        showScreen_(btn.getAttribute('data-next'));
      });
    });

    document.getElementById('btn-add-part').addEventListener('click', function () {
      formData.parts.push({ name: '', qty: 1, unitPrice: 0 });
      renderPartsList_();
    });

    document.getElementById('btn-gps').addEventListener('click', function () {
      if (!navigator.geolocation) { alert('この端末では位置情報を取得できません。'); return; }
      showOverlay_('現在地を取得中...');
      navigator.geolocation.getCurrentPosition(function (pos) {
        formData.lat = pos.coords.latitude;
        formData.lng = pos.coords.longitude;
        runServer_('getAddressFromLatLng', idToken, formData.lat, formData.lng).then(function (address) {
          hideOverlay_();
          if (address) document.getElementById('f-address').value = address;
          else alert('住所への変換に失敗しました。お手数ですが住所欄に手入力してください。');
        }).catch(function () {
          hideOverlay_();
          alert('住所への変換に失敗しました。お手数ですが住所欄に手入力してください。');
        });
      }, function (err) {
        hideOverlay_();
        alert('位置情報の取得に失敗しました: ' + err.message);
      }, { enableHighAccuracy: true, timeout: 10000 });
    });

    document.getElementById('btn-go-confirm').addEventListener('click', function () {
      if (!validateStep6_()) return;
      renderConfirm_();
      showScreen_('screen-confirm');
    });

    document.getElementById('btn-submit-report').addEventListener('click', function () {
      var btn = document.getElementById('btn-submit-report');
      btn.disabled = true;
      showScreen_('screen-sending');
      runServer_('saveReport', idToken, formData).then(function (result) {
        document.getElementById('done-receipt-no').textContent = '受付番号 ' + result.receiptNo;
        document.getElementById('done-pdf-link').href = result.pdfUrl;
        showScreen_('screen-done');
        btn.disabled = false;
      }).catch(function (err) {
        btn.disabled = false;
        showError_(err);
      });
    });

    document.getElementById('btn-close-app').addEventListener('click', function () {
      if (window.liff && liff.isInClient()) liff.closeWindow();
    });
    document.getElementById('btn-back-home').addEventListener('click', function () {
      showDashboard_();
    });
    document.getElementById('btn-error-retry').addEventListener('click', function () {
      location.reload();
    });

    document.getElementById('btn-search-submit').addEventListener('click', function () {
      // 設備名称・メーカーの絞り込みは、既存の自由語検索(全語AND一致)にキーワードとして
      // 追加する形で実現している(バックエンドの検索ロジックはPhase1のものをそのまま再利用)。
      var parts = [
        document.getElementById('search-keyword').value.trim(),
        document.getElementById('search-filter-equipment').value,
        document.getElementById('search-filter-maker').value
      ].filter(function (s) { return s !== ''; });
      var keyword = parts.join(' ');
      showOverlay_('検索中...');
      runServer_('searchPastReports', idToken, keyword).then(function (results) {
        hideOverlay_();
        searchResults_ = results;
        renderSearchResults_();
      }).catch(showError_);
    });
  });

  window.addEventListener('load', initApp_);
