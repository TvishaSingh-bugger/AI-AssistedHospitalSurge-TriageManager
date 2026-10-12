from pathlib import Path
import sys
import joblib
import pandas as pd
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "ml-service" / "models"
TRAINING_DIR = PROJECT_ROOT / "ml-service" / "training"
sys.path.insert(
    0,
    str(TRAINING_DIR)
)
from features import build_training_dataset
def main():
    df = build_training_dataset(interval="1min")
    if df.empty:
        print("No data available for prediction.")
        return
    latest = (
        df.sort_values("date")
        .groupby("hospital_id", as_index=False)
        .tail(1)
        .copy()
    )
    for target in ["next_emergency", "next_critical"]:
        model_path = MODEL_DIR / f"{target}.joblib"
        if not model_path.exists():
            print(f"Model not found: {model_path}")
            continue
        bundle = joblib.load(model_path)
        model = bundle["model"]
        features = bundle["features"]
        excluded = [
            "next_emergency",
            "next_critical",
            "emergency_cases",
            "critical_cases",
            "date",
        ]
        X = latest.drop(
            columns=excluded,
            errors="ignore"
        ).copy()
        categorical = X.select_dtypes(
            include=["object", "category"]
        ).columns.tolist()
        if categorical:
            X = pd.get_dummies(
                X, columns=categorical, dtype=int
            )
        X = X.reindex(columns=features, fill_value=0)
        predictions = model.predict(X).clip(min=0)
        latest[target + "_prediction"] = predictions
    columns = ["hospital_id", "date"]
    for target in [
        "next_emergency_prediction",
        "next_critical_prediction",
    ]:
        if target in latest.columns:
            columns.append(target)
    print("\nHospital demand predictions:")
    print(latest[columns].to_string(index=False))

if __name__ == "__main__":
    main()
