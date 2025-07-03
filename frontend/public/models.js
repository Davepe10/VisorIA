const API_BASE_URL = 'https://backend-detector.onrender.com';

document.addEventListener('DOMContentLoaded', () => {
  const modelUpload = document.getElementById('modelUpload');
  const uploadBtn = document.getElementById('uploadBtn');
  const preloadedModels = document.getElementById('preloadedModels');
  const uploadedModels = document.getElementById('uploadedModels');
  const currentModel = document.getElementById('currentModel');
  const refreshBtn = document.getElementById('refreshBtn');

  init();

  async function init() {
    await loadModels();

    uploadBtn.addEventListener('click', subirModelo);
    refreshBtn.addEventListener('click', loadModels);
  }

  async function subirModelo() {
    if (!modelUpload.files.length) {
      Swal.fire("⚠️", "Selecciona un archivo .pt", "warning");
      return;
    }

    const file = modelUpload.files[0];
    if (!file.name.endsWith('.pt')) {
      Swal.fire("❌", "Solo se permiten archivos .pt", "error");
      return;
    }

    const formData = new FormData();
    formData.append('model', file);
    uploadBtn.disabled = true;

    try {
      Swal.fire({ title: 'Subiendo modelo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      const res = await fetch(`${API_BASE_URL}/api/upload-model`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (res.ok) {
        Swal.fire("✅ Éxito", `Modelo subido: ${data.model_id}`, "success");
        modelUpload.value = '';
        await loadModels();
      } else {
        Swal.fire("❌ Error", data.error, "error");
      }
    } catch (err) {
      console.error(err);
      Swal.fire("❌", "Error de conexión", "error");
    } finally {
      uploadBtn.disabled = false;
    }
  }

  async function loadModels() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/models`);
      const data = await res.json();

      const renderList = (models, container, isUploaded = false) => {
        container.innerHTML = models.map(model => `
          <li class="${model === data.current ? 'active' : ''}" data-model="${model}">
            ${model} ${model === data.current ? '(ACTUAL)' : ''}
            ${isUploaded ? `<button class="delete-btn" data-model="${model}">🗑️</button>` : ''}
          </li>
        `).join('');
      };

      renderList(data.preloaded, preloadedModels);
      renderList(data.uploaded, uploadedModels, true);
      currentModel.textContent = data.current;

      // Cambiar modelo
      document.querySelectorAll('li[data-model]').forEach(li => {
        li.addEventListener('click', async () => {
          const model = li.dataset.model;
          await switchModel(model);
        });
      });

      // Eliminar modelo
      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const model = btn.dataset.model;
          const confirm = await Swal.fire({
            title: `¿Eliminar ${model}?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar'
          });
          if (confirm.isConfirmed) {
            await deleteModel(model);
          }
        });
      });

    } catch (error) {
      console.error("Error cargando modelos:", error);
      Swal.fire("❌", "No se pudo obtener la lista de modelos", "error");
    }
  }

  async function switchModel(model) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/switch-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      });

      const data = await res.json();
      if (res.ok) {
        Swal.fire("✅ Cambiado", data.status, "success");
        await loadModels();
      } else {
        Swal.fire("❌ Error", data.error, "error");
      }
    } catch (err) {
      console.error(err);
      Swal.fire("❌", "Error al cambiar modelo", "error");
    }
  }

  async function deleteModel(model) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/delete-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      });

      const data = await res.json();
      if (res.ok) {
        Swal.fire("🗑️ Eliminado", `Modelo ${model} eliminado correctamente`, "success");
        await loadModels();
      } else {
        Swal.fire("❌ Error", data.error, "error");
      }
    } catch (err) {
      console.error(err);
      Swal.fire("❌", "Error al eliminar modelo", "error");
    }
  }
});
