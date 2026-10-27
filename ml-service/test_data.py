from training.features import load_dataset, load_resource_history

cases = load_dataset()
resources = load_resource_history()

print("\nEmergency cases:")
print(cases.head())
print("Case rows:", len(cases))
print("Case columns:", cases.columns.tolist())

print("\nResource history:")
print(resources.head())
print("History rows:", len(resources))
