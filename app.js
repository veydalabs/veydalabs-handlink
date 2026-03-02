const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = {
  setup: document.getElementById("panel-setup"),
  control: document.getElementById("panel-control"),
};

const boardSelect = document.getElementById("board-select");
const portSelect = document.getElementById("port-select");
const detectBtn = document.getElementById("detect-btn");
const connectBtn = document.getElementById("connect-btn");
const disconnectBtn = document.getElementById("disconnect-btn");

const statusText = document.getElementById("status-text");
const supportText = document.getElementById("support-text");
const connectionText = document.getElementById("connection-text");
const deviceText = document.getElementById("device-text");

const servoCalibrationList = document.getElementById("servo-calibration-list");
const saveCalibrationBtn = document.getElementById("save-calibration-btn");
const calibrationSaveStatus = document.getElementById("calibration-save-status");

const controlGate = document.getElementById("control-gate");
const controlConfirmBtn = document.getElementById("control-confirm-btn");
const controlGateStatus = document.getElementById("control-gate-status");
const controlWorkspace = document.getElementById("control-workspace");
const controlStartBtn = document.getElementById("control-start-btn");
const controlStopBtn = document.getElementById("control-stop-btn");
const controlCameraToggle = document.getElementById("control-camera-toggle");
const controlStatusText = document.getElementById("control-status-text");
const controlCanvas = document.getElementById("control-canvas");
const controlVideo = document.getElementById("control-video");
const controlServoReadout = document.getElementById("control-servo-readout");
const controlCanvasCtx = controlCanvas ? controlCanvas.getContext("2d") : null;

const encoder = new TextEncoder();
const STEP_DEGREES = 5;
const CALIBRATION_STORAGE_KEY = "veydalabs-handlink.manualCalibration.v1";
const SERVO_MIN_ANGLE = 15;
const SERVO_MAX_ANGLE = 165;

const CONTROL_CAMERA_WIDTH = 1280;
const CONTROL_CAMERA_HEIGHT = 720;
const CONTROL_SEND_RATE_HZ = 30;
const CONTROL_SEND_INTERVAL_MS = 1000 / CONTROL_SEND_RATE_HZ;
const CONTROL_SMOOTHING_ALPHA = 0.35;

const fingerOptions = [
  { value: "thumb", label: "Thumb" },
  { value: "index", label: "Index Finger" },
  { value: "middle", label: "Middle Finger" },
  { value: "ring", label: "Ring Finger" },
  { value: "pinky", label: "Pinky" },
];
const fingerOrder = fingerOptions.map((option) => option.value);
const defaultFingerAssignments = [...fingerOrder];

const FINGER_TRIPLETS = [
  [1, 2, 4],
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
];
const PALM_CONNECTIONS = [
  [0, 5],
  [5, 9],
  [9, 13],
  [13, 17],
  [17, 0],
];
const FINGER_DRAW_GROUPS = [
  {
    color: "#ffb366",
    landmarkIndices: [1, 2, 3, 4],
    connections: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    color: "#7dd3fc",
    landmarkIndices: [5, 6, 7, 8],
    connections: [[0, 5], [5, 6], [6, 7], [7, 8]],
  },
  {
    color: "#86efac",
    landmarkIndices: [9, 10, 11, 12],
    connections: [[0, 9], [9, 10], [10, 11], [11, 12]],
  },
  {
    color: "#c4b5fd",
    landmarkIndices: [13, 14, 15, 16],
    connections: [[0, 13], [13, 14], [14, 15], [15, 16]],
  },
  {
    color: "#f9a8d4",
    landmarkIndices: [17, 18, 19, 20],
    connections: [[0, 17], [17, 18], [18, 19], [19, 20]],
  },
];

const servoMeta = [
  { code: "S1" },
  { code: "S2" },
  { code: "S3" },
  { code: "S4" },
  { code: "S5" },
];

const boardProfiles = {
  arduino_uno: {
    label: "Arduino Uno",
    baudRate: 115200,
    // Includes official Uno IDs and common clone USB-UART chips.
    filters: [
      { usbVendorId: 0x2341 },
      { usbVendorId: 0x2a03 },
      { usbVendorId: 0x1a86 },
      { usbVendorId: 0x10c4 },
      { usbVendorId: 0x0403 },
    ],
  },
};

const serialState = {
  ports: [],
  selectedIndex: -1,
  activePort: null,
  isConnected: false,
};

const calibrationState = {
  currentAngles: [90, 90, 90, 90, 90],
  extendedValues: [null, null, null, null, null],
  closedValues: [null, null, null, null, null],
  fingerAssignments: [...defaultFingerAssignments],
  cardRefs: [],
  lastSavedAt: null,
};

const controlState = {
  hasConfirmed: false,
  isTracking: false,
  cameraVisible: true,
  cameraWidth: CONTROL_CAMERA_WIDTH,
  cameraHeight: CONTROL_CAMERA_HEIGHT,
  stream: null,
  hands: null,
  rafId: 0,
  processingFrame: false,
  lastResults: null,
  lastSendAtMs: 0,
  lastSentAngles: null,
  filteredAngles: null,
  readoutRefs: [],
};

