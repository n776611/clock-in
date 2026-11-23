// ================= 系統設定區 =================
const APP_VERSION = "v2.1.1 (2026-11-23)";
const LIFF_ID = "2012759776-EMPr4Tf7";
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxZQWXJuKsdNbztDLbBvonZZ6UBhZ54J9Hd7uM3-Yl44Kyiw6g3-RD6Mqxo4ybe9r_X/exec";
// ==============================================

let lineUserId = "";
let boundEmpName = "";
let autoPunchType = null;

function startLiveClock() {
  const clockEl = document.getElementById('liveClock');
  const update = () => {
    const now = new Date();
    clockEl.innerText = now.toLocaleTimeString('zh-TW', { hour12: false });
  };
  update();
  setInterval(update, 1000);
}

window.onload = async function () {
  startLiveClock();
  document.getElementById('versionFooter').innerText = `Version ${APP_VERSION}`;

  const urlParams = new URLSearchParams(window.location.search);
  const rawType = (urlParams.get('type') || "").toLowerCase();
  if (rawType === "in") autoPunchType = "上班";
  if (rawType === "out") autoPunchType = "下班";

  // 階段一：初始化 LINE LIFF
  let profile;
  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }
    profile = await liff.getProfile();
    lineUserId = profile.userId;
  } catch (err) {
    updateStatus("err", "LINE LIFF 驗證失敗：" + err.message);
    return;
  }

  // 階段二：連線 Google Apps Script 查詢綁定狀態
  try {
    updateStatus("loading", "正在驗證員工綁定狀態...");
    // 加上時間戳避免 iOS 快取 GET 請求，並明確指定 follow 重導向
    const queryUrl = `${GAS_API_URL}?userId=${encodeURIComponent(lineUserId)}&_t=${Date.now()}`;
    const res = await fetch(queryUrl, {
      method: "GET",
      redirect: "follow"
    });

    if (!res.ok) {
      throw new Error(`HTTP 狀態碼 ${res.status}`);
    }

    const userData = await res.json();
    const badgeEl = document.getElementById('userBadge');

    if (userData.boundName) {
      boundEmpName = userData.boundName;
      badgeEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> ${boundEmpName}`;

      if (autoPunchType === "上班" || autoPunchType === "下班") {
        executePunch(autoPunchType);
      } else {
        updateStatus("ok", "身分驗證通過，請選擇打卡項目");
        showManualButtons();
      }
    } else {
      badgeEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500"></span> ${profile.displayName} (尚未綁定)`;
      
      const select = document.getElementById('empName');
      userData.unboundNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.innerText = name;
        select.appendChild(opt);
      });

      document.getElementById('bindSection').classList.remove('hidden');
      showManualButtons();

      const btnIn = document.getElementById('btnIn');
      const btnOut = document.getElementById('btnOut');

      if (autoPunchType === "上班") {
        btnOut.classList.add('hidden');
        btnIn.classList.remove('col-span-1');
        btnIn.classList.add('col-span-2');
        btnIn.querySelector('span').innerText = "確認綁定並打上班卡";
      } else if (autoPunchType === "下班") {
        btnIn.classList.add('hidden');
        btnOut.classList.remove('col-span-1');
        btnOut.classList.add('col-span-2');
        btnOut.querySelector('span').innerText = "確認綁定並打下班卡";
      }

      updateStatus("loading", "請先在上方選擇你的姓名，再點擊確認按鈕");
    }
  } catch (err) {
    updateStatus("err", "後端資料庫連線失敗：" + err.message);
  }
};

function showManualButtons() {
  const btns = document.getElementById('manualBtns');
  btns.classList.remove('hidden');
  btns.classList.add('grid');
}

function hideManualButtons() {
  const btns = document.getElementById('manualBtns');
  btns.classList.add('hidden');
  btns.classList.remove('grid');
}

function executePunch(punchType) {
  const selectedName = boundEmpName || document.getElementById('empName').value;
  if (!selectedName) {
    alert("請先選擇你的姓名！");
    return;
  }

  hideManualButtons();
  updateStatus("loading", `正在取得 GPS 定位並執行【${punchType}】打卡...`);

  if (!navigator.geolocation) {
    updateStatus("err", "你的手機不支援 GPS 定位功能");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async function (position) {
      try {
        const payload = {
          userId: lineUserId,
          empName: selectedName,
          punchType: punchType,
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        // 使用 text/plain 避開 iOS Safari CORS Preflight 預檢阻擋
        const response = await fetch(GAS_API_URL, {
          method: "POST",
          redirect: "follow",
          headers: {
            "Content-Type": "text/plain;charset=utf-8"
          },
          body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (result.success) {
          const cleanMsg = result.message.replace(/^✅\s*/, "");
          updateStatus("ok", cleanMsg);

          if (liff.isInClient()) {
            try {
              await liff.sendMessages([{ type: 'text', text: result.message }]);
            } catch (msgErr) {}
          }

          setTimeout(() => {
            if (liff.isInClient()) liff.closeWindow();
          }, 1600);
        } else {
          const cleanErr = result.message.replace(/^(📍|🚫|⚠️|❌)\s*/, "");
          updateStatus("err", cleanErr);
          showManualButtons();
        }
      } catch (e) {
        updateStatus("err", "網路連線異常，請重試：" + e.message);
        showManualButtons();
      }
    },
    function (error) {
      updateStatus("err", "無法取得 GPS 定位！請確認手機已開啟「定位服務」並允許存取位置。");
      showManualButtons();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function updateStatus(type, msg) {
  const box = document.getElementById('statusBox');
  const iconEl = document.getElementById('statusIcon');
  const textEl = document.getElementById('statusText');

  box.className = `status-card status-${type} rounded-2xl p-4 mb-5 text-sm font-medium leading-relaxed flex items-start gap-3`;
  textEl.innerText = msg;

  if (type === "loading") {
    iconEl.innerHTML = `<div class="spinner"></div>`;
  } else if (type === "ok") {
    iconEl.innerHTML = `<svg class="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  } else if (type === "err") {
    iconEl.innerHTML = `<svg class="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  }
}