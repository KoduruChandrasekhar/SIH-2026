# TraceNet — Complete Setup, Run & Development Guide

## 1. REQUIREMENTS

Install the following on the laptop:

- Git
- Python 3.10+
- Node.js 18+
- npm

System-level FFmpeg is NOT required. The project uses imageio-ffmpeg.

---

## 2. CLONE THE PROJECT

git clone <REPOSITORY_URL>
cd SIH-2026

Switch to the combined integration branch:

git checkout integration
git pull origin integration

---

## 3. INSTALL FRONTEND DEPENDENCIES

From the project root:

npm install

---

## 4. INSTALL BACKEND DEPENDENCIES

From the project root:

python -m pip install -r backend/requirements.txt

The backend uses:

- FastAPI
- Uvicorn
- Pydantic
- Ultralytics
- OpenCV
- imageio-ffmpeg

---

## 5. CAMERA INPUT VIDEOS

The original camera input videos must be present inside:

public/camera-feeds/

Expected files:

public/camera-feeds/CAM-401.mp4
public/camera-feeds/CAM-402.mp4
public/camera-feeds/CAM-403.mp4

These are INPUT videos.

They are different from the generated AI-annotated videos.

---

## 6. REAL VEHICLE AI PIPELINE

The current real AI pipeline is:

Camera MP4
    ↓
YOLO11n
    ↓
Vehicle Detection
    ↓
ByteTrack
    ↓
Track IDs
    ↓
Annotated Video

The pipeline detects:

- Cars
- Motorcycles
- Buses
- Trucks

---

## 7. GENERATE AI VIDEO

Run this from the project root.

### macOS / Linux

python backend/scripts/run_vehicle_tracking.py --camera CAM-401

### Windows

python backend\scripts\run_vehicle_tracking.py --camera CAM-401

The script generates:

public/camera-feeds/CAM-401_annotated.mp4

and:

backend/output/CAM-401_detections.json

The annotated video is the video displayed by the TraceNet camera viewer.

---

## 8. GENERATE OTHER CAMERAS

For CAM-402:

### macOS / Linux

python backend/scripts/run_vehicle_tracking.py --camera CAM-402

### Windows

python backend\scripts\run_vehicle_tracking.py --camera CAM-402

For CAM-403:

### macOS / Linux

python backend/scripts/run_vehicle_tracking.py --camera CAM-403

### Windows

python backend\scripts\run_vehicle_tracking.py --camera CAM-403

Each camera generates its own annotated video and detection JSON.

---

## 9. GENERATED FILES

For CAM-401:

public/camera-feeds/CAM-401_annotated.mp4
backend/output/CAM-401_detections.json

For CAM-402:

public/camera-feeds/CAM-402_annotated.mp4
backend/output/CAM-402_detections.json

For CAM-403:

public/camera-feeds/CAM-403_annotated.mp4
backend/output/CAM-403_detections.json

These files are generated locally and are intentionally ignored by Git.

---

## 10. START THE FASTAPI BACKEND

Open a new terminal.

Navigate to the project root if necessary:

cd SIH-2026

### macOS / Linux

uvicorn backend.main:app --reload --port 8000

### Windows

python -m uvicorn backend.main:app --reload --port 8000

The backend runs at:

http://localhost:8000

Keep this terminal running.

---

## 11. TEST THE BACKEND

Open another terminal.

Run:

curl http://localhost:8000/api/health

Also test:

curl http://localhost:8000/api/cameras

and:

curl http://localhost:8000/api/vehicles

The FastAPI backend should return successful responses.

---

## 12. START THE REACT FRONTEND

Open another terminal in the project root.

Run:

npm run dev

Vite will display the local development URL.

Normally:

http://localhost:5173

Open the URL shown by Vite in the browser.

---

## 13. COMPLETE RUNNING SETUP

Three terminals are normally used.

### TERMINAL 1 — AI VIDEO GENERATION

Generate the required camera video:

python backend/scripts/run_vehicle_tracking.py --camera CAM-401

This only needs to be run when an annotated camera video needs to be generated or regenerated.

### TERMINAL 2 — FASTAPI BACKEND

uvicorn backend.main:app --reload --port 8000

Keep this terminal running.

### TERMINAL 3 — REACT FRONTEND

npm run dev

Keep this terminal running.

Then open:

http://localhost:5173

---

## 14. CAMERA VIEWER

After opening the TraceNet website:

1. Open the camera section.
2. Select a camera such as CAM-401.
3. The camera viewer opens the generated annotated video.
4. The video contains real YOLO11n vehicle detections.
5. ByteTrack provides persistent tracking IDs.

The flow is:

CAM-401.mp4
    ↓
YOLO11n
    ↓
Vehicle Detection
    ↓
ByteTrack
    ↓
CAM-401_annotated.mp4
    ↓
TraceNet Camera Viewer

---

## 15. VERIFY ANNOTATED VIDEO EXISTS

### macOS / Linux