let serialWriteQueue = Promise.resolve();

function controlCameraLabel() {
  return `${controlState.cameraWidth}x${controlState.cameraHeight}`;
}

function activateTab(targetName) {
  tabs.forEach((tab) => {
    const isActive = tab.dataset.target === targetName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  Object.entries(panels).forEach(([name, panel]) => {
    const isActive = name === targetName;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });

  if (targetName !== "control" && controlState.isTracking) {
    void stopHandControl("Hand control stopped while Control tab is hidden.");
  }
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.target));
});

function hasWebSerial() {
  return "serial" in navigator;
}

function hasMediaPipeRuntime() {
  return (
    typeof window.Hands === "function" &&
    typeof window.drawConnectors === "function" &&
    typeof window.drawLandmarks === "function"
  );
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function hexId(id) {
  if (typeof id !== "number") return "----";
  return `0x${id.toString(16).toUpperCase().padStart(4, "0")}`;
}

function boardForPort(info) {
  if (!info) return "Unknown";
  const vendor = info.usbVendorId;
  if (vendor === 0x2341 || vendor === 0x2a03) return "Arduino Uno";
  if (vendor === 0x1a86) return "Arduino-compatible (CH340)";
  if (vendor === 0x10c4) return "Arduino-compatible (CP210x)";
  if (vendor === 0x0403) return "Arduino-compatible (FTDI)";
  return "Serial device";
}

function formatPortLabel(port, index) {
  const info = port.getInfo?.() ?? {};
  return `${index + 1}. ${boardForPort(info)} [${hexId(info.usbVendorId)}:${hexId(info.usbProductId)}]`;
}

function setStatus(main, connection, device) {
  statusText.textContent = main;
  connectionText.textContent = connection;
  if (typeof device === "string") deviceText.textContent = device;
}

function setCalibrationSaveStatus(message, tone = "") {
  calibrationSaveStatus.textContent = message;
  calibrationSaveStatus.classList.remove("is-success", "is-error");
  if (tone === "success") calibrationSaveStatus.classList.add("is-success");
  if (tone === "error") calibrationSaveStatus.classList.add("is-error");
}

function setControlGateStatus(message, tone = "") {
  if (!controlGateStatus) return;
  const previousTone = controlGateStatus.dataset.tone ?? "";
  if (controlGateStatus.textContent === message && previousTone === tone) return;

  controlGateStatus.textContent = message;
  controlGateStatus.dataset.tone = tone;
  controlGateStatus.classList.remove("is-success", "is-error");
  if (tone === "success") controlGateStatus.classList.add("is-success");
  if (tone === "error") controlGateStatus.classList.add("is-error");
}

function setControlStatus(message, tone = "") {
  if (!controlStatusText) return;
  const previousTone = controlStatusText.dataset.tone ?? "";
  if (controlStatusText.textContent === message && previousTone === tone) return;

  controlStatusText.textContent = message;
  controlStatusText.dataset.tone = tone;
  controlStatusText.classList.remove("is-success", "is-error");
  if (tone === "success") controlStatusText.classList.add("is-success");
  if (tone === "error") controlStatusText.classList.add("is-error");
}

function isValidFingerAssignment(value) {
  return fingerOrder.includes(value);
}

function fingerLabel(value) {
  const found = fingerOptions.find((option) => option.value === value);
  return found ? found.label : "Unassigned";
}

function fingerOptionMarkup(selectedValue) {
  return fingerOptions
    .map((option) => {
      const selected = option.value === selectedValue ? " selected" : "";
      return `<option value="${option.value}"${selected}>${option.label}</option>`;
    })
    .join("");
}

function getCalibrationConfigurationError() {
  const usedAssignments = new Set();

  for (let i = 0; i < servoMeta.length; i += 1) {
    const extended = calibrationState.extendedValues[i];
    const closed = calibrationState.closedValues[i];
    const assignment = calibrationState.fingerAssignments[i];

    if (!Number.isInteger(extended) || extended < SERVO_MIN_ANGLE || extended > SERVO_MAX_ANGLE) {
      return `${servoMeta[i].code} needs a saved Fully Extended value (${SERVO_MIN_ANGLE}-${SERVO_MAX_ANGLE}).`;
    }

    if (!Number.isInteger(closed) || closed < SERVO_MIN_ANGLE || closed > SERVO_MAX_ANGLE) {
      return `${servoMeta[i].code} needs a saved Fully Closed value (${SERVO_MIN_ANGLE}-${SERVO_MAX_ANGLE}).`;
    }

    if (!isValidFingerAssignment(assignment)) {
      return `${servoMeta[i].code} needs a valid finger mapping.`;
    }

    if (usedAssignments.has(assignment)) {
      return "Each servo must be assigned to a unique finger before control can start.";
    }
    usedAssignments.add(assignment);
  }

  return null;
}

function getControlReadinessError() {
  if (!hasWebSerial()) {
    return "Web Serial is required for hardware control. Use desktop Chrome or Edge.";
  }

  if (!serialState.isConnected) {
    return "Connect your Arduino in Setup before entering control.";
  }

  const calibrationError = getCalibrationConfigurationError();
  if (calibrationError) {
    return calibrationError;
  }

  if (!hasMediaPipeRuntime()) {
    return "MediaPipe runtime failed to load. Refresh with internet access.";
  }

  return null;
}

function syncButtonState() {
  const supported = hasWebSerial();
  const hasPort = serialState.selectedIndex >= 0 && serialState.ports[serialState.selectedIndex];
  detectBtn.disabled = !supported || serialState.isConnected;
  connectBtn.disabled = !supported || serialState.isConnected || !hasPort;
  disconnectBtn.disabled = !supported || !serialState.isConnected;
  saveCalibrationBtn.disabled = !supported;

  calibrationState.cardRefs.forEach((refs) => {
    refs.downBtn.disabled = !serialState.isConnected;
    refs.upBtn.disabled = !serialState.isConnected;
  });

  const readinessError = getControlReadinessError();

  if (controlConfirmBtn) {
    controlConfirmBtn.disabled = controlState.hasConfirmed || Boolean(readinessError);
  }

  if (controlStartBtn) {
    controlStartBtn.disabled =
      !controlState.hasConfirmed ||
      controlState.isTracking ||
      Boolean(readinessError);
  }

  if (controlStopBtn) {
    controlStopBtn.disabled = !controlState.isTracking;
  }

  if (controlCameraToggle) {
    controlCameraToggle.disabled = !controlState.hasConfirmed;
  }

  if (!controlState.hasConfirmed) {
    if (readinessError) {
      setControlGateStatus(readinessError);
    } else {
      setControlGateStatus("Safety check passed. Click confirm to enter control.", "success");
    }
  }
}

function renderPortOptions() {
  portSelect.innerHTML = "";

  if (!serialState.ports.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No authorized ports yet";
    portSelect.appendChild(option);
    serialState.selectedIndex = -1;
    syncButtonState();
    return;
  }

  serialState.ports.forEach((port, idx) => {
    const option = document.createElement("option");
    option.value = String(idx);
    option.textContent = formatPortLabel(port, idx);
    portSelect.appendChild(option);
  });

  if (serialState.selectedIndex < 0 || serialState.selectedIndex >= serialState.ports.length) {
    serialState.selectedIndex = 0;
  }
  portSelect.value = String(serialState.selectedIndex);
  syncButtonState();
}

async function refreshAuthorizedPorts() {
  serialState.ports = await navigator.serial.getPorts();
  renderPortOptions();
}

function updateServoTitle(index) {
  const refs = calibrationState.cardRefs[index];
  if (!refs) return;
  refs.servoTitle.textContent = `${servoMeta[index].code} ${fingerLabel(calibrationState.fingerAssignments[index])}`;
}

function createServoCard(index) {
  const selectedFinger = calibrationState.fingerAssignments[index];

  const card = document.createElement("article");
  card.className = "servo-card";
  card.innerHTML = `
    <div class="servo-title-row">
      <h4 class="servo-title" data-role="servo-title"></h4>
      <p class="servo-angle"><span data-role="angle-value">90</span>°</p>
    </div>
    <div class="servo-map-row">
      <label class="servo-map-field">
        <span>Finger Mapping</span>
        <select class="servo-map-select" data-role="mapping-select">
          ${fingerOptionMarkup(selectedFinger)}
        </select>
      </label>
    </div>
    <div class="servo-meter" aria-hidden="true">
      <div class="servo-meter-fill" data-role="meter-fill"></div>
    </div>
    <div class="servo-move-row">
      <button class="servo-move-btn" data-role="down-btn" type="button">Down -5°</button>
      <button class="servo-move-btn" data-role="up-btn" type="button">Up +5°</button>
    </div>
    <div class="servo-cal-row">
      <label class="servo-cal-field">
        <span>Fully Extended</span>
        <input data-role="extended-input" type="number" min="15" max="165" step="1" placeholder="15-165">
      </label>
      <label class="servo-cal-field">
        <span>Fully Closed</span>
        <input data-role="closed-input" type="number" min="15" max="165" step="1" placeholder="15-165">
      </label>
    </div>
  `;

  servoCalibrationList.appendChild(card);

  const refs = {
    card,
    servoTitle: card.querySelector('[data-role="servo-title"]'),
    angleValue: card.querySelector('[data-role="angle-value"]'),
    meterFill: card.querySelector('[data-role="meter-fill"]'),
    downBtn: card.querySelector('[data-role="down-btn"]'),
    upBtn: card.querySelector('[data-role="up-btn"]'),
    mappingSelect: card.querySelector('[data-role="mapping-select"]'),
    extendedInput: card.querySelector('[data-role="extended-input"]'),
    closedInput: card.querySelector('[data-role="closed-input"]'),
  };

  refs.downBtn.addEventListener("click", async () => {
    await adjustServo(index, -STEP_DEGREES);
  });
  refs.upBtn.addEventListener("click", async () => {
    await adjustServo(index, STEP_DEGREES);
  });
  refs.mappingSelect.addEventListener("change", () => {
    const value = refs.mappingSelect.value;
    if (!isValidFingerAssignment(value)) {
      refs.mappingSelect.value = calibrationState.fingerAssignments[index];
      return;
    }
    calibrationState.fingerAssignments[index] = value;
    updateServoTitle(index);
    updateControlServoReadout();
    syncButtonState();
  });

  calibrationState.cardRefs[index] = refs;
  updateServoTitle(index);
}

function renderServoCards() {
  servoCalibrationList.innerHTML = "";
  calibrationState.cardRefs = [];
  for (let i = 0; i < servoMeta.length; i += 1) {
    createServoCard(i);
  }
}

function updateServoCard(index) {
  const refs = calibrationState.cardRefs[index];
  if (!refs) return;

  const angle = calibrationState.currentAngles[index];
  const angleSpan = SERVO_MAX_ANGLE - SERVO_MIN_ANGLE;
  const meterPercent = Math.round(((angle - SERVO_MIN_ANGLE) / angleSpan) * 100);
  refs.angleValue.textContent = String(angle);
  refs.meterFill.style.width = `${clamp(meterPercent, 0, 100)}%`;
}

function updateAllServoCards() {
  for (let i = 0; i < servoMeta.length; i += 1) {
    updateServoCard(i);
    updateServoTitle(i);
  }
}

function applyCalibrationValuesToInputs() {
  for (let i = 0; i < servoMeta.length; i += 1) {
    const refs = calibrationState.cardRefs[i];
    if (!refs) continue;

    refs.extendedInput.value =
      Number.isInteger(calibrationState.extendedValues[i]) ? String(calibrationState.extendedValues[i]) : "";
    refs.closedInput.value =
      Number.isInteger(calibrationState.closedValues[i]) ? String(calibrationState.closedValues[i]) : "";
    refs.mappingSelect.value = calibrationState.fingerAssignments[i];
  }
}

function loadCalibrationFromStorage() {
  let parsed;
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return;
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (!parsed || typeof parsed !== "object") return;

  if (Array.isArray(parsed.currentAngles) && parsed.currentAngles.length === servoMeta.length) {
    parsed.currentAngles.forEach((value, idx) => {
      if (Number.isFinite(value)) {
        calibrationState.currentAngles[idx] = clamp(Math.round(value), SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);
      }
    });
  }

  if (Array.isArray(parsed.extendedValues) && parsed.extendedValues.length === servoMeta.length) {
    parsed.extendedValues.forEach((value, idx) => {
      if (Number.isFinite(value)) {
        calibrationState.extendedValues[idx] = clamp(Math.round(value), SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);
      }
    });
  }

  if (Array.isArray(parsed.closedValues) && parsed.closedValues.length === servoMeta.length) {
    parsed.closedValues.forEach((value, idx) => {
      if (Number.isFinite(value)) {
        calibrationState.closedValues[idx] = clamp(Math.round(value), SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);
      }
    });
  }

  if (Array.isArray(parsed.fingerAssignments) && parsed.fingerAssignments.length === servoMeta.length) {
    parsed.fingerAssignments.forEach((value, idx) => {
      if (typeof value === "string" && isValidFingerAssignment(value)) {
        calibrationState.fingerAssignments[idx] = value;
      }
    });
  }

  if (typeof parsed.lastSavedAt === "string") {
    calibrationState.lastSavedAt = parsed.lastSavedAt;
  }
}

function persistCalibration() {
  const payload = {
    currentAngles: calibrationState.currentAngles,
    extendedValues: calibrationState.extendedValues,
    closedValues: calibrationState.closedValues,
    fingerAssignments: calibrationState.fingerAssignments,
    lastSavedAt: new Date().toISOString(),
  };
  localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(payload));
  calibrationState.lastSavedAt = payload.lastSavedAt;
}

