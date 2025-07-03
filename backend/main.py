import os
import cv2
import time
import base64
import numpy as np
from pathlib import Path
from gtts import gTTS
from fastapi import FastAPI, File, UploadFile, WebSocket, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from ultralytics import YOLO
import torch

torch.backends.cudnn.benchmark = True  # 🧠 Optimización para GPU

# Configuración de FastAPI
app = FastAPI(title="Vision AI - YOLOv8")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_FOLDER = Path("uploads")
MODELS_FOLDER = Path("models")
UPLOAD_FOLDER.mkdir(exist_ok=True)
MODELS_FOLDER.mkdir(exist_ok=True)

# Modelos predefinidos
MODELS = {
    "model1": str(MODELS_FOLDER / "modelo1.pt"),
    "model2": str(MODELS_FOLDER / "modelo2.pt")
}

loaded_models_cache = {}

def load_safe_model(path):
    if path in loaded_models_cache:
        return loaded_models_cache[path]
    try:
        model = YOLO(path)
        model.ckpt_path = path
        loaded_models_cache[path] = model
        return model
    except Exception as e:
        print(f"Error loading model {path}: {e}")
        return None

def generate_description(counts):
    items = [f"{count} {name}{'s' if count > 1 else ''}" for name, count in counts.items()]
    return "No se detectaron objetos" if not items else \
           f"Se detectó {items[0]}" if len(items) == 1 else \
           f"Se detectaron: {', '.join(items[:-1])} y {items[-1]}"

current_model = load_safe_model(MODELS["model1"])


# --------------------- ENDPOINTS HTTP ---------------------

@app.get("/")
async def root():
    return {"message": "Bienvenido a Vision AI API - Usa los endpoints /api/*"}

@app.get("/api/models")
async def list_models():
    uploaded_models = {
        f"uploaded_{file.stem}": str(file.resolve())
        for file in UPLOAD_FOLDER.glob("*.pt")
    }

    current_model_name = None
    if current_model and hasattr(current_model, 'ckpt_path'):
        all_models = {**MODELS, **uploaded_models}
        current_path = str(current_model.ckpt_path)
        for k, v in all_models.items():
            if v == current_path:
                current_model_name = k
                break

    return {
        "preloaded": list(MODELS.keys()),
        "uploaded": list(uploaded_models.keys()),
        "current": current_model_name
    }

@app.post("/api/upload-model")
async def upload_model(model: UploadFile = File(...)):
    if not model.filename.endswith(".pt"):
        return JSONResponse(status_code=400, content={"error": "Solo archivos .pt permitidos"})

    save_path = UPLOAD_FOLDER / model.filename
    with open(save_path, "wb") as f:
        f.write(await model.read())

    model_id = f"uploaded_{model.filename[:-3]}"
    MODELS[model_id] = str(save_path)
    return {"status": "Modelo subido correctamente", "model_id": model_id}

@app.post("/api/switch-model")
async def switch_model(req: Request):
    data = await req.json()
    model_name = data.get("model")

    all_models = {**MODELS}
    for file in UPLOAD_FOLDER.glob("*.pt"):
        model_id = f"uploaded_{file.stem}"
        all_models[model_id] = str(file.resolve())

    if model_name not in all_models:
        return JSONResponse(status_code=404, content={"error": "Modelo no encontrado"})

    new_model = load_safe_model(all_models[model_name])
    if not new_model:
        return JSONResponse(status_code=500, content={"error": "Error al cargar modelo"})
    
    global current_model
    current_model = new_model
    return {"status": f"Modelo cambiado a {model_name}"}

@app.post("/api/upload-image")
async def process_image(image: UploadFile = File(...)):
    if not current_model:
        return JSONResponse(status_code=500, content={"error": "Modelo no cargado"})

    img = cv2.imdecode(np.frombuffer(await image.read(), np.uint8), cv2.IMREAD_COLOR)
    results = current_model(img)[0]
    annotated_img = results.plot()

    _, buffer = cv2.imencode('.jpg', annotated_img)
    img_str = base64.b64encode(buffer).decode('utf-8')

    detections = []
    counts = {}

    for box in results.boxes:
        class_id = int(box.cls[0].item())
        name = results.names[class_id]
        conf = float(box.conf[0].item())
        xmin, ymin, xmax, ymax = map(lambda x: int(x.item()), box.xyxy[0])
        detections.append({
            "name": name,
            "confidence": conf,
            "xmin": xmin,
            "ymin": ymin,
            "xmax": xmax,
            "ymax": ymax
        })
        counts[name] = counts.get(name, 0) + 1

    return {
        "image": f"data:image/jpeg;base64,{img_str}",
        "detections": detections,
        "description": generate_description(counts)
    }

@app.post("/api/generate-tts")
async def generate_tts(req: Request):
    data = await req.json()
    text = data.get('text', '')
    tts = gTTS(text=text, lang='es')
    tts.save("temp_tts.mp3")
    return FileResponse("temp_tts.mp3", media_type="audio/mpeg")

@app.post("/api/delete-model")
async def delete_model(req: Request):
    data = await req.json()
    model_name = data.get("model")

    if not model_name.startswith("uploaded_"):
        return JSONResponse(status_code=400, content={"error": "Solo modelos subidos pueden eliminarse"})

    filename = model_name.replace("uploaded_", "") + ".pt"
    model_path = UPLOAD_FOLDER / filename

    if model_path.exists():
        try:
            model_path.unlink()
            MODELS.pop(model_name, None)
            return {"status": f"{model_name} eliminado correctamente"}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})
    else:
        return JSONResponse(status_code=404, content={"error": "Modelo no encontrado"})


# --------------------- WEBSOCKET DE DETECCIÓN EN VIVO ---------------------

@app.websocket("/ws/detect")
async def detect_stream(websocket: WebSocket):
    await websocket.accept()
    print("[WS] Cliente conectado") 
    try:
        while True:
            data = await websocket.receive_bytes()
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)

            results = current_model(img)[0]
            annotated_img = results.plot()

            _, buffer = cv2.imencode('.jpg', annotated_img)
            img_str = base64.b64encode(buffer).decode('utf-8')

            detections = []
            for box in results.boxes:
                class_id = int(box.cls[0].item())
                name = results.names[class_id]
                conf = float(box.conf[0].item())
                x1, y1, x2, y2 = map(lambda x: int(x.item()), box.xyxy[0])
                detections.append({
                    "name": name,
                    "confidence": round(conf, 2),
                    "bbox": [x1, y1, x2, y2]
                })

            await websocket.send_json({
                "image": img_str,
                "detections": detections
            })

    except Exception as e:
        print(f"[WebSocket Error] {e}")
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)
