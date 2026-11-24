"""Read cached PNG favicons for the live dashboard's requested URLs."""
import base64
import json
import os
import sqlite3
import sys
from pathlib import Path
from urllib.parse import urlsplit

chrome = Path.home() / "Library/Application Support/Google/Chrome"
profiles = json.loads((chrome / "Local State").read_text())["profile"]["info_cache"]
# An explicit profile is required if there is more than one to choose from.
profile = os.environ.get("SUNSHINE_CHROME_PROFILE")
if not profile and len(profiles) == 1:
    profile = next(iter(profiles))
if profile not in profiles:
    print("{}")
    sys.exit()
db = sqlite3.connect((chrome / profile / "Favicons").as_uri() + "?mode=ro&immutable=1", uri=True)
base = """SELECT b.image_data FROM icon_mapping m
          JOIN favicon_bitmaps b ON b.icon_id=m.icon_id WHERE """
order = " AND length(b.image_data) BETWEEN 1 AND 65536 ORDER BY abs(b.width-32), b.last_updated DESC LIMIT 1"
icons = {}
for url in json.load(sys.stdin):
    parts = urlsplit(url)
    if parts.scheme not in ("https", "http") or not parts.netloc:
        continue
    bare = parts._replace(fragment="").geturl()
    row = db.execute(base + "m.page_url IN (?,?)" + order, (url, bare)).fetchone()
    if not row:
        prefix = parts.scheme + "://" + parts.netloc + "/"
        if parts.hostname == "docs.google.com":
            prefix += parts.path.strip("/").split("/")[0] + "/"
        row = db.execute(base + "m.page_url >= ? AND m.page_url < ?" + order,
                         (prefix, prefix[:-1] + "0")).fetchone()
    if row and row[0].startswith(b"\x89PNG"):
        icons[url] = "data:image/png;base64," + base64.b64encode(row[0]).decode()
print(json.dumps(icons))