function showLoadedCalibrationStatus() {
  if (!calibrationState.lastSavedAt) {
    setCalibrationSaveStatus("No saved calibration yet.");
    return;
  }

  const timestamp = new Date(calibrationState.lastSavedAt);
  if (Number.isNaN(timestamp.getTime())) {
    setCalibrationSaveStatus("Loaded saved calibration.");
    return;
  }

  setCalibrationSaveStatus(`Loaded saved calibration (${timestamp.toLocaleString()}).`, "success");
}

function parseCalibrationInputs() {
  const nextExtended = [];
  const nextClosed = [];
  const nextFingerAssignments = [];

  for (let i = 0; i < servoMeta.length; i += 1) {
    const refs = calibrationState.cardRefs[i];
    const extendedRaw = refs.extendedInput.value.trim();
    const closedRaw = refs.closedInput.value.trim();
    const fingerAssignment = refs.mappingSelect.value;

    const extended = Number.parseInt(extendedRaw, 10);
    const closed = Number.parseInt(closedRaw, 10);

    if (!Number.isInteger(extended) || extended < SERVO_MIN_ANGLE || extended > SERVO_MAX_ANGLE) {
      throw new Error(
        `${servoMeta[i].code} requires a valid Fully Extended value (${SERVO_MIN_ANGLE}-${SERVO_MAX_ANGLE}).`
      );
    }
    if (!Number.isInteger(closed) || closed < SERVO_MIN_ANGLE || closed > SERVO_MAX_ANGLE) {
      throw new Error(
        `${servoMeta[i].code} requires a valid Fully Closed value (${SERVO_MIN_ANGLE}-${SERVO_MAX_ANGLE}).`
      );
    }
    if (!isValidFingerAssignment(fingerAssignment)) {
      throw new Error(`${servoMeta[i].code} requires a finger mapping.`);
    }

    nextExtended.push(extended);
    nextClosed.push(closed);
    nextFingerAssignments.push(fingerAssignment);
  }

  if (new Set(nextFingerAssignments).size !== nextFingerAssignments.length) {
    throw new Error("Each servo must be assigned to a unique finger.");
  }

  return { nextExtended, nextClosed, nextFingerAssignments };
}

