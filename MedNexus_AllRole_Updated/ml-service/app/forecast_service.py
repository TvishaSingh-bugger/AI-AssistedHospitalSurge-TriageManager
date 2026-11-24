from pathlib import Path
import os

import joblib
import numpy as np
import pandas as pd
from dotenv import load_dotenv
import mysql.connector

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / "backend" / ".env")
MODEL_DIR = PROJECT_ROOT / "ml-service" / "models"
FEATURE_COLUMNS = [
    "hospital_id", "emergency_cases", "critical_cases",
    "emergency_cases_lag_1", "emergency_cases_lag_2",
    "emergency_cases_rolling_mean_3", "critical_cases_lag_1",
    "critical_cases_lag_2", "critical_cases_rolling_mean_3",
    "day_of_week", "hour", "time_sin", "time_cos",
]


def get_connection():
    user = os.getenv("DB_USER")
    if not user:
        raise RuntimeError("DB_USER is missing from backend/.env")
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=user,
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "hospital_surge_db"),
    )


def _model(target):
    path = MODEL_DIR / f"{target}.joblib"
    if not path.exists():
        raise FileNotFoundError(f"Model {path.name} is missing; train the models first.")
    bundle = joblib.load(path)
    if bundle.get("target") != target or bundle.get("features") != FEATURE_COLUMNS:
        raise ValueError(f"{path.name} was trained with incompatible features; retrain the models.")
    # Parallel prediction is slower for these small dashboard batches and can
    # flood the console with worker-configuration warnings on newer sklearn.
    regressor = getattr(bundle.get("model"), "named_steps", {}).get("regressor")
    if regressor is not None and hasattr(regressor, "set_params"):
        regressor.set_params(n_jobs=1)
    return bundle


def forecast(hospital_id: int, hours: int):
    connection = get_connection()
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """SELECT arrival_time, triage_level FROM emergency_cases
               WHERE hospital_id = %s
               ORDER BY arrival_time""",
            (hospital_id,),
        )
        cases = pd.DataFrame(cursor.fetchall())
        cursor.execute(
            """SELECT resource_type, SUM(available_quantity) AS available
               FROM resource_inventory WHERE hospital_id = %s
                 AND resource_type IN ('ICU_BED', 'VENTILATOR')
               GROUP BY resource_type""",
            (hospital_id,),
        )
        inventory = {r["resource_type"]: int(r["available"] or 0) for r in cursor.fetchall()}
        cursor.execute("SELECT hospital_name FROM hospitals WHERE hospital_id = %s", (hospital_id,))
        hospital = cursor.fetchone()
        cursor.close()
    finally:
        connection.close()

    if not hospital:
        return {"available": False, "message": "Hospital not found"}
    if cases.empty:
        return {"available": False, "message": "No recent case history for this hospital"}

    cases["arrival_time"] = pd.to_datetime(cases["arrival_time"])
    cases["slot"] = cases["arrival_time"].dt.floor("30min")
    cases["critical"] = cases["triage_level"].eq("Critical").astype(int)
    counts = cases.groupby("slot").agg(
        emergency_cases=("triage_level", "size"), critical_cases=("critical", "sum")
    )
    end = counts.index.max()
    start = max(counts.index.min(), end - pd.Timedelta(days=44))
    counts = counts.reindex(pd.date_range(start.floor("30min"), end, freq="30min"), fill_value=0)

    # Forecast starts at the next half-hour after the last recorded interval.
    now = pd.Timestamp.now().floor("30min") + pd.Timedelta(minutes=30)
    if now.tz is not None:
        now = now.tz_localize(None)
    current = counts.iloc[-1].copy()
    history_total = counts["emergency_cases"].astype(float).tolist()
    history_critical = counts["critical_cases"].astype(float).tolist()
    bundles = {name: _model(name) for name in ("next_emergency", "next_critical")}
    slots = []

    for i in range(int(round(hours * 2))):
        moment = now + pd.Timedelta(minutes=30 * i)
        minute_of_day = moment.hour * 60 + moment.minute
        features = {
            "hospital_id": hospital_id,
            "emergency_cases": float(current["emergency_cases"]),
            "critical_cases": float(current["critical_cases"]),
            "emergency_cases_lag_1": history_total[-2] if len(history_total) > 1 else 0.0,
            "emergency_cases_lag_2": history_total[-3] if len(history_total) > 2 else 0.0,
            "emergency_cases_rolling_mean_3": float(np.mean(history_total[-4:-1])) if len(history_total) > 1 else 0.0,
            "critical_cases_lag_1": history_critical[-2] if len(history_critical) > 1 else 0.0,
            "critical_cases_lag_2": history_critical[-3] if len(history_critical) > 2 else 0.0,
            "critical_cases_rolling_mean_3": float(np.mean(history_critical[-4:-1])) if len(history_critical) > 1 else 0.0,
            "day_of_week": moment.dayofweek,
            "hour": moment.hour,
            "minute_of_day": minute_of_day,
            "time_sin": float(np.sin(2 * np.pi * minute_of_day / 1440)),
            "time_cos": float(np.cos(2 * np.pi * minute_of_day / 1440)),
        }
        frame = pd.DataFrame([[features[c] for c in FEATURE_COLUMNS]], columns=FEATURE_COLUMNS)
        expected = max(0.0, float(bundles["next_emergency"]["model"].predict(frame)[0]))
        critical = max(0.0, min(expected, float(bundles["next_critical"]["model"].predict(frame)[0])))
        expected, critical = round(expected, 2), round(critical, 2)
        slots.append({"start": moment.isoformat(), "expected_cases": expected, "expected_critical": critical})
        history_total.append(expected)
        history_critical.append(critical)
        current = pd.Series({"emergency_cases": expected, "critical_cases": critical})

    total = sum(s["expected_cases"] for s in slots)
    critical_total = sum(s["expected_critical"] for s in slots)
    icu = inventory.get("ICU_BED", 0)
    vent = inventory.get("VENTILATOR", 0)
    capacity = max(1, min(icu, vent or icu))
    ratio = critical_total / capacity
    risk = "HIGH" if ratio >= 1 else "MEDIUM" if ratio >= 0.6 else "LOW"
    return {
        "available": True, "method": "database-trained random forest",
        "history_days_used": int((counts.index.max() - counts.index.min()).days) + 1,
        "history_ends": end.isoformat(), "horizon_hours": hours,
        "expected_cases": round(total, 1), "expected_critical_cases": round(critical_total, 1),
        "icu_available": icu, "ventilators_available": vent, "risk": risk, "slots": slots,
    }


