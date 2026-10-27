
from training.features import load_dataset, load_resource_history

cases = load_dataset()
resources = load_resource_history()

print("\n===== EMERGENCY CASE SUMMARY =====")
print("Total cases:", len(cases))
print("Hospitals:", cases["hospital_id"].nunique())
print("Date range:")
print(cases["date"].min(), "to", cases["date"].max())

print("\nCases by hospital:")
print(cases.groupby("hospital_id").size())

print("\nCases by triage level:")
print(cases["triage_level"].value_counts())

print("\n===== RESOURCE HISTORY SUMMARY =====")
print("Total snapshots:", len(resources))
print("Hospitals:", resources["hospital_id"].nunique())
print("Date range:")
print(resources["recorded_at"].min(), "to",
      resources["recorded_at"].max())

print("\nResource records by type:")
print(resources.groupby("resource_type").size())

print("\nResource history timestamps:")
print(
    resources[["recorded_at", "hospital_id", "resource_type"]]
    .sort_values("recorded_at")
    .to_string(index=False)
)