function queueSerialWrite(line) {
  const task = serialWriteQueue.then(async () => {
    const port = serialState.activePort;
    if (!port || !serialState.isConnected || !port.writable) {
      throw new Error("device is not connected");
    }

    const writer = port.writable.getWriter();
    try {
      await writer.write(encoder.encode(line));
    } finally {
      writer.releaseLock();
    }
  });

  serialWriteQueue = task.catch(() => {});
  return task;
}

async function sendCurrentServoPose() {
  const command = `A ${calibrationState.currentAngles.join(" ")}\n`;
  await queueSerialWrite(command);
}

async function adjustServo(index, delta) {
  if (!serialState.isConnected) {
    setStatus("Connect device to move servos", "Disconnected", "None");
    return;
  }

  const nextAngle = clamp(calibrationState.currentAngles[index] + delta, SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);
  if (nextAngle === calibrationState.currentAngles[index]) return;

  calibrationState.currentAngles[index] = nextAngle;
  updateServoCard(index);
  updateControlServoReadout();

  try {
    await sendCurrentServoPose();
    setStatus(
      `Moved ${servoMeta[index].code} (${fingerLabel(calibrationState.fingerAssignments[index])}) to ${nextAngle}°`,
      "Connected",
      deviceText.textContent
    );
  } catch (error) {
    setStatus(`Move failed: ${error.message}`, "Connected", deviceText.textContent);
  }
}

