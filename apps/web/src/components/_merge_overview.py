from pathlib import Path

root = Path(r"c:\Users\auber\Documents\GitHub\devforge\apps\web\src\components")
src = root / "ProjectDetailPage.tsx"
head = (root / "_overview_head.tsx").read_text(encoding="utf-8")
full = src.read_text(encoding="utf-8")
marker = "function BackupsPanel"
idx = full.find(marker)
if idx < 0:
    raise SystemExit("marker not found")
head = head.replace("PLACEHOLDER_TAIL\n", "")
src.write_text(head + full[idx:], encoding="utf-8")
(root / "_overview_head.tsx").unlink()
print("ok", src.stat().st_size)
