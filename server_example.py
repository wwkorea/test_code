# ════════════════════════════════════════════════════════════════════════════
#  FastAPI 수신 엔드포인트 예시 — 이미지 + 마스크 쌍 저장
#
#  React 생성기의 "FastAPI로 전송" 옵션이 보내는 multipart/form-data를 받아
#  images/ 와 masks/ 폴더에 같은 파일명으로 저장한다.
#
#  실행:
#    pip install fastapi uvicorn python-multipart
#    uvicorn server:app --reload --port 8000
# ════════════════════════════════════════════════════════════════════════════

from pathlib import Path
import csv

from fastapi import FastAPI, UploadFile, Form, File
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# React 개발 서버(예: localhost:5173)에서의 요청 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # 운영 시에는 실제 프론트 주소로 제한
    allow_methods=["*"],
    allow_headers=["*"],
)

DATASET = Path("dataset")
IMG_DIR = DATASET / "images"
MASK_DIR = DATASET / "masks"
IMG_DIR.mkdir(parents=True, exist_ok=True)
MASK_DIR.mkdir(parents=True, exist_ok=True)
LABELS_CSV = DATASET / "labels.csv"


def _append_label(filename: str, mask_filename: str, template: str, anomaly_types: str, seed: str) -> None:
    """라벨 행을 CSV에 누적 기록 (헤더는 최초 1회)."""
    new_file = not LABELS_CSV.exists()
    with LABELS_CSV.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["filename", "mask_filename", "template", "anomaly_types", "seed"])
        writer.writerow([filename, mask_filename, template, anomaly_types, seed])


@app.post("/upload")
async def upload(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    template: str = Form(""),
    anomaly_types: str = Form(""),
    seed: str = Form(""),
):
    # 파일명은 React가 보낸 원본 이름을 그대로 사용 (이미지/마스크 base가 일치)
    img_name = image.filename or "unknown.png"
    mask_name = mask.filename or img_name.replace(".png", "_mask.png")

    (IMG_DIR / img_name).write_bytes(await image.read())
    (MASK_DIR / mask_name).write_bytes(await mask.read())

    _append_label(img_name, mask_name, template, anomaly_types, seed)

    return {"ok": True, "image": img_name, "mask": mask_name}


@app.get("/health")
def health():
    return {"status": "ok"}
