from pathlib import Path
import sys
import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_absolute_error, mean_squared_error
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = PROJECT_ROOT / "ml-service" / "models"
TARGET_COLUMNS = [
    "next_emergency",
    "next_critical",
]
def main():
    training_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(training_dir))
    from features import build_training_dataset
    df = build_training_dataset(interval="1min")
    if df.empty:
        raise ValueError(
            "Training dataset is empty. Add more time-spanning "
            "hospital records before training."
        )
    print("Dataset rows:", len(df))
    print("Dataset columns:", df.columns.tolist())
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for target in TARGET_COLUMNS:
        if target not in df.columns:
            print(f"Skipping {target}: target not found.")
            continue
        print(f"\nTraining model for: {target}")
        excluded=[
            "next_emergency",
            "next_critical",
            "emergency_cases",
            "critical_cases",
        ]
        feature_columns=[
            col for col in df.columns
            if col not in excluded
            and col !=target
            and col !="date"
        ]
        X=df[feature_columns].copy()
        y=df[target].copy()
        X=X.replace([np.inf, -np.inf], np.nan)
        categorical=X.select_dtypes(
            include=["object", "category"]
        ).columns.tolist()
        if categorical:
            X= __import__("pandas").get_dummies(
                X, columns=categorical, dtype=int
            )
        if len(X)<10:
            print(
                f"Skipping {target}: only {len(X)} training rows. "
                "Collect more data first."
            )
            continue
        split_index=int(len(X) * 0.8)
        X_train=X.iloc[:split_index]
        X_test=X.iloc[split_index:]
        y_train=y.iloc[:split_index]
        y_test=y.iloc[split_index:]
        model=Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("regressor", RandomForestRegressor(
                n_estimators=200,
                random_state=42,
                min_samples_leaf=2,
                n_jobs=-1,
            )),
        ])
        model.fit(X_train, y_train)
        predictions=model.predict(X_test)
        mae=mean_absolute_error(y_test, predictions)
        rmse=np.sqrt(mean_squared_error(y_test, predictions))
        print("Training rows:", len(X_train))
        print("Testing rows:", len(X_test))
        print(f"MAE: {mae:.3f}")
        print(f"RMSE: {rmse:.3f}")
        model_path=MODEL_DIR / f"{target}.joblib"
        joblib.dump({
            "model": model,
            "features": X.columns.tolist(),
            "target": target,
        }, model_path)
        print("Saved:", model_path)
if __name__ == "__main__":
    main()