function handleSaveCalibrationClick() {
  let parsed;
  try {
    parsed = parseCalibrationInputs();
  } catch (error) {
    setCalibrationSaveStatus(error.message, "error");
    return;
  }

  calibrationState.extendedValues = parsed.nextExtended;
  calibrationState.closedValues = parsed.nextClosed;
  calibrationState.fingerAssignments = parsed.nextFingerAssignments;
  persistCalibration();
  updateAllServoCards();
  updateControlServoReadout();

  const timestamp = new Date(calibrationState.lastSavedAt);
  setCalibrationSaveStatus(`Calibration saved (${timestamp.toLocaleString()}).`, "success");
  syncButtonState();
}

function renderControlServoReadout() {
  if (!controlServoReadout) return;

  controlServoReadout.innerHTML = "";
  controlState.readoutRefs = [];

  for (let i = 0; i < servoMeta.length; i += 1) {
    const row = document.createElement("li");
    row.className = "control-servo-row";
    row.innerHTML = `
      <span class="control-servo-label" data-role="label"></span>
      <span class="control-servo-angle" data-role="angle"></span>
    `;

    controlServoReadout.appendChild(row);
    controlState.readoutRefs[i] = {
      label: row.querySelector('[data-role="label"]'),
      angle: row.querySelector('[data-role="angle"]'),
    };
  }
}

function updateControlServoReadout() {
  if (!controlState.readoutRefs.length) return;

  for (let i = 0; i < servoMeta.length; i += 1) {
    const refs = controlState.readoutRefs[i];
    if (!refs) continue;

    refs.label.textContent = `${servoMeta[i].code} ${fingerLabel(calibrationState.fingerAssignments[i])}`;
    refs.angle.textContent = `${calibrationState.currentAngles[i]}°`;
  }
}

function drawControlBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0b1621");
  gradient.addColorStop(1, "#061019");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(67, 103, 132, 0.18)";
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawFingerCodedHand(ctx, landmarks) {
  window.drawConnectors(ctx, landmarks, PALM_CONNECTIONS, {
    color: "#a6bfd8",
    lineWidth: 3,
  });

  window.drawLandmarks(ctx, [landmarks[0]], {
    color: "#dcecff",
    fillColor: "#dcecff",
    lineWidth: 1,
    radius: 5,
  });

  FINGER_DRAW_GROUPS.forEach((group) => {
    window.drawConnectors(ctx, landmarks, group.connections, {
      color: group.color,
      lineWidth: 4,
    });
    window.drawLandmarks(
      ctx,
      group.landmarkIndices.map((index) => landmarks[index]),
      {
        color: group.color,
        fillColor: group.color,
        lineWidth: 1,
        radius: 4,
      }
    );
  });
}

