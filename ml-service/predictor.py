"""Sole entry point for risk prediction. Per CLAUDE.md: "Express calls
predictor.py only" / "Never call individual algo files directly" — nothing
outside this file should import from algorithms/ directly.

IMPORTANT: this is currently trained on ml-service/data/dummy_train.csv, a
small synthetic placeholder dataset — NOT real patient data. This proves the
swappable-algorithm architecture works end-to-end; real training happens once
real dental IPTR data is cleaned (Sprint 21a-21d). Do not treat predictions
from this module as clinically meaningful yet.
"""

from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import config
from algorithms.base import RiskClassifier
from algorithms.decision_tree import DecisionTreeRiskClassifier
from algorithms.logistic_regression import LogisticRegressionClassifier
from algorithms.random_forest import RandomForestRiskClassifier
from algorithms.svm import SVMRiskClassifier
from algorithms.xgboost_model import XGBoostRiskClassifier

FEATURE_COLUMNS = [
    "dmf_score",
    "decayed_count",
    "missing_count",
    "filled_count",
    "gingivitis",
    "periodontal_disease",
    "debris",
    "calculus",
    "abnormal_growth",
    "sugar_beverages",
    "tobacco_user",
    "age",
    "sex",
]
LABEL_COLUMN = "risk_level"

_REGISTRY: dict[str, type[RiskClassifier]] = {
    "logistic_regression": LogisticRegressionClassifier,
    "decision_tree": DecisionTreeRiskClassifier,
    "random_forest": RandomForestRiskClassifier,
    "svm": SVMRiskClassifier,
    "xgboost": XGBoostRiskClassifier,
}


def algorithm_registry() -> dict[str, type[RiskClassifier]]:
    """Public, read-only view of the registry — used by the Sprint 21c
    experiment runner so it never imports algorithm modules directly."""
    return dict(_REGISTRY)


def get_active_classifier() -> RiskClassifier:
    algo_key = config.ACTIVE_ALGORITHM
    if algo_key not in _REGISTRY:
        raise ValueError(
            f"Unknown ACTIVE_ALGORITHM '{algo_key}' in config.py — must be one of {list(_REGISTRY)}"
        )
    return _REGISTRY[algo_key]()


_classifier: RiskClassifier | None = None
_model_meta: dict = {}

MODEL_PATH = Path(__file__).resolve().parent / "active" / "model.pkl"

# SCOPE (user/classmate decision 2026-10-04, "hanggang risk lang tayo"): the
# model classifies caries RISK and nothing else. Treatment recommendations are
# RULE-BASED in the app (dental-4-12-main/project/shared/riskTreatments.ts)
# and confirmed by the dentist one by one. This service used to also return a
# fixed sentence per risk level ("recommendation"); it was a lookup, not
# learned, but coming from the model it read as the model recommending
# treatment, so it was removed.


def load_model() -> RiskClassifier:
    """Load the persisted trained model (train.py output). Falls back to
    training in-memory on the placeholder CSV if no bundle exists yet."""
    global _classifier, _model_meta
    if MODEL_PATH.exists():
        bundle = joblib.load(MODEL_PATH)
        _classifier = bundle["classifier"]
        _model_meta = {k: v for k, v in bundle.items() if k != "classifier"}
    else:
        train()
    return _classifier


def model_info() -> dict:
    """Metadata about the currently loaded model (for /health and the UI's
    honesty banner — the frontend shows the synthetic_data flag)."""
    if _classifier is None:
        load_model()
    return {"algorithm": _classifier.display_name, **_model_meta}


def train(dataset_path: str = "data/dummy_train.csv") -> RiskClassifier:
    """Trains the currently active algorithm (per config.py) and caches it.
    For persisted training use train.py, which saves to active/model.pkl."""
    global _classifier
    df = pd.read_csv(dataset_path)
    X = df[FEATURE_COLUMNS]
    y = df[LABEL_COLUMN]
    classifier = get_active_classifier()
    classifier.train(X, y)
    _classifier = classifier
    return classifier


def _top_features(clf: RiskClassifier, X: pd.DataFrame, risk_level: str) -> list[str]:
    """Best-effort top-3 contributing features for this prediction.
    Linear models: per-instance contribution (coef × value) toward the
    predicted class. Tree ensembles: global feature importance. Others: []"""
    model = getattr(clf, "model", None)
    try:
        if hasattr(model, "coef_"):
            idx = list(model.classes_).index(risk_level)
            contrib = model.coef_[idx] * X.iloc[0].to_numpy(dtype=float)
            order = np.argsort(contrib)[::-1]
            return [FEATURE_COLUMNS[i] for i in order[:3] if contrib[i] > 0]
        if hasattr(model, "feature_importances_"):
            order = np.argsort(model.feature_importances_)[::-1]
            return [FEATURE_COLUMNS[i] for i in order[:3]]
    except Exception:
        pass
    return []


def predict_risk(features: dict) -> dict:
    """features: dict with keys matching FEATURE_COLUMNS.
    Returns {risk_level, confidence, probabilities, top_features, algorithm}
    (Sprint 21e spec, minus `recommendation` since 2026-10-04: risk only).
    Dentist MUST validate before any clinical action — this never replaces
    clinical judgment (see CLAUDE.md's ABSOLUTE DO NOT list)."""
    if _classifier is None:
        load_model()
    X = pd.DataFrame([features])[FEATURE_COLUMNS]
    risk_level = _classifier.predict(X)[0]
    probabilities = {k: float(v) for k, v in _classifier.predict_proba(X)[0].items()}
    return {
        "risk_level": risk_level,
        "confidence": max(probabilities.values()),
        "probabilities": probabilities,
        "top_features": _top_features(_classifier, X, risk_level),
        "algorithm": _classifier.display_name,
    }


if __name__ == "__main__":
    clf = train()
    sample = {
        "dmf_score": 5.0,
        "decayed_count": 3,
        "missing_count": 1,
        "filled_count": 1,
        "gingivitis": 1,
        "periodontal_disease": 0,
        "debris": 1,
        "calculus": 0,
        "abnormal_growth": 0,
        "sugar_beverages": 1,
        "tobacco_user": 0,
        "age": 10,
        "sex": 0,
    }
    result = predict_risk(sample)
    print(f"Active algorithm: {clf.display_name}")
    print(f"Prediction: {result}")
