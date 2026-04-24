const configKeys = {
  gatewayBase: "gatewayCounting.gatewayBase",
  statusPath: "gatewayCounting.statusPath",
  controlPath: "gatewayCounting.controlPath",
  cameraName: "gatewayCounting.cameraName",
  cameraStream: "gatewayCounting.cameraStream",
  authToken: "gatewayCounting.authToken",
};

const state = {
  connected: false,
  pollingTimer: null,
  lastError: "",
};

const elements = {
  onlineStatus: document.querySelector("#onlineStatus"),
  gatewayBase: document.querySelector("#gatewayBase"),
  statusPath: document.querySelector("#statusPath"),
  controlPath: document.querySelector("#controlPath"),
  cameraName: document.querySelector("#cameraName"),
  cameraStream: document.querySelector("#cameraStream"),
  authToken: document.querySelector("#authToken"),
  connectButton: document.querySelector("#connectButton"),
  cameraVideo: document.querySelector("#cameraVideo"),
  cameraImage: document.querySelector("#cameraImage"),
  cameraPlaceholder: document.querySelector("#cameraPlaceholder"),
  cameraState: document.querySelector("#cameraState"),
  countValue: document.querySelector("#countValue"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  runState: document.querySelector(".run-state"),
  runText: document.querySelector("#runText"),
  gatewayState: document.querySelector("#gatewayState"),
  cameraModel: document.querySelector("#cameraModel"),
  counterState: document.querySelector("#counterState"),
  lastUpdate: document.querySelector("#lastUpdate"),
};

function loadConfig() {
  elements.gatewayBase.value =
    localStorage.getItem(configKeys.gatewayBase) || "http://192.168.1.100:8080";
  elements.statusPath.value = localStorage.getItem(configKeys.statusPath) || "/api/status";
  elements.controlPath.value = localStorage.getItem(configKeys.controlPath) || "/api/control";
  elements.cameraName.value = localStorage.getItem(configKeys.cameraName) || "";
  elements.cameraStream.value = localStorage.getItem(configKeys.cameraStream) || "";
  elements.authToken.value = localStorage.getItem(configKeys.authToken) || "";
}

function saveConfig() {
  Object.entries(configKeys).forEach(([field, key]) => {
    localStorage.setItem(key, elements[field].value.trim());
  });
}

function joinUrl(base, path) {
  const cleanBase = base.trim().replace(/\/+$/, "");
  const cleanPath = path.trim().replace(/^\/?/, "/");
  return `${cleanBase}${cleanPath}`;
}

function headers() {
  const token = elements.authToken.value.trim();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` } : {}),
  };
}

function formatTime(value) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function normalizeStatus(raw) {
  const data = raw?.data && typeof raw.data === "object" ? raw.data : raw;
  return {
    count: data.count ?? data.total ?? data.bagCount ?? data.quantity ?? "--",
    running: Boolean(data.running ?? data.isRunning ?? data.beltRunning),
    cameraOnline: Boolean(data.cameraOnline ?? data.camera?.online ?? data.cameraStatus === "online"),
    counterOnline: data.counterOnline ?? data.counter?.online ?? true,
    updatedAt: data.updatedAt ?? data.lastUpdate ?? data.time ?? new Date().toISOString(),
    cameraName: data.cameraName ?? data.camera?.name,
    streamUrl: data.streamUrl ?? data.camera?.streamUrl,
  };
}

function setConnection(connected, message = "") {
  state.connected = connected;
  elements.onlineStatus.textContent = connected ? "已连接" : "未连接";
  elements.onlineStatus.classList.toggle("offline", !connected);
  elements.gatewayState.textContent = connected ? "在线" : message || "未连接";
  elements.connectButton.textContent = connected ? "重新连接" : "连接网关";
  elements.startButton.disabled = !connected;
  elements.stopButton.disabled = !connected;
}

function renderStatus(status) {
  elements.countValue.textContent = status.count;
  elements.runState.classList.toggle("running", status.running);
  elements.runText.textContent = status.running ? "运行中" : "已停止";
  elements.counterState.textContent = status.counterOnline ? "正常计数" : "计数程序离线";
  elements.lastUpdate.textContent = formatTime(status.updatedAt);

  if (status.cameraName) {
    elements.cameraName.value = status.cameraName;
  }

  if (status.streamUrl && !elements.cameraStream.value.trim()) {
    elements.cameraStream.value = status.streamUrl;
  }

  renderCamera();
}

function renderCamera() {
  const streamUrl = elements.cameraStream.value.trim();
  const cameraName = elements.cameraName.value.trim();
  elements.cameraModel.textContent = cameraName || "未指定";

  elements.cameraVideo.removeAttribute("src");
  elements.cameraImage.removeAttribute("src");
  elements.cameraVideo.style.display = "none";
  elements.cameraImage.style.display = "none";
  elements.cameraPlaceholder.style.display = "flex";

  if (!streamUrl) {
    elements.cameraState.textContent = "摄像头未连接";
    return;
  }

  if (/^rtsp:\/\//i.test(streamUrl)) {
    elements.cameraState.textContent = "RTSP需网关转码";
    elements.cameraPlaceholder.querySelector("strong").textContent = "浏览器不能直接播放 RTSP";
    elements.cameraPlaceholder.querySelector("span").textContent =
      "请让网关输出 HLS、MJPEG 或 WebRTC 地址";
    return;
  }

  elements.cameraPlaceholder.style.display = "none";

  if (/\.(mjpg|mjpeg)(\?|$)/i.test(streamUrl) || /mjpeg|snapshot|jpg/i.test(streamUrl)) {
    elements.cameraImage.src = streamUrl;
    elements.cameraImage.style.display = "block";
    elements.cameraState.textContent = "MJPEG/图片流";
    return;
  }

  elements.cameraVideo.src = streamUrl;
  elements.cameraVideo.style.display = "block";
  elements.cameraVideo.play().catch(() => {
    elements.cameraState.textContent = "视频流需手动播放";
  });
  elements.cameraState.textContent = "视频流";
}

async function fetchStatus() {
  const gateway = elements.gatewayBase.value.trim();
  if (!gateway) {
    setConnection(false, "缺少网关地址");
    return;
  }

  try {
    const response = await fetch(joinUrl(gateway, elements.statusPath.value), {
      method: "GET",
      headers: headers(),
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();
    const status = normalizeStatus(json);
    setConnection(true);
    renderStatus(status);
  } catch (error) {
    state.lastError = error.message;
    setConnection(false, "连接失败");
    elements.counterState.textContent = error.message.includes("Failed to fetch")
      ? "无法访问网关或被CORS拦截"
      : error.message;
  }
}

function startPolling() {
  window.clearInterval(state.pollingTimer);
  state.pollingTimer = window.setInterval(fetchStatus, 1500);
}

async function sendControl(action) {
  if (!state.connected) return;

  try {
    const response = await fetch(joinUrl(elements.gatewayBase.value, elements.controlPath.value), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await fetchStatus();
  } catch (error) {
    elements.counterState.textContent = `控制失败：${error.message}`;
  }
}

function connectGateway() {
  saveConfig();
  renderCamera();
  fetchStatus();
  startPolling();
}

elements.connectButton.addEventListener("click", connectGateway);
elements.startButton.addEventListener("click", () => sendControl("start"));
elements.stopButton.addEventListener("click", () => sendControl("stop"));
elements.cameraStream.addEventListener("change", () => {
  saveConfig();
  renderCamera();
});
elements.cameraName.addEventListener("change", saveConfig);

loadConfig();
setConnection(false);
renderCamera();