ls -lh public/camera-feeds/CAM-401_annotated.mp4

ls -lh backend/output/CAM-401_detections.json

### Windows

dir public\camera-feeds\CAM-401_annotated.mp4

dir backend\output\CAM-401_detections.json

Both files should exist after running the AI pipeline.

---

## 16. IF THE CAMERA VIDEO DOES NOT OPEN

First check whether the generated video exists.

### macOS / Linux

ls -lh public/camera-feeds/CAM-401_annotated.mp4

### Windows

dir public\camera-feeds\CAM-401_annotated.mp4

If it does not exist, regenerate it:

### macOS / Linux

python backend/scripts/run_vehicle_tracking.py --camera CAM-401

### Windows

python backend\scripts\run_vehicle_tracking.py --camera CAM-401

Then refresh the website.

---

## 17. IF THE FRONTEND DOES NOT START

Run:

npm install

Then:

npm run dev

---

## 18. IF THE BACKEND DOES NOT START

Run:

python -m pip install -r backend/requirements.txt

Then start:

uvicorn backend.main:app --reload --port 8000

On Windows:

python -m uvicorn backend.main:app --reload --port 8000

---

## 19. YOLO MODEL WEIGHTS

The YOLO model weights are downloaded locally when required.

Do NOT commit YOLO model files to Git.

Files such as:

yolo11n.pt

are ignored by Git.

---

## 20. GIT RULES FOR GENERATED FILES

The following files must NOT be committed:

*_annotated.mp4
backend/output/*.mp4
backend/output/*.json
*.pt

Generated AI videos are recreated locally on each laptop.

The original camera input videos are separate from generated annotated videos.

---

## 21. INPUT VS OUTPUT

INPUT:

public/camera-feeds/CAM-401.mp4
public/camera-feeds/CAM-402.mp4
public/camera-feeds/CAM-403.mp4

OUTPUT:

public/camera-feeds/CAM-401_annotated.mp4
public/camera-feeds/CAM-402_annotated.mp4
public/camera-feeds/CAM-403_annotated.mp4

DETECTION DATA:

backend/output/CAM-401_detections.json
backend/output/CAM-402_detections.json
backend/output/CAM-403_detections.json

Input videos are used by the AI pipeline.

Output videos and detection JSON files are generated locally.

---

## 22. NEW LAPTOP COMPLETE SETUP

Run the following commands in order:

git clone <REPOSITORY_URL>
cd SIH-2026
git checkout integration
git pull origin integration

npm install

python -m pip install -r backend/requirements.txt

python backend/scripts/run_vehicle_tracking.py --camera CAM-401

Then open another terminal:

uvicorn backend.main:app --reload --port 8000

Then open another terminal:

npm run dev

Open the URL displayed by Vite, normally:

http://localhost:5173

Select CAM-401 in the TraceNet website.

---

## 23. WINDOWS COMPLETE SETUP

Run:

git clone <REPOSITORY_URL>
cd SIH-2026
git checkout integration
git pull origin integration

npm install

python -m pip install -r backend\requirements.txt

python backend\scripts\run_vehicle_tracking.py --camera CAM-401

Open another terminal:

python -m uvicorn backend.main:app --reload --port 8000

Open another terminal:

npm run dev

Open the Vite URL in the browser.

Select CAM-401.

---

## 24. MACOS / LINUX COMPLETE SETUP

Run:

git clone <REPOSITORY_URL>
cd SIH-2026
git checkout integration
git pull origin integration

npm install

python -m pip install -r backend/requirements.txt

python backend/scripts/run_vehicle_tracking.py --camera CAM-401

Open another terminal:

uvicorn backend.main:app --reload --port 8000

Open another terminal:

npm run dev

Open the Vite URL in the browser.

Select CAM-401.

---

## 25. PROJECT BRANCH STRUCTURE

main
|
+-- dev
|   +-- Frontend
|
+-- backend
|   +-- AI / Backend
|
+-- integration
    +-- Frontend
    +-- Backend
    +-- AI Vehicle Tracking
    +-- Camera Viewer

The integration branch is the combined development/demo branch.

---

## 26. CURRENT REAL AI COMPONENT

The currently implemented real AI component is vehicle detection and tracking.

YOLO11n performs vehicle detection.

ByteTrack performs single-camera object tracking.

The generated annotated video is displayed by the TraceNet frontend camera viewer.

---

## 27. QUICK START

For a laptop that is already configured:

Terminal 1:

python backend/scripts/run_vehicle_tracking.py --camera CAM-401

Terminal 2:

uvicorn backend.main:app --reload --port 8000

Terminal 3:

npm run dev

Open:

http://localhost:5173

Select:

CAM-401

---

## 28. DEVELOPMENT RULE

Do not commit generated AI output files.

Before committing changes, run:

git status

Make sure generated files such as:

CAM-401_annotated.mp4
CAM-402_annotated.mp4
CAM-403_annotated.mp4
backend/output/*.json
*.pt

are not staged.