function resizeControlCanvasToVideo() {
  if (!controlCanvas || !controlVideo) return;

  const width = controlVideo.videoWidth || CONTROL_CAMERA_WIDTH;
  const height = controlVideo.videoHeight || CONTROL_CAMERA_HEIGHT;

  if (controlCanvas.width !== width || controlCanvas.height !== height) {
    controlCanvas.width = width;
    controlCanvas.height = height;
  }
}

function drawControlFrame(results) {
  if (!controlCanvasCtx || !controlCanvas) return;

  const width = controlCanvas.width;
  const height = controlCanvas.height;
  const landmarks = results?.multiHandLandmarks?.[0] ?? null;

  controlCanvasCtx.save();
  controlCanvasCtx.translate(width, 0);
  controlCanvasCtx.scale(-1, 1);

  if (controlState.cameraVisible && results?.image) {
    controlCanvasCtx.drawImage(results.image, 0, 0, width, height);
  } else {
    drawControlBackground(controlCanvasCtx, width, height);
  }

  if (landmarks && hasMediaPipeRuntime()) {
    drawFingerCodedHand(controlCanvasCtx, landmarks);
  }

  controlCanvasCtx.restore();

  controlCanvasCtx.fillStyle = "rgba(205, 223, 241, 0.9)";
  controlCanvasCtx.font = '17px "JetBrains Mono", "Cascadia Mono", monospace';
  const overlayLabel = controlState.isTracking ? (landmarks ? "Tracking" : "No hand detected") : "Control idle";
  controlCanvasCtx.fillText(overlayLabel, 18, 30);
}

function jointAngleDeg(a, b, c) {
  const baX = a.x - b.x;
  const baY = a.y - b.y;
  const baZ = a.z - b.z;
  const bcX = c.x - b.x;
  const bcY = c.y - b.y;
  const bcZ = c.z - b.z;

  const normBA = Math.hypot(baX, baY, baZ);
  const normBC = Math.hypot(bcX, bcY, bcZ);
  const denom = normBA * normBC;
  if (denom < 1e-9) return 180;

  const dot = baX * bcX + baY * bcY + baZ * bcZ;
  const cosAngle = clamp(dot / denom, -1, 1);
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

function mapAngleToCurl(angle, openDeg, closeDeg) {
  if (Math.abs(openDeg - closeDeg) < 1e-6) return 0;
  return clamp((openDeg - angle) / (openDeg - closeDeg), 0, 1);
}

function landmarkDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

function computeCurlsFromLandmarks(landmarks) {
  const thumbAngle = jointAngleDeg(landmarks[1], landmarks[2], landmarks[4]);
  const thumbCurlAngle = mapAngleToCurl(thumbAngle, 155, 70);

  const palmWidth = landmarkDistance(landmarks[5], landmarks[17]) + 1e-6;
  const thumbDist = landmarkDistance(landmarks[4], landmarks[5]) / palmWidth;
  const thumbCurlDist = clamp((1.05 - thumbDist) / (1.05 - 0.45), 0, 1);
  const thumbCurl = clamp(0.6 * thumbCurlAngle + 0.4 * thumbCurlDist, 0, 1);

  const curls = [thumbCurl];
  for (let i = 1; i < FINGER_TRIPLETS.length; i += 1) {
    const [mcp, pip, tip] = FINGER_TRIPLETS[i];
    const angle = jointAngleDeg(landmarks[mcp], landmarks[pip], landmarks[tip]);
    const curl = mapAngleToCurl(angle, 170, 65);
    curls.push(curl);
  }

  return curls;
}

function curlsToServoAngles(curls) {
  const curlsByFinger = {
    thumb: curls[0],
    index: curls[1],
    middle: curls[2],
    ring: curls[3],
    pinky: curls[4],
  };

  const output = [];
  for (let i = 0; i < servoMeta.length; i += 1) {
    const finger = calibrationState.fingerAssignments[i];
    const curl = curlsByFinger[finger] ?? 0;

    const extended = calibrationState.extendedValues[i];
    const closed = calibrationState.closedValues[i];
    const raw = extended + curl * (closed - extended);
    output.push(clamp(Math.round(raw), SERVO_MIN_ANGLE, SERVO_MAX_ANGLE));
  }

  return output;
}

async function maybeSendControlAngles(angles) {
  if (!serialState.isConnected) return;

  const now = performance.now();
  if (now - controlState.lastSendAtMs < CONTROL_SEND_INTERVAL_MS) return;
  controlState.lastSendAtMs = now;

  if (
    controlState.lastSentAngles &&
    controlState.lastSentAngles.length === angles.length &&
    angles.every((value, idx) => value === controlState.lastSentAngles[idx])
  ) {
    return;
  }

  const command = `A ${angles.join(" ")}\n`;
  try {
    await queueSerialWrite(command);
    controlState.lastSentAngles = [...angles];
  } catch (error) {
    setControlStatus(`Serial send failed: ${error.message}`, "error");
  }
}

function handleHandResults(results) {
  controlState.lastResults = results;
  drawControlFrame(results);

  const landmarks = results?.multiHandLandmarks?.[0];
  if (!landmarks) {
    setControlStatus(`Tracking active. No hand detected. Camera ${controlCameraLabel()}.`);
    return;
  }

  const curls = computeCurlsFromLandmarks(landmarks);
  const targetAngles = curlsToServoAngles(curls);

  if (!controlState.filteredAngles) {
    controlState.filteredAngles = targetAngles.map((value) => value);
  } else {
    controlState.filteredAngles = controlState.filteredAngles.map(
      (previous, index) => previous + CONTROL_SMOOTHING_ALPHA * (targetAngles[index] - previous)
    );
  }

  const smoothedAngles = controlState.filteredAngles.map((value) =>
    clamp(Math.round(value), SERVO_MIN_ANGLE, SERVO_MAX_ANGLE)
  );

  calibrationState.currentAngles = smoothedAngles;
  updateAllServoCards();
  updateControlServoReadout();

  void maybeSendControlAngles(smoothedAngles);
  setControlStatus(`Tracking active. Camera ${controlCameraLabel()}.`, "success");
}

async function processHandFrame() {
  if (!controlState.isTracking) return;

  if (controlVideo.readyState >= 2 && !controlState.processingFrame && controlState.hands) {
    controlState.processingFrame = true;
    try {
      await controlState.hands.send({ image: controlVideo });
    } catch (error) {
      setControlStatus(`Tracking error: ${error.message}`, "error");
    } finally {
      controlState.processingFrame = false;
    }
  }

  if (controlState.isTracking) {
    controlState.rafId = window.requestAnimationFrame(() => {
      void processHandFrame();
    });
  }
}

async function requestControlCameraStream() {
  const exact720p = {
    video: {
      width: { exact: CONTROL_CAMERA_WIDTH },
      height: { exact: CONTROL_CAMERA_HEIGHT },
      facingMode: "user",
    },
    audio: false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(exact720p);
  } catch {
    return navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: CONTROL_CAMERA_WIDTH },
        height: { ideal: CONTROL_CAMERA_HEIGHT },
        facingMode: "user",
      },
      audio: false,
    });
  }
}

