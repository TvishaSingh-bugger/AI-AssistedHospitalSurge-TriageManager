"""Print one next-interval forecast row for each hospital in MySQL."""
from pathlib import Path
import sys

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models"
sys.path.insert(0, str(ROOT / "training"))

from features import build_interval_dataset  # noqa: E402


def main():
    model_paths = {
        "next_emergency": MODEL_DIR / "next_emergency.joblib",
        "next_critical": MODEL_DIR / "next_critical.joblib",
    }
    missing = [path.name for path in model_paths.values() if not path.exists()]
    if missing:
        raise FileNotFoundError(
            f"Missing trained model(s): {', '.join(missing)}. Run `py training\\train.py` first."
        )

    interval_data = build_interval_dataset()
    if interval_data.empty:
        raise ValueError("No case history was found in the configured MySQL database.")

    latest = (
        interval_data.sort_values(["hospital_id", "date"])
        .groupby("hospital_id", sort=True)
        .tail(1)
        .copy()
    )
    outputs = latest[["hospital_id", "date", "emergency_cases", "critical_cases"]].copy()

    for target, model_path in model_paths.items():
        bundle = joblib.load(model_path)
        feature_columns = bundle["features"]
        absent = [column for column in feature_columns if column not in latest.columns]
        if absent:
            raise ValueError(
                f"{model_path.name} expects missing feature(s): {', '.join(absent)}. Retrain the models."
            )
        values = bundle["model"].predict(latest[feature_columns])
        outputs[f"{target}_prediction"] = pd.Series(values, index=latest.index).clip(lower=0)

    outputs["date"] = pd.to_datetime(outputs["date"]).dt.strftime("%Y-%m-%d %H:%M:%S")
    outputs["emergency_cases"] = outputs["emergency_cases"].astype(int)
    outputs["critical_cases"] = outputs["critical_cases"].astype(int)
    print(outputs.to_string(index=False, float_format=lambda value: f"{value:.6f}"))
    print(f"\nForecast rows: {len(outputs)} hospital(s); predictions are for the next 30-minute interval after each row's date.")


if __name__ == "__main__":
    main()
