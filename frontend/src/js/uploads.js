const API_BASE_URL = 'https://backend-detector.onrender.com';

const imageInput = document.getElementById('imageInput');
const modelSelector = document.getElementById('uploadModelSelector');
const processBtn = document.getElementById('processBtn');
const uploadStatus = document.getElementById('uploadStatus');
const resultCanvas = document.getElementById('resultCanvas');
const detectionResults = document.getElementById('detectionResults');
const progressBar = document.getElementById('progressBar');

let currentDescription = '';
let lastSpokenTime = 0;

// ============ CARGAR MODELOS =============
async function loadModels() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/models`);
    const data = await response.json();

    modelSelector.innerHTML = '';
    [...data.preloaded, ...data.uploaded].forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model === data.current ? `${model} (actual)` : model;
      modelSelector.appendChild(option);
    });

    modelSelector.value = data.current;
  } catch (error) {
    console.error("Error cargando modelos:", error);
    Swal.fire("⚠️ Error", "No se pudieron cargar los modelos", "error");
  }
}

// ============ CAMBIO DE MODELO ============
modelSelector.addEventListener('change', async () => {
  const model = modelSelector.value;
  try {
    const res = await fetch(`${API_BASE_URL}/api/switch-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model })
    });

    const data = await res.json();

    if (res.ok) {
      Swal.fire("✅ Modelo cambiado", data.status, "success");
    } else {
      Swal.fire("⚠️ Error", data.error, "error");
    }
  } catch (error) {
    console.error(error);
    Swal.fire("⚠️ Error", "Error al cambiar el modelo", "error");
  }
});

// ============ PROCESAR IMAGEN =============
processBtn.addEventListener('click', async () => {
  if (!imageInput.files || imageInput.files.length === 0) {
    Swal.fire("⚠️", "Por favor selecciona una imagen", "warning");
    return;
  }

  const file = imageInput.files[0];

  uploadStatus.textContent = "Procesando imagen...";
  processBtn.disabled = true;
  progressBar.style.width = '0%';
  progressBar.parentElement.style.display = 'block';

  const formData = new FormData();
  formData.append('image', file);

  try {
    let progress = 0;
    const fakeProgress = setInterval(() => {
      if (progress < 90) {
        progress += 10;
        progressBar.style.width = `${progress}%`;
      }
    }, 150);

    const response = await fetch(`${API_BASE_URL}/api/upload-image`, {
      method: 'POST',
      body: formData
    });

    clearInterval(fakeProgress);
    progressBar.style.width = '100%';

    if (!response.ok) throw new Error(await response.text());

    const data = await response.json();

    // Dibujar imagen en canvas
    const img = new Image();
    img.onload = () => {
      resultCanvas.width = img.width;
      resultCanvas.height = img.height;

      const ctx = resultCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Dibujar detecciones sobre el canvas
      if (data.detections && data.detections.length > 0) {
        data.detections.forEach(det => {
          const color = '#FF0000';

          // Caja
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(det.xmin, det.ymin, det.xmax - det.xmin, det.ymax - det.ymin);

          // Etiqueta
          const label = `${det.name} ${(det.confidence * 100).toFixed(1)}%`;
          ctx.fillStyle = color;
          ctx.font = '16px Arial';
          const textWidth = ctx.measureText(label).width;
          ctx.fillRect(det.xmin, det.ymin - 20, textWidth + 10, 20);
          ctx.fillStyle = '#FFF';
          ctx.fillText(label, det.xmin + 5, det.ymin - 5);
        });
      }

      detectionResults.innerHTML = `
        <h4>Objetos detectados:</h4>
        <p>${data.description}</p>
        <button class="btn btn-secondary" onclick="speakDescription('${data.description.replace(/'/g, "\\'")}')">
          🔊 Escuchar descripción
        </button>
      `;

      speakDescription(data.description);
    };
    img.src = data.image;

    Swal.fire("✅ Procesado", "Imagen analizada correctamente", "success");
    uploadStatus.textContent = "✅ Análisis completado";
  } catch (error) {
    console.error("Error:", error);
    Swal.fire("❌ Error", error.message, "error");
    uploadStatus.textContent = `Error: ${error.message}`;
  } finally {
    processBtn.disabled = false;
    setTimeout(() => {
      progressBar.style.width = '0%';
      progressBar.parentElement.style.display = 'none';
    }, 1000);
  }
});

// ============ VOZ DESCRIPTIVA ============
function speakDescription(text) {
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

// ============ INICIALIZACIÓN ============
window.addEventListener('DOMContentLoaded', () => {
  loadModels();
  speechSynthesis.onvoiceschanged = () => {};
});