async function startHandControl() {
  if (controlState.isTracking) return;

  const readinessError = getControlReadinessError();
  if (readinessError) {
    setControlStatus(readinessError, "error");
    syncButtonState();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setControlStatus("Camera API unavailable in this browser.", "error");
    return;
  }

  try {
    const stream = await requestControlCameraStream();

    controlVideo.srcObject = stream;
    await controlVideo.play();

    resizeControlCanvasToVideo();

    const hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      modelComplexity: 1,
      maxNumHands: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    hands.onResults(handleHandResults);

    controlState.stream = stream;
    controlState.hands = hands;
    controlState.isTracking = true;
    controlState.processingFrame = false;
    controlState.lastResults = null;
    controlState.lastSendAtMs = 0;
    controlState.lastSentAngles = null;
    controlState.filteredAngles = null;

    const trackSettings = stream.getVideoTracks()[0]?.getSettings?.() ?? {};
    const activeWidth = Math.round(Number(trackSettings.width) || controlVideo.videoWidth || CONTROL_CAMERA_WIDTH);
    const activeHeight = Math.round(Number(trackSettings.height) || controlVideo.videoHeight || CONTROL_CAMERA_HEIGHT);
    controlState.cameraWidth = activeWidth;
    controlState.cameraHeight = activeHeight;

    setControlStatus(`Tracking active. Show one hand to camera. Camera ${controlCameraLabel()}.`, "success");
    drawControlFrame(null);

    controlState.rafId = window.requestAnimationFrame(() => {
      void processHandFrame();
    });
  } catch (error) {
    setControlStatus(`Could not start hand control: ${error.message}`, "error");
    await stopHandControl("");
  }

  syncButtonState();
}

async function stopHandControl(reason = "Hand control stopped.") {
  const hadResources = Boolean(controlState.isTracking || controlState.stream || controlState.hands);

  controlState.isTracking = false;
  if (controlState.rafId) {
    window.cancelAnimationFrame(controlState.rafId);
    controlState.rafId = 0;
  }

  controlState.processingFrame = false;

  if (controlState.hands) {
    try {
      await controlState.hands.close();
    } catch {
      // Ignore cleanup errors.
    }
    controlState.hands = null;
  }

  if (controlState.stream) {
    controlState.stream.getTracks().forEach((track) => track.stop());
    controlState.stream = null;
  }

  if (controlVideo) {
    try {
      controlVideo.pause();
    } catch {
      // Ignore pause errors.
    }
    controlVideo.srcObject = null;
  }

  controlState.lastResults = null;
  controlState.lastSentAngles = null;
  controlState.filteredAngles = null;
  drawControlFrame(null);

  if (reason && hadResources) {
    setControlStatus(reason);
  }

  syncButtonState();
}

function handleControlConfirmClick() {
  const readinessError = getControlReadinessError();
  if (readinessError) {
    setControlGateStatus(readinessError, "error");
    return;
  }

  controlState.hasConfirmed = true;
  controlGate.hidden = true;
  controlWorkspace.hidden = false;
  controlState.cameraVisible = Boolean(controlCameraToggle?.checked);

  renderControlServoReadout();
  updateControlServoReadout();
  drawControlFrame(null);

  setControlStatus("Ready. Click Start Hand Control.");
  syncButtonState();
}

