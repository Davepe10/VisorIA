const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const cameraSelect = document.getElementById('cameraSelect');
const modelSelector = document.getElementById('modelSelector');
const fpsDisplay = document.getElementById('fps');
const spinnerOverlay = document.getElementById('spinnerOverlay');

const WS_URL = 'wss://backend-detector.onrender.com/ws/detect';
const TARGET_FPS = 10;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

let stream = null;
let video = null;
let websocket = null;
let processing = false;
let lastFrameTime = 0;
let lastSpokenTime = 0;
let currentDescription = '';
let waitingResponse = false;

const BOX_COLORS = {
  person: '#FF0000',
  car: '#0000FF',
  bottle: '#00FF00',
  default: '#FFFF00',
};

// ========== Cargar cámaras ==========
async function cargarCamaras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(d => d.kind === 'videoinput');
  cameraSelect.innerHTML = '';
  videoDevices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.text = device.label || `Cámara ${cameraSelect.length + 1}`;
    cameraSelect.appendChild(option);
  });
}

// ========== Cargar modelos ==========
async function cargarModelos() {
  try {
    const res = await fetch('https://backend-detector.onrender.com/api/models');
    const data = await res.json();
    modelSelector.innerHTML = '';
    [...data.preloaded, ...data.uploaded].forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelector.appendChild(option);
    });
    modelSelector.value = data.current;
  } catch (err) {
    console.error('Error cargando modelos:', err);
    showError('No se pudieron cargar los modelos');
  }
}

// ========== Iniciar cámara + WebSocket ==========
startBtn.addEventListener('click', async () => {
  if (processing) return;

  try {
    spinnerOverlay.classList.remove('hidden');

    video = document.createElement('video');
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: cameraSelect.value ? { exact: cameraSelect.value } : undefined,
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    });

    video.srcObject = stream;
    await video.play();

    canvas.width = 320;
    canvas.height = 240;

    websocket = new WebSocket(WS_URL);
    websocket.binaryType = 'arraybuffer';

    websocket.onopen = () => {
      console.log('WebSocket conectado');
      processing = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      requestAnimationFrame(sendFrameLoop);
    };

    websocket.onmessage = event => {
      waitingResponse = false;
      spinnerOverlay.classList.add('hidden');

      const data = JSON.parse(event.data);
      drawDetections(data.image, data.detections);
      updateFPS();
      speakDetection(generateDescription(data.detections));
      requestAnimationFrame(sendFrameLoop); // iniciar siguiente frame
    };

    websocket.onerror = err => {
      console.error('WebSocket error:', err);
      showError('Error en la comunicación con el servidor');
      spinnerOverlay.classList.add('hidden');
    };

    websocket.onclose = () => {
      console.warn('WebSocket cerrado');
    };
  } catch (err) {
    console.error('Error iniciando cámara o WS:', err);
    showError('No se pudo iniciar la cámara o conexión');
    spinnerOverlay.classList.add('hidden');
  }
});

// ========== Detener cámara + WebSocket ==========
stopBtn.addEventListener('click', () => {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (video) video.srcObject = null;
  if (websocket && websocket.readyState === WebSocket.OPEN) websocket.close();
  processing = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  spinnerOverlay.classList.add('hidden');
});

// ========== Enviar frame por WebSocket ==========
async function sendFrameLoop(timestamp) {
  if (!processing || !video || websocket.readyState !== WebSocket.OPEN || waitingResponse) return;

  const elapsed = timestamp - lastFrameTime;
  if (elapsed < FRAME_INTERVAL) {
    requestAnimationFrame(sendFrameLoop);
    return;
  }

  lastFrameTime = timestamp;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(blob => {
    if (blob) {
      blob.arrayBuffer().then(buffer => {
        websocket.send(buffer);
        waitingResponse = true; // Espera la respuesta antes de seguir
      });
    }
  }, 'image/jpeg', 0.6);
}

// ========== Dibujar detecciones ==========
function drawDetections(base64Image, detections) {
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    detections.forEach(det => {
      const color = BOX_COLORS[det.name] || BOX_COLORS.default;
      const [x1, y1, x2, y2] = det.bbox;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      const label = `${det.name} ${(det.confidence * 100).toFixed(1)}%`;
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = color;
      ctx.fillRect(x1, y1 - 20, textWidth + 10, 20);
      ctx.fillStyle = '#FFF';
      ctx.font = '14px Arial';
      ctx.fillText(label, x1 + 5, y1 - 5);
    });
  };
  img.src = `data:image/jpeg;base64,${base64Image}`;
}

// ========== Descripción con voz ==========
function generateDescription(detections) {
  if (!detections || detections.length === 0) return 'No se detectaron objetos';
  const counts = {};
  detections.forEach(d => {
    counts[d.name] = (counts[d.name] || 0) + 1;
  });

  const items = Object.entries(counts).map(([k, v]) => `${v} ${k}${v > 1 ? 's' : ''}`);
  return items.length === 1
    ? `Se detectó ${items[0]}`
    : `Se detectaron: ${items.slice(0, -1).join(', ')} y ${items.slice(-1)[0]}`;
}

function speakDetection(description) {
  const now = Date.now();
  if (description === currentDescription || now - lastSpokenTime < 5000) return;

  currentDescription = description;
  lastSpokenTime = now;

  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(description);
    utterance.lang = 'es-ES';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }
}

// ========== Mostrar FPS ==========
function updateFPS() {
  const now = performance.now();
  const fps = Math.round(1000 / (now - lastFrameTime));
  fpsDisplay.textContent = `FPS: ${fps}`;
}

// ========== Errores ==========
function showError(message) {
  Swal.fire({
    title: 'Error',
    text: message,
    icon: 'error',
    timer: 3000,
    showConfirmButton: false
  });
}

// ========== Inicializar ==========
window.addEventListener('DOMContentLoaded', () => {
  cargarCamaras();
  cargarModelos();
  navigator.mediaDevices.ondevicechange = cargarCamaras;
});
