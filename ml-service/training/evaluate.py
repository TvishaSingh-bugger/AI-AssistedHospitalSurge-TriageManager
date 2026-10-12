from pathlib import Path
import sys
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
)
PROJECT_ROOT=Path(__file__).resolve().parents[2]
MODEL_DIR=PROJECT_ROOT/"ml-service"/"models"
TARGET_COLUMNS=[
    "next_emergency",
    "next_critical",
    "icu_shortage",
    "vent_shortage"
]
SHORTAGE_TARGETS=["icu_shortage","vent_shortage"]
def main():
    training_dir=Path(__file__).resolve().parent
    sys.path.insert(0,str(training_dir))
    from features import load_dataset,clean_dataset,prepare_features
