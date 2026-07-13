  /**
   * 音声入力(Web Speech API)。
   * 注意: iOS版LINEアプリ内ブラウザ(WKWebView)は SpeechRecognition 非対応の場合が多い。
   * Android版LINEアプリ(Chrome系 WebView)では利用できることが多い。
   * 非対応の端末では🎤ボタン押下時に手入力を促すメッセージを表示する。
   */
  var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  var activeRecognition = null;
  var activeMicBtn = null;

  function isVoiceInputSupported_() {
    return !!SpeechRecognitionCtor;
  }

  function startVoiceInput_(targetId, btnEl) {
    if (!isVoiceInputSupported_()) {
      alert('この端末では音声入力がご利用いただけません。お手数ですがキーボードで入力してください。');
      return;
    }
    if (activeRecognition) {
      activeRecognition.stop();
      return;
    }
    var recognition = new SpeechRecognitionCtor();
    recognition.lang = 'ja-JP';
    recognition.interimResults = false;
    recognition.continuous = false;

    activeRecognition = recognition;
    activeMicBtn = btnEl;
    btnEl.classList.add('recording');

    recognition.onresult = function (event) {
      var transcript = event.results[0][0].transcript;
      var textarea = document.getElementById(targetId);
      textarea.value = textarea.value ? (textarea.value + '\n' + transcript) : transcript;
    };
    recognition.onerror = function (event) {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        alert('音声入力でエラーが発生しました: ' + event.error);
      }
    };
    recognition.onend = function () {
      btnEl.classList.remove('recording');
      activeRecognition = null;
      activeMicBtn = null;
    };
    recognition.start();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.mic-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        startVoiceInput_(btn.getAttribute('data-target'), btn);
      });
    });
  });
