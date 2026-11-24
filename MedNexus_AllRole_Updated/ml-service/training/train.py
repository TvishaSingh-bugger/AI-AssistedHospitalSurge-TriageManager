from pathlib import Path
import argparse
import os
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = PROJECT_ROOT / "ml-service" / "models"
TARGET_COLUMNS = ["next_emergency", "next_critical"]
NON_FEATURE_COLUMNS = {
    "case_id", "hospital", "date", "next_emergency", "next_critical", "minute_of_day",
}


def make_model():
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("regressor", RandomForestRegressor(
            n_estimators=300, min_samples_leaf=2, random_state=42,
            n_jobs=-1,
        )),
    ])


def save_bundle(bundle, destination):
    """Write beside the destination, then atomically replace the model file."""
    temporary = destination.with_name(f".{destination.stem}.{os.getpid()}.tmp")
    try:
        joblib.dump(bundle, temporary)
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()


def main(targets=None):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from features import build_training_dataset, split_by_time

    interval = "30min"
    data = build_training_dataset(interval=interval)
    if data.empty:
        raise ValueError("No labeled intervals available. Add case records spanning multiple intervals.")
    feature_columns = [column for column in data.columns if column not in NON_FEATURE_COLUMNS]
    if not feature_columns:
        raise ValueError("No usable model features were generated.")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    forecast_preview = None

    for target in targets or TARGET_COLUMNS:
        usable = data.dropna(subset=[target]).copy()
        if len(usable) < 10:
            print(f"Skipping {target}: need at least 10 labeled intervals; found {len(usable)}.")
            continue
        train_rows, test_rows = split_by_time(usable)
        X_train = train_rows[feature_columns].replace([np.inf, -np.inf], np.nan)
        y_train = pd.to_numeric(train_rows[target], errors="coerce")
        X_test = test_rows[feature_columns].replace([np.inf, -np.inf], np.nan)
        y_test = pd.to_numeric(test_rows[target], errors="coerce")
        model = make_model().fit(X_train, y_train)
        predictions = np.maximum(0, model.predict(X_test))
        mae = float(np.mean(np.abs(y_test.to_numpy() - predictions)))
        rmse = float(np.sqrt(np.mean((y_test.to_numpy() - predictions) ** 2)))
        baseline_column = "emergency_cases" if target == "next_emergency" else "critical_cases"
        baseline_mae = float(np.mean(np.abs(y_test.to_numpy() - X_test[baseline_column].to_numpy())))
        print(f"{target}: rows={len(usable)}, train={len(train_rows)}, test={len(test_rows)}, MAE={mae:.3f}, RMSE={rmse:.3f}, current-count baseline MAE={baseline_mae:.3f}")

        # Keep a small joined preview of held-out predictions for the terminal.
        preview = test_rows[["date", "hospital_id"]].copy()
        preview[f"actual_{target}"] = y_test.to_numpy()
        preview[f"forecast_{target}"] = predictions
        if forecast_preview is None:
            forecast_preview = preview
        else:
            forecast_preview = forecast_preview.merge(
                preview, on=["date", "hospital_id"], how="inner"
            )

        # Refit after the holdout score is measured so the saved model uses all labeled data.
        all_X = usable[feature_columns].replace([np.inf, -np.inf], np.nan)
        all_y = pd.to_numeric(usable[target], errors="coerce")
        model.fit(all_X, all_y)
        bundle = {
            "model": model,
            "features": feature_columns,
            "target": target,
            "interval": interval,
            "metrics": {"holdout_mae": mae, "holdout_rmse": rmse, "baseline_mae": baseline_mae},
            "training_rows": len(usable),
        }
        destination = MODEL_DIR / f"{target}.joblib"
        save_bundle(bundle, destination)
        print(f"Saved {destination}")

    if forecast_preview is not None:
        columns = [
            "date", "hospital_id",
            "actual_next_emergency", "forecast_next_emergency",
            "actual_next_critical", "forecast_next_critical",
        ]
        columns = [column for column in columns if column in forecast_preview]
        preview = forecast_preview[columns].sort_values(
            ["date", "hospital_id"]
        ).head(20).copy()
        for column in preview.columns:
            if column.startswith("forecast_"):
                preview[column] = preview[column].round(2)
        print("\nHeld-out forecast preview (actual vs predicted; first 20 rows):")
        print(preview.to_string(index=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train hospital demand forecasting models.")
    parser.add_argument("--target", choices=TARGET_COLUMNS, help="Train only one target model.")
    arguments = parser.parse_args()
    main([arguments.target] if arguments.target else None)
