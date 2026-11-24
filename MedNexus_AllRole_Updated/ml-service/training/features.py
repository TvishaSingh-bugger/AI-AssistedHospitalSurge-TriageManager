from pathlib import Path
import os

import numpy as np
import pandas as pd
from dotenv import load_dotenv
import mysql.connector

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / "backend" / ".env")
load_dotenv(PROJECT_ROOT / ".env", override=False)

TARGET_COLUMNS = ["next_emergency", "next_critical"]


def get_connection():
    """Open the project MySQL database using its .env settings."""
    user = os.getenv("DB_USER")
    if not user:
        raise RuntimeError("DB_USER is missing from the project .env file.")
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        user=user,
        port=int(os.getenv("DB_PORT", "3306")),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "hospital_surge_db"),
    )


def _read_sql(query):
    connection = get_connection()
    try:
        return pd.read_sql_query(query, connection)
    finally:
        connection.close()


def load_dataset():
    """Load case-level data required for demand forecasting."""
    df = _read_sql("""
        SELECT c.case_id, c.hospital_id, h.hospital_name AS hospital,
               c.triage_level, c.arrival_time AS date
        FROM emergency_cases AS c
        JOIN hospitals AS h ON h.hospital_id = c.hospital_id
        ORDER BY c.arrival_time, c.case_id
    """)
    if df.empty:
        raise ValueError("No emergency cases found in the database.")
    return clean_dataset(df)


def load_resource_history():
    """Load resource snapshots for inspection; these have no shortage labels."""
    df = _read_sql("""
        SELECT ri.hospital_id, ri.resource_type, rh.recorded_at,
               rh.total_quantity, rh.available_quantity, rh.used_quantity
        FROM resource_history AS rh
        JOIN resource_inventory AS ri ON ri.resource_id = rh.resource_id
        ORDER BY rh.recorded_at, ri.hospital_id, ri.resource_type
    """)
    if df.empty:
        raise ValueError("No resource history found in the database.")
    df["recorded_at"] = pd.to_datetime(df["recorded_at"], errors="coerce")
    return df.dropna(subset=["recorded_at"]).reset_index(drop=True)


def clean_dataset(df):
    df = df.copy().drop_duplicates()
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"])
    if "triage_level" in df.columns:
        df["triage_level"] = df["triage_level"].astype("string").str.strip().str.lower()
    return df.reset_index(drop=True)


def prepare_features(df, target_column):
    """Generic tabular feature preparation retained for exploratory scripts."""
    if target_column not in df.columns:
        raise ValueError(f"Target '{target_column}' not found in {list(df.columns)}")
    data = df.copy()
    y = data.pop(target_column)
    if "date" in data:
        date = pd.to_datetime(data.pop("date"), errors="coerce")
        data["day_of_week"] = date.dt.dayofweek
        data["hour"] = date.dt.hour
        data["month"] = date.dt.month
    data = pd.get_dummies(data, dtype=int)
    data = data.replace([np.inf, -np.inf], np.nan)
    valid = y.notna()
    return data.loc[valid].reset_index(drop=True), y.loc[valid].reset_index(drop=True)


def build_interval_dataset(interval="30min"):
    """Aggregate cases and add only information available at each interval."""
    cases = clean_dataset(load_dataset())
    if cases.empty:
        raise ValueError("No emergency cases available.")
    cases["is_critical"] = cases["triage_level"].eq("critical").astype("int8")
    grouped = (
        cases.set_index("date")
        .groupby("hospital_id")
        .resample(interval)
        .agg(emergency_cases=("case_id", "count"), critical_cases=("is_critical", "sum"))
        .reset_index()
        .sort_values(["date", "hospital_id"])
        .reset_index(drop=True)
    )
    by_hospital = grouped.groupby("hospital_id", sort=False)
    for column in ("emergency_cases", "critical_cases"):
        grouped[f"{column}_lag_1"] = by_hospital[column].shift(1)
        grouped[f"{column}_lag_2"] = by_hospital[column].shift(2)
        grouped[f"{column}_rolling_mean_3"] = by_hospital[column].transform(
            lambda values: values.shift(1).rolling(3, min_periods=1).mean()
        )
        target_name = "next_" + column.removesuffix("_cases")
        grouped[target_name] = by_hospital[column].shift(-1)
    grouped["day_of_week"] = grouped["date"].dt.dayofweek
    grouped["hour"] = grouped["date"].dt.hour
    grouped["minute_of_day"] = grouped["date"].dt.hour * 60 + grouped["date"].dt.minute
    grouped["time_sin"] = np.sin(2 * np.pi * grouped["minute_of_day"] / 1440)
    grouped["time_cos"] = np.cos(2 * np.pi * grouped["minute_of_day"] / 1440)
    return grouped


def build_training_dataset(interval="30min"):
    """Return rows with known next-interval targets."""
    grouped = build_interval_dataset(interval)
    return grouped.dropna(subset=TARGET_COLUMNS).reset_index(drop=True)


def split_by_time(data, train_fraction=0.8):
    """Split on timestamps so simultaneous hospital intervals stay together."""
    ordered = data.sort_values("date").reset_index(drop=True)
    timestamps = ordered["date"].drop_duplicates().sort_values().reset_index(drop=True)
    if len(timestamps) < 2:
        raise ValueError("At least two distinct timestamps are required for a time holdout.")
    split_index = min(max(1, int(len(timestamps) * train_fraction)), len(timestamps) - 1)
    cutoff = timestamps.iloc[split_index]
    return ordered[ordered["date"] < cutoff].copy(), ordered[ordered["date"] >= cutoff].copy()