def forecast_all_hospitals():
    """Return one next-30-minute ML estimate per hospital in a single DB read."""
    connection = get_connection()
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """SELECT hospital_id, arrival_time, triage_level
               FROM emergency_cases
               ORDER BY hospital_id, arrival_time"""
        )
        cases = pd.DataFrame(cursor.fetchall())
        cursor.execute("SELECT hospital_id FROM hospitals ORDER BY hospital_id")
        hospitals = [int(row["hospital_id"]) for row in cursor.fetchall()]
        cursor.close()
    finally:
        connection.close()

    bundles = {name: _model(name) for name in ("next_emergency", "next_critical")}
    moment = pd.Timestamp.now().floor("30min") + pd.Timedelta(minutes=30)
    rows = []
    pending = []
    if not cases.empty:
        cases["arrival_time"] = pd.to_datetime(cases["arrival_time"])
        cases["slot"] = cases["arrival_time"].dt.floor("30min")
        cases["critical"] = cases["triage_level"].eq("Critical").astype(int)

    grouped_cases = {
        int(hospital_id): group
        for hospital_id, group in cases.groupby("hospital_id")
    } if not cases.empty else {}

    for hospital_id in hospitals:
        group = grouped_cases.get(hospital_id)
        if group is None or group.empty:
            rows.append({"hospital_id": hospital_id, "available": False})
            continue

        counts = group.groupby("slot").agg(
            emergency_cases=("triage_level", "size"),
            critical_cases=("critical", "sum"),
        )
        end = counts.index.max()
        start = max(counts.index.min(), end - pd.Timedelta(days=44))
        counts = counts.reindex(
            pd.date_range(start.floor("30min"), end, freq="30min"), fill_value=0
        )
        total_history = counts["emergency_cases"].astype(float).tolist()
        critical_history = counts["critical_cases"].astype(float).tolist()
        current = counts.iloc[-1]
        minute_of_day = moment.hour * 60 + moment.minute
        features = {
            "hospital_id": hospital_id,
            "emergency_cases": float(current["emergency_cases"]),
            "critical_cases": float(current["critical_cases"]),
            "emergency_cases_lag_1": total_history[-2] if len(total_history) > 1 else 0.0,
            "emergency_cases_lag_2": total_history[-3] if len(total_history) > 2 else 0.0,
            "emergency_cases_rolling_mean_3": float(np.mean(total_history[-4:-1])) if len(total_history) > 1 else 0.0,
            "critical_cases_lag_1": critical_history[-2] if len(critical_history) > 1 else 0.0,
            "critical_cases_lag_2": critical_history[-3] if len(critical_history) > 2 else 0.0,
            "critical_cases_rolling_mean_3": float(np.mean(critical_history[-4:-1])) if len(critical_history) > 1 else 0.0,
            "day_of_week": moment.dayofweek,
            "hour": moment.hour,
            "time_sin": float(np.sin(2 * np.pi * minute_of_day / 1440)),
            "time_cos": float(np.cos(2 * np.pi * minute_of_day / 1440)),
        }
        pending.append((hospital_id, features))

    if pending:
        frame = pd.DataFrame(
            [{column: features[column] for column in FEATURE_COLUMNS} for _, features in pending],
            columns=FEATURE_COLUMNS,
        )
        expected_values = bundles["next_emergency"]["model"].predict(frame)
        critical_values = bundles["next_critical"]["model"].predict(frame)
        for (hospital_id, _), expected_value, critical_value in zip(
            pending, expected_values, critical_values
        ):
            expected = max(0.0, float(expected_value))
            critical = max(0.0, min(expected, float(critical_value)))
            rows.append({
                "hospital_id": hospital_id,
                "available": True,
                "source": "hospital history",
                "expected_cases": round(expected, 2),
                "expected_critical": round(critical, 2),
            })

    history_rows = [row for row in rows if row.get("available")]
    if history_rows:
        shared_cases = sum(row["expected_cases"] for row in history_rows) / len(history_rows)
        shared_critical = sum(row["expected_critical"] for row in history_rows) / len(history_rows)
        for row in rows:
            if not row.get("available"):
                row.update({
                    "available": True,
                    "source": "shared hospital estimate",
                    "expected_cases": round(shared_cases, 2),
                    "expected_critical": round(shared_critical, 2),
                })

    return {"available": True, "method": "database-trained random forest", "forecasts": rows}