async function detectArduinoPort() {
  if (!hasWebSerial()) return;
  const selectedProfile = boardProfiles[boardSelect.value];

  setStatus("Scanning for device...", "Disconnected", "None");
  await refreshAuthorizedPorts();

  if (!serialState.ports.length) {
    try {
      const requested = await navigator.serial.requestPort({ filters: selectedProfile.filters });
      serialState.ports = [requested];
      serialState.selectedIndex = 0;
      renderPortOptions();
      setStatus("Device access granted", "Disconnected", formatPortLabel(requested, 0));
    } catch {
      setStatus("No device selected", "Disconnected", "None");
    }
    return;
  }

  const info = serialState.ports[0].getInfo?.() ?? {};
  setStatus("Device detected", "Disconnected", `${boardForPort(info)} ${hexId(info.usbVendorId)}:${hexId(info.usbProductId)}`);
}

async function connectPort() {
  if (!hasWebSerial()) return;
  const profile = boardProfiles[boardSelect.value];
  const port = serialState.ports[serialState.selectedIndex];
  if (!port) return;

  try {
    await port.open({ baudRate: profile.baudRate });
    serialState.activePort = port;
    serialState.isConnected = true;
    const info = port.getInfo?.() ?? {};
    setStatus(
      `Connected @ ${profile.baudRate} baud`,
      "Connected",
      `${boardForPort(info)} ${hexId(info.usbVendorId)}:${hexId(info.usbProductId)}`
    );
  } catch (error) {
    setStatus(`Connect failed: ${error.message}`, "Disconnected", "None");
    serialState.activePort = null;
    serialState.isConnected = false;
  }

  syncButtonState();
}

async function disconnectPort() {
  if (controlState.isTracking) {
    await stopHandControl("Tracking stopped: serial device disconnected.");
  }

  const port = serialState.activePort;
  if (!port) return;

  try {
    await port.close();
  } catch (error) {
    setStatus(`Disconnect warning: ${error.message}`, "Disconnected", deviceText.textContent);
  } finally {
    serialState.activePort = null;
    serialState.isConnected = false;
    setStatus("Disconnected", "Disconnected", "None");
    syncButtonState();
  }
}

function setUnsupportedState() {
  supportText.textContent = "Not available in this browser";
  setStatus("Use Chrome or Edge on desktop", "Unavailable", "None");
  syncButtonState();
}

function initControlTab() {
  renderControlServoReadout();
  updateControlServoReadout();
  drawControlFrame(null);

  if (controlConfirmBtn) {
    controlConfirmBtn.addEventListener("click", handleControlConfirmClick);
  }

  if (controlStartBtn) {
    controlStartBtn.addEventListener("click", () => {
      void startHandControl();
    });
  }

  if (controlStopBtn) {
    controlStopBtn.addEventListener("click", () => {
      void stopHandControl("Hand control stopped.");
    });
  }

  if (controlCameraToggle) {
    controlCameraToggle.addEventListener("change", () => {
      controlState.cameraVisible = Boolean(controlCameraToggle.checked);
      drawControlFrame(controlState.lastResults);
    });
  }

  syncButtonState();
}

async function initSetupTab() {
  loadCalibrationFromStorage();
  renderServoCards();
  applyCalibrationValuesToInputs();
  updateAllServoCards();
  updateControlServoReadout();
  showLoadedCalibrationStatus();

  saveCalibrationBtn.addEventListener("click", handleSaveCalibrationClick);

  if (!hasWebSerial()) {
    setUnsupportedState();
    return;
  }

  supportText.textContent = "Available";
  setStatus("Ready to detect USB serial device", "Disconnected", "None");
  await refreshAuthorizedPorts();

  detectBtn.addEventListener("click", detectArduinoPort);
  connectBtn.addEventListener("click", connectPort);
  disconnectBtn.addEventListener("click", disconnectPort);

  portSelect.addEventListener("change", () => {
    serialState.selectedIndex = Number.parseInt(portSelect.value, 10);
    syncButtonState();
  });

  navigator.serial.addEventListener("connect", async () => {
    await refreshAuthorizedPorts();
    if (!serialState.isConnected) {
      setStatus("USB serial device plugged in", "Disconnected", "Select a port and connect");
    }
  });

  navigator.serial.addEventListener("disconnect", async (event) => {
    const removedPort = event.target;
    if (serialState.activePort && removedPort === serialState.activePort) {
      if (controlState.isTracking) {
        await stopHandControl("Tracking stopped: serial device unplugged.");
      }
      serialState.activePort = null;
      serialState.isConnected = false;
      setStatus("Device unplugged", "Disconnected", "None");
    }
    await refreshAuthorizedPorts();
    syncButtonState();
  });

  syncButtonState();
}

window.addEventListener("beforeunload", () => {
  if (controlState.stream) {
    controlState.stream.getTracks().forEach((track) => track.stop());
  }
});

initControlTab();
void initSetupTab();
