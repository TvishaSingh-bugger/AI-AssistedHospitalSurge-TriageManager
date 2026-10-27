from pathlib import Path
import sys
import joblib
import numpy as np
import pandas as pd
ML_SERVICE_DIR = Path(__file__).resolve().parent
MODEL_DIR = ML_SERVICE_DIR / "models"
TRAINING_DIR = ML_SERVICE_DIR / "training"
sys.path.insert(0, str(TRAINING_DIR))
from features import build_interval_dataset
def main():
    models = [MODEL_DIR / "next_emergency.joblib", MODEL_DIR / "next_critical.joblib"]
    available = [path for path in models if path.exists()]
    if not available:
        raise FileNotFoundError("No trained demand models found. Run training/train.py first.")
    interval = joblib.load(available[0]).get("interval", "30min")
    data = build_interval_dataset(interval=interval)
    if data.empty:
        print("No data available for prediction.")
        return
    latest = data.sort_values("date").groupby("hospital_id", sort=False).tail(1).copy()
    for path in available:
        bundle = joblib.load(path)
        X = latest.reindex(columns=bundle["features"]).replace([np.inf, -np.inf], np.nan)
        latest[bundle["target"] + "_prediction"] = np.maximum(0, bundle["model"].predict(X))
    columns = ["hospital_id", "date", "emergency_cases", "critical_cases"]
    columns += [name for name in ("next_emergency_prediction", "next_critical_prediction") if name in latest]
    print("Predicted demand for the interval following each hospital's latest observed interval:")
    print(latest[columns].to_string(index=False))


if __name__ == "__main__":
    main()
