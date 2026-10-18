"""One-time migration. Existing content is never overwritten."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
subprocess.run(["node", str(root / "scripts/content.mjs"), "--migrate", *sys.argv[1:]], cwd=root, check=True)
