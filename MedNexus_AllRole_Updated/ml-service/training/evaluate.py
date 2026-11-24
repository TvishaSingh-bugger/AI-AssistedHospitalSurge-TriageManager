from pathlib import Path
import sys

import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from features import TARGET_COLUMNS, build_training_dataset, split_by_time
    from train import NON_FEATURE_COLUMNS, make_model

    data = build_training_dataset(interval="30min")
    if data.empty:
        raise ValueError("No labeled intervals available for evaluation.")
    feature_columns = [column for column in data.columns if column not in NON_FEATURE_COLUMNS]
    print(f"Evaluation data: {len(data)} rows")
    for target in TARGET_COLUMNS:
        usable = data.dropna(subset=[target]).copy()
        if len(usable) < 2:
            print(f"{target}: need at least two labeled intervals for evaluation")
            continue
        train_rows, test_rows = split_by_time(usable)
        X_train = train_rows[feature_columns].replace([np.inf, -np.inf], np.nan)
        X_test = test_rows[feature_columns].replace([np.inf, -np.inf], np.nan)
        model = make_model().fit(X_train, train_rows[target])
        actual = test_rows[target].to_numpy()
        predictions = np.maximum(0, model.predict(X_test))
        mae = mean_absolute_error(actual, predictions)
        rmse = np.sqrt(mean_squared_error(actual, predictions))
        baseline_column = "emergency_cases" if target == "next_emergency" else "critical_cases"
        baseline_mae = mean_absolute_error(actual, X_test[baseline_column])
        print(f"{target}: holdout MAE={mae:.3f}, RMSE={rmse:.3f}, current-count baseline MAE={baseline_mae:.3f}, rows={len(actual)}")


if __name__ == "__main__":
    main()
