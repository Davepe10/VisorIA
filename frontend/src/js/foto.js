const API_BASE_URL = 'https://backend-detector.onrender.com';
const WS_URL = 'wss://backend-detector.onrender.com/ws/detect';

const video = document.getElementById('videoPreview');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const cameraSelect = document.getElementById('cameraSelect');
const modelSelect = document.getElementById('modelSelect');
const startPreviewBtn = document.getElementById('startPreview');
const takePhotoBtn = document.getElementById('takePhoto');
const backToCameraBtn = document.getElementById('backToCamera');
const stopPreviewBtn = document.getElementById('stopPreview');
const spinnerOverlay = document.getElementById('spinnerOverlay');
const detectionResults = document.getElementById('detectionResults');

let stream = null;
let currentDescription = '';
let lastSpokenTime = 0;

// === Cargar cámaras ===
async function cargarCamaras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');

    cameraSelect.innerHTML = '';
    cameras.forEach((cam, i) => {
      const option = document.createElement('option');
      option.value = cam.deviceId;
      option.text = cam.label || `Cámara ${i + 1}`;
      cameraSelect.appendChild(option);
    });

    if (cameras.length > 0) {
      cameraSelect.classList.remove('hidden');
      startPreviewBtn.classList.remove('hidden');
    } else {
      Swal.fire("⚠️ Error", "No se encontraron cámaras", "error");
    }
  } catch (err) {
    console.error('No se pudo cargar cámaras:', err);
    Swal.fire("⚠️ Error", "No se pudieron cargar las cámaras", "error");
  }
}

// === Cargar modelos ===
async function cargarModelos() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/models`);
    const data = await response.json();

    modelSelect.innerHTML = '';
    [...data.preloaded, ...data.uploaded].forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model === data.current ? `${model} (actual)` : model;
      modelSelect.appendChild(option);
    });

    modelSelect.value = data.current;
    modelSelect.classList.remove('hidden');
  } catch (error) {
    console.error("Error cargando modelos:", error);
    Swal.fire("⚠️ Error", "No se pudieron cargar los modelos", "error");
  }
}

// === Notificación al cambiar modelo ===
modelSelect.addEventListener('change', () => {
  const selectedModel = modelSelect.value;
  Swal.fire({
    title: 'Modelo Cambiado',
    text: `Has seleccionado el modelo: ${selectedModel}`,
    icon: 'info',
    confirmButtonText: 'OK'
  });
});



// === Iniciar cámara ===
async function iniciarCamara() {
  if (stream) stream.getTracks().forEach(t => t.stop());

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: cameraSelect.value ? { exact: cameraSelect.value } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'environment',
      }
    });

    video.srcObject = stream;
    await video.play();

    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    };

    takePhotoBtn.style.display = 'block';
    stopPreviewBtn.style.display = 'block';
    backToCameraBtn.style.display = 'none';
    video.style.display = 'block';
    canvas.style.display = 'none';

  } catch (err) {
    console.error('Error iniciando cámara:', err);
    Swal.fire("⚠️ Error", "No se pudo iniciar la cámara. Verifica los permisos.", "error");
  }
}

// === Tomar foto ===
function tomarFoto() {
  if (!stream) return;
  spinnerOverlay.style.display = 'flex';

  video.style.display = 'none';
  canvas.style.display = 'block';
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(blob => {
    if (!blob) {
      alert('No se pudo capturar imagen.');
      volverACamara();
      return;
    }

    const ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      const formData = new FormData();
      formData.append('image', blob);
      formData.append('model', modelSelect.value);

      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result;
        ws.send(arrayBuffer);
      };
      reader.readAsArrayBuffer(blob);
    };

    ws.onmessage = (event) => {
      const { image, detections } = JSON.parse(event.data);
      mostrarResultado(image, detections);
      hablarDescripcion(detections);
      ws.close();
    };

    ws.onerror = () => {
      alert('Error al procesar la imagen');
      volverACamara();
    };

    ws.onclose = () => {
      spinnerOverlay.style.display = 'none';
    };
  }, 'image/jpeg', 0.85);
}

// === Mostrar detecciones en canvas ===
function mostrarResultado(base64Image, detecciones) {
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    detecciones.forEach(det => {
      const [x1, y1, x2, y2] = det.bbox;
      const label = `${det.name} ${(det.confidence * 100).toFixed(1)}%`;

      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      ctx.fillStyle = '#FF0000';
      ctx.fillRect(x1, y1 - 24, ctx.measureText(label).width + 12, 24);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '16px Arial';
      ctx.fillText(label, x1 + 6, y1 - 6);
    });

    spinnerOverlay.style.display = 'none';
    takePhotoBtn.style.display = 'none';
    backToCameraBtn.style.display = 'block';

    // Mostrar resultados en el div
    detectionResults.innerHTML = `
      <h4>Objetos detectados:</h4>
      <p>${generarDescripcion(detecciones)}</p>
      <button class="btn btn-secondary" onclick="speakDescription('${generarDescripcion(detecciones).replace(/'/g, "\\'")}')">
        🔊 Escuchar descripción
      </button>
    `;
  };

  img.src = `data:image/jpeg;base64,${base64Image}`;
}

// === Generar descripción ===
function generarDescripcion(detecciones) {
  if (!detecciones.length) {
    return 'No se detectaron objetos';
  }

  const conteo = {};
  detecciones.forEach(det => {
    conteo[det.name] = (conteo[det.name] || 0) + 1;
  });

  const partes = Object.entries(conteo).map(([nombre, cantidad]) =>
    `${cantidad} ${nombre}${cantidad > 1 ? 's' : ''}`
  );

  return partes.length === 1
    ? `Se detectó ${partes[0]}`
    : `Se detectaron ${partes.slice(0, -1).join(', ')} y ${partes.slice(-1)}`;
}

// === Generar y hablar descripción ===
function hablarDescripcion(text) {
  const now = Date.now();
  if (text === currentDescription || now - lastSpokenTime < 5000) return;

  currentDescription = text;
  lastSpokenTime = now;

  if ('speechSynthesis' in window) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'es-ES';
    const voice = speechSynthesis.getVoices().find(v => v.lang.includes('es'));
    if (voice) utter.voice = voice;
    window.speechSynthesis.speak(utter);
  } else {
    fetch(`${API_BASE_URL}/api/generate-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
    .then(res => res.blob())
    .then(blob => new Audio(URL.createObjectURL(blob)).play());
  }
}

// === Volver a la cámara ===
function volverACamara() {
  canvas.style.display = 'none';
  video.style.display = 'block';
  spinnerOverlay.style.display = 'none';
  takePhotoBtn.style.display = 'block';
  backToCameraBtn.style.display = 'none';
}

// === Apagar cámara ===
function apagarCamara() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  video.srcObject = null;
  video.style.display = 'none';
  canvas.style.display = 'none';
  takePhotoBtn.style.display = 'none';
  backToCameraBtn.style.display = 'none';
  stopPreviewBtn.style.display = 'none';

  alert('Cámara apagada. Pulsa "Iniciar Cámara" para volver a usarla.');
}

// === Eventos DOM ===
window.addEventListener('DOMContentLoaded', () => {
  cargarCamaras();
  cargarModelos();
  speechSynthesis.onvoiceschanged = () => {};
});

startPreviewBtn.addEventListener('click', iniciarCamara);
takePhotoBtn.addEventListener('click', tomarFoto);
backToCameraBtn.addEventListener('click', volverACamara);
stopPreviewBtn.addEventListener('click', apagarCamara);
cameraSelect.addEventListener('change', iniciarCamara);