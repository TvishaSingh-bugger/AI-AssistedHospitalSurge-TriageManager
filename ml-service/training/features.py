from pathlib import Path
import pandas as pd
import os
import mysql.connector
from dotenv import load_dotenv

PROJECT_ROOT=Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT/".env")

def get_connection():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST","localhost"),
        user=os.getenv("DB_USER"),
        port=int(os.getenv("DB_PORT", 3306)),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME","hospital_surge_db")
    )
def load_dataset():
    connection=get_connection()
    try:
        query="""SELECT
                c.case_id,
                c.hospital_id,
                h.hospital_name AS hospital,
                c.case_type,
                c.triage_level,
                c.priority,
                c.arrival_time AS date,
                c.arrival_time_units,
                c.burst_time,
                c.remaining_time,
                c.process_state
            FROM emergency_cases AS c
            JOIN hospitals AS h
                ON h.hospital_id = c.hospital_id
            ORDER BY c.arrival_time, c.case_id"""
        df=pd.read_sql(query, connection)
    finally:
        connection.close()
    if df.empty:
        raise ValueError("No data found in the database.")
    df.columns=(df.columns.str.strip().str.lower().str.replace(" ","_",regex=False))
    return df

def load_resource_history():
    connection=get_connection()
    try:
        query="""SELECT
                ri.hospital_id,
                ri.resource_type,
                rh.recorded_at,
                rh.total_quantity,
                rh.available_quantity,
                rh.used_quantity
                FROM resource_history AS rh
                JOIN resource_inventory AS ri
                ON ri.resource_id = rh.resource_id
                ORDER BY rh.recorded_at, ri.hospital_id, ri.resource_type
                """
        df=pd.read_sql(query, connection)
    finally:
        connection.close()
    if df.empty:
        raise ValueError("No data found in the database.")
    df.columns=(df.columns.str.strip().str.lower().str.replace(" ","_",regex=False))
    return df

def clean_dataset(df):
    df=df.copy().drop_duplicates()
    if "date" in df.columns:
        df["date"]=pd.to_datetime(
            df["date"],
            dayfirst=True,
            errors="coerce"
        )
        df=df.dropna(subset=["date"])
    numeric_columns=[
        "priority",
        "arrival_time_units",
        "burst_time",
        "remaining_time",
    ]
    for column in numeric_columns:
        if column in df.columns:
            df[column]=pd.to_numeric(
                df[column],errors="coerce"
            )
    return df.reset_index(drop=True)

def prepare_features(df,target_column):
    if target_column not in df.columns:
        raise ValueError(
            f"Target '{target_column}' not found."
            f"Available columns: {list(df.columns)}"
        )
    df=df.copy()
    future_columns=[
        column for column in df.columns
        if column.startswith("next_")
        or column.endswith("_shortage")
    ]
    X=df.drop(
        columns=[target_column]+future_columns,
        errors="ignore"
    )
    y=df[target_column]
    valid_rows=y.notna()
    X=X.loc[valid_rows].copy()
    y=y.loc[valid_rows].copy()
    if "date" in X.columns:
        X["day_of_week"] = X["date"].dt.dayofweek
        X["month"] = X["date"].dt.month
        X = X.drop(columns=["date"])
    categorical_columns=X.select_dtypes(
        include=["object","category"]
    ).columns.tolist()
    if categorical_columns:
        X=pd.get_dummies(
            X,
            columns=categorical_columns,
            dtype=int,
        )
    X=X.replace(
        [float("inf"),float("-inf")],
        float("nan"),
    )
    return X,y

def build_training_dataset(interval="30min"):
    cases=clean_dataset(load_dataset())
    if cases.empty:
        raise ValueError("No emergency cases available.")
    cases["date"]=pd.to_datetime(cases["date"], errors="coerce")
    cases = cases.dropna(subset=["date"])
    cases["is_critical"]=(
        cases["triage_level"].str.lower() == "critical"
    ).astype(int)
    grouped=(
        cases.set_index("date")
        .groupby("hospital_id")
        .resample(interval)
        .agg(
            emergency_cases=("case_id", "count"),
            critical_cases=("is_critical", "sum"),
        )
        .reset_index()
        .sort_values(["hospital_id", "date"])
    )
    grouped["next_emergency"]=(
        grouped.groupby("hospital_id")["emergency_cases"].shift(-1)
    )
    grouped["next_critical"]=(
        grouped.groupby("hospital_id")["critical_cases"].shift(-1)
    )
    grouped=grouped.dropna(
        subset=["next_emergency", "next_critical"]
    )
    return grouped.reset_index(drop=True)
