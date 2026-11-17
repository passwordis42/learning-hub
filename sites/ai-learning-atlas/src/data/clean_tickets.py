import csv
from pathlib import Path


folder = Path(__file__).resolve().parent
source = folder / "tickets.csv"
output = folder / "clean_tickets.csv"
header = ["问题", "分类"]
kept = []
seen = set()
read_count = empty_count = duplicate_count = 0

with source.open(encoding="utf-8-sig", newline="") as file:
    reader = csv.reader(file)
    if next(reader, None) != header:
        raise SystemExit("第一行应为：问题,分类")

    for fields in reader:
        read_count += 1
        if len(fields) != 2:
            raise SystemExit(f"第 {read_count} 条数据应该有两列。")

        question, category = (field.strip() for field in fields)
        if not question and not category:
            empty_count += 1
            continue

        key = (question, category)
        if key in seen:
            duplicate_count += 1
            continue

        seen.add(key)
        kept.append((question, category))

with output.open("w", encoding="utf-8", newline="") as file:
    writer = csv.writer(file)
    writer.writerow(header)
    writer.writerows(kept)

print(f"读入 {read_count} 条，空记录 {empty_count} 条，重复 {duplicate_count} 条，保留 {len(kept)} 条。")
print(f"结果已写入：{output}")
