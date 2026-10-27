from training.features import build_training_dataset

df = build_training_dataset(interval="30min")

print("\nTraining dataset:")
print(df.head(10))

print("\nDataset shape:", df.shape)
print("\nColumns:", df.columns.tolist())

print("\nTarget columns:")
print(df[["next_emergency", "next_critical"]].head())

